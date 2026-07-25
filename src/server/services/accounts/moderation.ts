/**
 * Account moderation — approve, reject, suspend, reinstate, re-apply
 * (spec §9.1, §17.2, §18 rows 4 and 5).
 *
 * ## Every mutation follows the same four steps, in this order (§20)
 * 1. **Validate** the input with a `.strict()` Zod schema.
 * 2. **Authorise** through `can()` — the §8 matrix, never an ad-hoc role test.
 * 3. **Transition** through the state machine, which decides both the next
 *    status and the side effects.
 * 4. **Commit** the status change, the e-mails, the notifications and the audit
 *    row in one transaction.
 *
 * ## Idempotency is structural, not hopeful
 * The status update is a compare-and-set: `WHERE id = ? AND status = <the status
 * the decision was based on>`. Two administrators pressing « Valider le compte »
 * on the same row at the same instant produce one winner; the loser's
 * `updateMany` matches zero rows and returns `changed: false` **before** any
 * e-mail is queued. Double-clicking cannot send two « bienvenue » messages or
 * write two notifications, which §17.2 requires and which a plain
 * `update({ where: { id } })` would not give.
 *
 * ## This file also hosts the shared effect executor
 * {@link executeAccountEffects} turns the machine's declared effects into rows.
 * It lives here rather than in `state-machine.ts` because the machine must stay
 * free of database imports to remain unit-testable, and here rather than
 * duplicated because `verify-email.ts` runs the very same effects.
 */

import { z } from 'zod';
import type { AccountStatus, Locale } from '@prisma/client';

import { transaction } from '@/server/db';
import { parsePhone } from '@/lib/phone';
import { can, type PermissionUser } from '@/server/auth/permissions';
import { revokeAllForUser } from '@/server/auth/session';
import { buildDiff, recordAudit, type AuditDiff } from '@/server/services/audit';
import {
  ACCOUNT_ROUTES,
  absoluteUrl,
  adminEmailRecipients,
  adminUserIds,
  createNotification,
  createNotifications,
  queueEmail,
  type JsonValue,
  type NotificationDbClient,
  type NotificationPayload,
} from '@/server/services/notifications';
import {
  applyTransition,
  sourceStatuses,
  type AccountEffect,
  type AccountEvent,
} from './state-machine';
import { toFieldIssues, type FieldIssue } from './register';

/* -------------------------------------------------------------------------- */
/* Rejection reasons (§17.2)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The four reasons the review drawer offers. Codes, not French labels: the
 * student's rejection e-mail is written in *their* locale, so the reason has to
 * survive as data (§10.2).
 *
 * `INCOMPLETE_INFO` → « Informations incomplètes »
 * `DUPLICATE`       → « Doublon »
 * `INVALID_PHONE`   → « Numéro invalide »
 * `OTHER`           → « Autre », which is why free text is mandatory with it.
 */
export const REJECTION_REASON_CODES = [
  'INCOMPLETE_INFO',
  'DUPLICATE',
  'INVALID_PHONE',
  'OTHER',
] as const;

export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

export interface RejectionReason {
  readonly code: RejectionReasonCode;
  /** Free text. Required for `OTHER`, optional and additive for the others. */
  readonly details: string | null;
}

export const REJECTION_DETAILS_MIN = 5;
export const REJECTION_DETAILS_MAX = 1_000;

/**
 * `User.rejectionReason` is a single TEXT column but the reason is two fields, so
 * it is stored as compact JSON. {@link parseRejectionReason} reads it back and
 * tolerates a legacy plain string, which it reports as `OTHER` + details.
 */
export function serializeRejectionReason(reason: RejectionReason): string {
  return JSON.stringify({ code: reason.code, details: reason.details });
}

export function parseRejectionReason(raw: string | null): RejectionReason | null {
  if (raw === null || raw.trim() === '') return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const code = record.code;
      if (typeof code === 'string' && (REJECTION_REASON_CODES as readonly string[]).includes(code)) {
        const details = record.details;
        return {
          code: code as RejectionReasonCode,
          details: typeof details === 'string' && details.trim() !== '' ? details : null,
        };
      }
    }
  } catch {
    // Not JSON — fall through to the legacy interpretation.
  }

  return { code: 'OTHER', details: raw };
}

/* -------------------------------------------------------------------------- */
/* Input schemas                                                               */
/* -------------------------------------------------------------------------- */

const userIdSchema = z.string().min(1).max(64);

export const approveAccountSchema = z.object({ userId: userIdSchema }).strict();

