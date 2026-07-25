'use server';

/**
 * Server actions for the account-approval queue (§17.2).
 *
 * Every export goes through {@link withAction}, which enforces the §20 order:
 * Origin check → Zod `.strict()` → session → capability (`account.approve`) →
 * handler. Not one line below touches the database before that has happened.
 *
 * ## The decisions themselves live in the service, not here
 * `approve`, `reject` and their bulk forms delegate to
 * `@/server/services/accounts/moderation`, which owns the state machine, the
 * compare-and-set idempotency, the e-mails, the notifications and the audit
 * row — all inside one transaction. This file's job is authorisation, shaping
 * the result for the interface, and cache invalidation.
 *
 * ## Why the outcome carries a name and an address
 * §17.2 requires the interface to state exactly what happened — « Compte validé ·
 * e-mail envoyé à salma@… ». That sentence needs the subject's name and address,
 * which `ModerationResult` deliberately does not carry, so each action loads the
 * subject first and returns it alongside the decision.
 *
 * ## Bulk is per-row, never all-or-nothing
 * One rejected row must not roll back forty approved ones. Each user is its own
 * transaction (the service opens it) and its own outcome; the batch always
 * returns a full report the interface can render row by row.
 */

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import type { AccountStatus, Locale, Role } from '@prisma/client';

import { db, transaction } from '@/server/db';
import { ActionError, assertCan, requireAdmin, withAction } from '@/server/auth/guards';
import type { PermissionUser } from '@/server/auth/permissions';
import { revokeAllForUser } from '@/server/auth/session';
import { buildDiff, recordAudit } from '@/server/services/audit';
import {
  REJECTION_REASON_CODES,
  REJECTION_DETAILS_MAX,
  REJECTION_DETAILS_MIN,
  approveAccount,
  loadSubject,
  rejectAccount,
  type ModerationContext,
  type ModerationResult,
} from '@/server/services/accounts/moderation';

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                               */
/* -------------------------------------------------------------------------- */

const userIdSchema = z.string().min(1).max(64);

/** How many accounts one bulk press may touch. Beyond this, use the filters. */
const BULK_MAX = 100;

/**
 * What happened to one account.
 *
 * `unchanged` is a success, not a failure: the account was already in the target
 * state, so no second « bienvenue » e-mail went out. The interface says so
 * rather than pretending something happened.
 */
export type AccountOutcomeResult = 'changed' | 'unchanged' | 'notFound' | 'refused' | 'invalid';

export interface AccountOutcome {
  readonly userId: string;
  /** `null` when the account could not be loaded. */
  readonly fullName: string | null;
  /** The address the decision e-mail went to. `null` when nothing was sent. */
  readonly email: string | null;
  readonly result: AccountOutcomeResult;
  readonly status: AccountStatus | null;
}

