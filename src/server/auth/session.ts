import type { AccountStatus, Locale, Role } from '@prisma/client';

import { generateToken, hashToken } from '@/lib/crypto';
import { env } from '@/lib/env';
import { db, type Db } from '@/server/db';

/**
 * Server-side sessions — the revocation authority (§20).
 *
 * ## Why a table and not "just a JWT"
 * A signed cookie is only revocable by waiting for it to expire. §20 requires
 * that an administrator suspending an account, or a student clicking
 * « Déconnecter cet appareil », takes effect on the *next request*. So the
 * `Session` row is the truth: the JWT is a transport for an opaque token, and
 * every authenticated request resolves that token against this table. Delete or
 * revoke the row and the cookie is instantly worthless.
 *
 * ## Token discipline
 * `createSession` mints 64 bytes of CSPRNG output and stores **only its
 * SHA-256** in `Session.sessionToken`. A database dump therefore contains no
 * usable credential. Lookup is by hash, which is why the column is unique and
 * indexed. The raw value is returned exactly once, to be sealed inside the
 * encrypted Auth.js JWT.
 *
 * ## Three clocks, not one
 * - **Sliding expiry** — `expiresAt` is pushed to `now + 30 days` as the user
 *   keeps working, so an active student is never logged out mid-lesson.
 * - **Absolute cap** — 90 days from `createdAt`, no matter how active. A stolen
 *   token cannot be kept alive forever by using it.
 * - **Revocation** — `revokedAt`, set by the user, by an administrator, or by a
 *   password change.
 */

/* -------------------------------------------------------------------------- */
/* Policy                                                                      */
/* -------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sliding lifetime, in days. `SESSION_MAX_AGE_DAYS` in the environment, 30 by default (§20). */
export function sessionTtlDays(): number {
  return env.SESSION_MAX_AGE_DAYS;
}

/** Sliding lifetime in seconds — the value Auth.js and the cookie need. */
export function sessionTtlSeconds(): number {
  return sessionTtlDays() * 24 * 60 * 60;
}

/**
 * Hard ceiling from `createdAt` (§20). Not configurable: it is a security
 * property, not a preference.
 */
export const SESSION_ABSOLUTE_MAX_DAYS = 90;

/**
 * Minimum drift before a sliding renewal is actually written.
 *
 * Renewing on literally every request would mean one `UPDATE` per page view for
 * a benefit measured in minutes. One hour of granularity gives the same user
 * experience — a session only ever dies after 30 idle days — for roughly one
 * write per hour of activity.
 */
const SLIDE_THRESHOLD_MS = 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Cookie (§20: httpOnly, Secure in production, SameSite=Lax)                  */
/* -------------------------------------------------------------------------- */

/**
 * `SameSite=Lax`, not `Strict`: a student following the « Votre compte est
 * validé » link out of their mailbox must land already authenticated. `Lax`
 * still blocks every cross-site POST, which is the CSRF surface that matters,
 * and the explicit Origin check in `withAction` (see `./guards`) covers the
 * rest.
 *
 * `Secure` is conditional on production only so that `http://localhost:3000`
 * keeps working in development; the deployed site is HTTPS-only and additionally
 * carries HSTS.
 */
export function isSecureCookieEnvironment(): boolean {
  return env.NODE_ENV === 'production';
}

/** Cookie name. The `__Secure-` prefix binds the cookie to HTTPS at the browser level. */
export function sessionCookieName(): string {
  return isSecureCookieEnvironment() ? '__Secure-cfi.session-token' : 'cfi.session-token';
}

export interface SessionCookieOptions {
  readonly httpOnly: true;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly secure: boolean;
  readonly maxAge: number;
}

export interface SessionCookieDescriptor {
  readonly name: string;
  readonly options: SessionCookieOptions;
}

/**
 * The cookie policy, in the shape Auth.js expects under `cookies.sessionToken`.
 * Declared here rather than in `config.ts` so that "how the session is carried"
 * lives next to "what a session is".
 */