export const rejectAccountSchema = z
  .object({
    userId: userIdSchema,
    code: z.enum(REJECTION_REASON_CODES),
    details: z
      .string()
      .trim()
      .max(REJECTION_DETAILS_MAX)
      .optional()
      .transform((value) => (value === undefined || value === '' ? null : value)),
  })
  .strict()
  .superRefine((value, ctx) => {
    // « Autre » with no explanation is not a reason — and the student receives
    // this text verbatim in e-mail #5.
    if (value.code === 'OTHER' && (value.details === null || value.details.length < REJECTION_DETAILS_MIN)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['details'],
        message: 'admin.accounts.rejectDetailsRequired',
      });
    }
  });

/** §17.2 « Actions » — suspend with a duration and a reason. */
export const suspendAccountSchema = z
  .object({
    userId: userIdSchema,
    /** Whole days. `null` suspends indefinitely, until an administrator reinstates. */
    durationDays: z.number().int().min(1).max(3_650).nullable(),
    reason: z.string().trim().min(REJECTION_DETAILS_MIN).max(REJECTION_DETAILS_MAX),
  })
  .strict();

export const reinstateAccountSchema = z
  .object({
    userId: userIdSchema,
    reason: z
      .string()
      .trim()
      .max(REJECTION_DETAILS_MAX)
      .optional()
      .transform((value) => (value === undefined || value === '' ? null : value)),
  })
  .strict();

export const reapplySchema = z.object({ userId: userIdSchema }).strict();

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

export type ModerationResult =
  | {
      readonly ok: true;
      /** `false` when the account was already in the target state — a no-op, not an error. */
      readonly changed: boolean;
      readonly status: AccountStatus;
    }
  | {
      readonly ok: false;
      readonly code: 'INVALID';
      readonly issues: readonly FieldIssue[];
    }
  | {
      readonly ok: false;
      readonly code: 'FORBIDDEN' | 'NOT_FOUND';
    };

export interface ModerationContext {
  /** The administrator performing the action — `{ id, role, status }`. */
  readonly actor: PermissionUser;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly now?: Date;
}

/* -------------------------------------------------------------------------- */
/* The account, as the effects need it                                         */
/* -------------------------------------------------------------------------- */

/** Exactly the columns the e-mails and notifications of §18 read. Nothing more. */
export const ACCOUNT_SUBJECT_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  locale: true,
  city: true,
  professionalStatus: true,
  status: true,
  createdAt: true,
  deletedAt: true,
} as const;