export interface BulkOutcome {
  readonly outcomes: readonly AccountOutcome[];
  readonly changed: number;
  readonly unchanged: number;
  readonly failed: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Refresh every screen under the admin layout: the lists *and* the top-bar
 * counter. The pattern is the URL one — a route group leaves no segment behind.
 */
function revalidateAdmin(): void {
  revalidatePath('/[locale]/admin', 'layout');
}

function moderationContext(
  actor: PermissionUser,
  ip: string | null,
  userAgent: string | null,
): ModerationContext {
  return { actor, ip, userAgent };
}

/**
 * Run one moderation decision and describe it in the shape the queue renders.
 *
 * The subject is loaded *before* the decision so the outcome can name the person
 * even when the transition turns out to be a no-op; a soft-deleted or unknown
 * account short-circuits to `notFound` without the service being called at all.
 */
async function decide(
  userId: string,
  run: () => Promise<ModerationResult>,
): Promise<AccountOutcome> {
  const subject = await loadSubject(db, userId);
  if (subject === null) {
    return { userId, fullName: null, email: null, result: 'notFound', status: null };
  }

  const result = await run();

  if (result.ok) {
    return {
      userId,
      fullName: subject.fullName,
      email: result.changed ? subject.email : null,
      result: result.changed ? 'changed' : 'unchanged',
      status: result.status,
    };
  }

  return {
    userId,
    fullName: subject.fullName,
    email: null,
    result: result.code === 'INVALID' ? 'invalid' : result.code === 'NOT_FOUND' ? 'notFound' : 'refused',
    status: subject.status,
  };
}

function summarize(outcomes: readonly AccountOutcome[]): BulkOutcome {
  let changed = 0;
  let unchanged = 0;
  let failed = 0;

  for (const outcome of outcomes) {
    if (outcome.result === 'changed') changed += 1;
    else if (outcome.result === 'unchanged') unchanged += 1;
    else failed += 1;
  }

  return { outcomes, changed, unchanged, failed };
}

/** A single decision that could not be applied is an error, not a silent no-op. */
function assertSingleOutcome(outcome: AccountOutcome): AccountOutcome {
  if (outcome.result === 'notFound') {
    throw new ActionError('not_found', 'admin.actionError.notFound');
  }
  if (outcome.result === 'refused') {
    throw new ActionError('forbidden', 'admin.actionError.forbidden');
  }
  if (outcome.result === 'invalid') {
    throw new ActionError('validation', 'admin.actionError.validation');
  }
  return outcome;
}

/* -------------------------------------------------------------------------- */
/* Read model for the account detail page (§17.2)                              */
/* -------------------------------------------------------------------------- */

/**
 * The columns `/admin/comptes/[id]` shows that no read model covers yet — the
 * internal note, the login counters, the approving administrator.
 *
 * It lives in this module because `src/app/**` may not import the Prisma client
 * (§5) and Milestone 1 owns no account-security service to put it in. **Every
 * export of a `'use server'` module is a public endpoint**, so it authenticates
 * and authorises exactly like a mutation before it reads a single column, and
 * it validates its argument first.
 */
export interface AdminAccountDetail {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly emailVerifiedAt: Date | null;
  readonly phone: string;
  readonly city: string | null;
  readonly professionalStatus: string | null;
  readonly status: AccountStatus;
  readonly role: Role;
  readonly locale: Locale;
  readonly tags: string | null;
  readonly internalNote: string | null;
  readonly createdAt: Date;
  readonly approvedAt: Date | null;
  readonly approvedByName: string | null;
  /** Raw column; decode it with `parseRejectionReason`. */
  readonly rejectionReason: string | null;
  readonly lastLoginAt: Date | null;
  readonly lastLoginIp: string | null;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
}

export async function getAccountDetail(userId: unknown): Promise<AdminAccountDetail | null> {
  const parsed = userIdSchema.safeParse(userId);
  if (!parsed.success) return null;

  const actor = await requireAdmin();
  assertCan(actor, 'account.approve');

  const row = await db.user.findUnique({
    where: { id: parsed.data },
    select: {
      id: true,
      fullName: true,
      email: true,
      emailVerifiedAt: true,
      phone: true,
      city: true,
      professionalStatus: true,
      status: true,
      role: true,
      locale: true,
      tags: true,
      internalNote: true,
      createdAt: true,
      approvedAt: true,
      rejectionReason: true,
      lastLoginAt: true,
      lastLoginIp: true,
      failedLoginCount: true,
      lockedUntil: true,
      deletedAt: true,
      approvedBy: { select: { fullName: true } },
    },
  });

  // A soft-deleted account is gone as far as the panel is concerned (§20).
  if (row === null || row.deletedAt !== null) return null;

  const { deletedAt: _deletedAt, approvedBy, ...rest } = row;
  return { ...rest, approvedByName: approvedBy?.fullName ?? null };
}

/** One entry of an account's audit trail (§17.13, scoped to this entity). */
export interface AdminAuditEntry {
  readonly id: string;
  readonly action: string;
  readonly summary: string | null;
  readonly createdAt: Date;
  readonly actorName: string | null;
}

/** How many events the « Journal » tab shows before it needs its own page. */
const AUDIT_TRAIL_LIMIT = 50;

/**
 * This account's audit trail, newest first.
 *
 * Gated on `auditLog.view` — the §8 row that separates an administrator who may
 * read the journal from one who may not — rather than on the account
 * capability, because these are two different questions.
 */
export async function listAccountAuditTrail(userId: unknown): Promise<readonly AdminAuditEntry[]> {
  const parsed = userIdSchema.safeParse(userId);
  if (!parsed.success) return [];

  const actor = await requireAdmin();
  assertCan(actor, 'auditLog.view');

  const rows = await db.auditLog.findMany({
    where: { entityType: 'User', entityId: parsed.data },
    orderBy: { createdAt: 'desc' },
    take: AUDIT_TRAIL_LIMIT,
    select: {
      id: true,
      action: true,
      summary: true,
      createdAt: true,
      actor: { select: { fullName: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    summary: row.summary,
    createdAt: row.createdAt,
    actorName: row.actor?.fullName ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Approve                                                                     */
/* -------------------------------------------------------------------------- */

/** « Valider le compte » (§17.2). Idempotent — a second press changes nothing. */
export const approveAccountAction = withAction(
  z.object({ userId: userIdSchema }).strict(),
  async (input, ctx): Promise<AccountOutcome> => {
    const outcome = await decide(input.userId, () =>
      approveAccount({ userId: input.userId }, moderationContext(ctx.user, ctx.ip, ctx.userAgent)),
    );
    revalidateAdmin();
    return assertSingleOutcome(outcome);
  },
  { auth: 'active', can: 'account.approve' },
);

/* -------------------------------------------------------------------------- */
/* Reject                                                                      */
/* -------------------------------------------------------------------------- */

const rejectInputSchema = z
  .object({
    userId: userIdSchema,
    code: z.enum(REJECTION_REASON_CODES),
    details: z.string().trim().max(REJECTION_DETAILS_MAX).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // « Autre » without an explanation is not a reason: the student receives this
    // text verbatim in e-mail #5 (§18 row 5).
    if (value.code === 'OTHER' && (value.details ?? '').length < REJECTION_DETAILS_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['details'],
        message: 'admin.accounts.reject.detailsRequired',
      });
    }
  });

/** « Refuser » (§17.2). The reason is mandatory and reaches the student by e-mail. */
export const rejectAccountAction = withAction(
  rejectInputSchema,
  async (input, ctx): Promise<AccountOutcome> => {
    const outcome = await decide(input.userId, () =>
      rejectAccount(
        { userId: input.userId, code: input.code, details: input.details },
        moderationContext(ctx.user, ctx.ip, ctx.userAgent),
      ),
    );
    revalidateAdmin();
    return assertSingleOutcome(outcome);
  },
  { auth: 'active', can: 'account.approve' },
);

/* -------------------------------------------------------------------------- */
/* Bulk                                                                        */
/* -------------------------------------------------------------------------- */

const bulkIdsSchema = z.array(userIdSchema).min(1).max(BULK_MAX);

/** « Valider la sélection ». One transaction per account, one outcome per account. */
export const bulkApproveAccountsAction = withAction(
  z.object({ userIds: bulkIdsSchema }).strict(),
  async (input, ctx): Promise<BulkOutcome> => {
    const context = moderationContext(ctx.user, ctx.ip, ctx.userAgent);
    const outcomes: AccountOutcome[] = [];

    // Sequential on purpose: forty concurrent interactive transactions would
    // exhaust the connection pool long before they would be faster.
    for (const userId of input.userIds) {
      outcomes.push(await decide(userId, () => approveAccount({ userId }, context)));
    }

    revalidateAdmin();
    return summarize(outcomes);
  },
  { auth: 'active', can: 'account.approve' },
);

/**
 * Shared-reason schema for the bulk refusal.
 *
 * Declared at module scope rather than inline in the `withAction` call: a
 * `'use server'` module may not carry a synchronous function expression inside
 * an exported declaration, and `superRefine` is one.
 */
const bulkRejectSchema = z
  .object({
    userIds: bulkIdsSchema,
    code: z.enum(REJECTION_REASON_CODES),
    details: z.string().trim().max(REJECTION_DETAILS_MAX).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.code === 'OTHER' && (value.details ?? '').length < REJECTION_DETAILS_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['details'],
        message: 'admin.accounts.reject.detailsRequired',
      });
    }
  });

/** « Refuser la sélection » with a shared reason (§17.2 bulk actions). */
export const bulkRejectAccountsAction = withAction(
  bulkRejectSchema,
  async (input, ctx): Promise<BulkOutcome> => {
    const context = moderationContext(ctx.user, ctx.ip, ctx.userAgent);
    const outcomes: AccountOutcome[] = [];

    for (const userId of input.userIds) {
      outcomes.push(
        await decide(userId, () =>
          rejectAccount({ userId, code: input.code, details: input.details }, context),
        ),
      );
    }

    revalidateAdmin();
    return summarize(outcomes);
  },
  { auth: 'active', can: 'account.approve' },
);

/* -------------------------------------------------------------------------- */
/* Internal note (§17.2 « Notes internes »)                                    */
/* -------------------------------------------------------------------------- */

/** `User.internalNote` is a single admin-only TEXT column. */
const INTERNAL_NOTE_MAX = 4_000;

/**
 * Save the administration's private note on an account.
 *
 * The audit row records the *fact* and the size of the change, never the text:
 * an internal note is written about a person, and copying it into a second table
 * that a wider audience can read would defeat the point (§20 redaction).
 */
export const updateInternalNoteAction = withAction(
  z
    .object({
      userId: userIdSchema,
      note: z.string().max(INTERNAL_NOTE_MAX),
    })
    .strict(),
  async (input, ctx): Promise<{ readonly saved: true }> => {
    const note = input.note.trim();

    await transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id: input.userId },
        select: { internalNote: true, fullName: true, deletedAt: true },
      });
      if (before === null || before.deletedAt !== null) {
        throw new ActionError('not_found', 'admin.actionError.notFound');
      }

