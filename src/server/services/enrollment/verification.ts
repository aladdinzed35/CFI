/**
 * Admin verification — approve, reject, request info, manual grant
 * (§9.2 rules 2/5/9, §1666 rows 3–5, §17.3).
 *
 * ## The approval transaction, §1666 row 4, in full
 * Inside ONE `transaction()`:
 *   compare-and-set `status → APPROVED`   ← the idempotency gate
 *   → `Payment(receivedAt, invoiceNumber)` (FAC-#### allocated here)
 *   → `Enrollment(ACTIVE)` linked by `requestId`
 *   → `Course.seatsTaken` + `Course.enrollmentCount` incremented
 *   → coupon `usedCount` consumed
 *   → `GENERATE_INVOICE` job enqueued
 *   → e-mail #9 queued, notification created, timeline row, audit row
 *
 * The compare-and-set is what the §22 double-submit test leans on: the second
 * click matches zero rows, returns `{ changed: false }`, and nothing after the
 * gate runs — ONE payment, ONE enrollment, however many clicks. The unique
 * constraints (`Payment.requestId`, `Enrollment.requestId`,
 * `Enrollment(userId, courseId)`) are the §9.2 rule 2 safety net underneath.
 */

import type { RequestStatus } from '@prisma/client';

import { transaction } from '@/server/db';
import { ActionError } from '@/server/auth/guards';
import { generateInvoiceNumber } from '@/lib/crypto';
import { enqueue } from '@/server/jobs/queue';
import { recordAudit } from '@/server/services/audit';
import { applyTransition } from './state-machine';
import {
  executeRequestEffects,
  isUniqueViolation,
  requestExpiryDays,
  REQUEST_SUBJECT_SELECT,
  type ActorContext,
  type EnrollmentDbClient,
} from './requests';

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

export interface VerificationResult {
  /** `false` when the request was already in the target state — absorbed, not an error. */
  readonly changed: boolean;
  readonly status: RequestStatus;
  /** Set on a fresh approval. */
  readonly paymentId?: string;
  readonly enrollmentId?: string;
  readonly invoiceNumber?: string;
}

/* -------------------------------------------------------------------------- */
/* Approve                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * « Activer l'accès ». Idempotent and transactional (§9.2 rule 2).
 *
 * Retries once on a lost `FAC-####` allocation race (`P2002` rolls the whole
 * transaction back, including the compare-and-set, so a retry starts clean).
 */
export async function approveRequest(
  requestId: string,
  ctx: ActorContext,
): Promise<VerificationResult> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await approveOnce(requestId, ctx);
    } catch (cause) {
      if (isUniqueViolation(cause) && attempt < 3) continue;
      throw cause;
    }
  }
}

