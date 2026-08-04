/**
 * Enrollment requests — creation, references, coupons, cancellation, and the
 * shared effect executor for the whole §9.2 flow.
 *
 * ## The house pattern (M1 accounts)
 * 1. Validate with a `.strict()` Zod schema (in `actions/enrollment.ts`).
 * 2. Authorise through `can()` — done by `withAction`.
 * 3. Ask the state machine what an event does.
 * 4. Commit the change, the e-mails, the notifications, the timeline rows and
 *    the audit row in ONE transaction, with a compare-and-set on `status`.
 *
 * ## References
 * `CFI-{year}-{seq}` is allocated inside the creating transaction from the
 * highest existing reference of the year. The `@unique` on
 * `EnrollmentRequest.reference` is the arbiter: a race loses with `P2002` and
 * the whole creation retries with the next number (§9.2 — two concurrent
 * requests must never mint the same reference).
 *
 * ## E-mail plumbing
 * Enrollment e-mails are queued through `enqueue('SEND_EMAIL', …)` from
 * `@/server/jobs/queue` — the payload type derives from the mail registry this
 * milestone extends, so a template/props mismatch is a compile error, and the
 * payload is Zod-validated at enqueue (same guarantee `queueEmail` gives the
 * account flow, whose narrower M1 template union cannot name these templates).
 */

import { Prisma, type Locale, type RequestStatus, type TransferType } from '@prisma/client';

import { transaction } from '@/server/db';
import { ActionError } from '@/server/auth/guards';
import { generateReference } from '@/lib/crypto';
import { formatMoney } from '@/lib/money';
import { enqueue } from '@/server/jobs/queue';
import { recordAudit } from '@/server/services/audit';
import { absoluteUrl, adminEmailRecipients, adminUserIds } from '@/server/services/notifications';
import {
  applyTransition,
  INITIAL_REQUEST_STATUS,
  isFinalRequestStatus,
  REQUEST_EXPIRY_DAYS_DEFAULT,
  type RequestEffect,
  type RequestEvent as RequestMachineEvent,
  type RequestNotificationType,
  type RequestTimelineType,
} from './state-machine';

/** A Prisma client or an interactive-transaction client. */
export type EnrollmentDbClient = Prisma.TransactionClient;

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Locale-relative paths the §9.2 e-mails and notifications point at. The
 * student pages are §13.3 and the admin drawer §17.3 — both built in this
 * milestone by the UI agents; the spellings below are the contract.
 */
export const ENROLLMENT_ROUTES = {
  /** §13.3 « Mes demandes » — the timeline widget, re-upload box and invoice download. */
  studentRequests: () => '/espace/demandes',
  /** Public course page — where a (new) request starts. */
  course: (slug: string) => `/formations/${encodeURIComponent(slug)}`,
  /** §17.3 deep link into the verification drawer. */
  adminRequest: (requestId: string) => `/admin/demandes/${encodeURIComponent(requestId)}`,
} as const;

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

/**
 * i18n keys of the request notifications. The `notifications` namespace is
 * owned by the i18n agent; missing keys are declared in the M3 manifest.
 */
export const REQUEST_NOTIFICATION_TITLE_KEYS: Record<RequestNotificationType, string> = {
  REQUEST_RECEIVED: 'notifications.requestReceived',
  REQUEST_AWAITING_REVIEW: 'notifications.requestAwaitingReview',
  REQUEST_INFO_NEEDED: 'notifications.requestInfoNeeded',
  REQUEST_APPROVED: 'notifications.requestApproved',
  REQUEST_REJECTED: 'notifications.requestRejected',
  REQUEST_EXPIRED: 'notifications.requestExpired',
};

type JsonPayload = Readonly<Record<string, string | number | boolean | null>>;

function toJson(value: JsonPayload): Prisma.InputJsonObject {
  return { ...value } as Prisma.InputJsonObject;
}

/**
 * Written directly rather than through `notifications.createNotification`,
 * whose `type` union is the closed M1 vocabulary. The row shape and the
 * titleKey-plus-payload contract are identical; the bell renders both the same.
 */
