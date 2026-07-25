/**
 * Registration — the entry point of the account lifecycle (spec §9.1, §20).
 *
 * ```
 * rate limit (IP) → validate → rate limit (e-mail) → hash → ┌ transaction ┐
 *                                                           │ user        │
 *                                                           │ token       │
 *                                                           │ e-mail #1   │
 *                                                           │ audit       │
 *                                                           └─────────────┘
 * ```
 *
 * ## Enumeration safety
 * An address that already has an account produces the **same** response, in the
 * same shape, after the same work: the password is hashed before the transaction
 * either way, so the two branches also take the same wall-clock time. The only
 * trace of the collision is an audit row an administrator can read. Without this
 * the registration form becomes a free "does this person study here?" oracle
 * (§20 "generic error messages that never reveal whether an email exists").
 *
 * ## Why the password is hashed outside the transaction
 * Argon2id with 19 MiB and t=2 costs tens of milliseconds. Holding a MySQL
 * transaction open across it, on a pool capped at five connections, is how a
 * registration burst turns into a connection famine. The hash depends on nothing
 * in the database, so it is computed first and the transaction stays short.
 *
 * ## Durable rate limiting
 * `@/lib/rate-limit` is in-process and dies with the process. The limits that
 * protect account creation must survive a restart, so each attempt also writes a
 * `RateLimitEvent` row and the durable count is checked first — see
 * {@link consumeDurableLimit}, which the login and password-reset paths reuse.
 */

import type { ZodError } from 'zod';

import { db, transaction } from '@/server/db';
import { generateToken, generateVerifyCode, hashToken } from '@/lib/crypto';
import {
  bucketKey,
  consumePolicy,
  REGISTER_PER_EMAIL,
  REGISTER_PER_IP,
  type RateLimitPolicy,
} from '@/lib/rate-limit';
import { maskEmail, registerSchema } from '@/lib/validation/auth';
import { isDisposableDomain } from '@/lib/validation/disposable-domains';
import { hashPassword } from '@/server/auth/password';
import { recordAudit } from '@/server/services/audit';
import {
  ACCOUNT_ROUTES,
  absoluteUrl,
  queueEmail,
  type NotificationDbClient,
} from '@/server/services/notifications';
import { INITIAL_ACCOUNT_STATUS } from './state-machine';

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** §9.1: the verification link lives 24 hours. */
export const EMAIL_VERIFY_TTL_HOURS = 24;
const EMAIL_VERIFY_TTL_MS = EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1_000;

/** Attempts at minting a referral code before widening it. Collisions are astronomically rare. */
const REFERRAL_CODE_ATTEMPTS = 5;

/* -------------------------------------------------------------------------- */
/* Result shapes                                                               */
/* -------------------------------------------------------------------------- */

/** One field-level validation failure, carrying an i18n key rather than a sentence. */
export interface FieldIssue {
  /** Dotted path into the submitted object, `''` for a form-level issue. */
  readonly path: string;
  /** A key from `AUTH_ERROR_KEYS`, to be translated by the caller. */
  readonly messageKey: string;
}

export type RegisterResult =
  | {
      readonly ok: true;
      /** `y•••••••f@gmail.com` — what the confirmation screen shows (§9.1). */
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

export interface RegisterContext {
  /** Caller IP, from the trusted proxy header. `null` disables the per-IP limit. */
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** Injectable clock, for tests. */
  readonly now?: Date;
}

/* -------------------------------------------------------------------------- */
/* Durable rate limiting                                                       */
/* -------------------------------------------------------------------------- */

export interface DurableLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSec: number;
}

/**
 * Consume one token from a policy, counting across restarts.
 *
 * Two layers, in this order:
 * 1. the durable `RateLimitEvent` count inside the window — authoritative, and
 *    the only one that survives a deploy;
 * 2. the in-process token bucket — cheap, and what smooths a burst.
 *
 * The attempt is recorded **before** the decision, so a refused attempt still
 * counts. That is deliberate: a bot hammering the endpoint should dig its own
 * hole deeper, not stall at the threshold. Rows are pruned by the nightly
 * `cleanup` cron (§19.5).
 *
 * Exported because login and password reset need exactly the same two layers on
 * the same table; there is no second implementation of this anywhere.
 */
