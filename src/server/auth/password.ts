import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

/**
 * Password hashing — Argon2id, and nothing else (§4, §20).
 *
 * bcrypt is banned by the stack rules and by ESLint (`no-restricted-imports`):
 * it truncates at 72 bytes, has no memory hardness, and a modern GPU rig walks
 * through it. Argon2id is the OWASP recommendation and the only algorithm this
 * codebase is allowed to use for a human-chosen secret.
 *
 * ## Parameters (§20)
 * `memoryCost` ≥ 19 456 KiB (19 MiB), `timeCost` 2, `parallelism` 1 — the OWASP
 * "second recommended" configuration. On the single Hostinger Node process this
 * costs roughly 30–50 ms per hash, which is a rounding error on a login request
 * and about 10⁶ times more expensive than SHA-256 for an offline cracker.
 *
 * Every parameter is embedded in the PHC string that gets stored, so raising
 * them later does not invalidate existing hashes: {@link needsRehash} tells the
 * login path when to transparently re-hash a password it has just verified.
 *
 * ## Timing and account enumeration
 * A login for an unknown e-mail must take as long as a login for a known one,
 * otherwise the response time answers "does this address have an account?" —
 * which §20 forbids. {@link dummyVerify} burns an equivalent Argon2id
 * verification against a throw-away hash built with the *current* parameters,
 * so the two paths stay indistinguishable even after the cost is raised.
 *
 * Server-only: this module loads a native addon. It must never reach a client
 * bundle.
 */

/** Argon2id. Numeric value of `Algorithm.Argon2id` from `@node-rs/argon2`. */
const ARGON2ID = 2;

/** Argon2 version 0x13 (19) — the current one, and the only one we mint. */
const ARGON2_VERSION = 19;

/** Value of `Version.V0x13` in the `@node-rs/argon2` enum. */
const ARGON2_VERSION_ENUM = 1;

/**
 * Current cost parameters. Raise them, deploy, and every user is migrated on
 * their next successful login through {@link needsRehash} — no mass reset.
 */
export const PASSWORD_PARAMS = {
  /** KiB of memory per hash. §20 requires at least 19 456 (19 MiB). */
  memoryCost: 19_456,
  /** Passes over that memory. */
  timeCost: 2,
  /** Lanes. 1, because the process is already handling other requests. */
  parallelism: 1,
  /** Raw digest length in bytes. */
  outputLen: 32,
} as const;

/** Minimum length accepted at registration (§9.1). Shared with the Zod schemas. */
export const PASSWORD_MIN_LENGTH = 10;

/**
 * Upper bound on what we are willing to hash. Argon2 cost is independent of the
 * input length, but refusing a megabyte of "password" keeps the request cheap.
 */
export const PASSWORD_MAX_LENGTH = 256;

const HASH_OPTIONS = {
  algorithm: ARGON2ID,
  version: ARGON2_VERSION_ENUM,
  memoryCost: PASSWORD_PARAMS.memoryCost,
  timeCost: PASSWORD_PARAMS.timeCost,
  parallelism: PASSWORD_PARAMS.parallelism,
  outputLen: PASSWORD_PARAMS.outputLen,
} as const;

/**
 * Hash a plaintext password.
 *
 * Returns a PHC string — `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<digest>` — that
 * carries its own salt and parameters. That whole string is what goes in
 * `User.passwordHash`; there is no separate salt column and there must never be
 * one.
 *
 * @throws RangeError when the input is empty or longer than {@link PASSWORD_MAX_LENGTH}.
 */
export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new RangeError('hashPassword: le mot de passe ne peut pas être vide.');
  }
  if (plain.length > PASSWORD_MAX_LENGTH) {
    throw new RangeError(
      `hashPassword: le mot de passe dépasse ${PASSWORD_MAX_LENGTH} caractères.`,
    );
  }
  return argon2Hash(plain, HASH_OPTIONS);
}

/**
 * Check a plaintext password against a stored PHC string.
 *
 * Argon2 reads the cost parameters out of `storedHash`, so a hash minted with
 * older parameters still verifies correctly — that is what makes a progressive
 * migration possible.
 *
 * Never throws: a malformed or truncated hash (a half-written row, a bad import)
 * is a failed verification, not a 500 that tells the caller something is wrong
 * with *this particular account*.
 */
