/**
 * The enrollment-request lifecycle, as an explicit state machine
 * (spec §9.2, transition table at §1666).
 *
 * ```
 *                       student submits step 2
 *  create ──▶ AWAITING_RECEIPT ─────────────────────▶ UNDER_REVIEW
 *                  │                                   │        ▲
 *                  │ expiresAt passes                  │        │ re-upload
 *                  ▼                    admin asks for │        │
 *              EXPIRED ◀─────────────── more  ─────────▼────────┘
 *                  ▲    expiresAt passes         INFO_REQUESTED
 *                  │                                   │
 *                  └──────────────────┬────────────────┤
 *          admin approves ◀───────────┘                │──▶ admin rejects
 *              APPROVED                                        REJECTED
 *
 *  any non-final ──student cancels──▶ CANCELLED
 * ```
 *
 * Same construction as the M1 account machine (`services/accounts/state-machine.ts`),
 * for the same reasons: every legal edge is declared exactly once, illegal
 * transitions are data (the refusal carries what *was* legal), idempotency
 * falls out structurally (approving an `APPROVED` request is an illegal edge,
 * absorbed before any effect runs), and every cell of the table is
 * unit-testable with no database in sight.
 *
 * ## Side effects are described, not performed
 * A transition names the §18 e-mails (rows 6–12), the in-app notifications,
 * the audit action and the timeline `RequestEvent` it requires. The services
 * (`receipts.ts`, `verification.ts`, `expiry.ts`) perform them inside their
 * transaction. The *domain* writes of an approval — Payment, Enrollment,
 * counters, coupon, invoice job — are `verification.ts`'s own §1666 checklist,
 * not effects here: they need prices, ids and a transaction client that a pure
 * machine must not know about.
 */

import type { RequestStatus } from '@prisma/client';

/* -------------------------------------------------------------------------- */
/* Alphabet                                                                    */
/* -------------------------------------------------------------------------- */

/** Declared as a `Record` keyed by Prisma's enum: a schema change breaks this line. */
const REQUEST_STATUS_KEYS: Record<RequestStatus, null> = {
  AWAITING_RECEIPT: null,
  UNDER_REVIEW: null,
  INFO_REQUESTED: null,
  APPROVED: null,
  REJECTED: null,
  EXPIRED: null,
  CANCELLED: null,
};

export const REQUEST_STATUSES = Object.keys(REQUEST_STATUS_KEYS) as readonly RequestStatus[];

/** States no event may ever leave. `EXPIRED` is final too: §9.2 says the student re-submits *a new request* freely. */
export const FINAL_REQUEST_STATUSES: readonly RequestStatus[] = [
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
];

export function isFinalRequestStatus(status: RequestStatus): boolean {
  return FINAL_REQUEST_STATUSES.includes(status);
}

/**
 * Everything that can move a request (§1666, one event per table row):
 *
 * - `RECEIPT_SUBMITTED` — the student uploads (or re-uploads) a justificatif.
 * - `ADMIN_INFO_REQUESTED` — « Demander un complément » in the §17.3 drawer.
 * - `ADMIN_APPROVED` — « Activer l'accès », the §1666 approval transaction.
 * - `ADMIN_REJECTED` — « Refuser », with a mandatory reason.
 * - `EXPIRY_PASSED` — the hourly `expire-requests` cron found `expiresAt` in the past.
 * - `STUDENT_CANCELLED` — « Annuler la demande » from `/espace/demandes`.
 */
export const REQUEST_EVENTS = [
  'RECEIPT_SUBMITTED',
  'ADMIN_INFO_REQUESTED',
  'ADMIN_APPROVED',
  'ADMIN_REJECTED',
  'EXPIRY_PASSED',
  'STUDENT_CANCELLED',
] as const;

export type RequestEvent = (typeof REQUEST_EVENTS)[number];

/* -------------------------------------------------------------------------- */
/* Side-effect vocabulary                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Template ids of the §18 rows 6–12 e-mails, matching the `id` field of the
 * templates in `src/server/mail/templates/*` and the registry in
 * `src/server/mail/send.ts`. Rows 11 (reminders) and the creation-time pair
 * 6+7 for a request *created with its receipt in one step* are triggered by
 * the same `RECEIPT_SUBMITTED` edge.
 */
export type RequestEmailTemplateId =
  /** #6 — « Demande reçue — vérification en cours », to the student. */
  | 'request-received'
  /** #7 — « Nouveau paiement à vérifier », to the administrators. */
  | 'admin-new-payment'
  /** #8 — « Justificatif à compléter », to the student. */
  | 'request-info-needed'
  /** #9 — « Accès activé — bonne formation ! », to the student. */
  | 'request-approved'
  /** #10 — « Demande refusée », to the student. */
  | 'request-rejected'
  /** #11 — « Rappel : votre demande attend un justificatif ». Sent by the cron, not by a transition. */
  | 'receipt-reminder'
  /** #12 — « Demande expirée », to the student. */
  | 'request-expired';

