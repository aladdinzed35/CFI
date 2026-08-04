'use server';

/**
 * Server actions for the §17.3 verification queue.
 *
 * Every export goes through {@link withAction}: Origin check → Zod `.strict()`
 * → session → the §8 capability `payment.verify` → handler. Nothing below that
 * line touches the database.
 *
 * ## The decisions live in the domain, not here
 * `approveRequest`, `requestInfo` and `rejectRequest` each own ONE transaction
 * containing the compare-and-set gate, the Payment with its `FAC-####`, the
 * Enrollment, the counters, the coupon, the invoice job, the §18 e-mail, the
 * notification, the timeline row and the audit row. This file authorises,
 * reshapes the result into the sentence §17.3 requires the interface to show —
 * « Accès activé · Facture FAC-2026-0042 générée · E-mail envoyé à salma@… » —
 * and invalidates the admin cache. It never re-implements a single write.
 *
 * ## `changed: false` is an answer, not a failure
 * A double-clicked « Approuver » matches zero rows in the compare-and-set and
 * comes back unchanged. The interface says so rather than pretending a second
 * activation happened; §22's double-submit test leans on exactly this.
 */

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import type { RequestStatus } from '@prisma/client';

import { db, transaction } from '@/server/db';
import { ActionError, withAction } from '@/server/auth/guards';
import { buildDiff, recordAudit } from '@/server/services/audit';
import {
  approveRequest,
  rejectRequest,
  requestInfo,
} from '@/server/services/enrollment/verification';

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                               */
/* -------------------------------------------------------------------------- */

const requestIdSchema = z.string().min(1).max(64);

/**
 * A reason an administrator writes for a student to read (§18 rows 8 and 10).
 *
 * Not exported: a `'use server'` module may only export async functions, so the
 * drawer reads the same minimum from `demandes/request-view.ts`.
 */
const REQUEST_MESSAGE_MIN = 5;
const REQUEST_MESSAGE_MAX = 2_000;

const messageSchema = z.string().trim().min(REQUEST_MESSAGE_MIN).max(REQUEST_MESSAGE_MAX);

/** `EnrollmentRequest.adminNote` is a private TEXT column. */
const ADMIN_NOTE_MAX = 4_000;

/**
 * What happened to one request, in the shape the drawer announces.
 *
 * `studentEmail` is only filled when a decision actually went out, so the
 * interface cannot claim « e-mail envoyé » about a no-op.
 */
export interface RequestDecision {
  readonly requestId: string;
  readonly reference: string;
  readonly status: RequestStatus;
  /** `false` — the request was already in the target state; nothing was sent. */
  readonly changed: boolean;
  readonly studentName: string;
  /** The address the decision e-mail went to, or `null` when nothing was sent. */
  readonly studentEmail: string | null;
  /** `FAC-2026-0042`, on a fresh approval only. */
  readonly invoiceNumber: string | null;
}

/** Refresh every screen under the admin layout — lists and the pending counter. */
function revalidateAdmin(): void {
  revalidatePath('/[locale]/admin', 'layout');
}

/**
 * The student behind a request, loaded before the decision so the outcome can
 * name them even when the transition turns out to be a no-op.
 */
async function loadSubject(
  requestId: string,
): Promise<{ reference: string; fullName: string; email: string }> {
  const row = await db.enrollmentRequest.findUnique({
    where: { id: requestId },
    select: { reference: true, user: { select: { fullName: true, email: true } } },
  });
  if (row === null) throw new ActionError('not_found', 'admin.actionError.notFound');
  return { reference: row.reference, fullName: row.user.fullName, email: row.user.email };
}

/* -------------------------------------------------------------------------- */
/* Approve — « Approuver et activer l'accès »                                  */
/* -------------------------------------------------------------------------- */

/**
 * §1666 row 4, in one transaction owned by the domain service. Idempotent: a
 * second press returns `changed: false` and activates nothing twice.
 */
