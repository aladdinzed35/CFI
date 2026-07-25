import NextAuth, { CredentialsSignin, type NextAuthConfig, type User } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';

import {
  LOGIN_PER_EMAIL,
  LOGIN_PER_IP,
  bucketKey,
  consumePolicy,
  loginLockoutMs,
  peekPolicy,
  resetPolicy,
} from '@/lib/rate-limit';
import { env } from '@/lib/env';
import { db, transaction } from '@/server/db';

import { dummyVerify, hashPassword, needsRehash, verifyPassword } from './password';
import {
  clientIpFrom,
  createSession,
  revokeSessionByToken,
  sessionCookieDescriptor,
  sessionTtlSeconds,
  userAgentFrom,
  validateSession,
} from './session';

/**
 * Auth.js v5 configuration (§20).
 *
 * ## Node runtime, always
 * Argon2 is a native addon and Prisma needs TCP: neither runs on the edge, and
 * the whole application is a single Node 22 process on Hostinger anyway (§2 C1).
 * The route handler pins `runtime = 'nodejs'`; nothing here may be imported from
 * middleware.
 *
 * ## JWT strategy, database revocation
 * The strategy is `jwt`, but the JWT is not the authority — it is an encrypted
 * envelope carrying an opaque session token. Every request resolves that token
 * against the `Session` table (`validateSession`), which is what makes
 * revocation, suspension and role changes take effect on the next request
 * rather than in thirty days. Losing the table would log everybody out, which
 * is the correct failure direction.
 *
 * ## What `authorize()` promises
 * In order: Zod-validate → rate-limit by e-mail **and** IP → look the user up →
 * burn an equivalent hash when there is no user → verify the password → enforce
 * the lockout → escalate on failure → reset counters and mint a session on
 * success. Every refusal uses one of a small set of **generic codes**; nothing
 * in the response distinguishes "no such address" from "wrong password".
 *
 * ## Who may log in (§9.1)
 * `PENDING_EMAIL` and `PENDING_APPROVAL` accounts **can** log in — they have to,
 * or the waiting screen and the "resend the confirmation e-mail" button would be
 * unreachable. What they cannot do is reach anything else; that is the guards'
 * job, not this file's. Only `REJECTED` and `SUSPENDED` are refused at the door,
 * each with its own actionable code.
 */

/* -------------------------------------------------------------------------- */
/* Error codes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every reason a sign-in can fail, as a stable machine code.
 *
 * Codes, not sentences: the login page translates them through next-intl, so
 * the same failure reads correctly in the four locales and no French string is
 * ever hard-coded in the server layer (rule 5). The codes also end up in the
 * `?code=` query parameter of an Auth.js error redirect, so they must not hint
 * at anything sensitive — which is why there is exactly one code covering both
 * "unknown address" and "wrong password".
 */