export async function consumeDurableLimit(
  policy: RateLimitPolicy,
  identifier: string,
  client: NotificationDbClient = db,
  now: Date = new Date(),
): Promise<DurableLimitResult> {
  const bucket = bucketKey(policy, identifier);
  const windowStart = new Date(now.getTime() - policy.windowMs);

  await client.rateLimitEvent.create({ data: { bucket, createdAt: now } });

  const durable = await client.rateLimitEvent.count({
    where: { bucket, createdAt: { gte: windowStart } },
  });

  const memory = consumePolicy(policy, identifier, now.getTime());

  if (durable > policy.limit) {
    // The window is a sliding one: the caller may retry once the oldest attempt
    // inside it has aged out.
    const oldest = await client.rateLimitEvent.findFirst({
      where: { bucket, createdAt: { gte: windowStart } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    const freeAt =
      oldest === null ? now.getTime() + policy.windowMs : oldest.createdAt.getTime() + policy.windowMs;
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((freeAt - now.getTime()) / 1_000)) };
  }

  if (!memory.allowed) {
    return { allowed: false, retryAfterSec: Math.max(1, memory.retryAfterSec) };
  }

  return { allowed: true, retryAfterSec: 0 };
}

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Register a student.
 *
 * `input` is whatever arrived from the form — `unknown` on purpose, because §20
 * requires the boundary to validate before anything else looks at it.
 */
export async function register(input: unknown, context: RegisterContext): Promise<RegisterResult> {
  const now = context.now ?? new Date();

  // 1. Per-IP budget: 5 registrations per hour (§9.1). Checked before parsing so
  //    a flood of malformed payloads is throttled too.
  if (context.ip !== null && context.ip !== '') {
    const perIp = await consumeDurableLimit(REGISTER_PER_IP, context.ip, db, now);
    if (!perIp.allowed) {
      return { ok: false, code: 'RATE_LIMITED', retryAfterSec: perIp.retryAfterSec };
    }
  }

  // 2. Validation. The schema normalises as it goes: trimmed name, lower-cased
  //    address, E.164 phone, and the honeypot / timing traps already applied.
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID', issues: toFieldIssues(parsed.error) };
  }
  const values = parsed.data;

  // 3. Per-address budget: 3 attempts per day. It needs the parsed address, so
  //    it necessarily follows validation.
  const perEmail = await consumeDurableLimit(REGISTER_PER_EMAIL, values.email, db, now);
  if (!perEmail.allowed) {
    return { ok: false, code: 'RATE_LIMITED', retryAfterSec: perEmail.retryAfterSec };
  }

  // 4. Argon2id, outside the transaction. Runs on both branches below so the
  //    "address already known" case costs the same time as a real signup.
  const passwordHash = await hashPassword(values.password);

  const rawToken = generateToken(64);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFY_TTL_MS);
  const referralCode = await mintReferralCode();

  await transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email: values.email },
      select: { id: true, status: true },
    });

    if (existing !== null) {
      // Silently stop. The caller gets the same success below, and the only
      // record of the collision is this audit row (§17.13).
      await recordAudit(
        {
          actorId: null,
          action: 'ACCOUNT_REGISTER_DUPLICATE',
          entityType: 'User',
          entityId: existing.id,
          summary: `Tentative d'inscription avec une adresse déjà enregistrée (statut ${existing.status}).`,
          ip: context.ip,
          userAgent: context.userAgent,
        },
        tx,
      );
      return;
    }

    const user = await tx.user.create({
      data: {
        fullName: values.fullName,
        email: values.email,
        phone: values.phone.e164,
        passwordHash,
        status: INITIAL_ACCOUNT_STATUS,
        locale: values.preferredLocale,
        city: values.city ?? null,
        professionalStatus: values.professionalStatus ?? null,
        referralCode,
      },
      select: { id: true, fullName: true },
    });

    const token = await tx.verificationToken.create({
      data: {
        identifier: values.email,
        tokenHash,
        purpose: 'EMAIL_VERIFY',
        payload: { userId: user.id },
        expiresAt,
      },
      select: { id: true },
    });

    // E-mail #1 (§18 row 1). Keyed on the token, not the user: a resent link
    // must not be swallowed by the idempotency check.
    await queueEmail(
      {
        template: 'verify-email',
        to: [values.email],
        locale: values.preferredLocale,
        props: {
          fullName: user.fullName,
          verifyUrl: absoluteUrl(values.preferredLocale, ACCOUNT_ROUTES.verifyEmail(rawToken)),
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
        // The student is their own actor here — there is no administrator yet.
        actorId: user.id,
        action: 'ACCOUNT_REGISTERED',
        entityType: 'User',
        entityId: user.id,
        summary: `${user.fullName} a créé un compte (en attente de confirmation de l'adresse e-mail).`,
        diff: {
          before: { status: null },
          after: {
            status: INITIAL_ACCOUNT_STATUS,
            locale: values.preferredLocale,
            // Flagged for the review drawer: §9.1 accepts foreign numbers but
            // wants them visible to the administrator.
            phoneIsMoroccan: values.phone.isMoroccan,
            emailDomainDisposable: isDisposableDomain(values.email),
          },
        },
        ip: context.ip,
        userAgent: context.userAgent,
      },
      tx,
    );
  });

  return { ok: true, emailMasked: maskEmail(values.email) };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A referral code nobody holds yet.
 *
 * `generateVerifyCode` draws 10 symbols from a 31-letter alphabet with the
 * look-alikes removed — ~49 bits, and readable over the phone, which is how this
 * code actually gets shared. The existence check is a courtesy: the unique index
 * on `User.referralCode` is the real guarantee.
 */
async function mintReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < REFERRAL_CODE_ATTEMPTS; attempt += 1) {
    const candidate = generateVerifyCode();
    const taken = await db.user.findUnique({
      where: { referralCode: candidate },
      select: { id: true },
    });
    if (taken === null) return candidate;
  }
  // Five collisions in a row means something is very wrong with the RNG; a
  // doubled code is still unique and the account creation goes through.
  return `${generateVerifyCode()}${generateVerifyCode()}`;
}

/** Flatten a `ZodError` into field/key pairs the form can display. */
export function toFieldIssues(error: ZodError): readonly FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    messageKey: issue.message,
  }));
}
