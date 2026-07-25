'use server';

/**
 * Authentication server actions (spec §9.1, §20).
 *
 * Every export here is produced by {@link withAction}, which is what enforces —
 * in this order, before a single line of business code runs:
 *
 *   1. an explicit `Origin` / `Host` assertion on top of what Server Actions
 *      already do;
 *   2. Zod `.strict()` validation of the payload, using the **same schemas the
 *      forms validate with** (`@/lib/validation/auth`), so client and server can
 *      never disagree about what is acceptable;
 *   3. the session / role / capability gate;
 *   4. only then, the handler — the first line allowed to touch the database.
 *
 * ## Nothing here reveals whether an address exists
 * `register`, `resendVerification` and `requestPasswordReset` return the same
 * shape, after the same work, whether or not the address is known. The services
 * are what make that true (they hash a password and open a transaction on both
 * branches); these actions simply refuse to add a fast path that would leak the
 * difference through timing or through a distinguishable error.
 *
 * ## Failures are codes, never sentences
 * A failure comes back as `{ ok: false, error, message?, fieldErrors? }` where
 * `message` is an i18n **key**. The forms translate it. No French string is
 * composed on the server (rule 5).
 *
 * ## Why `db` is imported here
 * Exactly twice, both times a single indexed read scoped to the caller's own
 * account: the status a fresh sign-in must be routed on, and the rejection
 * reason the waiting screen shows its owner. Both would otherwise need a new
 * read model in `services/accounts/queries.ts`, which this milestone's file
 * ownership does not allow — see the manifest.
 */

import { z } from 'zod';

import {
  ActionError,
  AUTH_ROUTES,
  RateLimitedError,
  authErrorCode,
  signIn,
  signOut,
  withAction,
  type AuthErrorCode,
} from '@/server/auth';
import { db } from '@/server/db';
import {
  loginFormSchema,
  registerFormSchema,
  requestPasswordResetFormSchema,
  resendVerificationFormSchema,
  resetPasswordFormSchema,
} from '@/lib/validation/auth';
import { locales } from '@/i18n/routing';
import { parseRejectionReason } from '@/server/services/accounts/moderation';
import { requestPasswordReset, resetPassword } from '@/server/services/accounts/password-reset';
import { register, type FieldIssue } from '@/server/services/accounts/register';
import { getOwnAccountStatus } from '@/server/services/accounts/queries';
import { resendVerification } from '@/server/services/accounts/verify-email';

/* -------------------------------------------------------------------------- */
/* Shared plumbing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A service's `FieldIssue[]` in the shape `react-hook-form`'s `setError` wants.
 * A form-level issue (empty path) lands under `_form`, which is the same key
 * `withAction` uses for Zod's own form-level errors.
 */
function toFieldErrors(issues: readonly FieldIssue[]): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path === '' ? '_form' : issue.path;
    const bucket = fields[key];
    if (bucket === undefined) {
      fields[key] = [issue.messageKey];
    } else if (!bucket.includes(issue.messageKey)) {
      bucket.push(issue.messageKey);
    }
  }
  return fields;
}

/**
 * `withAction` already validated the payload against the very schema the
 * service re-parses, so a service-side `INVALID` means the two layers have
 * drifted — a bug, not user input. It is still reported as a field error rather
 * than swallowed, so the form shows something actionable instead of nothing.
 */
function invalidInput(issues: readonly FieldIssue[]): ActionError {
  return new ActionError('validation', 'errors.required', toFieldErrors(issues));
}

/** The prefixes `@/i18n/navigation` re-adds itself: `/fr/espace` → `/espace`. */
const LOCALE_PREFIXES: readonly string[] = locales.map((locale) => `/${locale}`);

/**
 * Turn an attacker-controlled `?suivant=` into a path this site can navigate to,
 * or fall back to the dashboard.
 *
 * Refused: anything that is not a rooted path, protocol-relative `//host`,
 * backslashes (which some browsers normalise to `/`), and anything carrying a
 * scheme. That is the whole open-redirect surface of the login flow.
 */
function safeReturnPath(value: string | undefined): string {
  if (value === undefined) return AUTH_ROUTES.home;

  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return AUTH_ROUTES.home;
  if (trimmed.startsWith('//')) return AUTH_ROUTES.home;
  if (trimmed.includes('\\') || trimmed.includes('://')) return AUTH_ROUTES.home;

  // Strip a locale prefix, because `useRouter` from `@/i18n/navigation` adds the
  // active one; leaving it would produce `/fr/fr/espace`.
  for (const prefix of LOCALE_PREFIXES) {
    if (trimmed === prefix) return AUTH_ROUTES.home;
    if (trimmed.startsWith(`${prefix}/`)) {
      const rest = trimmed.slice(prefix.length);
      return rest === '' ? AUTH_ROUTES.home : rest;
    }
  }

  return trimmed;
}

