/**
 * In-process token-bucket rate limiting.
 *
 * ## Why there is no Redis here
 * CFI runs as a **single long-lived Node process** on Hostinger (spec §2). There
 * is no second instance to synchronise with, so a `Map` in module scope is a
 * complete and correct shared counter — and it costs no network round-trip on
 * the hot path.
 *
 * ## What this deliberately does not do
 * A `Map` dies with the process. Restarting the server would hand an attacker a
 * fresh budget. For the endpoints where that matters — login, registration,
 * password reset — the auth service layers a **durable** counter on top by
 * writing a `RateLimitEvent { bucket, createdAt }` row per attempt and counting
 * rows inside the window before calling {@link consume}. Use
 * {@link bucketKey} to build the string so both layers agree on the key:
 *
 * ```ts
 * const key = bucketKey(LOGIN_PER_EMAIL, email.toLowerCase());
 * const durable = await db.rateLimitEvent.count({
 *   where: { bucket: key, createdAt: { gte: new Date(Date.now() - LOGIN_PER_EMAIL.windowMs) } },
 * });
 * if (durable >= LOGIN_PER_EMAIL.limit) return locked();
 * const memory = consumePolicy(LOGIN_PER_EMAIL, email.toLowerCase());
 * if (!memory.allowed) return locked();
 * ```
 *
 * The in-memory bucket absorbs bursts cheaply; the table survives restarts. The
 * nightly `cleanup` cron (spec §19) deletes old rows.
 *
 * ## Token bucket, not fixed window
 * Each bucket refills continuously at `limit / windowMs` tokens per millisecond.
 * That gives the same long-run ceiling as a fixed window without the boundary
 * artefact where a client spends its whole budget at 11:59 and again at 12:00,
 * and it makes a `1 per 60 s` cooldown fall out naturally.
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A named limit. `key` prefixes the bucket string so two policies never collide. */
export interface RateLimitPolicy {
  /** Stable prefix, e.g. `login:email`. Also written to `RateLimitEvent.bucket`. */
  readonly key: string;
  /** Number of actions allowed per window. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
}

export interface RateLimitResult {
  /** `false` means the caller must reject the request with HTTP 429. */
  readonly allowed: boolean;
  /** Whole actions still available right now (0 when blocked). */
  readonly remaining: number;
  /** When the bucket will be completely refilled — the `X-RateLimit-Reset` value. */
  readonly resetAt: Date;
  /** Seconds until at least one action is available again — the `Retry-After` value. 0 when allowed. */
  readonly retryAfterSec: number;
}

interface Bucket {
  /** Fractional tokens available at `updatedAt`. */
  tokens: number;
  /** Timestamp the token count refers to. */
  updatedAt: number;
  /** Timestamp at which the bucket is full again and can be forgotten. */
  fullAt: number;
}

/* -------------------------------------------------------------------------- */
/* Policies (spec §9.1, §20)                                                   */
/* -------------------------------------------------------------------------- */

/** 5 registrations per IP per hour. */
export const REGISTER_PER_IP: RateLimitPolicy = {
  key: 'register:ip',
  limit: 5,
  windowMs: HOUR,
};

/** 3 registration attempts per email address per day. */
export const REGISTER_PER_EMAIL: RateLimitPolicy = {
  key: 'register:email',
  limit: 3,
  windowMs: DAY,
};

/**
 * 5 login attempts per email per 15 minutes. Past that the auth service locks
 * the account for {@link loginLockoutMs} and emails the owner — the bucket only
 * decides *when* the lockout starts.
 */
export const LOGIN_PER_EMAIL: RateLimitPolicy = {
  key: 'login:email',
  limit: 5,
  windowMs: 15 * MINUTE,
};

/** 5 login attempts per IP per 15 minutes, so credential stuffing across many accounts also stalls. */
export const LOGIN_PER_IP: RateLimitPolicy = {
  key: 'login:ip',
  limit: 5,
  windowMs: 15 * MINUTE,
};

/** Password reset gets the same treatment as login (spec §20). */
export const PASSWORD_RESET_PER_EMAIL: RateLimitPolicy = {
  key: 'password-reset:email',
  limit: 5,
  windowMs: 15 * MINUTE,
};