export const AUTH_ERROR_CODES = [
  /** Unknown e-mail, wrong password, or malformed input. Deliberately one code. */
  'invalid_credentials',
  /** Too many attempts on this address or from this network, or the account is locked. */
  'too_many_attempts',
  /** The account was rejected by an administrator; the reason is in the e-mail sent at the time. */
  'account_rejected',
  /** The account is suspended; the student must contact the centre. */
  'account_suspended',
  /** Something broke server-side. */
  'server_error',
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === 'string' && (AUTH_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * A sign-in refusal carrying one of {@link AUTH_ERROR_CODES}.
 *
 * Extends `CredentialsSignin` so Auth.js treats it as a normal credentials
 * failure — logged in full on the server, reduced to `code` for the client.
 */
export class LoginError extends CredentialsSignin {
  constructor(code: AuthErrorCode) {
    super(code);
    this.code = code;
  }
}

/**
 * Pull the code back out of whatever `signIn()` threw or returned.
 *
 * Auth.js is inconsistent here between versions and between the redirecting and
 * non-redirecting paths: sometimes the `CredentialsSignin` surfaces directly,
 * sometimes it arrives wrapped in `cause`, sometimes only as a `?code=` in a
 * returned URL. The login action calls this and gets a code either way; an
 * unrecognised shape degrades to `invalid_credentials`, which is both the safest
 * and the most common answer.
 */
export function authErrorCode(error: unknown): AuthErrorCode {
  if (isAuthErrorCode(error)) return error;

  if (typeof error === 'string') {
    const fromUrl = codeFromUrl(error);
    if (fromUrl !== null) return fromUrl;
    return 'invalid_credentials';
  }

  if (typeof error === 'object' && error !== null) {
    const record: Record<string, unknown> = error as Record<string, unknown>;
    if (isAuthErrorCode(record.code)) return record.code;

    const cause = record.cause;
    if (typeof cause === 'object' && cause !== null) {
      const causeRecord: Record<string, unknown> = cause as Record<string, unknown>;
      if (isAuthErrorCode(causeRecord.code)) return causeRecord.code;
      const inner = causeRecord.err;
      if (typeof inner === 'object' && inner !== null) {
        const innerRecord: Record<string, unknown> = inner as Record<string, unknown>;
        if (isAuthErrorCode(innerRecord.code)) return innerRecord.code;
      }
    }
  }

  return 'invalid_credentials';
}

function codeFromUrl(value: string): AuthErrorCode | null {
  const separator = value.indexOf('?');
  if (separator === -1) return null;
  const code = new URLSearchParams(value.slice(separator + 1)).get('code');
  return isAuthErrorCode(code) ? code : null;
}

/* -------------------------------------------------------------------------- */
/* Credentials                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `.strict()` per §20. The object handed to `safeParse` is projected explicitly
 * from the two credential fields rather than passed through wholesale, because
 * Auth.js mixes its own transport keys (`csrfToken`, `callbackUrl`) into the
 * POST body — the projection is what keeps `.strict()` meaningful instead of
 * permanently failing.
 */
const credentialsSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(254)
      .email(),
    password: z.string().min(1).max(256),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Fallback routes for the pages Auth.js would otherwise render itself.
 *
 * The real login flow never reaches them: the form posts to a server action that
 * calls `signIn('credentials', { redirect: false })` and renders the error in
 * place. They exist so that a stray `GET /api/auth/signin` lands on the French
 * login page instead of Auth.js's unstyled, untranslated default.
 */
const FALLBACK_SIGN_IN_PAGE = '/fr/connexion';

export const authConfig: NextAuthConfig = {
  secret: env.AUTH_SECRET,
  trustHost: env.AUTH_TRUST_HOST,

  session: {
    strategy: 'jwt',
    maxAge: sessionTtlSeconds(),
  },

  jwt: {
    maxAge: sessionTtlSeconds(),
  },

  cookies: {
    sessionToken: sessionCookieDescriptor(),
  },

  pages: {
    signIn: FALLBACK_SIGN_IN_PAGE,
    error: FALLBACK_SIGN_IN_PAGE,
    signOut: FALLBACK_SIGN_IN_PAGE,
  },

  providers: [
    Credentials({
      id: 'credentials',
      name: 'CFI',
      credentials: {
        email: { label: 'E-mail', type: 'email' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      authorize: async (credentials, request) => authorizeCredentials(credentials, request),
    }),
  ],

  callbacks: {
    /**
     * Runs on sign-in with `user` set, and on every subsequent request without
     * it. The second case is the important one: it re-reads the `Session` row,
     * so a revoked session, a suspended account or a promoted role is reflected
     * immediately. Returning `null` destroys the session.
     */
    jwt: async ({ token, user }) => {
      if (user !== undefined && user !== null) {
        token.sub = user.id ?? token.sub;
        token.sid = user.sessionId;
        token.stk = user.sessionToken;
        token.fullName = user.fullName;
        token.name = user.fullName ?? token.name;
        token.email = user.email ?? token.email;
        token.role = user.role;
        token.status = user.status;
        token.locale = user.locale;
        token.avatarKey = user.avatarKey ?? null;
        return token;
      }

      const rawToken = token.stk;
      if (typeof rawToken !== 'string' || rawToken.length === 0) return null;

      const validated = await validateSession(rawToken);
      if (validated === null) return null;

      token.sub = validated.user.id;
      token.sid = validated.sessionId;
      token.fullName = validated.user.fullName;
      token.name = validated.user.fullName;
      token.email = validated.user.email;
      token.role = validated.user.role;
      token.status = validated.user.status;
      token.locale = validated.user.locale;
      token.avatarKey = validated.user.avatarKey;
      return token;
    },

    /**
     * Project the token onto `session.user`. The raw session token is
     * deliberately *not* copied: a session object can be serialised into a
     * client component, and nothing there should be able to read a credential.
     */
    session: ({ session, token }) => {
      const id = token.sub;
      const sessionId = token.sid;
      const role = token.role;
      const status = token.status;
      const locale = token.locale;

      if (
        typeof id !== 'string' ||
        typeof sessionId !== 'string' ||
        role === undefined ||
        status === undefined ||
        locale === undefined
      ) {
        return session;
      }

      // Returned rather than mutated: Auth.js types `session` as the
      // intersection of the JWT-strategy and database-strategy shapes, so
      // `session.user` nominally still carries the adapter's fields. Spreading
      // preserves them without this file having to invent an `emailVerified`
      // it does not use.
      return {
        ...session,
        user: {
          ...session.user,
          id,
          sessionId,
          role,
          status,
          locale,
          fullName: typeof token.fullName === 'string' ? token.fullName : '',
          email: typeof token.email === 'string' ? token.email : '',
          avatarKey: typeof token.avatarKey === 'string' ? token.avatarKey : null,
        },
      };
    },
  },

  events: {
    /**
     * Signing out must kill the row, not just the cookie — otherwise a token
     * captured earlier would still resolve to a live session.
     */
    signOut: async (message) => {
      if (!('token' in message)) return;
      const token = message.token;
      if (token === null) return;
      const rawToken = token.stk;
      if (typeof rawToken !== 'string' || rawToken.length === 0) return;
      await revokeSessionByToken(rawToken);
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/* -------------------------------------------------------------------------- */
/* authorize()                                                                 */
/* -------------------------------------------------------------------------- */

async function authorizeCredentials(
  credentials: Partial<Record<'email' | 'password', unknown>>,
  request: Request,
): Promise<User | null> {
  const now = new Date();

  // 1 — Validate before anything else touches the database (§20).
  const parsed = credentialsSchema.safeParse({
    email: credentials.email,
    password: credentials.password,
  });
  if (!parsed.success) throw new LoginError('invalid_credentials');

  const { email, password } = parsed.data;
  const ip = clientIpFrom(request.headers);
  const userAgent = userAgentFrom(request.headers);

  // 2 — Brute-force budget, checked before the lookup so that an unknown
  //     address is throttled exactly like a known one.
  await enforceLoginBudget(email, ip, now);

  // 3 — Look the account up. A soft-deleted user is treated as absent.
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      fullName: true,
      email: true,
      passwordHash: true,
      role: true,
      status: true,
      locale: true,
      avatarKey: true,
      failedLoginCount: true,
      lockedUntil: true,
      deletedAt: true,
    },
  });

  if (user === null || user.deletedAt !== null) {
    // 4 — Burn an equivalent Argon2id verification so the timing of this branch
    //     matches the "wrong password" branch (§20).
    await dummyVerify();
    await recordLoginFailure(email, ip, now);
    throw new LoginError('invalid_credentials');
  }

  // 5 — Account-level lockout, persisted so it survives a restart.
  if (user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime()) {
    throw new LoginError('too_many_attempts');
  }

  // 6 — The actual check.
  const valid = await verifyPassword(password, user.passwordHash);

  if (!valid) {
    await registerFailedAttempt(user.id, user.failedLoginCount, now);
    await recordLoginFailure(email, ip, now);
    throw new LoginError('invalid_credentials');
  }

  // 7 — Status gate. Evaluated only once the password is known to be correct,
  //     so a stranger never learns anything about an account's standing.
  //     PENDING_EMAIL and PENDING_APPROVAL pass: they are restricted by the
  //     guards, not refused at the door (§9.1).
  if (user.status === 'REJECTED' || user.status === 'SUSPENDED') {
    await clearFailures(user.id, ip, email, now);
    throw new LoginError(user.status === 'REJECTED' ? 'account_rejected' : 'account_suspended');
  }

  // 8 — Success: reset the counters, stamp the login, mint a session. All of it
  //     in one transaction, so a session can never exist without its audit trail
  //     of "when and from where" (§20).
  const rehashed = needsRehash(user.passwordHash) ? await hashPassword(password) : null;

  const session = await transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: now,
        lastLoginIp: ip,
        ...(rehashed === null ? {} : { passwordHash: rehashed }),
      },
    });

    return createSession({ userId: user.id, ip, userAgent, now, client: tx });
  });

  await clearFailureBudget(email);

  return {
    id: user.id,
    email: user.email,
    name: user.fullName,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    locale: user.locale,
    avatarKey: user.avatarKey,
    sessionId: session.id,
    sessionToken: session.token,
  };
}