/** In-app notification types this machine produces (`Notification.type`). */
export type RequestNotificationType =
  | 'REQUEST_RECEIVED'
  | 'REQUEST_AWAITING_REVIEW'
  | 'REQUEST_INFO_NEEDED'
  | 'REQUEST_APPROVED'
  | 'REQUEST_REJECTED'
  | 'REQUEST_EXPIRED';

/** `AuditLog.action` values this machine produces. */
export type RequestAuditAction =
  | 'REQUEST_SUBMITTED'
  | 'REQUEST_INFO_REQUESTED'
  | 'REQUEST_APPROVED'
  | 'REQUEST_REJECTED'
  | 'REQUEST_EXPIRED'
  | 'REQUEST_CANCELLED';

/**
 * `RequestEvent.type` values of the immutable timeline (§9.2 widget). The
 * creation-time `CREATED` and `RECEIPT_UPLOADED` rows are written by
 * `requests.ts` / `receipts.ts` outside the machine — they are facts about an
 * upload, not transitions.
 */
export type RequestTimelineType =
  | 'CREATED'
  | 'RECEIPT_UPLOADED'
  | 'UNDER_REVIEW'
  | 'INFO_REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REMINDER_SENT';

export type RequestAudience = 'STUDENT' | 'ADMINS';

export interface RequestEmailEffect {
  readonly kind: 'EMAIL';
  readonly template: RequestEmailTemplateId;
  readonly audience: RequestAudience;
}

export interface RequestNotificationEffect {
  readonly kind: 'NOTIFICATION';
  readonly type: RequestNotificationType;
  readonly audience: RequestAudience;
}

export interface RequestAuditEffect {
  readonly kind: 'AUDIT';
  readonly action: RequestAuditAction;
}

/** One row appended to the request's immutable timeline. */
export interface RequestTimelineEffect {
  readonly kind: 'TIMELINE';
  readonly type: RequestTimelineType;
}

export type RequestEffect =
  | RequestEmailEffect
  | RequestNotificationEffect
  | RequestAuditEffect
  | RequestTimelineEffect;

/* -------------------------------------------------------------------------- */
/* Transitions                                                                 */
/* -------------------------------------------------------------------------- */

export interface RequestTransition {
  readonly to: RequestStatus;
  readonly effects: readonly RequestEffect[];
}

/**
 * §1666 row 1: submitting the justificatif puts the request under review and
 * fires §18 rows 6 + 7 — the student's confirmation (with the verbatim 48 h
 * notice for a standard transfer) and the administrators' deep-linked alert.
 */
const ON_FIRST_SUBMISSION: RequestTransition = {
  to: 'UNDER_REVIEW',
  effects: [
    { kind: 'TIMELINE', type: 'RECEIPT_UPLOADED' },
    { kind: 'TIMELINE', type: 'UNDER_REVIEW' },
    { kind: 'EMAIL', template: 'request-received', audience: 'STUDENT' },
    { kind: 'NOTIFICATION', type: 'REQUEST_RECEIVED', audience: 'STUDENT' },
    { kind: 'EMAIL', template: 'admin-new-payment', audience: 'ADMINS' },
    { kind: 'NOTIFICATION', type: 'REQUEST_AWAITING_REVIEW', audience: 'ADMINS' },
    { kind: 'AUDIT', action: 'REQUEST_SUBMITTED' },
  ],
};

/**
 * §1666 row 3, return leg: a re-upload after `INFO_REQUESTED` goes back under
 * review. The student pressed the button themselves, so no student e-mail; the
 * administrators are told there is something new to look at.
 */
const ON_RESUBMISSION: RequestTransition = {
  to: 'UNDER_REVIEW',
  effects: [
    { kind: 'TIMELINE', type: 'RECEIPT_UPLOADED' },
    { kind: 'TIMELINE', type: 'UNDER_REVIEW' },
    { kind: 'NOTIFICATION', type: 'REQUEST_AWAITING_REVIEW', audience: 'ADMINS' },
    { kind: 'AUDIT', action: 'REQUEST_SUBMITTED' },
  ],
};

/** §1666 row 3: e-mail #8 carries the admin's message and the re-upload CTA. */
const ON_INFO_REQUESTED: RequestTransition = {
  to: 'INFO_REQUESTED',
  effects: [
    { kind: 'TIMELINE', type: 'INFO_REQUESTED' },
    { kind: 'EMAIL', template: 'request-info-needed', audience: 'STUDENT' },
    { kind: 'NOTIFICATION', type: 'REQUEST_INFO_NEEDED', audience: 'STUDENT' },
    { kind: 'AUDIT', action: 'REQUEST_INFO_REQUESTED' },
  ],
};