export function sessionCookieDescriptor(): SessionCookieDescriptor {
  return {
    name: sessionCookieName(),
    options: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: isSecureCookieEnvironment(),
      maxAge: sessionTtlSeconds(),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A Prisma client or an interactive-transaction client. `createSession` accepts
 * either so a login can commit the session row and the `lastLoginAt` update in
 * the same transaction.
 */
type TransactionClient = Parameters<Parameters<Db['$transaction']>[0]>[0];
export type SessionDbClient = Db | TransactionClient;

/** The identity every guard, layout and action reads. Never contains the password hash. */
export interface SessionUser {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: Role;
  readonly status: AccountStatus;
  readonly locale: Locale;
  readonly avatarKey: string | null;
}

/** One row of « Appareils connectés » in the profile (§13.4). */
export interface SessionSummary {
  readonly id: string;
  /** Parsed label, e.g. `Chrome · Android`. `null` when the client sent no user agent. */
  readonly device: string | null;
  readonly ip: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  /** When this session must die regardless of activity: `createdAt + 90 days`. */
  readonly absoluteExpiresAt: Date;
}

export interface CreateSessionInput {
  readonly userId: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  /** Injectable clock, for tests. */
  readonly now?: Date;
  /** Transaction client, when the session is created alongside other writes. */
  readonly client?: SessionDbClient;
}

export interface CreatedSession {
  readonly id: string;
  /** The raw opaque token. Returned once, stored nowhere, only its hash is persisted. */
  readonly token: string;
  readonly expiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly device: string | null;
}

export interface ValidatedSession {
  readonly sessionId: string;
  readonly user: SessionUser;
  readonly expiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Mint a session for a user who has just proved who they are.
 *
 * Every login creates a *new* row — tokens rotate, they are never reused or
 * refreshed in place — so « Déconnecter les autres appareils » has something
 * concrete to revoke and the device list is meaningful.
 */
export async function createSession(input: CreateSessionInput): Promise<CreatedSession> {
  const client = input.client ?? db;
  const now = input.now ?? new Date();
  const token = generateToken();
  const device = parseDeviceLabel(input.userAgent ?? null);

  const created = await client.session.create({
    data: {
      userId: input.userId,
      sessionToken: hashToken(token),
      ip: normalizeIp(input.ip ?? null),
      userAgent: truncate(input.userAgent ?? null, 1024),
      device,
      expiresAt: new Date(now.getTime() + sessionTtlDays() * DAY_MS),
      createdAt: now,
    },
    select: { id: true, expiresAt: true, createdAt: true },
  });

  return {
    id: created.id,
    token,
    expiresAt: created.expiresAt,
    absoluteExpiresAt: absoluteExpiryOf(created.createdAt),
    device,
  };
}

/**
 * Resolve a raw token to its session and its owner, or `null`.
 *
 * Refuses, in this order: an unknown token, a revoked session, an expired
 * session, a session past its 90-day absolute cap, a soft-deleted user. A
 * session that fails the absolute cap is revoked on the spot so it stops being
 * re-checked on every request.
 *
 * On success the sliding expiry is pushed forward — at most once per
 * {@link SLIDE_THRESHOLD_MS} — and never beyond the absolute cap.
 *
 * The user's `role` and `status` come from this query, which is what makes a
 * suspension or a role change take effect on the very next request rather than
 * whenever the JWT happens to be re-issued.
 */
export async function validateSession(
  rawToken: string,
  now: Date = new Date(),
): Promise<ValidatedSession | null> {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return null;

  const record = await db.session.findUnique({
    where: { sessionToken: hashToken(rawToken) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          status: true,
          locale: true,
          avatarKey: true,
          deletedAt: true,
        },
      },
    },
  });

  if (record === null) return null;
  if (record.revokedAt !== null) return null;
  if (record.user.deletedAt !== null) return null;

  const absoluteExpiresAt = absoluteExpiryOf(record.createdAt);

  if (record.expiresAt.getTime() <= now.getTime()) return null;
  if (absoluteExpiresAt.getTime() <= now.getTime()) {
    await revokeById(record.id, now);
    return null;
  }

  const expiresAt = await slide(record.id, record.expiresAt, absoluteExpiresAt, now);

  return {
    sessionId: record.id,
    expiresAt,
    absoluteExpiresAt,
    user: {
      id: record.user.id,
      fullName: record.user.fullName,
      email: record.user.email,
      role: record.user.role,
      status: record.user.status,
      locale: record.user.locale,
      avatarKey: record.user.avatarKey,
    },
  };
}

/**
 * Push the sliding expiry forward.
 *
 * `Session` carries no `lastSeenAt` column, and adding one is a schema change
 * this milestone does not own — the sliding `expiresAt` *is* the last-seen
 * signal, to within {@link SLIDE_THRESHOLD_MS}: `expiresAt − 30 days` is the
 * moment the session was last renewed. Call it from a heartbeat or after a
 * long-running action when you want the clock reset explicitly; `validateSession`
 * already does it on every request.
 *
 * Returns the resulting expiry, or `null` if the session no longer exists.
 */
export async function touchLastSeen(
  sessionId: string,
  now: Date = new Date(),
): Promise<Date | null> {
  const record = await db.session.findUnique({
    where: { id: sessionId },
    select: { expiresAt: true, createdAt: true, revokedAt: true },
  });
  if (record === null || record.revokedAt !== null) return null;

  return slide(sessionId, record.expiresAt, absoluteExpiryOf(record.createdAt), now);
}

/**
 * Revoke one session, scoped to its owner.
 *
 * `userId` is required and part of the `where` clause: without it, a session id
 * leaked into a URL or a log would let anyone log anyone else out. Returns
 * `true` when a live session was actually revoked.
 */
export async function revokeSession(
  sessionId: string,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const result = await db.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: now },
  });
  return result.count > 0;
}