async function createRequestNotification(
  tx: EnrollmentDbClient,
  userId: string,
  type: RequestNotificationType,
  payload: JsonPayload,
  link: string,
): Promise<void> {
  await tx.notification.create({
    data: {
      userId,
      type,
      titleKey: REQUEST_NOTIFICATION_TITLE_KEYS[type],
      payload: toJson(payload),
      link,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* The request, as the effects need it                                         */
/* -------------------------------------------------------------------------- */

/** Exactly the columns the §18 rows 6–12 e-mails and notifications read. */
export const REQUEST_SUBJECT_SELECT = {
  id: true,
  reference: true,
  status: true,
  amountDueCentimes: true,
  transferType: true,
  expiresAt: true,
  receiptSha256: true,
  user: { select: { id: true, fullName: true, email: true, locale: true } },
  course: {
    select: {
      id: true,
      slug: true,
      translations: { select: { locale: true, title: true } },
    },
  },
} as const;

export type RequestSubject = Prisma.EnrollmentRequestGetPayload<{
  select: typeof REQUEST_SUBJECT_SELECT;
}>;

/** The course title in `locale`, falling back to French, then to the slug. */
export function courseTitleFor(subject: RequestSubject, locale: Locale): string {
  const course = subject.course;
  if (course === null) return '—';
  const exact = course.translations.find((t) => t.locale === locale);
  const fallback = course.translations.find((t) => t.locale === 'fr');
  return exact?.title ?? fallback?.title ?? course.slug;
}

/* -------------------------------------------------------------------------- */
/* Effect executor                                                             */
/* -------------------------------------------------------------------------- */

export interface ExecuteRequestEffectsInput {
  readonly tx: EnrollmentDbClient;
  readonly subject: RequestSubject;
  readonly effects: readonly RequestEffect[];
  readonly actorId: string | null;
  /** One readable French sentence for §17.13 and the §17.1 activity feed. */
  readonly summary: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  /** Facts the request row does not carry. */
  readonly extras?: {
    /** The admin's message, for `request-info-needed`. */
    readonly adminMessage?: string;
    /** The admin's reason, for `request-rejected`. */
    readonly rejectionReason?: string;
    /** §9.2 rule 6 — the receipt digest matched another request. */
    readonly duplicateReceipt?: boolean;
    /** The id of the timeline row the repeatable e-mails key on. */
    readonly eventKey?: string;
  };
  readonly now: Date;
}

/**
 * Perform what a transition declared: timeline rows, e-mails, notifications,
 * the audit row — all on the caller's transaction client.
 */
export async function executeRequestEffects(input: ExecuteRequestEffectsInput): Promise<void> {
  const { tx, subject, effects, extras, now } = input;
  const student = subject.user;
  const studentLocale = student.locale;
  const courseTitle = courseTitleFor(subject, studentLocale);
  const amountLabel = formatMoney(subject.amountDueCentimes, studentLocale);
  const requestsUrl = absoluteUrl(studentLocale, ENROLLMENT_ROUTES.studentRequests());
  const courseUrl = absoluteUrl(
    studentLocale,
    subject.course === null
      ? ENROLLMENT_ROUTES.studentRequests()
      : ENROLLMENT_ROUTES.course(subject.course.slug),
  );

  let admins: readonly string[] | null = null;
  const resolveAdmins = async (): Promise<readonly string[]> => {
    admins ??= await adminUserIds(tx);
    return admins;
  };

  for (const effect of effects) {
    switch (effect.kind) {
      case 'TIMELINE': {
        await appendTimeline(tx, subject.id, effect.type, input.actorId, {
          message:
            effect.type === 'INFO_REQUESTED'
              ? (extras?.adminMessage ?? null)
              : effect.type === 'REJECTED'
                ? (extras?.rejectionReason ?? null)
                : null,
        });
        break;
      }

      case 'EMAIL': {
        switch (effect.template) {
          case 'request-received':
            await enqueue(
              'SEND_EMAIL',
              {
                to: student.email,
                template: 'request-received',
                props: {
                  fullName: student.fullName,
                  reference: subject.reference,
                  courseTitle,
                  amountLabel,
                  transferType: subject.transferType,
                  requestsUrl,
                },
                locale: studentLocale,
                relatedType: 'EnrollmentRequest',
                relatedId: subject.id,
              },
              {},
              tx,
            );
            break;

          case 'admin-new-payment':
            await enqueue(
              'SEND_EMAIL',
              {
                to: adminEmailRecipients(),
                template: 'admin-new-payment',
                props: {
                  studentName: student.fullName,
                  studentEmail: student.email,
                  courseTitle: courseTitleFor(subject, 'fr'),
                  reference: subject.reference,
                  amountLabel: formatMoney(subject.amountDueCentimes, 'fr'),
                  transferType: subject.transferType,
                  adminUrl: absoluteUrl('fr', ENROLLMENT_ROUTES.adminRequest(subject.id)),
                  duplicateReceipt: extras?.duplicateReceipt ?? false,
                },
                // The administration works in French; the recipient is the
                // centre's mailbox, not the student.
                locale: 'fr',
                relatedType: 'EnrollmentRequest',
                // A re-submission must alert the admins again, so the key
                // carries the submission event, not just the request.
                relatedId: `${subject.id}:${extras?.eventKey ?? 'initial'}`,
              },
              {},
              tx,
            );
            break;

          case 'request-info-needed':
            await enqueue(
              'SEND_EMAIL',
              {
                to: student.email,
                template: 'request-info-needed',
                props: {
                  fullName: student.fullName,
                  courseTitle,
                  reference: subject.reference,
                  adminMessage: extras?.adminMessage ?? '',
                  requestsUrl,
                },
                locale: studentLocale,
                relatedType: 'EnrollmentRequest',
                // INFO_REQUESTED can legitimately happen twice on one request.
                relatedId: `${subject.id}:${extras?.eventKey ?? 'info'}`,
              },
              {},
              tx,
            );
            break;

          case 'request-approved':
            await enqueue(
              'SEND_EMAIL',
              {
                to: student.email,
                template: 'request-approved',
                props: {
                  fullName: student.fullName,
                  courseTitle,
                  reference: subject.reference,
                  amountLabel,
                  courseUrl,
                  requestsUrl,
                },
                locale: studentLocale,
                relatedType: 'EnrollmentRequest',
                relatedId: subject.id,
              },
              {},
              tx,
            );
            break;

          case 'request-rejected':
            await enqueue(
              'SEND_EMAIL',
              {
                to: student.email,
                template: 'request-rejected',
                props: {
                  fullName: student.fullName,
                  courseTitle,
                  reference: subject.reference,
                  reason: extras?.rejectionReason ?? '',
                  courseUrl,
                },
                locale: studentLocale,
                relatedType: 'EnrollmentRequest',
                relatedId: subject.id,
              },
              {},
              tx,
            );
            break;

          case 'request-expired':
            await enqueue(
              'SEND_EMAIL',
              {
                to: student.email,
                template: 'request-expired',
                props: {
                  fullName: student.fullName,
                  courseTitle,
                  reference: subject.reference,
                  courseUrl,
                },
                locale: studentLocale,
                relatedType: 'EnrollmentRequest',
                relatedId: subject.id,
              },
              {},
              tx,
            );
            break;

          // The reminder e-mail is sent by the `reminders` cron directly — it
          // is not the consequence of a transition, so no machine edge names
          // it. Reaching this case would mean the machine grew an edge without
          // teaching the executor about it.
          case 'receipt-reminder':
            throw new Error(
              'receipt-reminder est envoyé par le cron reminders, jamais par une transition.',
            );

          default:
            assertNeverTemplate(effect.template);
        }
        break;
      }

      case 'NOTIFICATION': {
        const payload: JsonPayload = {
          requestId: subject.id,
          reference: subject.reference,
          courseTitle,
        };
        if (effect.audience === 'STUDENT') {
          await createRequestNotification(
            tx,
            student.id,
            effect.type,
            payload,
            ENROLLMENT_ROUTES.studentRequests(),
          );
        } else {
          const ids = await resolveAdmins();
          for (const adminId of ids) {
            await createRequestNotification(
              tx,
              adminId,
              effect.type,
              { ...payload, studentName: student.fullName },
              ENROLLMENT_ROUTES.adminRequest(subject.id),
            );
          }
        }
        break;
      }

      case 'AUDIT': {
        await recordAudit(
          {
            actorId: input.actorId,
            action: effect.action,
            entityType: 'EnrollmentRequest',
            entityId: subject.id,
            summary: input.summary,
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );
        break;
      }
    }
  }
  void now;
}

function assertNeverTemplate(value: never): never {
  throw new Error(`Modèle d'e-mail non géré par l'exécuteur d'effets : ${String(value)}`);
}

/** Append one immutable row to the §9.2 timeline. */
export async function appendTimeline(
  tx: EnrollmentDbClient,
  requestId: string,
  type: RequestTimelineType,
  actorId: string | null,
  extra: { readonly message?: string | null; readonly metadata?: JsonPayload } = {},
): Promise<string> {
  const row = await tx.requestEvent.create({
    data: {
      requestId,
      type,
      actorId,
      message: extra.message ?? null,
      metadata: extra.metadata === undefined ? Prisma.DbNull : toJson(extra.metadata),
    },
    select: { id: true },
  });
  return row.id;
}

/* -------------------------------------------------------------------------- */
/* Reference allocation                                                        */
/* -------------------------------------------------------------------------- */

const REFERENCE_PREFIX = 'CFI-';

/**
 * Next `CFI-{year}-{seq}` for `year`, read inside the caller's transaction.
 * The unique constraint is the real arbiter — see the retry in
 * {@link createRequest}.
 */
export async function nextReference(tx: EnrollmentDbClient, year: number): Promise<string> {
  const prefix = `${REFERENCE_PREFIX}${year}-`;
  const latest = await tx.enrollmentRequest.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });

  const lastSequence =
    latest === null ? 0 : Number.parseInt(latest.reference.slice(prefix.length), 10);
  const sequence = Number.isFinite(lastSequence) ? lastSequence + 1 : 1;
  return generateReference(year, sequence);
}

/* -------------------------------------------------------------------------- */
/* Coupons                                                                     */
/* -------------------------------------------------------------------------- */

export interface CouponQuote {
  readonly couponId: string;
  readonly code: string;
  readonly discountCentimes: number;
}

/**
 * Validate a coupon for a course and a student, and price the discount in
 * integer centimes (rule 6 — no floats; percentage discounts round down, in
 * the student's favour never the centre's books').
 *
 * @throws ActionError `validation` with an i18n message key when the code is
 *   unusable — the UI shows it under the coupon field.
 */
export async function quoteCoupon(
  tx: EnrollmentDbClient,
  code: string,
  courseId: string,
  userId: string,
  priceCentimes: number,
  now: Date,
): Promise<CouponQuote> {
  const coupon = await tx.coupon.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      type: true,
      value: true,
      maxUses: true,
      usedCount: true,
      maxUsesPerUser: true,
      minAmountCentimes: true,
      startsAt: true,
      expiresAt: true,
      isActive: true,
      courses: { select: { courseId: true } },
    },
  });

  const invalid = (): never => {
    throw new ActionError('validation', 'course.request.couponInvalid', {
      couponCode: ['course.request.couponInvalid'],
    });
  };

  if (coupon === null || !coupon.isActive) return invalid();
  if (coupon.startsAt !== null && coupon.startsAt > now) return invalid();
  if (coupon.expiresAt !== null && coupon.expiresAt < now) return invalid();
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return invalid();
  if (coupon.minAmountCentimes !== null && priceCentimes < coupon.minAmountCentimes) {
    return invalid();
  }
  // An empty course list means "valid on everything"; a non-empty one is an
  // allow-list.
  if (coupon.courses.length > 0 && !coupon.courses.some((c) => c.courseId === courseId)) {
    return invalid();
  }

  const usesByThisUser = await tx.enrollmentRequest.count({
    where: {
      couponId: coupon.id,
      userId,
      status: { notIn: ['CANCELLED', 'EXPIRED', 'REJECTED'] },
    },
  });
  if (usesByThisUser >= coupon.maxUsesPerUser) return invalid();

  const discount =
    coupon.type === 'PERCENT'
      ? Math.floor((priceCentimes * Math.min(Math.max(coupon.value, 0), 100)) / 100)
      : Math.min(Math.max(coupon.value, 0), priceCentimes);

  return { couponId: coupon.id, code: coupon.code, discountCentimes: discount };
}

