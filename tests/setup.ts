import { afterAll, afterEach, beforeAll, vi } from 'vitest';

/**
 * tests/setup.ts — the determinism contract for every Vitest suite (spec §22).
 *
 * Two sources of non-determinism are removed before a single test module is
 * imported, because both of them make date assertions pass on one machine and
 * fail on another:
 *
 *   1. **Timezone.** The product is operated from Morocco; invoice dates, the
 *      48-hour bank-transfer notice, session expiry and the SM-2 scheduler are
 *      all reasoned about in `Africa/Casablanca`. A developer in UTC+2 or a CI
 *      runner in UTC would otherwise land on a different calendar day.
 *   2. **The clock.** `Date` is frozen at a fixed instant so that "48 hours from
 *      now" is a constant. Only `Date` is faked — `setTimeout`, `setInterval`
 *      and `queueMicrotask` stay real, so awaiting a promise still resolves and
 *      integration tests are not left hanging on a stopped event loop.
 *
 * `SKIP_ENV_VALIDATION` is set for the same reason CI sets it: `src/lib/env.ts`
 * validates the whole environment at module load and calls `process.exit(1)`
 * when a secret is missing. Tests hold no production secrets, so they run with
 * the module's explicitly fake build placeholders instead.
 */

/* --------------------------------------------------------------- timezone */

/**
 * Set before anything constructs a `Date`. Node re-reads `process.env.TZ` on
 * the next date operation, so assigning it here — in a setup file, which Vitest
 * loads before the test modules — is early enough.
 */
process.env.TZ = 'Africa/Casablanca';

/* -------------------------------------------------------------- environment */

// Vitest already sets NODE_ENV=test; only the validation switch is ours to set.
process.env.SKIP_ENV_VALIDATION = '1';

/* ------------------------------------------------------------------- clock */

/**
 * Wednesday 15 January 2026, 11:30 in Casablanca (UTC+1) — a plain weekday
 * outside Ramadan, when Morocco temporarily returns to UTC+0, and far from a
 * month or year boundary. Every "today" in the suite is this instant.
 */
export const FROZEN_NOW = new Date('2026-01-15T10:30:00.000Z');

beforeAll(() => {
  vi.useFakeTimers({ now: FROZEN_NOW, toFake: ['Date'] });
});

afterEach(() => {
  // A test that advanced the clock on purpose must not leak that into the next.
  vi.setSystemTime(FROZEN_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});