      await tx.user.update({
        where: { id: input.userId },
        data: { internalNote: note === '' ? null : note },
      });

      await recordAudit(
        {
          actorId: ctx.user.id,
          action: 'ACCOUNT_NOTE_UPDATED',
          entityType: 'User',
          entityId: input.userId,
          summary: `Note interne du compte de ${before.fullName} modifiée.`,
          diff: buildDiff(
            { internalNoteLength: before.internalNote?.length ?? 0 },
            { internalNoteLength: note.length },
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
  { auth: 'active', can: 'account.approve' },
);

/* -------------------------------------------------------------------------- */
/* Sessions (§17.2 « Sécurité »)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Force one device out.
 *
 * The revocation is written on the transaction client rather than through
 * `revokeSession`, so that it and its audit row commit together — a logged-out
 * device with no record of who did it is exactly the question an audit trail
 * exists to answer. `userId` is part of the `WHERE` clause: a session id leaked
 * into a log must not be enough to log somebody else out.
 */
export const revokeUserSessionAction = withAction(
  z.object({ userId: userIdSchema, sessionId: z.string().min(1).max(64) }).strict(),
  async (input, ctx): Promise<{ readonly revoked: number }> => {
    const now = new Date();

    const revoked = await transaction(async (tx) => {
      const subject = await tx.user.findUnique({
        where: { id: input.userId },
        select: { fullName: true, deletedAt: true },
      });
      if (subject === null || subject.deletedAt !== null) {
        throw new ActionError('not_found', 'admin.actionError.notFound');
      }

      const result = await tx.session.updateMany({
        where: { id: input.sessionId, userId: input.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      if (result.count === 0) return 0;

      await recordAudit(
        {
          actorId: ctx.user.id,
          action: 'SESSION_REVOKED',
          entityType: 'User',
          entityId: input.userId,
          summary: `Un appareil de ${subject.fullName} a été déconnecté.`,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return result.count;
    });

    revalidateAdmin();
    return { revoked };
  },
  { auth: 'active', can: 'account.approve' },
);

/** « Déconnecter tous les appareils » — every live session of one account. */
export const revokeAllUserSessionsAction = withAction(
  z.object({ userId: userIdSchema }).strict(),
  async (input, ctx): Promise<{ readonly revoked: number }> => {
    const now = new Date();

    const revoked = await transaction(async (tx) => {
      const subject = await tx.user.findUnique({
        where: { id: input.userId },
        select: { fullName: true, deletedAt: true },
      });
      if (subject === null || subject.deletedAt !== null) {
        throw new ActionError('not_found', 'admin.actionError.notFound');
      }

      const count = await revokeAllForUser(input.userId, { now, client: tx });

      await recordAudit(
        {
          actorId: ctx.user.id,
          action: 'SESSIONS_REVOKED_ALL',
          entityType: 'User',
          entityId: input.userId,
          summary: `Toutes les sessions de ${subject.fullName} ont été fermées (${count}).`,
          diff: buildDiff({ activeSessions: count }, { activeSessions: 0 }),
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return count;
    });

    revalidateAdmin();
    return { revoked };
  },
  { auth: 'active', can: 'account.approve' },
);