/** An empty, still `.strict()` payload — `withAction` refuses a loose schema. */
const emptyPayloadSchema = z.object({}).strict();

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Create an account (§9.1).
 *
 * Public by design: the caller has no session yet. The honeypot and the
 * render-timestamp travel inside `registerFormSchema`, so the bot traps are
 * checked by the same code on both sides of the wire.
 *
 * Returns the **masked** address for the confirmation screen. The real one
 * never travels back.
 */
export const registerAction = withAction(
  registerFormSchema,
  async (input, ctx) => {
    const result = await register(input, { ip: ctx.ip, userAgent: ctx.userAgent });

    if (result.ok) return { emailMasked: result.emailMasked };
    if (result.code === 'RATE_LIMITED') throw new RateLimitedError(result.retryAfterSec);
    throw invalidInput(result.issues);
  },
  { auth: 'public' },
);

/* -------------------------------------------------------------------------- */
/* Sign in                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `loginFormSchema` plus the page the visitor was trying to reach.
 *
 * `suivant` is not a form field — it is navigation state carried in the URL —
 * but it is attacker-controlled input like any other, so it is validated here
 * and sanitised by {@link safeReturnPath} rather than trusted by the client.
 */
const loginActionSchema = loginFormSchema
  .extend({ suivant: z.string().max(2_048).optional() })
  .strict();

/**
 * Auth.js is inconsistent about how a credentials refusal surfaces when
 * `redirect: false`: sometimes it throws, sometimes it *returns* the error URL.
 * This reads the returned form; the thrown form is handled by `authErrorCode`.
 */
function failureFromOutcome(outcome: unknown): AuthErrorCode | null {
  if (typeof outcome !== 'string') return null;

  const separator = outcome.indexOf('?');
  if (separator === -1) return null;

  const params = new URLSearchParams(outcome.slice(separator + 1));
  if (params.get('code') === null && params.get('error') === null) return null;

  return authErrorCode(outcome);
}

/**
 * Sign-in refusals, mapped to the i18n keys the login page renders.
 *
 * `too_many_attempts` is absent on purpose: it carries a duration, so it comes
 * back as `rate_limited` with `retryAfterSec` and the page renders
 * `errors.accountLocked`, which names the remaining minutes *and* offers the
 * password reset.
 */
const SIGN_IN_MESSAGE_KEYS: Readonly<Record<Exclude<AuthErrorCode, 'too_many_attempts'>, string>> = {
  invalid_credentials: 'errors.invalidCredentials',
  account_rejected: 'errors.accountRejected',
  account_suspended: 'errors.accountSuspended',
  server_error: 'errors.serverError.body',
};

/**
 * Where a freshly signed-in account belongs (§9.1).
 *
 * `PENDING_EMAIL` and `PENDING_APPROVAL` accounts *can* sign in — they must, or
 * the resend button and the waiting screen would be unreachable — so the
 * destination is decided by status, not by the presence of a session.
 */
function destinationForStatus(status: string, requested: string): string {
  switch (status) {
    case 'PENDING_EMAIL':
      return AUTH_ROUTES.pendingEmail;
    case 'PENDING_APPROVAL':
      return AUTH_ROUTES.pendingApproval;
    default:
      return requested;
  }
}

/**
 * Sign in with an e-mail and a password.
 *
 * Every refusal is one of `AUTH_ERROR_CODES`, reported as an i18n key on the
 * form level. There is exactly one code covering "no such address" and "wrong
 * password" (§20), and the lockout code carries `retryAfterSec` so the page can
 * say how long is left instead of just refusing.
 */
export const loginAction = withAction(
  loginActionSchema,
  async (input) => {
    let failure: AuthErrorCode | null = null;

    try {
      const outcome: unknown = await signIn('credentials', {
        email: input.email,
        password: input.password,
        redirect: false,
      });
      failure = failureFromOutcome(outcome);
    } catch (error) {
      failure = authErrorCode(error);
    }

    if (failure !== null) {
      // `too_many_attempts` is the only refusal with a duration attached, and
      // the exact deadline lives on the account row rather than in the code.
      if (failure === 'too_many_attempts') {
        const locked = await db.user.findUnique({
          where: { email: input.email },
          select: { lockedUntil: true },
        });
        const lockedUntil = locked?.lockedUntil ?? null;
        const remainingMs = lockedUntil === null ? 0 : lockedUntil.getTime() - Date.now();
        // A floor of one minute: « réessayez dans 0 minute » is not an instruction.
        throw new RateLimitedError(Math.max(60, Math.ceil(remainingMs / 1_000)));
      }

      throw new ActionError(
        failure === 'server_error' ? 'server_error' : 'forbidden',
        SIGN_IN_MESSAGE_KEYS[failure],
      );
    }

    // The account exists and the password was correct, so this read is scoped to
    // an identity the caller has just proved they own.
    const account = await db.user.findUnique({
      where: { email: input.email },
      select: { status: true },
    });

    return {
      redirectTo: destinationForStatus(account?.status ?? 'ACTIVE', safeReturnPath(input.suivant)),
    };
  },
  { auth: 'public' },
);