/**
 * §1666 row 4 — the messaging half of the approval. The Payment, the
 * Enrollment, the invoice job, the counters and the coupon are performed by
 * `verification.approveRequest` in the same transaction.
 */
const ON_APPROVED: RequestTransition = {
  to: 'APPROVED',
  effects: [
    { kind: 'TIMELINE', type: 'APPROVED' },
    { kind: 'EMAIL', template: 'request-approved', audience: 'STUDENT' },
    { kind: 'NOTIFICATION', type: 'REQUEST_APPROVED', audience: 'STUDENT' },
    { kind: 'AUDIT', action: 'REQUEST_APPROVED' },
  ],
};

/** §1666 row 5: e-mail #10 with the reason and the WhatsApp CTA. */
const ON_REJECTED: RequestTransition = {
  to: 'REJECTED',
  effects: [
    { kind: 'TIMELINE', type: 'REJECTED' },
    { kind: 'EMAIL', template: 'request-rejected', audience: 'STUDENT' },
    { kind: 'NOTIFICATION', type: 'REQUEST_REJECTED', audience: 'STUDENT' },
    { kind: 'AUDIT', action: 'REQUEST_REJECTED' },
  ],
};

/** §1666 row 6: the hourly cron. E-mail #12 invites a fresh request. */
const ON_EXPIRED: RequestTransition = {
  to: 'EXPIRED',
  effects: [
    { kind: 'TIMELINE', type: 'EXPIRED' },
    { kind: 'EMAIL', template: 'request-expired', audience: 'STUDENT' },
    { kind: 'NOTIFICATION', type: 'REQUEST_EXPIRED', audience: 'STUDENT' },
    { kind: 'AUDIT', action: 'REQUEST_EXPIRED' },
  ],
};

/**
 * §1666 row 7: cancelling sends nothing — the student did it themselves and is
 * looking at the confirmation. The audit row and the timeline node remain.
 */
const ON_CANCELLED: RequestTransition = {
  to: 'CANCELLED',
  effects: [
    { kind: 'TIMELINE', type: 'CANCELLED' },
    { kind: 'AUDIT', action: 'REQUEST_CANCELLED' },
  ],
};

/* -------------------------------------------------------------------------- */
/* The switch                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The one place an edge is decided. Nested exhaustive `switch`es — adding a
 * status or an event fails the build here until every case is answered.
 */
function transitionFor(from: RequestStatus, event: RequestEvent): RequestTransition | null {
  switch (from) {
    case 'AWAITING_RECEIPT':
      switch (event) {
        case 'RECEIPT_SUBMITTED':
          return ON_FIRST_SUBMISSION;
        case 'EXPIRY_PASSED':
          return ON_EXPIRED;
        case 'STUDENT_CANCELLED':
          return ON_CANCELLED;
        case 'ADMIN_INFO_REQUESTED':
        case 'ADMIN_APPROVED':
        case 'ADMIN_REJECTED':
          return null;
        default:
          return assertNever(event);
      }

    case 'UNDER_REVIEW':
      switch (event) {
        case 'ADMIN_INFO_REQUESTED':
          return ON_INFO_REQUESTED;
        case 'ADMIN_APPROVED':
          return ON_APPROVED;
        case 'ADMIN_REJECTED':
          return ON_REJECTED;
        case 'STUDENT_CANCELLED':
          return ON_CANCELLED;
        // A request under review does not expire (§1666 row 6 lists only
        // AWAITING_RECEIPT and INFO_REQUESTED): the delay is now ours, not the
        // student's, and expiring it would punish them for our queue.
        case 'EXPIRY_PASSED':
        // A justificatif is already attached; replacing it while an admin is
        // reading it would be a race. The student is asked to wait or the
        // admin sends the request back with INFO_REQUESTED.
        case 'RECEIPT_SUBMITTED':
          return null;
        default:
          return assertNever(event);
      }

    case 'INFO_REQUESTED':
      switch (event) {
        case 'RECEIPT_SUBMITTED':
          return ON_RESUBMISSION;
        case 'ADMIN_APPROVED':
          return ON_APPROVED;
        case 'ADMIN_REJECTED':
          return ON_REJECTED;
        case 'EXPIRY_PASSED':
          return ON_EXPIRED;
        case 'STUDENT_CANCELLED':
          return ON_CANCELLED;
        case 'ADMIN_INFO_REQUESTED':
          return null;
        default:
          return assertNever(event);
      }

    case 'APPROVED':
    case 'REJECTED':
    case 'EXPIRED':
    case 'CANCELLED':
      switch (event) {
        // Final means final: §9.2 re-submission after EXPIRED/REJECTED is a
        // NEW request with a new reference, never a resurrection of this one.
        case 'RECEIPT_SUBMITTED':
        case 'ADMIN_INFO_REQUESTED':
        case 'ADMIN_APPROVED':
        case 'ADMIN_REJECTED':
        case 'EXPIRY_PASSED':
        case 'STUDENT_CANCELLED':
          return null;
        default:
          return assertNever(event);
      }

    default:
      return assertNever(from);
  }
}

