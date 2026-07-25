/**
 * The account lifecycle, as an explicit state machine (spec §9, §9.1).
 *
 * ```
 *                 ┌──────────────┐
 *  register  ──▶  │PENDING_EMAIL │
 *                 └──────┬───────┘
 *         clicks email link │
 *                 ┌────────▼─────────┐        admin rejects      ┌─────────┐
 *                 │PENDING_APPROVAL  │ ────────────────────────▶ │REJECTED │
 *                 └────────┬─────────┘                           └─────────┘
 *         admin approves   │                                          │ can re-apply
 *                 ┌────────▼─────┐   admin suspends    ┌───────────┐  │ after fix
 *                 │    ACTIVE    │ ──────────────────▶ │ SUSPENDED │◀─┘
 *                 └──────────────┘ ◀────────────────── └───────────┘
 *                                      reinstates
 * ```
 *
 * ## Why a machine and not a pile of `if`s
 * §9 is explicit: "Implement them as explicit state machines … with exhaustive
 * `switch` statements — not as scattered `if` blocks in route handlers." Every
 * legal edge is declared exactly once, here. A service asks the machine what a
 * given event does; it never decides for itself. The consequences:
 *
 * - **Illegal transitions are data, not accidents.** `applyTransition` returns a
 *   refusal carrying the events that *would* have been legal, so a caller can
 *   log or surface something better than "erreur".
 * - **Idempotency falls out for free.** Approving an already-`ACTIVE` account is
 *   an illegal transition, so `moderation.approveAccount` short-circuits before
 *   it can send a second e-mail or write a second notification (§17.2).
 * - **Every edge, legal and illegal, is unit-testable** without a database:
 *   this module imports nothing but a type.
 *
 * ## Side effects are described, not performed
 * A transition returns *what must happen* — which e-mail, to whom, which in-app
 * notification, which audit action, whether live sessions die. The calling
 * service performs them inside its transaction. That keeps the machine pure and
 * makes "does approving send exactly one e-mail?" a question a test can answer
 * by reading a value.
 *
 * ## Deliberate omissions
 * Edges the §9.1 diagram does not draw are **not** legal here, even where one
 * might be convenient:
 * - `PENDING_EMAIL → REJECTED`: an account that never confirmed its address is
 *   cleaned up by the retention job, not moderated.
 * - `PENDING_APPROVAL → SUSPENDED`: suspension acts on an account that has
 *   access; refusing one that does not yet have any is a rejection.
 * - `ACTIVE → REJECTED`: revoking an approved account is a suspension.
 * Adding an edge means adding it to the diagram in the spec first.
 */

import type { AccountStatus } from '@prisma/client';

/* -------------------------------------------------------------------------- */
/* Alphabet                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every lifecycle state, declared as a `Record` keyed by Prisma's enum so the
 * compiler rejects both a missing member and an invented one. A schema change
 * that adds or renames a status breaks this line — which is exactly where it
 * should break.
 */
const ACCOUNT_STATUS_KEYS: Record<AccountStatus, null> = {
  PENDING_EMAIL: null,
  PENDING_APPROVAL: null,
  ACTIVE: null,
  REJECTED: null,
  SUSPENDED: null,
};

/** The states, in lifecycle order (object key order is insertion order). */
export const ACCOUNT_STATUSES = Object.keys(ACCOUNT_STATUS_KEYS) as readonly AccountStatus[];

/**
 * Everything that can move an account.
 *
 * - `EMAIL_VERIFIED` — the student opened the link in e-mail #1.
 * - `ADMIN_APPROVED` — « Valider le compte » in the review drawer (§17.2). Also
 *   the edge that reactivates a rejected account, which §9.1 allows "at any
 *   time".
 * - `ADMIN_REJECTED` — « Refuser », with a mandatory reason.
 * - `ADMIN_SUSPENDED` — suspension with a duration and a reason (§17.2 Actions).
 * - `ADMIN_REINSTATED` — the "reinstates" arrow back to `ACTIVE`.
 * - `REAPPLIED` — the "can re-apply after fix" edge: a rejected student corrects
 *   what was wrong and puts the account back in the moderation queue.
 */
export const ACCOUNT_EVENTS = [
  'EMAIL_VERIFIED',
  'ADMIN_APPROVED',
  'ADMIN_REJECTED',
  'ADMIN_SUSPENDED',
  'ADMIN_REINSTATED',
  'REAPPLIED',
] as const;

export type AccountEvent = (typeof ACCOUNT_EVENTS)[number];

/* -------------------------------------------------------------------------- */
/* Side-effect vocabulary                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Template ids of the account e-mails in §18, matching the `id` field of the
 * templates in `src/server/mail/templates/*`. Only the four that a *transition*
 * triggers appear here; registration (#1) and the password e-mails (#13, #14)
 * are not transitions of this machine and live in
 * {@link import('../notifications').EmailTemplateId}.
 */