async function approveOnce(requestId: string, ctx: ActorContext): Promise<VerificationResult> {
  const now = ctx.now ?? new Date();

  return transaction(async (tx) => {
    const request = await tx.enrollmentRequest.findUnique({
      where: { id: requestId },
      select: {
        ...REQUEST_SUBJECT_SELECT,
        priceCentimes: true,
        couponId: true,
        transferBankRef: true,
      },
    });
    if (request === null) throw new ActionError('not_found', 'course.request.notFound');

    const transition = applyTransition(request.status, 'ADMIN_APPROVED');
    if (!transition.ok) {
      // A double-click lands here: the first click moved the row to APPROVED,
      // making the edge illegal for the second. Absorbed as a no-op.
      if (request.status === 'APPROVED') return { changed: false, status: request.status };
      throw new ActionError('conflict', 'course.request.notApprovable');
    }
    if (request.course === null) {
      throw new ActionError('conflict', 'course.request.courseUnavailable');
    }

    const course = await tx.course.findUnique({
      where: { id: request.course.id },
      select: { id: true, slug: true, maxSeats: true, seatsTaken: true, accessDurationDays: true },
    });
    if (course === null) throw new ActionError('conflict', 'course.request.courseUnavailable');
    if (course.maxSeats !== null && course.seatsTaken >= course.maxSeats) {
      throw new ActionError('conflict', 'course.request.courseFull');
    }

    const existingEnrollment = await tx.enrollment.findUnique({
      where: { userId_courseId: { userId: request.user.id, courseId: course.id } },
      select: { id: true },
    });
    if (existingEnrollment !== null) {
      throw new ActionError('conflict', 'course.request.alreadyEnrolled');
    }

    // ── The idempotency gate (§9.2 rule 2) ──────────────────────────────────
    const updated = await tx.enrollmentRequest.updateMany({
      where: { id: request.id, status: request.status },
      data: { status: 'APPROVED', reviewedById: ctx.userId, reviewedAt: now },
    });
    if (updated.count === 0) {
      // Another administrator won the race inside this same instant.
      return { changed: false, status: 'APPROVED' };
    }

    // ── Payment, with its FAC-#### allocated in the same breath ─────────────
    const invoiceNumber = await nextInvoiceNumber(tx, now.getFullYear());
    const payment = await tx.payment.create({
      data: {
        requestId: request.id,
        method: request.transferType === 'CASH_AT_CENTER' ? 'CASH_AT_CENTER' : 'BANK_TRANSFER',
        amountCentimes: request.amountDueCentimes,
        receivedAt: now,
        confirmedById: ctx.userId,
        invoiceNumber,
        bankReference: request.transferBankRef,
      },
      select: { id: true },
    });

    // ── Enrollment(ACTIVE) ──────────────────────────────────────────────────
    const enrollment = await tx.enrollment.create({
      data: {
        userId: request.user.id,
        courseId: course.id,
        requestId: request.id,
        source: 'PAID_REQUEST',
        status: 'ACTIVE',
        activatedAt: now,
        activatedById: ctx.userId,
        expiresAt:
          course.accessDurationDays === null
            ? null
            : new Date(now.getTime() + course.accessDurationDays * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });

    // ── Counters ────────────────────────────────────────────────────────────
    await tx.course.update({
      where: { id: course.id },
      data: { seatsTaken: { increment: 1 }, enrollmentCount: { increment: 1 } },
    });

    // ── Coupon consumption ──────────────────────────────────────────────────
    if (request.couponId !== null) {
      await tx.coupon.update({
        where: { id: request.couponId },
        data: { usedCount: { increment: 1 } },
      });
    }

    // ── Invoice PDF, generated in a JOB, never in the request cycle ────────
    await enqueue('GENERATE_INVOICE', { paymentId: payment.id }, {}, tx);

    // ── E-mail #9, notification, timeline, audit ────────────────────────────
    await executeRequestEffects({
      tx,
      subject: request,
      effects: transition.effects,
      actorId: ctx.userId,
      summary: `Demande ${request.reference} approuvée — accès activé pour ${request.user.fullName}.`,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      now,
    });

    return {
      changed: true,
      status: 'APPROVED',
      paymentId: payment.id,
      enrollmentId: enrollment.id,
      invoiceNumber,
    };
  });
}

/** Next `FAC-{year}-{seq}`, read under the caller's transaction; `@unique` arbitrates. */
async function nextInvoiceNumber(tx: EnrollmentDbClient, year: number): Promise<string> {
  const prefix = `FAC-${year}-`;
  const latest = await tx.payment.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  });
  const lastSequence =
    latest?.invoiceNumber == null
      ? 0
      : Number.parseInt(latest.invoiceNumber.slice(prefix.length), 10);
  const sequence = Number.isFinite(lastSequence) ? lastSequence + 1 : 1;
  return generateInvoiceNumber(year, sequence);
}

/* -------------------------------------------------------------------------- */
/* Reject                                                                      */
/* -------------------------------------------------------------------------- */

/** « Refuser », with a mandatory reason the student reads verbatim (e-mail #10). */
export async function rejectRequest(
  requestId: string,
  reason: string,
  ctx: ActorContext,
): Promise<VerificationResult> {
  const now = ctx.now ?? new Date();

  return transaction(async (tx) => {
    const request = await tx.enrollmentRequest.findUnique({
      where: { id: requestId },
      select: REQUEST_SUBJECT_SELECT,
    });
    if (request === null) throw new ActionError('not_found', 'course.request.notFound');

    const transition = applyTransition(request.status, 'ADMIN_REJECTED');
    if (!transition.ok) {
      if (request.status === 'REJECTED') return { changed: false, status: request.status };
      throw new ActionError('conflict', 'course.request.notRejectable');
    }

    const updated = await tx.enrollmentRequest.updateMany({
      where: { id: request.id, status: request.status },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
        reviewedById: ctx.userId,
        reviewedAt: now,
      },
    });
    if (updated.count === 0) return { changed: false, status: 'REJECTED' };

    await executeRequestEffects({
      tx,
      subject: request,
      effects: transition.effects,
      actorId: ctx.userId,
      summary: `Demande ${request.reference} refusée.`,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      extras: { rejectionReason: reason },
      now,
    });

    return { changed: true, status: 'REJECTED' };
  });
}

