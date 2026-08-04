import type { RateLimitPolicy } from '@/lib/rate-limit';

/**
 * The one definition of what a public certificate code is (§12.5).
 *
 * Three callers need these rules and they must agree exactly:
 *  - `server/actions/verify-certificate.ts`, which decides the verdict;
 *  - `certificat/verify-form.tsx`, which fails a typo in place rather than
 *    spending a round trip and a rate-limit token on it;
 *  - `certificat/[code]/page.tsx`, the QR target, where the code arrives in a
 *    URL rather than a form field.
 *
 * They used to be copied into the form by hand, because a `'use server'` module
 * may export nothing but async functions and so could not share them. A plain
 * module can, and three hand-kept copies of a security predicate is two too
 * many: the one that drifts is the one that lets something through.
 *
 * Nothing here touches the database or the request, so the client bundle picks
 * up two small functions and no server code.
 */

/**
 * The printed shape: groups of letters and digits joined by hyphens, e.g.
 * `CFI-2026-4KX9TB`. Permissive about the number and length of the groups so a
 * future issuing format is not rejected by a page written before it existed,
 * strict about the alphabet so nothing else ever reaches a query.
 */
export const CERTIFICATE_CODE_PATTERN = /^[A-Z0-9]{2,12}(?:-[A-Z0-9]{2,12}){0,4}$/;

/** Longer than this is not a typo, it is a payload. */
export const MAX_CERTIFICATE_CODE_LENGTH = 200;

/**
 * Turn what a human typed — or what a QR scanner produced — into what the
 * register stores.
 *
 * Every transformation fixes a way an honest person mistypes a code they are
 * reading off paper: lower case, spaces around the hyphens, the dash their word
 * processor curled into an en dash, and — for an Arabic keyboard — the
 * Arabic-Indic digits their phone produced for what is printed as `2026`.
 */
export function normalizeCertificateCode(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[‐-―−_]/gu, '-')
    .replace(/\s+/gu, '')
    .toUpperCase();
}

/**
 * 10 checks per IP per 10 minutes — refilled continuously, so ~1 per minute
 * sustained.
 *
 * Shared by the action and the QR page for one reason: a verification code is
 * short, printed on paper, and guessable, so the defence is that asking COSTS
 * something. A deep link that rendered a verdict without spending a token would
 * hand an attacker the free enumeration oracle the action refuses to be — and
 * it is the easier surface to script, being a plain GET.
 */
export const CERTIFICATE_VERIFY_POLICY: RateLimitPolicy = {
  key: 'certificate:verify:ip',
  limit: 10,
  windowMs: 10 * 60 * 1_000,
};
