/**
 * E-mail verification and re-sending the link (spec §9.1, §18 rows 1–3).
 *
 * ## Single use is enforced by the database, not by a read
 * Consuming the token is a conditional update:
 *
 * ```sql
 * UPDATE VerificationToken SET usedAt = now()
 *  WHERE tokenHash = ? AND usedAt IS NULL AND expiresAt > now()
 * ```
 *
 * The row is claimed by whoever wins that statement. A replay — the student
 * refreshing the tab, a mail scanner pre-fetching the link, an attacker with a
 * copied URL — matches zero rows and gets nothing. Checking `usedAt` with a
 * `SELECT` and then updating would leave a window where two requests both pass
 * the check, and both would send e-mail #3 to the administrators.
 *
 * ## Only the hash is ever compared
 * The raw token exists in the e-mail and in the URL the student clicks. The
 * database holds `sha256(token)` and nothing else (§9.1, `@/lib/crypto`), so a
 * database dump yields no usable link.
 */

import type { AccountStatus, Locale } from '@prisma/client';

import { db, transaction } from '@/server/db';
import { generateToken, hashToken } from '@/lib/crypto';
import { RESEND_VERIFICATION } from '@/lib/rate-limit';
import { maskEmail, resendVerificationSchema, verifyEmailSchema } from '@/lib/validation/auth';
import { recordAudit } from '@/server/services/audit';
import {
  ACCOUNT_ROUTES,
  absoluteUrl,
  queueEmail,
  type NotificationDbClient,
} from '@/server/services/notifications';
import { applyTransition } from './state-machine';
import {
  ACCOUNT_SUBJECT_SELECT,
  executeAccountEffects,
  type AccountSubject,
} from './moderation';
import {
  consumeDurableLimit,
  EMAIL_VERIFY_TTL_HOURS,
  toFieldIssues,
  type FieldIssue,
} from './register';

const EMAIL_VERIFY_TTL_MS = EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1_000;

/* -------------------------------------------------------------------------- */
/* Verify                                                                      */
/* -------------------------------------------------------------------------- */

export type VerifyEmailResult =
  | {
      readonly ok: true;
      /** `VERIFIED` on the first click, `ALREADY_VERIFIED` on a refresh. */
      readonly outcome: 'VERIFIED' | 'ALREADY_VERIFIED';
      readonly status: AccountStatus;
      /** The account's locale — the caller redirects into the right language. */
      readonly locale: Locale;
    }
  | {
      readonly ok: false;
      readonly code: 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'INVALID';
      readonly issues?: readonly FieldIssue[];
    };

export interface VerifyEmailContext {
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly now?: Date;
}

/**
 * Consume a verification token and move the account to `PENDING_APPROVAL`.
 *
 * A token that was already used, but whose owner is now past `PENDING_EMAIL`,
 * reports `ALREADY_VERIFIED` rather than an error: the student did nothing
 * wrong, and sending them to a red page for refreshing a tab is bad manners.
 */
export async function verifyEmail(
  input: unknown,
  context: VerifyEmailContext = {},
): Promise<VerifyEmailResult> {
  const parsed = verifyEmailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID', issues: toFieldIssues(parsed.error) };
  }

  const now = context.now ?? new Date();
  const tokenHash = hashToken(parsed.data.token);

  return transaction(async (tx): Promise<VerifyEmailResult> => {
    const token = await tx.verificationToken.findUnique({
      where: { tokenHash },
      select: { id: true, identifier: true, purpose: true, payload: true, usedAt: true, expiresAt: true },
    });

    if (token === null || token.purpose !== 'EMAIL_VERIFY') {
      return { ok: false, code: 'INVALID_TOKEN' };
    }

    // Claim the token. The `WHERE` is the whole safety mechanism: an already
    // consumed or expired row matches nothing.
    const claimed = await tx.verificationToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });

    if (claimed.count === 0) {
      // Lost the race, or the link is stale. Tell the two cases apart so the
      // page can offer « Renvoyer le lien » instead of a dead end.
      if (token.usedAt !== null) {
        const already = await subjectFor(tx, token.identifier, token.payload);
        if (already !== null && already.status !== 'PENDING_EMAIL') {
          return {
            ok: true,
            outcome: 'ALREADY_VERIFIED',
            status: already.status,
            locale: already.locale,
          };
        }
        return { ok: false, code: 'INVALID_TOKEN' };
      }
      return { ok: false, code: 'EXPIRED_TOKEN' };
    }

    const subject = await subjectFor(tx, token.identifier, token.payload);
    if (subject === null) return { ok: false, code: 'INVALID_TOKEN' };

    const outcome = applyTransition(subject.status, 'EMAIL_VERIFIED');
    if (!outcome.ok) {
      // The address is confirmed but the account has already moved on — the
      // token is spent either way, which is what matters.
      return {
        ok: true,
        outcome: 'ALREADY_VERIFIED',
        status: subject.status,
        locale: subject.locale,
      };
    }

    const updated = await tx.user.updateMany({
      where: { id: subject.id, status: outcome.from, deletedAt: null },
      data: { status: outcome.to, emailVerifiedAt: now },
    });
    if (updated.count === 0) {
      return {
        ok: true,
        outcome: 'ALREADY_VERIFIED',
        status: subject.status,
        locale: subject.locale,
      };
    }

    await executeAccountEffects({
      tx,
      subject,
      effects: outcome.effects,
      // The student acted; there is no administrator in this transition.
      actorId: subject.id,
      summary: `${subject.fullName} a confirmé son adresse e-mail. Le compte attend une validation.`,
      diff: {
        before: { status: outcome.from, emailVerifiedAt: null },
        after: { status: outcome.to, emailVerifiedAt: now.toISOString() },
      },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      now,
    });

    return { ok: true, outcome: 'VERIFIED', status: outcome.to, locale: subject.locale };
  });
}