function assertNever(value: never): never {
  throw new Error(
    `Transition non exhaustive dans la machine à états des demandes : ${String(value)}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Public API — mirrors the account machine                                    */
/* -------------------------------------------------------------------------- */

/** The full table, `null` where the edge does not exist. Derived, never retyped. */
export const REQUEST_TRANSITIONS: Readonly<
  Record<RequestStatus, Readonly<Record<RequestEvent, RequestStatus | null>>>
> = buildTable();

function buildTable(): Record<RequestStatus, Record<RequestEvent, RequestStatus | null>> {
  const table = {} as Record<RequestStatus, Record<RequestEvent, RequestStatus | null>>;
  for (const status of REQUEST_STATUSES) {
    const row = {} as Record<RequestEvent, RequestStatus | null>;
    for (const event of REQUEST_EVENTS) {
      row[event] = transitionFor(status, event)?.to ?? null;
    }
    table[status] = row;
  }
  return table;
}

export function canTransition(from: RequestStatus, event: RequestEvent): boolean {
  return transitionFor(from, event) !== null;
}

/** Every event legal from `from` — enables/disables the §17.3 drawer buttons. */
export function allowedEvents(from: RequestStatus): readonly RequestEvent[] {
  return REQUEST_EVENTS.filter((event) => canTransition(from, event));
}

/**
 * Every status `event` is legal from — the `WHERE status IN (…)` of the
 * compare-and-set update that makes a double-clicked « Activer » a no-op
 * (§9.2 rule 2).
 */
export function sourceStatuses(event: RequestEvent): readonly RequestStatus[] {
  return REQUEST_STATUSES.filter((status) => canTransition(status, event));
}

export interface AppliedRequestTransition {
  readonly ok: true;
  readonly from: RequestStatus;
  readonly event: RequestEvent;
  readonly to: RequestStatus;
  readonly effects: readonly RequestEffect[];
}

export interface RefusedRequestTransition {
  readonly ok: false;
  readonly from: RequestStatus;
  readonly event: RequestEvent;
  readonly reason: 'ILLEGAL_TRANSITION';
  readonly allowed: readonly RequestEvent[];
}

export type RequestTransitionResult = AppliedRequestTransition | RefusedRequestTransition;

/** Resolve an event against the current status. Never throws, never mutates. */
export function applyTransition(
  from: RequestStatus,
  event: RequestEvent,
): RequestTransitionResult {
  const transition = transitionFor(from, event);

  if (transition === null) {
    return { ok: false, from, event, reason: 'ILLEGAL_TRANSITION', allowed: allowedEvents(from) };
  }

  return { ok: true, from, event, to: transition.to, effects: transition.effects };
}

/* -------------------------------------------------------------------------- */
/* Effect helpers                                                              */
/* -------------------------------------------------------------------------- */

export function emailEffects(effects: readonly RequestEffect[]): readonly RequestEmailEffect[] {
  return effects.filter((effect): effect is RequestEmailEffect => effect.kind === 'EMAIL');
}

export function notificationEffects(
  effects: readonly RequestEffect[],
): readonly RequestNotificationEffect[] {
  return effects.filter(
    (effect): effect is RequestNotificationEffect => effect.kind === 'NOTIFICATION',
  );
}

export function timelineEffects(
  effects: readonly RequestEffect[],
): readonly RequestTimelineEffect[] {
  return effects.filter((effect): effect is RequestTimelineEffect => effect.kind === 'TIMELINE');
}

/** Exactly one per transition — an unaudited state change is not permitted (§20). */
export function auditAction(effects: readonly RequestEffect[]): RequestAuditAction | null {
  const effect = effects.find(
    (candidate): candidate is RequestAuditEffect => candidate.kind === 'AUDIT',
  );
  return effect?.action ?? null;
}

/* -------------------------------------------------------------------------- */
/* Entry points                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A request created *without* a justificatif starts here (§1666 row 2); one
 * created with the upload in the same action passes through
 * `RECEIPT_SUBMITTED` immediately after.
 */
export const INITIAL_REQUEST_STATUS: RequestStatus = 'AWAITING_RECEIPT';

/** §1666 row 1: `expiresAt = now + 7d` (overridable via `payment.requestExpiryDays`). */
export const REQUEST_EXPIRY_DAYS_DEFAULT = 7;
