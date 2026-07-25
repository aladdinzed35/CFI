/**
 * Password reset (spec §9.1, §18 rows 13–14, §20).
 *
 * ## The request never says whether the address exists
 * `requestPasswordReset` returns the same success, with the same masked address,
 * whether or not an account was found — §20: "generic error messages that never
 * reveal whether an email exists. Same treatment for password reset". The
 * account lookup and the token write happen inside the transaction; the caller
 * cannot tell them apart from the outside.
 *
 * ## The link lives one hour
 * Shorter than the verification link, because the window during which a leaked
 * reset URL is dangerous is the window during which someone else can take the
 * account over. Only `sha256(token)` is stored.
 *
 * ## Changing the password ends every session
 * §20 requires "server-side revocation via the `Session` table". A password is
 * reset precisely because it may be in someone else's hands, so every live
 * session — including the attacker's — is revoked in the same transaction. The
 * owner signs in again with the new password; nobody else can.
 */

import { db, transaction } from '@/server/db';
import { generateToken, hashToken } from '@/lib/crypto';
import { PASSWORD_RESET_PER_EMAIL, PASSWORD_RESET_PER_IP } from '@/lib/rate-limit';
import { maskEmail, requestPasswordResetSchema, resetPasswordSchema } from '@/lib/validation/auth';
import { hashPassword } from '@/server/auth/password';
import { revokeAllForUser } from '@/server/auth/session';
import { recordAudit } from '@/server/services/audit';
import {
  ACCOUNT_ROUTES,
  absoluteUrl,
  createNotification,
  queueEmail,
} from '@/server/services/notifications';
import { consumeDurableLimit, toFieldIssues, type FieldIssue } from './register';

/** §9.1: the reset link lives one hour. */
export const PASSWORD_RESET_TTL_HOURS = 1;
const PASSWORD_RESET_TTL_MS = PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1_000;

export interface PasswordResetContext {
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly now?: Date;
}

/* -------------------------------------------------------------------------- */
/* Request                                                                     */
/* -------------------------------------------------------------------------- */

export type RequestPasswordResetResult =
  | {
      readonly ok: true;
      /** Masked address for the confirmation screen. Never proves the account exists. */
      readonly emailMasked: string;
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

/**
 * Send e-mail #13, « Réinitialisation du mot de passe ».
 *
 * Any earlier unused reset token is burned first: one live link at a time means
 * a link that leaked in a forwarded message dies as soon as the owner asks for
 * another.
 *
 * A suspended or rejected account may still reset its password. Being unable to
 * sign in is a matter of status, checked at sign-in; refusing the reset would
 * only tell the caller something about the account.
 */
export async function requestPasswordReset(
  input: unknown,
  context: PasswordResetContext = {},
): Promise<RequestPasswordResetResult> {
  const parsed = requestPasswordResetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID', issues: toFieldIssues(parsed.error) };

  const now = context.now ?? new Date();
  const email = parsed.data.email;

  if (context.ip !== null && context.ip !== undefined && context.ip !== '') {
    const perIp = await consumeDurableLimit(PASSWORD_RESET_PER_IP, context.ip, db, now);
    if (!perIp.allowed) {
      return { ok: false, code: 'RATE_LIMITED', retryAfterSec: perIp.retryAfterSec };
    }
  }

  const perEmail = await consumeDurableLimit(PASSWORD_RESET_PER_EMAIL, email, db, now);
  if (!perEmail.allowed) {
    return { ok: false, code: 'RATE_LIMITED', retryAfterSec: perEmail.retryAfterSec };
  }

  const rawToken = generateToken(64);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);

  await transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email },
      select: { id: true, fullName: true, locale: true, deletedAt: true },
    });

    if (user === null || user.deletedAt !== null) return;

    await tx.verificationToken.updateMany({
      where: { identifier: email, purpose: 'PASSWORD_RESET', usedAt: null },
      data: { usedAt: now },
    });

    const token = await tx.verificationToken.create({
      data: {
        identifier: email,
        tokenHash,
        purpose: 'PASSWORD_RESET',
        payload: { userId: user.id },
        expiresAt,
      },
      select: { id: true },
    });

    await queueEmail(
      {
        template: 'password-reset',
        to: [email],
        locale: user.locale,
        props: {
          fullName: user.fullName,
          resetUrl: absoluteUrl(user.locale, ACCOUNT_ROUTES.resetPassword(rawToken)),
          expiresInHours: PASSWORD_RESET_TTL_HOURS,
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
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'User',
        entityId: user.id,
        summary: `Demande de réinitialisation du mot de passe pour ${maskEmail(email)}.`,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      },
      tx,
    );
  });

  return { ok: true, emailMasked: maskEmail(email) };
}