export async function verifyPassword(plain: string, storedHash: string): Promise<boolean> {
  if (typeof plain !== 'string' || plain.length === 0) return false;
  if (typeof storedHash !== 'string' || storedHash.length === 0) return false;
  if (plain.length > PASSWORD_MAX_LENGTH) return false;

  try {
    return await argon2Verify(storedHash, plain);
  } catch {
    return false;
  }
}

/**
 * Burn one Argon2id verification and return `false`.
 *
 * The login path calls this when the e-mail matches no account, so that the
 * "unknown address" branch costs the same wall-clock time as the "wrong
 * password" branch and the response time leaks nothing (§20).
 *
 * The throw-away hash is built once, lazily, from {@link PASSWORD_PARAMS} — so
 * when the parameters are raised the decoy automatically gets more expensive
 * too and the two branches stay matched. It is memoised for the life of the
 * process; the first call pays for one extra hash.
 */
export async function dummyVerify(): Promise<false> {
  const decoy = await decoyHash();
  try {
    await argon2Verify(decoy, DECOY_PROBE);
  } catch {
    // A decoy that fails to verify has done its only job: consumed the time.
  }
  return false;
}

/**
 * `true` when `storedHash` was produced with weaker parameters than the ones in
 * force today, or with another algorithm or version.
 *
 * Call it right after a **successful** {@link verifyPassword} — that is the only
 * moment the plaintext is available — and re-hash in place when it returns
 * `true`. An unparseable hash also returns `true`: rewriting it is strictly
 * better than leaving a row nobody can authenticate against.
 */
export function needsRehash(storedHash: string): boolean {
  const parsed = parsePhc(storedHash);
  if (parsed === null) return true;

  if (parsed.algorithm !== 'argon2id') return true;
  if (parsed.version !== ARGON2_VERSION) return true;
  if (parsed.memoryCost < PASSWORD_PARAMS.memoryCost) return true;
  if (parsed.timeCost < PASSWORD_PARAMS.timeCost) return true;
  if (parsed.parallelism !== PASSWORD_PARAMS.parallelism) return true;

  return false;
}

/** The parameters encoded in a PHC string, as read back by {@link parsePhc}. */
export interface PhcParameters {
  readonly algorithm: string;
  readonly version: number;
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

/**
 * Read the algorithm, version and cost out of a PHC string.
 *
 * Format: `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<digest>`. Returns `null` for
 * anything that does not match, including the bcrypt hashes this project must
 * never contain.
 */
export function parsePhc(storedHash: string): PhcParameters | null {
  if (typeof storedHash !== 'string') return null;

  const parts = storedHash.split('$');
  // ['', 'argon2id', 'v=19', 'm=…,t=…,p=…', salt, digest]
  if (parts.length !== 6) return null;

  const algorithm = parts[1];
  const versionField = parts[2];
  const costField = parts[3];
  if (algorithm === undefined || versionField === undefined || costField === undefined) return null;
  if (!algorithm.startsWith('argon2')) return null;

  const version = readNumeric(versionField, 'v');
  if (version === null) return null;

  const costs = new Map<string, number>();
  for (const segment of costField.split(',')) {
    const [key, raw] = segment.split('=');
    if (key === undefined || raw === undefined) return null;
    const value = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    costs.set(key, value);
  }

  const memoryCost = costs.get('m');
  const timeCost = costs.get('t');
  const parallelism = costs.get('p');
  if (memoryCost === undefined || timeCost === undefined || parallelism === undefined) return null;

  return { algorithm, version, memoryCost, timeCost, parallelism };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Constant plaintext behind the decoy hash. It is not a secret and does not need
 * to be: it never authenticates anything, and the probe below is deliberately
 * different so the verification always fails after doing the full work.
 */
const DECOY_SECRET = 'cfi-argon2id-timing-decoy';
const DECOY_PROBE = 'cfi-argon2id-timing-probe';

let decoyPromise: Promise<string> | null = null;

function decoyHash(): Promise<string> {
  decoyPromise ??= argon2Hash(DECOY_SECRET, HASH_OPTIONS);
  return decoyPromise;
}

function readNumeric(field: string, key: string): number | null {
  const prefix = `${key}=`;
  if (!field.startsWith(prefix)) return null;
  const value = Number.parseInt(field.slice(prefix.length), 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