/** Revoke a session from its raw token — the sign-out path, which holds the token, not the id. */
export async function revokeSessionByToken(
  rawToken: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return false;
  const result = await db.session.updateMany({
    where: { sessionToken: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: now },
  });
  return result.count > 0;
}

export interface RevokeAllOptions {
  /** Keep this session alive — « Déconnecter les autres appareils ». */
  readonly exceptSessionId?: string;
  readonly now?: Date;
  readonly client?: SessionDbClient;
}

/**
 * Revoke every live session of a user. Returns how many were revoked.
 *
 * Called on a password change, on suspension, on rejection and on an
 * administrator's « Déconnecter partout » — the reason a compromised password
 * stops being useful the moment it is changed. Accepts a transaction client so
 * it can commit atomically with the change that caused it.
 */
export async function revokeAllForUser(
  userId: string,
  options: RevokeAllOptions = {},
): Promise<number> {
  const client = options.client ?? db;
  const now = options.now ?? new Date();
  const result = await client.session.updateMany({
    where:
      options.exceptSessionId === undefined
        ? { userId, revokedAt: null }
        : { userId, revokedAt: null, id: { not: options.exceptSessionId } },
    data: { revokedAt: now },
  });
  return result.count;
}

/**
 * Live sessions of a user, newest first — the « Appareils connectés » list.
 *
 * Revoked and expired rows are excluded: the list is about what is currently
 * able to act, not about history. History lives in the audit log.
 */
export async function listSessions(
  userId: string,
  now: Date = new Date(),
): Promise<readonly SessionSummary[]> {
  const rows = await db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, device: true, ip: true, createdAt: true, expiresAt: true },
  });

  return rows
    .map((row) => ({
      id: row.id,
      device: row.device,
      ip: row.ip,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      absoluteExpiresAt: absoluteExpiryOf(row.createdAt),
    }))
    .filter((row) => row.absoluteExpiresAt.getTime() > now.getTime());
}

/**
 * Delete sessions that are revoked or long expired — the nightly `cleanup` cron
 * (§19.5, and the 90-day session retention rule in §20).
 *
 * Rows are kept for a grace period after death so that a support question
 * ("which device was that?") is still answerable for a while.
 */
