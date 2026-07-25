import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Cryptographic primitives and human-facing reference codes.
 *
 * Server-only: this module imports `node:crypto`. Never pull it into a client
 * component — go through a server action.
 *
 * ## Token discipline (spec §9.1, §20)
 * A verification, password-reset or session token is generated once, shown to
 * the user exactly once (inside an email link), and **only its SHA-256 hash is
 * persisted**. A database dump therefore leaks nothing usable. Verification is
 * always `constantTimeEquals(hashToken(candidate), storedHash)`.
 *
 * SHA-256 is the right tool here and Argon2id is not: these are 64 bytes of
 * cryptographically random data, not a low-entropy human password, so there is
 * nothing to brute-force and no reason to pay a KDF's cost on every request.
 * Passwords go through `@node-rs/argon2` in the auth service, never through here.
 */

/** Default token size in bytes. 64 bytes = 512 bits (spec §9.1). */
export const DEFAULT_TOKEN_BYTES = 64;

/** Length of a certificate verification code. */
export const VERIFY_CODE_LENGTH = 10;

/**
 * Alphabet for codes a human has to read off a printed certificate and type
 * back in. `0`/`O`, `1`/`I`/`L` are excluded — they are the pairs people
 * actually confuse. 31 symbols, so a 10-character code carries ~49.6 bits of
 * entropy, far beyond guessing range for a public lookup endpoint.
 */
export const VERIFY_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Generate a URL-safe random token.
 *
 * base64url has no `+`, `/` or `=`, so the value survives an email link, a query
 * string and a copy-paste without escaping.
 */
export function generateToken(bytes: number = DEFAULT_TOKEN_BYTES): string {
  const size = Number.isSafeInteger(bytes) && bytes > 0 ? bytes : DEFAULT_TOKEN_BYTES;
  return randomBytes(size).toString('base64url');
}

/**
 * SHA-256 of a token, hex-encoded (64 characters).
 *
 * This is the only form of a token that is ever written to the database or to a
 * log line.
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Compare two strings without leaking their contents through timing.
 *
 * Both sides are hashed first, which makes the comparison length-safe:
 * `timingSafeEqual` throws on mismatched buffer lengths, and comparing lengths
 * beforehand would itself leak the length. Hashing normalises everything to 32
 * bytes, so the only observable is equality.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Payment reference the student writes in the transfer's motif field, e.g.
 * `CFI-2026-000123` (spec §9.2).
 *
 * The sequence is allocated by the database (a per-year counter), never by this
 * function — two concurrent requests must not be able to mint the same
 * reference.
 */
export function generateReference(year: number, sequence: number): string {
  return `CFI-${formatYear(year)}-${formatSequence(sequence, 6)}`;
}

/** Invoice number, e.g. `FAC-2026-0042`. Sequential per year, allocated in the same transaction as the payment. */
export function generateInvoiceNumber(year: number, sequence: number): string {
  return `FAC-${formatYear(year)}-${formatSequence(sequence, 4)}`;
}

/** Certificate serial printed on the PDF, e.g. `CFI-CERT-2026-000042`. */
export function generateCertificateSerial(year: number, sequence: number): string {
  return `CFI-CERT-${formatYear(year)}-${formatSequence(sequence, 6)}`;
}

/**
 * Short public code behind `https://cfi.ma/fr/certificat/<code>` (spec §9.3).
 *
 * Unlike the serial, this is unguessable: the verification page is public, so
 * the code — not an incrementing id — is what stops anyone from enumerating
 * every certificate the center has ever issued.
 *
 * `randomInt` is uniform over the range, so no character is over-represented.
 */
export function generateVerifyCode(): string {
  let code = '';
  for (let i = 0; i < VERIFY_CODE_LENGTH; i += 1) {
    code += VERIFY_CODE_ALPHABET.charAt(randomInt(VERIFY_CODE_ALPHABET.length));
  }
  return code;
}

/**
 * SHA-256 of an uploaded file's bytes, hex-encoded.
 *
 * Used for duplicate-receipt detection (spec §9.2 rule 6): a matching digest
 * flags the new enrollment request in the admin queue against the original. It
 * never auto-rejects — two students can legitimately share a household transfer
 * screenshot, and that is a judgement call for a human.
 *
 * Hash the **original uploaded bytes**, before the sharp re-encode, or the digest
 * changes on every upload of the same image.
 */
export function sha256File(buffer: Buffer | Uint8Array | ArrayBuffer): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  return createHash('sha256').update(bytes).digest('hex');
}

function formatYear(year: number): string {
  if (!Number.isFinite(year)) return '0000';
  const normalized = Math.trunc(Math.abs(year));
  return String(normalized).padStart(4, '0');
}

function formatSequence(sequence: number, width: number): string {
  if (!Number.isFinite(sequence)) return '0'.repeat(width);
  const normalized = Math.max(0, Math.trunc(sequence));
  // A sequence wider than the pad is printed in full rather than truncated —
  // a longer reference is ugly, a colliding one is a data-integrity incident.
  return String(normalized).padStart(width, '0');
}