/* -------------------------------------------------------------------------- */
/* Request info                                                                */
/* -------------------------------------------------------------------------- */

/** « Demander un complément » (§1666 row 3). E-mail #8 carries `message` verbatim. */
export async function requestInfo(
  requestId: string,
  message: string,
  ctx: ActorContext,
): Promise<VerificationResult> {
  const now = ctx.now ?? new Date();

  return transaction(async (tx) => {
    const request = await tx.enrollmentRequest.findUnique({
      where: { id: requestId },
      select: REQUEST_SUBJECT_SELECT,
    });
    if (request === null) throw new ActionError('not_found', 'course.request.notFound');

    const transition = applyTransition(request.status, 'ADMIN_INFO_REQUESTED');
    if (!transition.ok) {
      if (request.status === 'INFO_REQUESTED') return { changed: false, status: request.status };
      throw new ActionError('conflict', 'course.request.notInfoRequestable');
    }

    const expiry = await freshExpiry(tx, now);
    const updated = await tx.enrollmentRequest.updateMany({
      where: { id: request.id, status: request.status },
      data: {
        status: 'INFO_REQUESTED',
        infoRequestedMessage: message,
        reviewedById: ctx.userId,
        reviewedAt: now,
        // The student gets a full window to answer (§1666 row 6 expires
        // INFO_REQUESTED requests from `expiresAt`).
        expiresAt: expiry,
      },
    });
    if (updated.count === 0) return { changed: false, status: 'INFO_REQUESTED' };

    // Repeatable event: the e-mail keys on this timeline row.
    const eventKey = `info-${now.getTime()}`;

    await executeRequestEffects({
      tx,
      subject: request,
      effects: transition.effects,
      actorId: ctx.userId,
      summary: `Complément demandé sur la demande ${request.reference}.`,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      extras: { adminMessage: message, eventKey },
      now,
    });

    return { changed: true, status: 'INFO_REQUESTED' };
  });
}

async function freshExpiry(tx: EnrollmentDbClient, now: Date): Promise<Date> {
  const days = await requestExpiryDays(tx);
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/* -------------------------------------------------------------------------- */
/* Manual grant (§9.2 rule 9)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `ADMIN_GRANT` — an enrollment with no request, for on-site students who paid
 * cash at the desk. Requires a reason; fully audited. No payment row and no
 * invoice: there was no §9.2 flow to invoice.
 */
export async function grantEnrollment(
  input: { readonly userId: string; readonly courseId: string; readonly reason: string },
  ctx: ActorContext,
): Promise<{ readonly enrollmentId: string; readonly created: boolean }> {
  const now = ctx.now ?? new Date();

  return transaction(async (tx) => {
    const [student, course] = await Promise.all([
      tx.user.findFirst({
        where: { id: input.userId, deletedAt: null },
        select: { id: true, fullName: true },
      }),
      tx.course.findFirst({
        where: { id: input.courseId, deletedAt: null },
        select: { id: true, slug: true, accessDurationDays: true },
      }),
    ]);
    if (student === null) throw new ActionError('not_found', 'course.request.studentNotFound');
    if (course === null) throw new ActionError('not_found', 'course.request.courseUnavailable');

    const existing = await tx.enrollment.findUnique({
      where: { userId_courseId: { userId: student.id, courseId: course.id } },
      select: { id: true },
    });
    if (existing !== null) return { enrollmentId: existing.id, created: false };

    const enrollment = await tx.enrollment.create({
      data: {
        userId: student.id,
        courseId: course.id,
        source: 'ADMIN_GRANT',
        status: 'ACTIVE',
        activatedAt: now,
        activatedById: ctx.userId,
        expiresAt:
          course.accessDurationDays === null
            ? null
            : new Date(now.getTime() + course.accessDurationDays * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });

    await tx.course.update({
      where: { id: course.id },
      data: { seatsTaken: { increment: 1 }, enrollmentCount: { increment: 1 } },
    });

    await recordAudit(
      {
        actorId: ctx.userId,
        action: 'ENROLLMENT_GRANTED',
        entityType: 'Enrollment',
        entityId: enrollment.id,
        summary: `Accès accordé manuellement à ${student.fullName} pour ${course.slug} — ${input.reason}`,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return { enrollmentId: enrollment.id, created: true };
  });
}