/** End the session and kill its `Session` row. The page navigates afterwards. */
export const signOutAction = withAction(
  emptyPayloadSchema,
  async () => {
    await signOut({ redirect: false });
    return { signedOut: true };
  },
  { auth: 'user' },
);

/* -------------------------------------------------------------------------- */
/* E-mail verification                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Re-send the confirmation link, behind the 60-second cooldown of §9.1.
 *
 * Enumeration-safe: an unknown address, an address whose account is already
 * confirmed, and a genuine re-send all return the same `{ emailMasked,
 * cooldownSec }`. Only the first of the three actually queues a message.
 */
export const resendVerificationAction = withAction(
  resendVerificationFormSchema,
  async (input, ctx) => {
    const result = await resendVerification(input, { ip: ctx.ip, userAgent: ctx.userAgent });

    if (result.ok) return { emailMasked: result.emailMasked, cooldownSec: result.cooldownSec };
    if (result.code === 'RATE_LIMITED') throw new RateLimitedError(result.retryAfterSec);
    throw invalidInput(result.issues);
  },
  { auth: 'public' },
);

/* -------------------------------------------------------------------------- */
/* Password reset                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Ask for a reset link.
 *
 * The answer is identical whether or not an account exists — same shape, same
 * masked address, same latency (§20). The confirmation screen therefore says
 * « si un compte existe avec cette adresse… », which is the only honest wording.
 */
export const requestPasswordResetAction = withAction(
  requestPasswordResetFormSchema,
  async (input, ctx) => {
    const result = await requestPasswordReset(input, { ip: ctx.ip, userAgent: ctx.userAgent });

    if (result.ok) return { emailMasked: result.emailMasked };
    if (result.code === 'RATE_LIMITED') throw new RateLimitedError(result.retryAfterSec);
    throw invalidInput(result.issues);
  },
  { auth: 'public' },
);

/**
 * Consume a reset token and install the new password.
 *
 * Every live session dies with it, including the one belonging to whoever may
 * have had the old password — that is the point of a reset (§20). The count
 * comes back so the confirmation screen can state it plainly.
 */
export const resetPasswordAction = withAction(
  resetPasswordFormSchema,
  async (input, ctx) => {
    const result = await resetPassword(input, { ip: ctx.ip, userAgent: ctx.userAgent });

    if (result.ok) return { revokedSessions: result.revokedSessions };

    switch (result.code) {
      case 'EXPIRED_TOKEN':
        throw new ActionError('not_found', 'errors.tokenExpired');
      case 'INVALID_TOKEN':
        throw new ActionError('not_found', 'errors.tokenAlreadyUsed');
      default:
        throw invalidInput(result.issues ?? []);
    }
  },
  { auth: 'public' },
);

/* -------------------------------------------------------------------------- */
/* Status poll                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The caller's own account status, for the live poll on `/compte-en-attente`
 * (§9.1: "shows a live status poll so it flips to the dashboard automatically
 * once approved").
 *
 * Scoped to `ctx.user.id` by construction: there is no parameter to point it at
 * somebody else's account, so there is nothing to authorise beyond "is signed
 * in". The rejection reason is returned only to the account it belongs to.
 */
export const accountStatusAction = withAction(
  emptyPayloadSchema,
  async (_input, ctx) => {
    const current = await getOwnAccountStatus(ctx.user.id);
    if (current === null) return { status: null, rejectionCode: null, rejectionDetails: null };

    if (current.status !== 'REJECTED') {
      return { status: current.status, rejectionCode: null, rejectionDetails: null };
    }

    const row = await db.user.findUnique({
      where: { id: ctx.user.id },
      select: { rejectionReason: true },
    });
    const reason = parseRejectionReason(row?.rejectionReason ?? null);

    return {
      status: current.status,
      rejectionCode: reason?.code ?? null,
      rejectionDetails: reason?.details ?? null,
    };
  },
  { auth: 'user' },
);
