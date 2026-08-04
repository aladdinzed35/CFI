/**
 * The clock-driven side of §9.2, run by the §19.5 crons:
 *
 * - `expire-requests` (hourly) → {@link expireOverdueRequests}: any
 *   `AWAITING_RECEIPT` / `INFO_REQUESTED` request whose `expiresAt` passed
 *   moves to `EXPIRED` through the machine — e-mail #12, notification,
 *   timeline, audit. Seats need no releasing: a seat is only ever taken by
 *   the approval transaction, which no expired request has reached.
 *
 * - `reminders` (hourly) → {@link sendReceiptReminders}: §18 row 11 — a
 *   request still waiting for its justificatif is nudged at +24 h and +72 h.
 *   The e-mail's idempotency key carries the stage
 *   (`{requestId}:rappel-24h:{recipient}`), so the hourly cron can pass over
 *   the same row twenty times and each stage still goes out exactly once.
 *
 * Each request is processed in its own transaction with a compare-and-set, so
 * one poisoned row cannot wedge the whole sweep, and a cron overlapping with
 * an admin decision loses cleanly.
 */

import { formatMoney } from '@/lib/money';
import { db, transaction } from '@/server/db';
import { enqueue } from '@/server/jobs/queue';
import { absoluteUrl } from '@/server/services/notifications';
import { applyTransition } from './state-machine';
import {
  appendTimeline,
  courseTitleFor,
  ENROLLMENT_ROUTES,
  executeRequestEffects,
  REQUEST_SUBJECT_SELECT,
} from './requests';

/* -------------------------------------------------------------------------- */
/* Expiry                                                                      */
/* -------------------------------------------------------------------------- */

/** How many overdue rows one cron run will touch. The next run takes the rest. */
const EXPIRY_BATCH = 100;

export interface ExpirySummary {
  readonly job: 'expire-requests';
  readonly scanned: number;
  readonly expired: number;
  readonly skipped: number;
}

/** §1666 row 6. Idempotent: an already-expired row no longer matches the scan. */
export async function expireOverdueRequests(now: Date = new Date()): Promise<ExpirySummary> {
  const overdue = await db.enrollmentRequest.findMany({
    where: {
      status: { in: ['AWAITING_RECEIPT', 'INFO_REQUESTED'] },
      expiresAt: { lt: now },
    },
    orderBy: { expiresAt: 'asc' },
    take: EXPIRY_BATCH,
    select: { id: true },
  });

  let expired = 0;
  let skipped = 0;

  for (const candidate of overdue) {
    const changed = await expireOne(candidate.id, now);
    if (changed) expired += 1;
    else skipped += 1;
  }

  return { job: 'expire-requests', scanned: overdue.length, expired, skipped };
}

async function expireOne(requestId: string, now: Date): Promise<boolean> {
  return transaction(async (tx) => {
    const request = await tx.enrollmentRequest.findUnique({
      where: { id: requestId },
      select: REQUEST_SUBJECT_SELECT,
    });
    if (request === null) return false;

    const transition = applyTransition(request.status, 'EXPIRY_PASSED');
    if (!transition.ok) return false;

    const updated = await tx.enrollmentRequest.updateMany({
      // Re-checks `expiresAt` too: an admin who granted more time between the
      // scan and this transaction wins.
      where: { id: request.id, status: request.status, expiresAt: { lt: now } },
      data: { status: transition.to },
    });
    if (updated.count === 0) return false;

    await executeRequestEffects({
      tx,
      subject: request,
      effects: transition.effects,
      // A system action: the cron has no user.
      actorId: null,
      summary: `Demande ${request.reference} expirée automatiquement.`,
      now,
    });

    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* Reminders (§18 row 11)                                                      */
/* -------------------------------------------------------------------------- */

const HOUR_MS = 60 * 60 * 1000;

export interface ReminderStageSpec {
  readonly stage: '24h' | '72h';
  readonly afterMs: number;
}

/** The two §18 row 11 nudges, measured from the request's creation. */
export const REMINDER_STAGES: readonly ReminderStageSpec[] = [
  { stage: '24h', afterMs: 24 * HOUR_MS },
  { stage: '72h', afterMs: 72 * HOUR_MS },
];

export interface ReminderSummary {
  readonly job: 'reminders';
  readonly scanned: number;
  readonly queued: number;
}

/**
 * Queue the receipt reminders that are due.
 *
 * "Due" = the request is still `AWAITING_RECEIPT`, old enough for the stage,
 * and not yet expired. Deduplication is layered: a `REMINDER_SENT` timeline
 * row per stage stops the requeue at the source, and the §18 `EmailLog` key
 * stops a duplicate delivery even if the job row were somehow written twice.
 */
export async function sendReceiptReminders(now: Date = new Date()): Promise<ReminderSummary> {
  const candidates = await db.enrollmentRequest.findMany({
    where: {
      status: 'AWAITING_RECEIPT',
      expiresAt: { gt: now },
      createdAt: { lt: new Date(now.getTime() - 24 * HOUR_MS) },
    },
    take: 200,
    select: { ...REQUEST_SUBJECT_SELECT, createdAt: true },
  });

  let queued = 0;

  for (const request of candidates) {
    for (const spec of REMINDER_STAGES) {
      if (now.getTime() - request.createdAt.getTime() < spec.afterMs) continue;

      const sent = await db.requestEvent.findFirst({
        where: { requestId: request.id, type: 'REMINDER_SENT', message: spec.stage },
        select: { id: true },
      });
      if (sent !== null) continue;

      const locale = request.user.locale;
      await transaction(async (tx) => {
        await appendTimeline(tx, request.id, 'REMINDER_SENT', null, { message: spec.stage });
        await enqueue(
          'SEND_EMAIL',
          {
            to: request.user.email,
            template: 'receipt-reminder',
            props: {
              fullName: request.user.fullName,
              courseTitle: courseTitleFor(request, locale),
              reference: request.reference,
              amountLabel: formatMoney(request.amountDueCentimes, locale),
              stage: spec.stage,
              expiresAtLabel: formatShortDate(request.expiresAt, locale),
              requestsUrl: absoluteUrl(locale, ENROLLMENT_ROUTES.studentRequests()),
            },
            locale,
            relatedType: 'EnrollmentRequest',
            // Stage-specific §18 key: each nudge exactly once.
            relatedId: `${request.id}:rappel-${spec.stage}`,
          },
          {},
          tx,
        );
        await tx.notification.create({
          data: {
            userId: request.user.id,
            type: 'REQUEST_RECEIPT_REMINDER',
            titleKey: 'notifications.requestReceiptReminder',
            payload: { requestId: request.id, reference: request.reference, stage: spec.stage },
            link: ENROLLMENT_ROUTES.studentRequests(),
          },
        });
      });
      queued += 1;
    }
  }

  return { job: 'reminders', scanned: candidates.length, queued };
}

/** `12/03/2026` — §28.1's dense-table date format, per locale digits kept Latin. */
function formatShortDate(date: Date, locale: string): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  void locale;
  return `${dd}/${mm}/${yyyy}`;
}