/* -------------------------------------------------------------------------- */
/* Brute-force accounting (§20)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Refuse the attempt when either budget is exhausted.
 *
 * Two layers, as documented in `lib/rate-limit`: a durable count of
 * `RateLimitEvent` rows, which survives a restart, and the in-process token
 * bucket, which is free. `peek` rather than `consume`: a *successful* login must
 * not spend budget, so tokens are only taken in {@link recordLoginFailure}.
 *
 * ### The enumeration trade-off, stated plainly
 * A locked account answers `too_many_attempts` while an address with no account
 * answers `invalid_credentials`, so the two are distinguishable — but only to an
 * attacker who has already spent five failed attempts on that exact address, and
 * `LOGIN_PER_IP` caps them at five attempts per fifteen minutes per network.
 * Probing the user base through this channel therefore costs roughly one address
 * per quarter of an hour per IP, which is not a practical enumeration oracle.
 * The alternative — hiding the lockout behind a generic message — leaves a
 * locked-out student staring at « identifiants incorrects » for two hours with
 * no way to understand why, and that is the worse failure.
 */
async function enforceLoginBudget(email: string, ip: string | null, now: Date): Promise<void> {
  const emailKey = bucketKey(LOGIN_PER_EMAIL, email);
  const durableEmail = await db.rateLimitEvent.count({
    where: { bucket: emailKey, createdAt: { gte: new Date(now.getTime() - LOGIN_PER_EMAIL.windowMs) } },
  });
  if (durableEmail >= LOGIN_PER_EMAIL.limit) throw new LoginError('too_many_attempts');
  if (!peekPolicy(LOGIN_PER_EMAIL, email, now.getTime()).allowed) {
    throw new LoginError('too_many_attempts');
  }

  if (ip === null) return;

  const ipKey = bucketKey(LOGIN_PER_IP, ip);
  const durableIp = await db.rateLimitEvent.count({
    where: { bucket: ipKey, createdAt: { gte: new Date(now.getTime() - LOGIN_PER_IP.windowMs) } },
  });
  if (durableIp >= LOGIN_PER_IP.limit) throw new LoginError('too_many_attempts');
  if (!peekPolicy(LOGIN_PER_IP, ip, now.getTime()).allowed) {
    throw new LoginError('too_many_attempts');
  }
}

