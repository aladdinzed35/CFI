import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AI_MESSAGES,
  bucketKey,
  consume,
  consumePolicy,
  LOGIN_LOCKOUT_BASE_MS,
  LOGIN_LOCKOUT_MAX_MS,
  LOGIN_PER_EMAIL,
  loginLockoutMs,
  peek,
  peekPolicy,
  POLICIES,
  RESEND_VERIFICATION,
  reset,
  resetAll,
  resetPolicy,
  trackedBuckets,
} from '@/lib/rate-limit';

/**
 * Rate limiting (spec §9.1, §20, §22).
 *
 * The store is module-level state shared by every test in this file, so each
 * case starts from `resetAll()`. Time is injected through the `now` parameter
 * wherever possible; the default-clock path is exercised separately with the
 * suite's fake timers.
 */

/** A fixed origin so every window arithmetic below is exact. */
const T0 = 1_768_473_000_000; // 2026-01-15T10:30:00.000Z

beforeEach(() => {
  resetAll();
});

describe('consume — the ceiling', () => {
  it('allows exactly `limit` actions and denies the next one', () => {
    for (let i = 0; i < 4; i += 1) {
      const result = consume('ceiling', 4, 1_000, T0);
      expect(result.allowed, `call ${i + 1} should be allowed`).toBe(true);
      expect(result.remaining).toBe(3 - i);
      expect(result.retryAfterSec).toBe(0);
    }

    const denied = consume('ceiling', 4, 1_000, T0);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('stays denied while the client keeps hammering inside the window', () => {
    for (let i = 0; i < 4; i += 1) consume('flood', 4, 1_000, T0);
    for (let i = 0; i < 10; i += 1) {
      expect(consume('flood', 4, 1_000, T0).allowed).toBe(false);
    }
  });

  it('reports a resetAt in the future and a Retry-After of at least one second', () => {
    for (let i = 0; i < 4; i += 1) consume('headers', 4, 1_000, T0);
    const denied = consume('headers', 4, 1_000, T0);
    expect(denied.resetAt).toBeInstanceOf(Date);
    expect(denied.resetAt.getTime()).toBe(T0 + 1_000);
    expect(denied.retryAfterSec).toBe(1);
  });

  it('treats a nonsensical limit or window as the safest possible policy', () => {
    expect(consume('nonsense', 0, 1_000, T0).allowed).toBe(true);
    expect(consume('nonsense', 0, 1_000, T0).allowed).toBe(false);
    expect(consume('nonsense-window', 2, -5, T0).allowed).toBe(true);
  });
});

describe('consume — refill', () => {
  it('lets the client back in once the window has elapsed', () => {
    for (let i = 0; i < 4; i += 1) consume('refill', 4, 1_000, T0);
    expect(consume('refill', 4, 1_000, T0).allowed).toBe(false);

    const after = consume('refill', 4, 1_000, T0 + 1_000);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(3);
  });

  it('does not let the client back in a millisecond early', () => {
    for (let i = 0; i < 4; i += 1) consume('early', 4, 1_000, T0);
    // The first token is worth 250 ms of waiting.
    expect(consume('early', 4, 1_000, T0 + 249).allowed).toBe(false);
  });

  it('refills continuously rather than in one fixed-window jump', () => {
    for (let i = 0; i < 4; i += 1) consume('drip', 4, 1_000, T0);
    // One token every 250 ms, so half a window buys back exactly two.
    const half = consume('drip', 4, 1_000, T0 + 500);
    expect(half.allowed).toBe(true);
    expect(half.remaining).toBe(1);
  });

  it('never lets a long idle period bank more than the limit', () => {
    consume('idle', 4, 1_000, T0);
    const muchLater = consume('idle', 4, 1_000, T0 + 10 * 60 * 1_000);
    expect(muchLater.remaining).toBe(3);
    for (let i = 0; i < 3; i += 1) {
      expect(consume('idle', 4, 1_000, T0 + 10 * 60 * 1_000).allowed).toBe(true);
    }
    expect(consume('idle', 4, 1_000, T0 + 10 * 60 * 1_000).allowed).toBe(false);
  });

  it('implements a 1-per-60s cooldown exactly', () => {
    const first = consumePolicy(RESEND_VERIFICATION, 'salma@example.com', T0);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(0);

    expect(consumePolicy(RESEND_VERIFICATION, 'salma@example.com', T0 + 59_000).allowed).toBe(false);

    consumePolicy(RESEND_VERIFICATION, 'omar@example.com', T0);
    expect(consumePolicy(RESEND_VERIFICATION, 'omar@example.com', T0 + 60_000).allowed).toBe(true);
  });
});

describe('consume — bucket isolation', () => {
  it('keeps two identifiers on independent budgets', () => {
    for (let i = 0; i < 4; i += 1) consume('user:a', 4, 1_000, T0);
    expect(consume('user:a', 4, 1_000, T0).allowed).toBe(false);
    expect(consume('user:b', 4, 1_000, T0).allowed).toBe(true);
    expect(consume('user:b', 4, 1_000, T0).remaining).toBe(2);
  });

  it('keeps two policies on the same identifier independent', () => {
    const email = 'salma@example.com';
    for (let i = 0; i < LOGIN_PER_EMAIL.limit; i += 1) consumePolicy(LOGIN_PER_EMAIL, email, T0);
    expect(consumePolicy(LOGIN_PER_EMAIL, email, T0).allowed).toBe(false);
    expect(consumePolicy(AI_MESSAGES, email, T0).allowed).toBe(true);
  });

  it('builds the same bucket string the durable layer writes', () => {
    expect(bucketKey(LOGIN_PER_EMAIL, 'salma@example.com')).toBe('login:email:salma@example.com');
    expect(bucketKey(AI_MESSAGES, 'user_123')).toBe('ai:messages:user_123');
  });

  it('does not conflate two identifiers that differ only in case', () => {
    consumePolicy(LOGIN_PER_EMAIL, 'salma@example.com', T0);
    expect(peekPolicy(LOGIN_PER_EMAIL, 'Salma@example.com', T0).remaining).toBe(
      LOGIN_PER_EMAIL.limit,
    );
  });
});

describe('peek', () => {
  it('reports the state without spending a token', () => {
    consume('peeked', 4, 1_000, T0);
    expect(peek('peeked', 4, 1_000, T0).remaining).toBe(3);
    expect(peek('peeked', 4, 1_000, T0).remaining).toBe(3);
    expect(consume('peeked', 4, 1_000, T0).remaining).toBe(2);
  });

  it('reports a full budget for a bucket that has never been used', () => {
    const fresh = peek('never-seen', 4, 1_000, T0);
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(4);
    expect(fresh.retryAfterSec).toBe(0);
    expect(trackedBuckets()).toBe(0);
  });

  it('reports the countdown for the resend button', () => {
    consumePolicy(RESEND_VERIFICATION, 'salma@example.com', T0);
    // A quarter of the 60 s cooldown has elapsed, so 45 s remain.
    const blocked = peekPolicy(RESEND_VERIFICATION, 'salma@example.com', T0 + 15_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(45);
  });
});

describe('reset', () => {
  it('forgets a bucket after a successful login', () => {
    for (let i = 0; i < 4; i += 1) consume('forget-me', 4, 1_000, T0);
    expect(consume('forget-me', 4, 1_000, T0).allowed).toBe(false);
    reset('forget-me');
    expect(consume('forget-me', 4, 1_000, T0).allowed).toBe(true);
  });

  it('forgets a policy bucket', () => {
    const email = 'salma@example.com';
    for (let i = 0; i < LOGIN_PER_EMAIL.limit; i += 1) consumePolicy(LOGIN_PER_EMAIL, email, T0);
    expect(consumePolicy(LOGIN_PER_EMAIL, email, T0).allowed).toBe(false);
    resetPolicy(LOGIN_PER_EMAIL, email);
    expect(consumePolicy(LOGIN_PER_EMAIL, email, T0).allowed).toBe(true);
  });

  it('resetAll drops every bucket', () => {
    consume('a', 4, 1_000, T0);
    consume('b', 4, 1_000, T0);
    expect(trackedBuckets()).toBe(2);
    resetAll();
    expect(trackedBuckets()).toBe(0);
  });
});

describe('memory bounds', () => {
  it('sweeps buckets that have refilled completely', () => {
    consume('stale', 5, 1_000, T0);
    expect(trackedBuckets()).toBe(1);
    // The sweep runs at most once a minute, on the back of a normal call.
    consume('fresh', 5, 1_000, T0 + 61_000);
    expect(trackedBuckets()).toBe(1);
    expect(peek('stale', 5, 1_000, T0 + 61_000).remaining).toBe(5);
  });

  it('keeps a bucket that is still draining', () => {
    consume('draining', 5, 10 * 60 * 1_000, T0);
    consume('other', 5, 1_000, T0 + 61_000);
    expect(trackedBuckets()).toBe(2);
  });

  it('evicts least-recently-used buckets instead of growing without bound', () => {
    const total = 10_050;
    for (let i = 0; i < total; i += 1) {
      consume(`flood:${i}`, 4, 60_000, T0);
    }
    expect(trackedBuckets()).toBeLessThanOrEqual(10_000);
    expect(trackedBuckets()).toBeGreaterThan(0);
    // The oldest key is gone (a full budget means "never seen"); the newest is kept.
    expect(peek('flood:0', 4, 60_000, T0).remaining).toBe(4);
    expect(peek(`flood:${total - 1}`, 4, 60_000, T0).remaining).toBe(3);
  });
});

describe('the default clock', () => {
  it('uses Date.now() when no timestamp is injected', () => {
    vi.setSystemTime(new Date(T0));
    for (let i = 0; i < 4; i += 1) {
      expect(consume('wall-clock', 4, 60_000).allowed).toBe(true);
    }
    expect(consume('wall-clock', 4, 60_000).allowed).toBe(false);

    vi.setSystemTime(new Date(T0 + 60_000));
    expect(consume('wall-clock', 4, 60_000).allowed).toBe(true);
  });
});

describe('policies', () => {
  it('matches the limits the spec fixes', () => {
    expect(LOGIN_PER_EMAIL).toMatchObject({ key: 'login:email', limit: 5, windowMs: 900_000 });
    expect(RESEND_VERIFICATION).toMatchObject({ key: 'resend-verification', limit: 1, windowMs: 60_000 });
    expect(AI_MESSAGES).toMatchObject({ key: 'ai:messages', limit: 20, windowMs: 3_600_000 });
  });

  it('has a unique key and a sane shape for every policy', () => {
    const keys = POLICIES.map((policy) => policy.key);
    expect(new Set(keys).size).toBe(POLICIES.length);
    for (const policy of POLICIES) {
      expect(policy.limit).toBeGreaterThan(0);
      expect(Number.isInteger(policy.limit)).toBe(true);
      expect(policy.windowMs).toBeGreaterThan(0);
    }
  });

  it('enforces each declared policy exactly', () => {
    for (const policy of POLICIES) {
      resetAll();
      for (let i = 0; i < policy.limit; i += 1) {
        expect(consumePolicy(policy, 'subject', T0).allowed, `${policy.key} #${i + 1}`).toBe(true);
      }
      expect(consumePolicy(policy, 'subject', T0).allowed, `${policy.key} overflow`).toBe(false);
      expect(consumePolicy(policy, 'subject', T0 + policy.windowMs).allowed).toBe(true);
    }
  });
});

describe('loginLockoutMs', () => {
  it('does not lock below the limit', () => {
    expect(loginLockoutMs(0)).toBe(0);
    expect(loginLockoutMs(1)).toBe(0);
    expect(loginLockoutMs(LOGIN_PER_EMAIL.limit - 1)).toBe(0);
  });

  it('doubles from 15 minutes and caps at 2 hours', () => {
    expect(loginLockoutMs(5)).toBe(LOGIN_LOCKOUT_BASE_MS);
    expect(loginLockoutMs(5)).toBe(15 * 60 * 1_000);
    expect(loginLockoutMs(6)).toBe(30 * 60 * 1_000);
    expect(loginLockoutMs(7)).toBe(60 * 60 * 1_000);
    expect(loginLockoutMs(8)).toBe(LOGIN_LOCKOUT_MAX_MS);
    expect(loginLockoutMs(9)).toBe(LOGIN_LOCKOUT_MAX_MS);
    expect(loginLockoutMs(50)).toBe(LOGIN_LOCKOUT_MAX_MS);
  });

  it('never punishes forever', () => {
    expect(loginLockoutMs(1_000)).toBeLessThanOrEqual(LOGIN_LOCKOUT_MAX_MS);
  });

  it('is total for nonsense input', () => {
    expect(loginLockoutMs(Number.NaN)).toBe(0);
    expect(loginLockoutMs(Number.POSITIVE_INFINITY)).toBe(0);
    expect(loginLockoutMs(-3)).toBe(0);
  });
});
