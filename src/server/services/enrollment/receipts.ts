/**
 * Receipt submission — §9.2 step 2 and the §1678 pipeline, wired to the
 * `RECEIPT_SUBMITTED` edge of the state machine.
 *
 * Order of operations, and why:
 * 1. The bytes go through `processReceiptUpload` **outside** the transaction —
 *    sharp work does not belong inside a database lock.
 * 2. The processed object is written to storage, still outside the
 *    transaction: storage is idempotent (a re-run overwrites the same content)
 *    and an orphaned object is reclaimed by the `cleanup` cron, whereas a
 *    database row pointing at a missing object is a broken receipt viewer.
 * 3. The transaction re-reads the request, runs the machine edge with a
 *    compare-and-set, updates the receipt columns, and executes the declared
 *    effects (timeline, e-mails 6+7, notifications, audit).
 *
 * Duplicate detection (§9.2 rule 6) happens inside the transaction: the fresh
 * SHA-256 is compared against every *other* request. A match never blocks —
 * it rides along to the admin e-mail and is re-derived by the §17.3 queue.
 */

import { transaction } from '@/server/db';
import { ActionError } from '@/server/auth/guards';
import { buildStorageKey, getStorage } from '@/server/storage';
import { processReceiptUpload, scanFile, RECEIPT_MAX_BYTES } from '@/server/storage/images';
import { applyTransition } from './state-machine';
import {
  appendTimeline,
  executeRequestEffects,
  requestExpiryDays,
  REQUEST_SUBJECT_SELECT,
  type ActorContext,
} from './requests';

export interface SubmitReceiptInput {
  readonly requestId: string;
  /** The raw upload — original bytes, straight out of the `File`. */
  readonly fileBytes: Buffer;
  /** Student-declared transfer date (§9.2: ≤ today, ≥ today − 30 j). */
  readonly transferDate: Date;
  /** Optional bank reference the student copied from their app. */
  readonly bankReference?: string | null;
  /** Optional message to the admin. */
  readonly message?: string | null;
}

export interface SubmitReceiptResult {
  readonly requestId: string;
  readonly reference: string;
  readonly status: 'UNDER_REVIEW';
  /** §9.2 rule 6 — informational; the admin decides. */
  readonly duplicateReceipt: boolean;
}

/** Maximum age of the declared transfer date (§9.2 step 2). */
export const TRANSFER_DATE_MAX_AGE_DAYS = 30;

/**
 * Attach a justificatif and move the request under review.
 *
 * Legal from `AWAITING_RECEIPT` (first submission — e-mails 6 + 7) and from
 * `INFO_REQUESTED` (re-submission — admins alerted again). Everything else is
 * an illegal edge and comes back as a typed refusal.
 */
export async function submitReceipt(
  input: SubmitReceiptInput,
  ctx: ActorContext,
): Promise<SubmitReceiptResult> {
  const now = ctx.now ?? new Date();

  // §9.2 step 2 — declared date sanity, before any expensive work.
  const ageMs = now.getTime() - input.transferDate.getTime();
  if (ageMs < -24 * 60 * 60 * 1000 || ageMs > TRANSFER_DATE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
    throw new ActionError('validation', 'course.request.transferDateOutOfRange', {
      transferDate: ['course.request.transferDateOutOfRange'],
    });
  }

  // 1 — The §1678 pipeline: size, magic bytes, re-encode, digest.
  const processed = await processReceiptUpload(input.fileBytes, RECEIPT_MAX_BYTES);
  if (!processed.ok) {
    const key =
      processed.reason === 'TOO_LARGE' ? 'errors.fileTooLarge' : 'errors.fileWrongType';
    throw new ActionError('validation', key, { file: [key] });
  }

  const scan = await scanFile(processed.body);
  if (!scan.clean) {
    throw new ActionError('validation', 'errors.fileWrongType', {
      file: ['errors.fileWrongType'],
    });
  }

  // 2 — Store the processed object under a fresh, server-built key.
  const storage = await getStorage();
  const storageKey = buildStorageKey('private/receipts', 'justificatif', processed.ext, now);
  await storage.put(storageKey, processed.body, { contentType: processed.contentType });

  // 3 — The transaction: machine edge, receipt columns, effects.
  return transaction(async (tx) => {
    const request = await tx.enrollmentRequest.findFirst({
      // Scoped by the actor (§20): only the owner may attach a receipt.
      where: { id: input.requestId, userId: ctx.userId },
      select: REQUEST_SUBJECT_SELECT,
    });
    if (request === null) throw new ActionError('not_found', 'course.request.notFound');

    const transition = applyTransition(request.status, 'RECEIPT_SUBMITTED');
    if (!transition.ok) {
      throw new ActionError('conflict', 'course.request.receiptNotExpected');
    }

    // §9.2 rule 6 — same digest on any OTHER request, whoever owns it.
    const duplicate = await tx.enrollmentRequest.findFirst({
      where: { receiptSha256: processed.sha256, id: { not: request.id } },
      select: { id: true },
    });
    const duplicateReceipt = duplicate !== null;

    // Compare-and-set: a double-posted form submits one receipt, not two
    // timelines and four e-mails.
    const expiryDays = await requestExpiryDays(tx);
    const updated = await tx.enrollmentRequest.updateMany({
      where: { id: request.id, status: request.status },
      data: {
        status: transition.to,
        receiptKey: storageKey,
        receiptMime: processed.contentType,
        receiptSizeBytes: processed.sizeBytes,
        receiptSha256: processed.sha256,
        receiptUploadedAt: now,
        transferDate: input.transferDate,
        transferBankRef: normalize(input.bankReference),
        studentMessage: normalize(input.message),
        // The clock restarts: the ball is now in the centre's court, and a
        // review that outlives the original window must not expire mid-queue.
        expiresAt: new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000),
      },
    });
    if (updated.count === 0) {
      throw new ActionError('conflict', 'course.request.receiptNotExpected');
    }

    // The RECEIPT_UPLOADED timeline row doubles as the per-submission key the
    // repeatable admin e-mail derives its idempotency from.
    const eventKey = await appendTimeline(tx, request.id, 'RECEIPT_UPLOADED', ctx.userId, {
      metadata: {
        sha256: processed.sha256,
        sizeBytes: processed.sizeBytes,
        contentType: processed.contentType,
        duplicateReceipt,
      },
    });

    // The machine's TIMELINE effects include RECEIPT_UPLOADED; it was just
    // written with richer metadata, so hand the executor the remainder.
    const effects = transition.effects.filter(
      (effect) => !(effect.kind === 'TIMELINE' && effect.type === 'RECEIPT_UPLOADED'),
    );

    await executeRequestEffects({
      tx,
      subject: request,
      effects,
      actorId: ctx.userId,
      summary: `Justificatif reçu pour la demande ${request.reference}.`,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      extras: { duplicateReceipt, eventKey },
      now,
    });

    return {
      requestId: request.id,
      reference: request.reference,
      status: 'UNDER_REVIEW' as const,
      duplicateReceipt,
    };
  });
}

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}