/** Spend one token in both buckets and write the durable rows. Failures only. */
async function recordLoginFailure(email: string, ip: string | null, now: Date): Promise<void> {
  consumePolicy(LOGIN_PER_EMAIL, email, now.getTime());
  if (ip !== null) consumePolicy(LOGIN_PER_IP, ip, now.getTime());

  const rows = [{ bucket: bucketKey(LOGIN_PER_EMAIL, email), createdAt: now }];
  if (ip !== null) rows.push({ bucket: bucketKey(LOGIN_PER_IP, ip), createdAt: now });

  await db.rateLimitEvent.createMany({ data: rows });
}

/**
 * Escalate the per-account lockout: nothing below 5 consecutive failures, then
 * 15 min, 30 min, 1 h, 2 h, 2 h… (§20, computed by `loginLockoutMs`).
 *
 * The deadline is persisted rather than held in memory precisely so a restart
 * does not hand an attacker a clean slate. Emailing the owner on lockout is the
 * accounts service's job — see the manifest.
 */
async function registerFailedAttempt(
  userId: string,
  previousFailures: number,
  now: Date,
): Promise<void> {
  const failures = previousFailures + 1;
  const lockMs = loginLockoutMs(failures);

  await db.user.update({
    where: { id: userId },
    data: {
      failedLoginCount: failures,
      lockedUntil: lockMs > 0 ? new Date(now.getTime() + lockMs) : null,
    },
  });
}

/** Reset the counters on a correct password, even when the status then refuses the login. */
async function clearFailures(
  userId: string,
  ip: string | null,
  email: string,
  now: Date,
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, lastLoginIp: ip },
  });
  await clearFailureBudget(email);
}

/**
 * Forget the failed attempts recorded against this **address**, so a student who
 * fumbled their password twice is not still throttled an hour later.
 *
 * The IP bucket is pointedly left alone. Clearing it would hand an attacker who
 * controls one valid account a way to wipe their own network's budget between
 * bursts — the per-IP limit exists to slow credential stuffing across *many*
 * accounts, and one success says nothing about the other 4 999 attempts.
 */
async function clearFailureBudget(email: string): Promise<void> {
  resetPolicy(LOGIN_PER_EMAIL, email);
  await db.rateLimitEvent.deleteMany({ where: { bucket: bucketKey(LOGIN_PER_EMAIL, email) } });
}
