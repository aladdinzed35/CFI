'use server';

/**
 * The public certificate check (§12.5, §20, §27).
 *
 * ## An endpoint that is enumerable by design
 * A verification code is short, printed on paper, and typed by strangers: there
 * is no session to gate it with and there never will be. So the two defences
 * that matter are that it costs something to ask, and that asking teaches
 * nothing beyond the answer.
 *
 * - **It costs something.** `withAction` spends a rate-limit token *before* the
 *   handler runs, so a malformed guess is charged exactly like a well-formed
 *   one and a script cannot walk the code space for free. The bucket is keyed on
 *   the caller's IP, with every IP-less caller sharing one bucket rather than
 *   escaping the limit — the failure mode of an unknown origin should be
 *   stricter, not laxer.
 * - **It teaches nothing.** A code that does not match the printed format never
 *   reaches the database and comes back as `{ found: false }` — byte for byte
 *   what an unknown code returns. There is no `validation` failure to time, to
 *   count, or to diff: the only signal an attacker gets is the one an honest
 *   employer gets.
 *
 * ## Why the schema is deliberately loose
 * Rejecting a wrong-format code at the Zod layer would return `validation`
 * where a real-but-unknown code returns `ok`, which is precisely the oracle this
 * page must not become. The schema therefore only refuses input no human typed
 * — a payload longer than any certificate code — and the *shape* check happens
 * in the handler, where its verdict is indistinguishable from a miss.
 *
 * ## Why the policy is declared here
 * A `'use server'` module may export nothing but async functions, so this
 * constant cannot be re-exported for `POLICIES`; and `src/lib/rate-limit.ts`
 * belongs to another milestone's file set. The bucket key is namespaced like
 * every other policy, so the durable layer and the diagnostics screen can find
 * it by prefix when they need to.
 */

import { z } from 'zod';

import type { RateLimitPolicy } from '@/lib/rate-limit';
import { withAction } from '@/server/auth';
import { verifyCertificate, type CertificateVerification } from '@/server/services/certificates';
import { locales } from '@/i18n/routing';

/** 10 checks per IP per 10 minutes — refilled continuously, so ~1 per minute sustained. */
const CERTIFICATE_VERIFY: RateLimitPolicy = {
  key: 'certificate:verify:ip',
  limit: 10,
  windowMs: 10 * 60 * 1_000,
};

/** Longer than this is not a typo, it is a payload. */
const MAX_SUBMITTED_LENGTH = 200;

/**
 * The printed shape: groups of letters and digits joined by hyphens, e.g.
 * `CFI-2026-4KX9TB`. Permissive about the number and length of the groups so a
 * future issuing format is not rejected by a page written before it existed,
 * strict about the alphabet so nothing else ever reaches a query.
 */
const CODE_PATTERN = /^[A-Z0-9]{2,12}(?:-[A-Z0-9]{2,12}){0,4}$/;

/**
 * Turn what a human typed into what the register stores.
 *
 * Every transformation here fixes a way an honest person mistypes a code they
 * are reading off paper: lower case, spaces around the hyphens, the dash their
 * word processor curled into an en dash, and — for an Arabic keyboard — the
 * Arabic-Indic digits their phone produced for what is printed as `2026`.
 *
 * `verify-form.tsx` holds the same two rules so the visitor gets an instant
 * « ce n'est pas le format attendu » instead of a round trip. This copy is the
 * one that decides anything: the browser's is a courtesy.
 */
function normalizeCode(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[‐-―−_]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
}

const verifyCertificateSchema = z
  .object({
    code: z.string().max(MAX_SUBMITTED_LENGTH),
    /** Only decides the language of the title and the date, never the verdict. */
    locale: z.enum(locales),
  })
  .strict();

export const verifyCertificateAction = withAction(
  verifyCertificateSchema,
  async (input): Promise<CertificateVerification> => {
    const code = normalizeCode(input.code);

    // Same answer as an unknown code, on purpose (see the header).
    if (!CODE_PATTERN.test(code)) return { found: false };

    return verifyCertificate(code, input.locale);
  },
  {
    auth: 'public',
    rateLimit: {
      policy: CERTIFICATE_VERIFY,
      identify: (_input, ctx) => ctx.ip ?? 'unknown',
    },
  },
);