export interface AccountSubject {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly locale: Locale;
  readonly city: string | null;
  readonly professionalStatus: string | null;
  readonly status: AccountStatus;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

/** Extra facts an effect may need that the account row does not carry. */
export interface EffectExtras {
  readonly rejection?: RejectionReason;
  readonly suspension?: { readonly reason: string; readonly until: Date | null };
}

export interface ExecuteEffectsInput {
  readonly tx: NotificationDbClient;
  readonly subject: AccountSubject;
  readonly effects: readonly AccountEffect[];
  readonly actorId: string | null;
  /** One readable French sentence for §17.13 and the activity feed of §17.1. */
  readonly summary: string;
  readonly diff?: AuditDiff | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly extras?: EffectExtras;
  readonly now: Date;
}

/**
 * Perform what a transition declared: queue the e-mails, create the in-app
 * notifications, write the audit row, revoke the sessions.
 *
 * Runs entirely on the caller's transaction client, so either the whole
 * transition lands or none of it does.
 */
export async function executeAccountEffects(input: ExecuteEffectsInput): Promise<void> {
  const { tx, subject, effects, extras, now } = input;

  // Resolved lazily: only the transitions that notify administrators pay for
  // the extra query.
  let admins: readonly string[] | null = null;
  const resolveAdmins = async (): Promise<readonly string[]> => {
    admins ??= await adminUserIds(tx);
    return admins;
  };

  for (const effect of effects) {
    switch (effect.kind) {
      case 'EMAIL': {
        if (effect.audience === 'STUDENT') {
          await queueEmail(
            {
              template: effect.template,
              to: [subject.email],
              locale: subject.locale,
              props: studentEmailProps(effect.template, subject, extras),
              relatedType: 'User',
              relatedId: subject.id,
              userId: subject.id,
            },
            tx,
          );
        } else {
          await queueEmail(
            {
              template: effect.template,
              to: adminEmailRecipients(),
              // The administration works in French; §18's Arabic layout follows
              // `User.locale`, and this recipient is the centre, not the student.
              locale: 'fr',
              props: adminEmailProps(subject),
              relatedType: 'User',
              relatedId: subject.id,
              userId: subject.id,
              // Keyed on the account *and* the moment it entered the queue, so a
              // re-application after a rejection is not swallowed as a duplicate.
              idempotencyKey: `${effect.template}:${subject.id}:${now.toISOString()}`,
            },
            tx,
          );
        }
        break;
      }

      case 'NOTIFICATION': {
        if (effect.audience === 'STUDENT') {
          await createNotification(
            {
              userId: subject.id,
              type: effect.type,
              payload: studentNotificationPayload(effect.type, subject, extras),
              link: studentNotificationLink(effect.type),
            },
            tx,
          );
        } else {
          await createNotifications(
            await resolveAdmins(),
            {
              type: effect.type,
              payload: { studentId: subject.id, studentName: subject.fullName },
              link: ACCOUNT_ROUTES.adminAccount(subject.id),
            },
            tx,
          );
        }
        break;
      }

      case 'AUDIT': {
        await recordAudit(
          {
            actorId: input.actorId,
            action: effect.action,
            entityType: 'User',
            entityId: subject.id,
            summary: input.summary,
            diff: input.diff ?? null,
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
          tx,
        );
        break;
      }

      case 'REVOKE_SESSIONS': {
        await revokeAllForUser(subject.id, { now, client: tx });
        break;
      }

      default:
        return assertNever(effect);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Effet de transition non pris en charge : ${JSON.stringify(value)}`);
}

/**
 * Props for the templates addressed to the student.
 *
 * These shapes are the contract with `src/server/mail/templates/*`; each
 * template re-validates them with its own `.strict()` schema when it renders.
 */
function studentEmailProps(
  template: string,
  subject: AccountSubject,
  extras: EffectExtras | undefined,
): Readonly<Record<string, JsonValue>> {
  switch (template) {
    case 'pending-approval':
      return {
        fullName: subject.fullName,
        waitingUrl: absoluteUrl(subject.locale, ACCOUNT_ROUTES.waiting()),
      };
    case 'account-approved':
      return {
        fullName: subject.fullName,
        loginUrl: absoluteUrl(subject.locale, ACCOUNT_ROUTES.login()),
      };
    case 'account-rejected':
      return {
        fullName: subject.fullName,
        reasonCode: extras?.rejection?.code ?? 'OTHER',
        reasonDetails: extras?.rejection?.details ?? null,
      };
    default:
      return { fullName: subject.fullName };
  }
}

/** Props for e-mail #3, « Nouveau compte à valider » (§18 row 3). */
function adminEmailProps(subject: AccountSubject): Readonly<Record<string, JsonValue>> {
  return {
    studentId: subject.id,
    fullName: subject.fullName,
    email: subject.email,
    phone: subject.phone,
    isMoroccanPhone: parsePhone(subject.phone)?.isMoroccan ?? false,
    city: subject.city,
    professionalStatus: subject.professionalStatus,
    studentLocale: subject.locale,
    registeredAt: subject.createdAt.toISOString(),
    // The administration panel is served in French by default (§17).
    adminUrl: absoluteUrl('fr', ACCOUNT_ROUTES.adminAccount(subject.id)),
  };
}

function studentNotificationPayload(
  type: string,
  subject: AccountSubject,
  extras: EffectExtras | undefined,
): NotificationPayload {
  if (type === 'ACCOUNT_SUSPENDED') {
    return {
      reason: extras?.suspension?.reason ?? '',
      until: extras?.suspension?.until?.toISOString() ?? null,
    };
  }
  return { fullName: subject.fullName };
}

function studentNotificationLink(type: string): string {
  return type === 'ACCOUNT_PENDING_APPROVAL' ? ACCOUNT_ROUTES.waiting() : '/espace';
}

/* -------------------------------------------------------------------------- */
/* Approve                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * « Valider le compte » (§17.2).
 *
 * Idempotent: a second call on an already-`ACTIVE` account returns
 * `{ ok: true, changed: false }` without queueing an e-mail or writing a
 * notification. The same call also reactivates a `REJECTED` account, which §9.1
 * allows "at any time".
 */
export async function approveAccount(
  input: unknown,
  context: ModerationContext,
): Promise<ModerationResult> {
  const parsed = approveAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID', issues: toFieldIssues(parsed.error) };
  if (!can(context.actor, 'account.approve')) return { ok: false, code: 'FORBIDDEN' };

  const now = context.now ?? new Date();

  return transaction(async (tx) => {
    const subject = await loadSubject(tx, parsed.data.userId);
    if (subject === null) return { ok: false, code: 'NOT_FOUND' } as const;

    const outcome = applyTransition(subject.status, 'ADMIN_APPROVED');
    if (!outcome.ok) return { ok: true, changed: false, status: subject.status } as const;

    const updated = await tx.user.updateMany({
      where: { id: subject.id, status: outcome.from, deletedAt: null },
      data: {
        status: outcome.to,
        approvedAt: now,
        approvedById: context.actor.id,
        // A reactivated account must not keep the reason it was refused for.
        rejectionReason: null,
        suspendedUntil: null,
      },
    });
    if (updated.count === 0) return { ok: true, changed: false, status: subject.status } as const;

    await executeAccountEffects({
      tx,
      subject,
      effects: outcome.effects,
      actorId: context.actor.id,
      summary: `Compte de ${subject.fullName} validé.`,
      diff: buildDiff({ status: outcome.from }, { status: outcome.to, approvedAt: now }),
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      now,
    });

    return { ok: true, changed: true, status: outcome.to } as const;
  });
}

/* -------------------------------------------------------------------------- */
/* Reject                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * « Refuser » (§17.2). The reason is mandatory and is sent to the student in
 * e-mail #5, so it is stored as data rather than as a French sentence.
 */
export async function rejectAccount(
  input: unknown,
  context: ModerationContext,
): Promise<ModerationResult> {
  const parsed = rejectAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID', issues: toFieldIssues(parsed.error) };
  if (!can(context.actor, 'account.approve')) return { ok: false, code: 'FORBIDDEN' };

  const now = context.now ?? new Date();
  const reason: RejectionReason = { code: parsed.data.code, details: parsed.data.details };

  return transaction(async (tx) => {
    const subject = await loadSubject(tx, parsed.data.userId);
    if (subject === null) return { ok: false, code: 'NOT_FOUND' } as const;

    const outcome = applyTransition(subject.status, 'ADMIN_REJECTED');
    if (!outcome.ok) return { ok: true, changed: false, status: subject.status } as const;

    const updated = await tx.user.updateMany({
      where: { id: subject.id, status: outcome.from, deletedAt: null },
      data: {
        status: outcome.to,
        rejectionReason: serializeRejectionReason(reason),
        approvedAt: null,
        approvedById: null,
      },
    });
    if (updated.count === 0) return { ok: true, changed: false, status: subject.status } as const;

    await executeAccountEffects({
      tx,
      subject,
      effects: outcome.effects,
      actorId: context.actor.id,
      summary: `Compte de ${subject.fullName} refusé (motif : ${reason.code}).`,
      diff: buildDiff(
        { status: outcome.from, rejectionReason: null },
        { status: outcome.to, rejectionReason: reason.code },
      ),
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      extras: { rejection: reason },
      now,
    });

    return { ok: true, changed: true, status: outcome.to } as const;
  });
}

/* -------------------------------------------------------------------------- */
/* Suspend                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Suspend an active account for a duration, or indefinitely (§17.2 Actions).
 *
 * Every live session dies with the suspension — the machine says so, and
 * {@link executeAccountEffects} carries it out inside the same transaction.
 */
export async function suspendAccount(
  input: unknown,
  context: ModerationContext,
): Promise<ModerationResult> {
  const parsed = suspendAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID', issues: toFieldIssues(parsed.error) };
  if (!can(context.actor, 'account.approve')) return { ok: false, code: 'FORBIDDEN' };

  const now = context.now ?? new Date();
  const until =
    parsed.data.durationDays === null
      ? null
      : new Date(now.getTime() + parsed.data.durationDays * 24 * 60 * 60 * 1_000);

  return transaction(async (tx) => {
    const subject = await loadSubject(tx, parsed.data.userId);
    if (subject === null) return { ok: false, code: 'NOT_FOUND' } as const;

    const outcome = applyTransition(subject.status, 'ADMIN_SUSPENDED');
    if (!outcome.ok) return { ok: true, changed: false, status: subject.status } as const;

    const updated = await tx.user.updateMany({
      where: { id: subject.id, status: outcome.from, deletedAt: null },
      data: { status: outcome.to, suspendedUntil: until },
    });
    if (updated.count === 0) return { ok: true, changed: false, status: subject.status } as const;

    await executeAccountEffects({
      tx,
      subject,
      effects: outcome.effects,
      actorId: context.actor.id,
      summary:
        until === null
          ? `Compte de ${subject.fullName} suspendu sans échéance.`
          : `Compte de ${subject.fullName} suspendu jusqu'au ${until.toISOString().slice(0, 10)}.`,
      diff: buildDiff(
        { status: outcome.from, suspendedUntil: null },
        { status: outcome.to, suspendedUntil: until },
      ),
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      extras: { suspension: { reason: parsed.data.reason, until } },
      now,
    });

    return { ok: true, changed: true, status: outcome.to } as const;
  });
}

/* -------------------------------------------------------------------------- */
/* Reinstate                                                                   */
/* -------------------------------------------------------------------------- */

/** The "reinstates" arrow of §9.1: `SUSPENDED → ACTIVE`. */
export async function reinstateAccount(
  input: unknown,
  context: ModerationContext,
): Promise<ModerationResult> {
  const parsed = reinstateAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID', issues: toFieldIssues(parsed.error) };
  if (!can(context.actor, 'account.approve')) return { ok: false, code: 'FORBIDDEN' };

  const now = context.now ?? new Date();

  return transaction(async (tx) => {
    const subject = await loadSubject(tx, parsed.data.userId);
    if (subject === null) return { ok: false, code: 'NOT_FOUND' } as const;

    const outcome = applyTransition(subject.status, 'ADMIN_REINSTATED');
    if (!outcome.ok) return { ok: true, changed: false, status: subject.status } as const;

    const updated = await tx.user.updateMany({
      where: { id: subject.id, status: outcome.from, deletedAt: null },
      data: { status: outcome.to, suspendedUntil: null },
    });
    if (updated.count === 0) return { ok: true, changed: false, status: subject.status } as const;

    await executeAccountEffects({
      tx,
      subject,
      effects: outcome.effects,
      actorId: context.actor.id,
      summary:
        parsed.data.reason === null
          ? `Compte de ${subject.fullName} réactivé.`
          : `Compte de ${subject.fullName} réactivé : ${parsed.data.reason}`,
      diff: buildDiff({ status: outcome.from }, { status: outcome.to, suspendedUntil: null }),
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      now,
    });

    return { ok: true, changed: true, status: outcome.to } as const;
  });
}

/* -------------------------------------------------------------------------- */
/* Re-apply                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The "can re-apply after fix" edge of §9.1: a rejected student who has
 * corrected what was wrong puts their account back in the moderation queue.
 *
 * Student-initiated, so the authorisation is ownership rather than a capability:
 * the actor must be the account holder. An administrator does not need this —
 * they have {@link approveAccount}, which reactivates a rejected account
 * directly.
 */
export async function reapplyForApproval(
  input: unknown,
  context: ModerationContext,
): Promise<ModerationResult> {
  const parsed = reapplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID', issues: toFieldIssues(parsed.error) };
  if (context.actor.id !== parsed.data.userId) return { ok: false, code: 'FORBIDDEN' };

  const now = context.now ?? new Date();

  return transaction(async (tx) => {
    const subject = await loadSubject(tx, parsed.data.userId);
    if (subject === null) return { ok: false, code: 'NOT_FOUND' } as const;

    const outcome = applyTransition(subject.status, 'REAPPLIED');
    if (!outcome.ok) return { ok: true, changed: false, status: subject.status } as const;

    const updated = await tx.user.updateMany({
      where: { id: subject.id, status: outcome.from, deletedAt: null },
      data: { status: outcome.to, rejectionReason: null },
    });
    if (updated.count === 0) return { ok: true, changed: false, status: subject.status } as const;

    await executeAccountEffects({
      tx,
      subject,
      effects: outcome.effects,
      actorId: subject.id,
      summary: `${subject.fullName} a soumis à nouveau son compte à la validation.`,
      diff: buildDiff({ status: outcome.from }, { status: outcome.to }),
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      now,
    });

    return { ok: true, changed: true, status: outcome.to } as const;
  });
}

/* -------------------------------------------------------------------------- */
/* Shared loading                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Load the account a moderation action targets.
 *
 * A soft-deleted row is `null`: an anonymised account (§20 retention) is gone as
 * far as moderation is concerned, and resurrecting it by approving it would undo
 * a deletion request.
 */
export async function loadSubject(
  client: NotificationDbClient,
  userId: string,
): Promise<AccountSubject | null> {
  const row = await client.user.findUnique({
    where: { id: userId },
    select: ACCOUNT_SUBJECT_SELECT,
  });
  if (row === null || row.deletedAt !== null) return null;
  return row;
}

/**
 * The statuses each moderation event can be applied from, for the admin UI: it
 * is what decides whether « Suspendre » is enabled on a given row.
 */
export function moderationSources(event: AccountEvent): readonly AccountStatus[] {
  return sourceStatuses(event);
}