export const PASSWORD_RESET_PER_IP: RateLimitPolicy = {
  key: 'password-reset:ip',
  limit: 5,
  windowMs: 15 * MINUTE,
};

/** One "renvoyer l'e-mail" per 60 seconds — the cooldown behind the resend button (spec §9.1). */
export const RESEND_VERIFICATION: RateLimitPolicy = {
  key: 'resend-verification',
  limit: 1,
  windowMs: 60 * SECOND,
};

/** 20 messages to the AI assistant per user per hour — the Anthropic bill's guardrail. */
export const AI_MESSAGES: RateLimitPolicy = {
  key: 'ai:messages',
  limit: 20,
  windowMs: HOUR,
};

/** 3 contact-form submissions per IP per hour, on top of the honeypot and timing check. */
export const CONTACT_FORM: RateLimitPolicy = {
  key: 'contact:ip',
  limit: 3,
  windowMs: HOUR,
};

/** 20 file uploads per user per hour — receipts, assignment submissions, avatars. */
export const UPLOAD: RateLimitPolicy = {
  key: 'upload:user',
  limit: 20,
  windowMs: HOUR,
};

/** Every named policy, for the diagnostics page and for exhaustive tests. */
export const POLICIES: readonly RateLimitPolicy[] = [
  REGISTER_PER_IP,
  REGISTER_PER_EMAIL,
  LOGIN_PER_EMAIL,
  LOGIN_PER_IP,
  PASSWORD_RESET_PER_EMAIL,
  PASSWORD_RESET_PER_IP,
  RESEND_VERIFICATION,
  AI_MESSAGES,
  CONTACT_FORM,
  UPLOAD,
];

/* -------------------------------------------------------------------------- */
/* Lockout escalation                                                          */
/* -------------------------------------------------------------------------- */

/** First lockout duration after the login limit is exhausted (spec §20). */
export const LOGIN_LOCKOUT_BASE_MS = 15 * MINUTE;
/** Ceiling the doubling stops at, so a locked-out student is never punished forever. */
export const LOGIN_LOCKOUT_MAX_MS = 2 * HOUR;

/**
 * How long to lock an account after `consecutiveFailures` failed logins:
 * nothing below the limit, then 15 min, 30 min, 1 h, 2 h, 2 h, …
 *
 * Pure — the auth service persists the resulting deadline, since a lockout must
 * survive a restart.
 */
export function loginLockoutMs(
  consecutiveFailures: number,
  policy: RateLimitPolicy = LOGIN_PER_EMAIL,
): number {
  if (!Number.isFinite(consecutiveFailures)) return 0;
  const failures = Math.trunc(consecutiveFailures);
  if (failures < policy.limit) return 0;

  const steps = Math.min(failures - policy.limit, 20);
  return Math.min(LOGIN_LOCKOUT_BASE_MS * 2 ** steps, LOGIN_LOCKOUT_MAX_MS);
}

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Hard ceiling on tracked buckets. Reached only under a distributed flood; the
 * eviction below keeps memory bounded instead of letting the process OOM.
 */
const MAX_BUCKETS = 10_000;
/** How much to shed once the ceiling is hit, so eviction is not re-triggered every call. */
const EVICT_TO = Math.floor(MAX_BUCKETS * 0.9);
/** Minimum gap between full sweeps of the map. */
const SWEEP_INTERVAL_MS = 60 * SECOND;

const buckets = new Map<string, Bucket>();
let lastSweepAt = 0;

/**
 * Build the canonical bucket string for a policy and an identifier, e.g.
 * `login:email:jane@example.com`. The same string goes into
 * `RateLimitEvent.bucket`, so the durable and in-memory layers stay aligned.
 *
 * Normalise the identifier before calling (lowercase an email, canonicalise an
 * IP) — this function does not guess.
 */
export function bucketKey(policy: RateLimitPolicy, identifier: string): string {
  return `${policy.key}:${identifier}`;
}

/**
 * Take one token from `bucket`, creating it on first use.
 *
 * Never throws and never blocks. `now` is injectable so tests can advance time
 * without waiting.
 */