export async function purgeDeadSessions(
  now: Date = new Date(),
  graceDays: number = 7,
): Promise<number> {
  const cutoff = new Date(now.getTime() - graceDays * DAY_MS);
  const result = await db.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return result.count;
}

/* -------------------------------------------------------------------------- */
/* Request metadata                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The client IP behind the Hostinger reverse proxy.
 *
 * `x-forwarded-for` is a comma-separated chain and the **left-most** entry is
 * the original client. It is attacker-controlled — anyone can send a header —
 * so it is used for rate-limit bucketing and for showing the student where a
 * session was opened, never as an authorisation input.
 */
export function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded !== null) {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first.length > 0) return normalizeIp(first);
  }
  const real = headers.get('x-real-ip');
  if (real !== null && real.trim().length > 0) return normalizeIp(real.trim());
  return null;
}

/** The user agent string, trimmed to something a database column can hold. */
export function userAgentFrom(headers: Headers): string | null {
  return truncate(headers.get('user-agent'), 1024);
}

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  // Order matters: every Chromium browser also claims to be Chrome and Safari.
  [/\bEdgi?A?[\s/]?|\bEdg\//i, 'Edge'],
  [/\bOPR\/|\bOpera\b/i, 'Opera'],
  [/\bSamsungBrowser\//i, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//i, 'Firefox'],
  [/\bCriOS\/|\bChrome\//i, 'Chrome'],
  [/\bSafari\//i, 'Safari'],
];

const PLATFORMS: readonly (readonly [RegExp, string])[] = [
  [/\bAndroid\b/i, 'Android'],
  [/\b(iPhone|iPod)\b/i, 'iPhone'],
  [/\biPad\b/i, 'iPad'],
  [/\bWindows NT\b/i, 'Windows'],
  [/\b(Macintosh|Mac OS X)\b/i, 'macOS'],
  [/\bCrOS\b/i, 'ChromeOS'],
  [/\bLinux\b/i, 'Linux'],
];

/**
 * A short, human label for a user agent: `Chrome · Android`, `Safari · iPhone`.
 *
 * Deliberately coarse. This string is shown to a student deciding whether a
 * session is theirs, so "the browser and the kind of machine" is exactly the
 * right resolution — a version number would only add noise, and a full UA string
 * would add fingerprinting surface to a page that does not need it.
 *
 * Returns `null` when nothing recognisable is present, so the UI can fall back
 * to a translated « Appareil inconnu » rather than printing English.
 */
export function parseDeviceLabel(userAgent: string | null): string | null {
  if (userAgent === null || userAgent.trim().length === 0) return null;

  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
  const platform = PLATFORMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;

  if (browser !== null && platform !== null) return `${browser} · ${platform}`;
  if (browser !== null) return browser;
  if (platform !== null) return platform;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function absoluteExpiryOf(createdAt: Date): Date {
  return new Date(createdAt.getTime() + SESSION_ABSOLUTE_MAX_DAYS * DAY_MS);
}

async function slide(
  sessionId: string,
  currentExpiresAt: Date,
  absoluteExpiresAt: Date,
  now: Date,
): Promise<Date> {
  const target = new Date(
    Math.min(now.getTime() + sessionTtlDays() * DAY_MS, absoluteExpiresAt.getTime()),
  );

  if (target.getTime() - currentExpiresAt.getTime() < SLIDE_THRESHOLD_MS) {
    return currentExpiresAt;
  }

  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { expiresAt: target },
  });
  return target;
}

async function revokeById(sessionId: string, now: Date): Promise<void> {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
}

/** IPv6-mapped IPv4 (`::ffff:1.2.3.4`) is written as plain IPv4 so buckets agree. */
function normalizeIp(ip: string | null): string | null {
  if (ip === null) return null;
  const trimmed = ip.trim();
  if (trimmed.length === 0) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(trimmed);
  return truncate(mapped?.[1] ?? trimmed, 45);
}

function truncate(value: string | null, max: number): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