export type AccountEmailTemplateId =
  /** #2 — « Votre compte est en cours de validation », to the student. */
  | 'pending-approval'
  /** #3 — « Nouveau compte à valider », to `MAIL_ADMIN_RECIPIENTS`. */
  | 'admin-new-account'
  /** #4 — « Bienvenue — votre compte est validé », to the student. */
  | 'account-approved'
  /** #5 — « Votre inscription n'a pas pu être validée », to the student. */
  | 'account-rejected';

/** In-app notification types this machine produces (`Notification.type`). */
export type AccountNotificationType =
  | 'ACCOUNT_PENDING_APPROVAL'
  | 'ACCOUNT_AWAITING_REVIEW'
  | 'ACCOUNT_APPROVED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_REINSTATED';

/** `AuditLog.action` values this machine produces. */
export type AccountAuditAction =
  | 'ACCOUNT_EMAIL_VERIFIED'
  | 'ACCOUNT_APPROVED'
  | 'ACCOUNT_REJECTED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_REINSTATED'
  | 'ACCOUNT_REAPPLIED';

/** Who an effect is aimed at. Addresses and ids are resolved by the service. */
export type AccountAudience = 'STUDENT' | 'ADMINS';

export interface AccountEmailEffect {
  readonly kind: 'EMAIL';
  readonly template: AccountEmailTemplateId;
  readonly audience: AccountAudience;
}

export interface AccountNotificationEffect {
  readonly kind: 'NOTIFICATION';
  readonly type: AccountNotificationType;
  readonly audience: AccountAudience;
}

export interface AccountAuditEffect {
  readonly kind: 'AUDIT';
  readonly action: AccountAuditAction;
}

/**
 * Kill every live session of the account. Emitted on suspension and on
 * rejection: an admin who suspends an account expects the person to be logged
 * out *now*, not at the next page load (§20).
 */
export interface AccountRevokeSessionsEffect {
  readonly kind: 'REVOKE_SESSIONS';
}

export type AccountEffect =
  | AccountEmailEffect
  | AccountNotificationEffect
  | AccountAuditEffect
  | AccountRevokeSessionsEffect;

/* -------------------------------------------------------------------------- */
/* Transitions                                                                 */
/* -------------------------------------------------------------------------- */

export interface AccountTransition {
  readonly to: AccountStatus;
  readonly effects: readonly AccountEffect[];
}

/**
 * §18 row 2 + row 3: verifying the address notifies the student that a human
 * review is pending, and tells the administrators there is work waiting.
 */
const ON_EMAIL_VERIFIED: AccountTransition = {
  to: 'PENDING_APPROVAL',
  effects: [
    { kind: 'EMAIL', template: 'pending-approval', audience: 'STUDENT' },
    { kind: 'NOTIFICATION', type: 'ACCOUNT_PENDING_APPROVAL', audience: 'STUDENT' },
    { kind: 'EMAIL', template: 'admin-new-account', audience: 'ADMINS' },
    { kind: 'NOTIFICATION', type: 'ACCOUNT_AWAITING_REVIEW', audience: 'ADMINS' },
    { kind: 'AUDIT', action: 'ACCOUNT_EMAIL_VERIFIED' },
  ],
};

/** §18 row 4: e-mail #4 plus an in-app notification. Exactly one of each. */
const ON_APPROVED: AccountTransition = {
  to: 'ACTIVE',
  effects: [
    { kind: 'EMAIL', template: 'account-approved', audience: 'STUDENT' },
    { kind: 'NOTIFICATION', type: 'ACCOUNT_APPROVED', audience: 'STUDENT' },
    { kind: 'AUDIT', action: 'ACCOUNT_APPROVED' },
  ],
};

/**
 * §18 row 5: e-mail #5 carries the reason and the WhatsApp CTA. The table's
 * in-app column is empty for this row on purpose — a rejected account cannot
 * reach the notification centre, so a notification would be written and never
 * read.
 */
const ON_REJECTED: AccountTransition = {
  to: 'REJECTED',
  effects: [
    { kind: 'EMAIL', template: 'account-rejected', audience: 'STUDENT' },
    { kind: 'AUDIT', action: 'ACCOUNT_REJECTED' },
    { kind: 'REVOKE_SESSIONS' },
  ],
};

/**
 * Suspension sends no e-mail: §18 defines none, and the center's practice is to
 * call the student. The in-app notification carries the reason and the end date
 * so the account holder sees why the moment they try to sign in again.
 */