export function consume(
  bucket: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
  const safeWindow = Number.isFinite(windowMs) && windowMs > 0 ? Math.floor(windowMs) : SECOND;
  const msPerToken = safeWindow / safeLimit;

  sweep(now);

  const state = refill(bucket, safeLimit, msPerToken, now);

  let allowed: boolean;
  if (state.tokens >= 1) {
    state.tokens -= 1;
    allowed = true;
  } else {
    allowed = false;
  }

  state.fullAt = now + (safeLimit - state.tokens) * msPerToken;
  touch(bucket, state);

  return result(state, safeLimit, msPerToken, now, allowed);
}

/** Same as {@link consume}, keyed by a policy and an identifier. */
export function consumePolicy(
  policy: RateLimitPolicy,
  identifier: string,
  now: number = Date.now(),
): RateLimitResult {
  return consume(bucketKey(policy, identifier), policy.limit, policy.windowMs, now);
}

/**
 * Report the current state **without** spending a token — for rendering a
 * countdown on the "renvoyer l'e-mail" button, or for a `check-then-act` flow
 * that must not charge the user for a request it is about to reject anyway.
 */
export function peek(
  bucket: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
  const safeWindow = Number.isFinite(windowMs) && windowMs > 0 ? Math.floor(windowMs) : SECOND;
  const msPerToken = safeWindow / safeLimit;

  const existing = buckets.get(bucket);
  if (existing === undefined) {
    return {
      allowed: true,
      remaining: safeLimit,
      resetAt: new Date(now),
      retryAfterSec: 0,
    };
  }

  const state = refill(bucket, safeLimit, msPerToken, now);
  return result(state, safeLimit, msPerToken, now, state.tokens >= 1);
}

/** Same as {@link peek}, keyed by a policy and an identifier. */
export function peekPolicy(
  policy: RateLimitPolicy,
  identifier: string,
  now: number = Date.now(),
): RateLimitResult {
  return peek(bucketKey(policy, identifier), policy.limit, policy.windowMs, now);
}

/**
 * Forget a bucket entirely. Call it after a **successful** login or a completed
 * verification so a student who fumbled their password twice is not still
 * throttled an hour later.
 */
export function reset(bucket: string): void {
  buckets.delete(bucket);
}

/** {@link reset}, keyed by a policy and an identifier. */
export function resetPolicy(policy: RateLimitPolicy, identifier: string): void {
  reset(bucketKey(policy, identifier));
}

/** Drop every bucket. Test helper and the "vider les compteurs" admin action. */
export function resetAll(): void {
  buckets.clear();
  lastSweepAt = 0;
}

/** Number of tracked buckets — surfaced on the admin diagnostics page (spec §17). */
export function trackedBuckets(): number {
  return buckets.size;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function refill(key: string, limit: number, msPerToken: number, now: number): Bucket {
  const existing = buckets.get(key);
  if (existing === undefined) {
    return { tokens: limit, updatedAt: now, fullAt: now };
  }

  const elapsed = Math.max(0, now - existing.updatedAt);
  existing.tokens = Math.min(limit, existing.tokens + elapsed / msPerToken);
  existing.updatedAt = now;
  return existing;
}

/**
 * Re-insert the bucket so the map's iteration order is least-recently-used
 * first, which is what {@link evict} relies on.
 */
function touch(key: string, state: Bucket): void {
  buckets.delete(key);
  buckets.set(key, state);
  if (buckets.size > MAX_BUCKETS) evict();
}

function result(
  state: Bucket,
  limit: number,
  msPerToken: number,
  now: number,
  allowed: boolean,
): RateLimitResult {
  const deficit = Math.max(0, 1 - state.tokens);
  return {
    allowed,
    remaining: Math.max(0, Math.floor(state.tokens)),
    resetAt: new Date(Math.round(now + (limit - state.tokens) * msPerToken)),
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((deficit * msPerToken) / SECOND)),
  };
}

/**
 * Drop buckets that have refilled completely — they are indistinguishable from
 * a bucket that never existed, so keeping them only wastes memory. Runs at most
 * once per {@link SWEEP_INTERVAL_MS}, on the back of a normal `consume` call:
 * no timer, nothing to keep the event loop alive.
 */
function sweep(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  for (const [key, state] of buckets) {
    if (state.fullAt <= now) buckets.delete(key);
  }
}

/** Shed the least-recently-used buckets once the map exceeds its ceiling. */
function evict(): void {
  for (const key of buckets.keys()) {
    if (buckets.size <= EVICT_TO) break;
    buckets.delete(key);
  }
}