export const approveRequestAction = withAction(
  z.object({ requestId: requestIdSchema }).strict(),
  async (input, ctx): Promise<RequestDecision> => {
    const subject = await loadSubject(input.requestId);

    const result = await approveRequest(input.requestId, {
      userId: ctx.user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    revalidateAdmin();

    return {
      requestId: input.requestId,
      reference: subject.reference,
      status: result.status,
      changed: result.changed,
      studentName: subject.fullName,
      studentEmail: result.changed ? subject.email : null,
      invoiceNumber: result.invoiceNumber ?? null,
    };
  },
  { auth: 'active', can: 'payment.verify' },
);

/* -------------------------------------------------------------------------- */
/* Request info — « Demander un justificatif plus lisible »                    */
/* -------------------------------------------------------------------------- */

/**
 * §1666 row 3. The message reaches the student verbatim in e-mail #8, so it is
 * required: « merci de renvoyer » with nothing after it helps nobody.
 */
export const requestInfoAction = withAction(
  z.object({ requestId: requestIdSchema, message: messageSchema }).strict(),
  async (input, ctx): Promise<RequestDecision> => {
    const subject = await loadSubject(input.requestId);

    const result = await requestInfo(input.requestId, input.message, {
      userId: ctx.user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    revalidateAdmin();

    return {
      requestId: input.requestId,
      reference: subject.reference,
      status: result.status,
      changed: result.changed,
      studentName: subject.fullName,
      studentEmail: result.changed ? subject.email : null,
      invoiceNumber: null,
    };
  },
  { auth: 'active', can: 'payment.verify' },
);

/* -------------------------------------------------------------------------- */
/* Reject — « Refuser »                                                        */
/* -------------------------------------------------------------------------- */

/**
 * §1666 row 5. The reason is mandatory and is what the student reads in e-mail
 * #10, which is why it is free text rather than a code: the administrator
 * writes the sentence, the template shows it unchanged.
 */
export const rejectRequestAction = withAction(
  z.object({ requestId: requestIdSchema, reason: messageSchema }).strict(),
  async (input, ctx): Promise<RequestDecision> => {
    const subject = await loadSubject(input.requestId);

    const result = await rejectRequest(input.requestId, input.reason, {
      userId: ctx.user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    revalidateAdmin();

    return {
      requestId: input.requestId,
      reference: subject.reference,
      status: result.status,
      changed: result.changed,
      studentName: subject.fullName,
      studentEmail: result.changed ? subject.email : null,
      invoiceNumber: null,
    };
  },
  { auth: 'active', can: 'payment.verify' },
);

/* -------------------------------------------------------------------------- */
/* Internal note                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The administration's private note on a request (§17.3 drawer).
 *
 * Not a state transition, so it does not go through the machine — but it is
 * still an admin mutation, so it is audited in the same transaction (§20). The
 * audit row records the fact and the size of the change, never the text: a note
 * written about a person must not be copied into a table with a wider audience.
 */
export const updateRequestNoteAction = withAction(
  z.object({ requestId: requestIdSchema, note: z.string().max(ADMIN_NOTE_MAX) }).strict(),
  async (input, ctx): Promise<{ readonly saved: true }> => {
    const note = input.note.trim();

    await transaction(async (tx) => {
      const before = await tx.enrollmentRequest.findUnique({
        where: { id: input.requestId },
        select: { reference: true, adminNote: true },
      });
      if (before === null) throw new ActionError('not_found', 'admin.actionError.notFound');

      await tx.enrollmentRequest.update({
        where: { id: input.requestId },
        data: { adminNote: note === '' ? null : note },
      });

      await recordAudit(
        {
          actorId: ctx.user.id,
          action: 'REQUEST_NOTE_UPDATED',
          entityType: 'EnrollmentRequest',
          entityId: input.requestId,
          summary: `Note interne de la demande ${before.reference} modifiée.`,
          diff: buildDiff(
            { adminNoteLength: before.adminNote?.length ?? 0 },
            { adminNoteLength: note.length },
          ),
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });

    revalidateAdmin();
    return { saved: true };
  },
  { auth: 'active', can: 'payment.verify' },
);