const ON_SUSPENDED: AccountTransition = {
  to: 'SUSPENDED',
  effects: [
    { kind: 'NOTIFICATION', type: 'ACCOUNT_SUSPENDED', audience: 'STUDENT' },
    { kind: 'AUDIT', action: 'ACCOUNT_SUSPENDED' },
    { kind: 'REVOKE_SESSIONS' },
  ],
};

const ON_REINSTATED: AccountTransition = {
  to: 'ACTIVE',
  effects: [
    { kind: 'NOTIFICATION', type: 'ACCOUNT_REINSTATED', audience: 'STUDENT' },
    { kind: 'AUDIT', action: 'ACCOUNT_REINSTATED' },
  ],
};

/**
 * Re-applying puts the account back in the `À valider` queue and tells the
 * administrators, reusing e-mail #3 — from their side this *is* a new account to
 * validate. The student gets no e-mail: they just pressed the button.
 */
const ON_REAPPLIED: AccountTransition = {
  to: 'PENDING_APPROVAL',
  effects: [
    { kind: 'EMAIL', template: 'admin-new-account', audience: 'ADMINS' },
    { kind: 'NOTIFICATION', type: 'ACCOUNT_AWAITING_REVIEW', audience: 'ADMINS' },
    { kind: 'AUDIT', action: 'ACCOUNT_REAPPLIED' },
  ],
};

/* -------------------------------------------------------------------------- */
/* The switch                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The one place an edge is decided. Nested exhaustive `switch`es: with
 * `noFallthroughCasesInSwitch` and the `assertNever` defaults, adding a status
 * or an event to the alphabet above fails the build here until every case is
 * answered — including with an explicit `null` for "illegal".
 */
function transitionFor(from: AccountStatus, event: AccountEvent): AccountTransition | null {
  switch (from) {
    case 'PENDING_EMAIL':
      switch (event) {
        case 'EMAIL_VERIFIED':
          return ON_EMAIL_VERIFIED;
        case 'ADMIN_APPROVED':
        case 'ADMIN_REJECTED':
        case 'ADMIN_SUSPENDED':
        case 'ADMIN_REINSTATED':
        case 'REAPPLIED':
          return null;
        default:
          return assertNever(event);
      }

    case 'PENDING_APPROVAL':
      switch (event) {
        case 'ADMIN_APPROVED':
          return ON_APPROVED;
        case 'ADMIN_REJECTED':
          return ON_REJECTED;
        case 'EMAIL_VERIFIED':
        case 'ADMIN_SUSPENDED':
        case 'ADMIN_REINSTATED':
        case 'REAPPLIED':
          return null;
        default:
          return assertNever(event);
      }

    case 'ACTIVE':
      switch (event) {
        case 'ADMIN_SUSPENDED':
          return ON_SUSPENDED;
        case 'EMAIL_VERIFIED':
        case 'ADMIN_APPROVED':
        case 'ADMIN_REJECTED':
        case 'ADMIN_REINSTATED':
        case 'REAPPLIED':
          return null;
        default:
          return assertNever(event);
      }

    case 'REJECTED':
      switch (event) {
        // §9.1: "the account can be reactivated by the admin at any time".
        case 'ADMIN_APPROVED':
          return ON_APPROVED;
        // The "can re-apply after fix" edge, student-initiated.
        case 'REAPPLIED':
          return ON_REAPPLIED;
        case 'EMAIL_VERIFIED':
        case 'ADMIN_REJECTED':
        case 'ADMIN_SUSPENDED':
        case 'ADMIN_REINSTATED':
          return null;
        default:
          return assertNever(event);
      }

    case 'SUSPENDED':
      switch (event) {
        case 'ADMIN_REINSTATED':
          return ON_REINSTATED;
        case 'EMAIL_VERIFIED':
        case 'ADMIN_APPROVED':
        case 'ADMIN_REJECTED':
        case 'ADMIN_SUSPENDED':
        case 'REAPPLIED':
          return null;
        default:
          return assertNever(event);
      }

    default:
      return assertNever(from);
  }
}