/* -------------------------------------------------------------------------- */
/* Reset                                                                       */
/* -------------------------------------------------------------------------- */

export type ResetPasswordResult =
  | {
      readonly ok: true;
      /** How many live sessions were killed — shown as « X appareils déconnectés ». */
      readonly revokedSessions: number;
      /** Where to send the user next, in their own language. */
      readonly locale: string;
    }
  | {
      readonly ok: false;
      readonly code: 'INVALID' | 'INVALID_TOKEN' | 'EXPIRED_TOKEN';
      readonly issues?: readonly FieldIssue[];
    };

/**
 * Consume a reset token and install the new password.
 *
 * The token is claimed with the same conditional update as e-mail verification,
 * so a replayed link changes nothing. Argon2id runs before the transaction
 * opens, for the reason given in `register.ts`.
 */
export async function resetPassword(
  input: unknown,
  context: PasswordResetContext = {},
): Promise<ResetPasswordResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID', issues: toFieldIssues(parsed.error) };

  const now = context.now ?? new Date();
  const tokenHash = hashToken(parsed.data.token);
  const passwordHash = await hashPassword(parsed.data.password);

  return transaction(async (tx): Promise<ResetPasswordResult> => {
    const token = await tx.verificationToken.findUnique({
      where: { tokenHash },
      select: { identifier: true, purpose: true, payload: true, usedAt: true },
    });

    if (token === null || token.purpose !== 'PASSWORD_RESET') {
      return { ok: false, code: 'INVALID_TOKEN' };
    }

    const claimed = await tx.verificationToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });

    if (claimed.count === 0) {
      return { ok: false, code: token.usedAt === null ? 'EXPIRED_TOKEN' : 'INVALID_TOKEN' };
    }

    const userId = userIdFromPayload(token.payload);
    const user =
      userId === null
        ? await tx.user.findUnique({
            where: { email: token.identifier },
            select: { id: true, fullName: true, locale: true, deletedAt: true },
          })
        : await tx.user.findUnique({
            where: { id: userId },
            select: { id: true, fullName: true, locale: true, deletedAt: true },
          });

    if (user === null || user.deletedAt !== null) return { ok: false, code: 'INVALID_TOKEN' };

    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // A successful reset also clears a brute-force lockout: the person who
        // owns the mailbox has just proved they own the account (§20).
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    const revokedSessions = await revokeAllForUser(user.id, { now, client: tx });

    // E-mail #14 (§18 row 14) — a security notice, with its in-app counterpart.
    await queueEmail(
      {
        template: 'password-changed',
        to: [token.identifier],
        locale: user.locale,
        props: {
          fullName: user.fullName,
          changedAt: now.toISOString(),
          securityUrl: absoluteUrl(user.locale, ACCOUNT_ROUTES.security()),
          revokedSessions,
        },
        relatedType: 'User',
        relatedId: user.id,
        userId: user.id,
        // One notice per reset, not one per account, or a second legitimate
        // reset would be silently dropped.
        idempotencyKey: `password-changed:${user.id}:${now.toISOString()}`,
      },
      tx,
    );

    await createNotification(
      {
        userId: user.id,
        type: 'PASSWORD_CHANGED',
        payload: { changedAt: now.toISOString(), revokedSessions },
        link: ACCOUNT_ROUTES.security(),
      },
      tx,
    );

    await recordAudit(
      {
        actorId: user.id,
        action: 'PASSWORD_RESET_COMPLETED',
        entityType: 'User',
        entityId: user.id,
        summary: `Mot de passe réinitialisé ; ${revokedSessions} session(s) révoquée(s).`,
        // `buildDiff` would redact `passwordHash` anyway; recording the fact of
        // the change without either value is the point.
        diff: {
          before: { passwordHash: '[redacted]' },
          after: { passwordHash: '[redacted]', revokedSessions },
        },
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      },
      tx,
    );

    return { ok: true, revokedSessions, locale: user.locale };
  });
}

function userIdFromPayload(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).userId;
  return typeof value === 'string' && value !== '' ? value : null;
}