/* -------------------------------------------------------------------------- */
/* Expiry window                                                               */
/* -------------------------------------------------------------------------- */

/** `payment.requestExpiryDays` from SiteSetting, defaulting to §1666's 7 days. */
export async function requestExpiryDays(tx: EnrollmentDbClient): Promise<number> {
  const row = await tx.siteSetting.findUnique({
    where: { key: 'payment.requestExpiryDays' },
    select: { value: true },
  });
  const value = row?.value;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 60
    ? value
    : REQUEST_EXPIRY_DAYS_DEFAULT;
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreateRequestInput {
  readonly courseId: string;
  readonly transferType: TransferType;
  readonly couponCode?: string | null;
}

export interface ActorContext {
  readonly userId: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly now?: Date;
}

export interface RequestView {
  readonly id: string;
  readonly reference: string;
  readonly status: RequestStatus;
  readonly priceCentimes: number;
  readonly discountCentimes: number;
  readonly amountDueCentimes: number;
  readonly transferType: TransferType;
  readonly expiresAt: Date;
  /** `true` when the request already existed — §9.2 rule 1 sent the student back to it. */
  readonly existing: boolean;
}

/**
 * Start a request (§9.2 modal, step 1 → « Enregistrer »).
 *
 * Rule 1: one non-final request per (student, course). An existing one is
 * returned as-is with `existing: true` — the UI navigates to its status page
 * instead of erroring.
 * Rule 3: the price is snapshotted here; later catalogue edits never touch it.
 */
export async function createRequest(
  input: CreateRequestInput,
  ctx: ActorContext,
): Promise<RequestView> {
  const now = ctx.now ?? new Date();

  // Retry only for a lost reference race (P2002 on the unique column).
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await transaction(async (tx) => {
        const course = await tx.course.findUnique({
          where: { id: input.courseId },
          select: {
            id: true,
            slug: true,
            status: true,
            priceCentimes: true,
            maxSeats: true,
            seatsTaken: true,
            deletedAt: true,
          },
        });

        if (course === null || course.deletedAt !== null || course.status !== 'PUBLISHED') {
          throw new ActionError('not_found', 'course.request.courseUnavailable');
        }
        if (course.priceCentimes === 0) {
          // §9.2 rule 8: free courses never enter this flow.
          throw new ActionError('validation', 'course.request.courseIsFree');
        }
        if (course.maxSeats !== null && course.seatsTaken >= course.maxSeats) {
          throw new ActionError('conflict', 'course.request.courseFull');
        }

        const alreadyEnrolled = await tx.enrollment.findUnique({
          where: { userId_courseId: { userId: ctx.userId, courseId: course.id } },
          select: { id: true, status: true },
        });
        if (alreadyEnrolled !== null && alreadyEnrolled.status === 'ACTIVE') {
          throw new ActionError('conflict', 'course.request.alreadyEnrolled');
        }

        // §9.2 rule 1 — return the existing non-final request.
        const open = await tx.enrollmentRequest.findFirst({
          where: {
            userId: ctx.userId,
            courseId: course.id,
            status: { in: ['AWAITING_RECEIPT', 'UNDER_REVIEW', 'INFO_REQUESTED'] },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            reference: true,
            status: true,
            priceCentimes: true,
            discountCentimes: true,
            amountDueCentimes: true,
            transferType: true,
            expiresAt: true,
          },
        });
        if (open !== null) return { ...open, existing: true };

        const priceCentimes = course.priceCentimes;
        const couponCode = input.couponCode?.trim();
        const coupon =
          couponCode === undefined || couponCode === ''
            ? null
            : await quoteCoupon(tx, couponCode, course.id, ctx.userId, priceCentimes, now);

        const discountCentimes = coupon?.discountCentimes ?? 0;
        const amountDueCentimes = Math.max(0, priceCentimes - discountCentimes);

        const expiryDays = await requestExpiryDays(tx);
        const reference = await nextReference(tx, now.getFullYear());

        const created = await tx.enrollmentRequest.create({
          data: {
            reference,
            userId: ctx.userId,
            courseId: course.id,
            status: INITIAL_REQUEST_STATUS,
            priceCentimes,
            couponId: coupon?.couponId ?? null,
            discountCentimes,
            amountDueCentimes,
            transferType: input.transferType,
            expiresAt: new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000),
          },
          select: {
            id: true,
            reference: true,
            status: true,
            priceCentimes: true,
            discountCentimes: true,
            amountDueCentimes: true,
            transferType: true,
            expiresAt: true,
          },
        });

        await appendTimeline(tx, created.id, 'CREATED', ctx.userId, {
          metadata: { transferType: input.transferType, amountDueCentimes },
        });

        await recordAudit(
          {
            actorId: ctx.userId,
            action: 'REQUEST_CREATED',
            entityType: 'EnrollmentRequest',
            entityId: created.id,
            summary: `Demande ${created.reference} créée pour la formation ${course.slug}.`,
            ip: ctx.ip ?? null,
            userAgent: ctx.userAgent ?? null,
          },
          tx,
        );

        return { ...created, existing: false };
      });
    } catch (cause) {
      if (isUniqueViolation(cause) && attempt < 3) continue;
      throw cause;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Free courses                                                                */
/* -------------------------------------------------------------------------- */

/**
 * §9.2 rule 8 — `priceCentimes = 0` skips the whole flow: one click, one
 * `Enrollment(source: FREE_COURSE)`. Idempotent via the `(userId, courseId)`
 * unique constraint: a second click returns the existing enrollment.
 */
export async function enrollFree(
  courseId: string,
  ctx: ActorContext,
): Promise<{ readonly enrollmentId: string; readonly created: boolean }> {
  const now = ctx.now ?? new Date();

  return transaction(async (tx) => {
    const course = await tx.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        slug: true,
        status: true,
        priceCentimes: true,
        accessDurationDays: true,
        deletedAt: true,
      },
    });
    if (course === null || course.deletedAt !== null || course.status !== 'PUBLISHED') {
      throw new ActionError('not_found', 'course.request.courseUnavailable');
    }
    if (course.priceCentimes !== 0) {
      throw new ActionError('validation', 'course.request.courseNotFree');
    }

    const existing = await tx.enrollment.findUnique({
      where: { userId_courseId: { userId: ctx.userId, courseId: course.id } },
      select: { id: true },
    });
    if (existing !== null) return { enrollmentId: existing.id, created: false };

    const enrollment = await tx.enrollment.create({
      data: {
        userId: ctx.userId,
        courseId: course.id,
        source: 'FREE_COURSE',
        status: 'ACTIVE',
        activatedAt: now,
        expiresAt:
          course.accessDurationDays === null
            ? null
            : new Date(now.getTime() + course.accessDurationDays * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });

    await tx.course.update({
      where: { id: course.id },
      data: { enrollmentCount: { increment: 1 } },
    });

    await recordAudit(
      {
        actorId: ctx.userId,
        action: 'ENROLLMENT_FREE',
        entityType: 'Enrollment',
        entityId: enrollment.id,
        summary: `Inscription gratuite à la formation ${course.slug}.`,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return { enrollmentId: enrollment.id, created: true };
  });
}

/* -------------------------------------------------------------------------- */
/* Cancellation                                                                */
/* -------------------------------------------------------------------------- */

export interface CancelResult {
  readonly changed: boolean;
  readonly status: RequestStatus;
}

/**
 * « Annuler la demande » (§1666 row 7). Compare-and-set on the non-final
 * statuses; cancelling an already-final request is a no-op, not an error.
 */
export async function cancelRequest(requestId: string, ctx: ActorContext): Promise<CancelResult> {
  const now = ctx.now ?? new Date();

  return transaction(async (tx) => {
    const request = await tx.enrollmentRequest.findFirst({
      // Scoped by the actor: a student can only ever cancel their own request.
      where: { id: requestId, userId: ctx.userId },
      select: REQUEST_SUBJECT_SELECT,
    });
    if (request === null) throw new ActionError('not_found', 'course.request.notFound');

    if (isFinalRequestStatus(request.status)) {
      return { changed: false, status: request.status };
    }

    const transition = applyTransition(request.status, 'STUDENT_CANCELLED');
    if (!transition.ok) return { changed: false, status: request.status };

    const updated = await tx.enrollmentRequest.updateMany({
      where: { id: request.id, status: request.status },
      data: { status: transition.to },
    });
    if (updated.count === 0) return { changed: false, status: request.status };

    await executeRequestEffects({
      tx,
      subject: request,
      effects: transition.effects,
      actorId: ctx.userId,
      summary: `Demande ${request.reference} annulée par l'étudiant.`,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      now,
    });

    return { changed: true, status: transition.to };
  });
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

export function isUniqueViolation(cause: unknown): boolean {
  return (
    cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002'
  );
}

/** Re-exported so sibling modules do not repeat the event union spelling. */
export type { RequestMachineEvent };