function assertNever(value: never): never {
  throw new Error(`Transition non exhaustive dans la machine à états des comptes : ${String(value)}`);
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The full transition table, `null` where the edge does not exist.
 *
 * Derived from {@link transitionFor} rather than written out a second time, so
 * the table and the switch cannot drift apart. Use it for documentation, for the
 * admin diagnostics page, and for a test that walks all 30 cells.
 */
export const ACCOUNT_TRANSITIONS: Readonly<
  Record<AccountStatus, Readonly<Record<AccountEvent, AccountStatus | null>>>
> = buildTable();

function buildTable(): Record<AccountStatus, Record<AccountEvent, AccountStatus | null>> {
  const table = {} as Record<AccountStatus, Record<AccountEvent, AccountStatus | null>>;
  for (const status of ACCOUNT_STATUSES) {
    const row = {} as Record<AccountEvent, AccountStatus | null>;
    for (const event of ACCOUNT_EVENTS) {
      row[event] = transitionFor(status, event)?.to ?? null;
    }
    table[status] = row;
  }
  return table;
}

/** `true` when `event` is legal from `from`. Cheap enough to call in a render. */
export function canTransition(from: AccountStatus, event: AccountEvent): boolean {
  return transitionFor(from, event) !== null;
}

/** Every event that is legal from `from` — the basis for enabling admin buttons. */
export function allowedEvents(from: AccountStatus): readonly AccountEvent[] {
  return ACCOUNT_EVENTS.filter((event) => canTransition(from, event));
}

/**
 * Every status `event` is legal from.
 *
 * Used to write the compare-and-set guard of a moderation update: the `WHERE`
 * clause narrows on the status the decision was based on, so two administrators
 * clicking « Valider » at the same moment produce one winner and one no-op
 * instead of two e-mails (§17.2 idempotency).
 */
export function sourceStatuses(event: AccountEvent): readonly AccountStatus[] {
  return ACCOUNT_STATUSES.filter((status) => canTransition(status, event));
}

export interface AppliedTransition {
  readonly ok: true;
  readonly from: AccountStatus;
  readonly event: AccountEvent;
  readonly to: AccountStatus;
  readonly effects: readonly AccountEffect[];
}

export interface RefusedTransition {
  readonly ok: false;
  readonly from: AccountStatus;
  readonly event: AccountEvent;
  readonly reason: 'ILLEGAL_TRANSITION';
  /** What the caller could have done instead — useful in a log line and in a test. */
  readonly allowed: readonly AccountEvent[];
}

export type TransitionResult = AppliedTransition | RefusedTransition;

/**
 * Resolve an event against the current status.
 *
 * Never throws and never mutates: it answers "what would happen", and the caller
 * decides whether to commit. A refusal is a normal, expected outcome — it is how
 * a double-clicked « Valider » is absorbed.
 */
export function applyTransition(from: AccountStatus, event: AccountEvent): TransitionResult {
  const transition = transitionFor(from, event);

  if (transition === null) {
    return {
      ok: false,
      from,
      event,
      reason: 'ILLEGAL_TRANSITION',
      allowed: allowedEvents(from),
    };
  }

  return { ok: true, from, event, to: transition.to, effects: transition.effects };
}

/* -------------------------------------------------------------------------- */
/* Effect helpers                                                              */
/* -------------------------------------------------------------------------- */

/** The e-mails a transition must queue, in declaration order. */
export function emailEffects(effects: readonly AccountEffect[]): readonly AccountEmailEffect[] {
  return effects.filter((effect): effect is AccountEmailEffect => effect.kind === 'EMAIL');
}

/** The in-app notifications a transition must create. */
export function notificationEffects(
  effects: readonly AccountEffect[],
): readonly AccountNotificationEffect[] {
  return effects.filter(
    (effect): effect is AccountNotificationEffect => effect.kind === 'NOTIFICATION',
  );
}

/**
 * The audit action a transition records. Every transition declares exactly one;
 * `null` would mean an unaudited state change, which §20 does not permit.
 */
export function auditAction(effects: readonly AccountEffect[]): AccountAuditAction | null {
  const effect = effects.find((candidate): candidate is AccountAuditEffect => candidate.kind === 'AUDIT');
  return effect?.action ?? null;
}

/** `true` when the transition must log the account out everywhere. */
export function revokesSessions(effects: readonly AccountEffect[]): boolean {
  return effects.some((effect) => effect.kind === 'REVOKE_SESSIONS');
}

/* -------------------------------------------------------------------------- */
/* Reachability                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The status a brand-new registration starts in (§9.1). Exported so
 * `register.ts` and the tests agree on the entry point without repeating a
 * literal.
 */
export const INITIAL_ACCOUNT_STATUS: AccountStatus = 'PENDING_EMAIL';

/**
 * Statuses from which the account holder may sign in.
 *
 * `PENDING_APPROVAL` is included deliberately: §9.1 lets those users log in but
 * confines them to the waiting screen, their profile, the public catalogue and
 * the guest-mode assistant. The confinement is the middleware's job; the right
 * to hold a session is this list's.
 */
export const SIGN_IN_ALLOWED_STATUSES: readonly AccountStatus[] = ['PENDING_APPROVAL', 'ACTIVE'];

/** `true` when a session may be minted for an account in this status. */
export function canSignIn(status: AccountStatus): boolean {
  return SIGN_IN_ALLOWED_STATUSES.includes(status);
}