/**
 * Resolve the account a token belongs to.
 *
 * The token's `payload.userId` is preferred over `identifier`, because an
 * address can legitimately change between issuing and clicking; the identifier
 * is the fallback for tokens issued without a payload.
 */
async function subjectFor(
  client: NotificationDbClient,
  identifier: string,
  payload: unknown,
): Promise<AccountSubject | null> {
  const userId = userIdFromPayload(payload);

  const row =
    userId === null
      ? await client.user.findUnique({ where: { email: identifier }, select: ACCOUNT_SUBJECT_SELECT })
      : await client.user.findUnique({ where: { id: userId }, select: ACCOUNT_SUBJECT_SELECT });

  if (row === null || row.deletedAt !== null) return null;
  return row;
}

function userIdFromPayload(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).userId;
  return typeof value === 'string' && value !== '' ? value : null;
}

/* -------------------------------------------------------------------------- */
/* Resend                                                                      */
/* -------------------------------------------------------------------------- */

export type ResendVerificationResult =
  | {
      readonly ok: true;
      readonly emailMasked: string;
      /** Seconds before the button may be pressed again (§9.1: 60 s). */
      readonly cooldownSec: number;
    }
  | {
      readonly ok: false;
      readonly code: 'INVALID';
      readonly issues: readonly FieldIssue[];
    }
  | {
      readonly ok: false;
      readonly code: 'RATE_LIMITED';
      readonly retryAfterSec: number;
    };

export const RESEND_COOLDOWN_SEC = Math.round(RESEND_VERIFICATION.windowMs / 1_000);

/**
 * Re-send e-mail #1, behind the 60-second cooldown of §9.1.
 *
 * Enumeration-safe in the same way as registration: an unknown address, an
 * address whose account is already verified, and a genuine re-send all return
 * the same success. Only the first one actually queues a message.
 *
 * Any previously issued, still-unused verification token is burned first, so a
 * student who asks twice cannot be confused by two live links — and a link that
 * leaked in a forwarded e-mail stops working the moment a new one is requested.
 */
export async function resendVerification(
  input: unknown,
  context: VerifyEmailContext = {},
): Promise<ResendVerificationResult> {
  const parsed = resendVerificationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID', issues: toFieldIssues(parsed.error) };

  const now = context.now ?? new Date();
  const email = parsed.data.email;

  const limit = await consumeDurableLimit(RESEND_VERIFICATION, email, db, now);
  if (!limit.allowed) {
    return { ok: false, code: 'RATE_LIMITED', retryAfterSec: limit.retryAfterSec };
  }

  const rawToken = generateToken(64);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFY_TTL_MS);

  await transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email },
      select: { id: true, fullName: true, locale: true, status: true, deletedAt: true },
    });

    if (user === null || user.deletedAt !== null || user.status !== 'PENDING_EMAIL') return;

    await tx.verificationToken.updateMany({
      where: { identifier: email, purpose: 'EMAIL_VERIFY', usedAt: null },
      data: { usedAt: now },
    });

    const token = await tx.verificationToken.create({
      data: {
        identifier: email,
        tokenHash,
        purpose: 'EMAIL_VERIFY',
        payload: { userId: user.id },
        expiresAt,
      },
      select: { id: true },
    });

    await queueEmail(
      {
        template: 'verify-email',
        to: [email],
        locale: user.locale,
        props: {
          fullName: user.fullName,
          verifyUrl: absoluteUrl(user.locale, ACCOUNT_ROUTES.verifyEmail(rawToken)),
          expiresInHours: EMAIL_VERIFY_TTL_HOURS,
        },
        relatedType: 'VerificationToken',
        relatedId: token.id,
        userId: user.id,
      },
      tx,
    );

    await recordAudit(
      {
        actorId: user.id,
        action: 'ACCOUNT_VERIFICATION_RESENT',
        entityType: 'User',
        entityId: user.id,
        summary: `Nouveau lien de confirmation envoyé à ${maskEmail(email)}.`,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      },
      tx,
    );
  });

  return { ok: true, emailMasked: maskEmail(email), cooldownSec: RESEND_COOLDOWN_SEC };
}
