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
 * ## Where the rules live
 * A `'use server'` module may export nothing but async functions, so the
 * pattern, the normaliser and the rate-limit policy sit in
 * `@/lib/certificate-code` — shared verbatim with the form (which uses them as
 * a courtesy check) and with the QR page at `/certificat/[code]`, which is the
 * same enumeration surface reached by a plain GET and therefore spends a token
 * from the same bucket. Three hand-kept copies of a security predicate is two
 * too many.
 */

import { z } from 'zod';

import {
  CERTIFICATE_CODE_PATTERN,
  CERTIFICATE_VERIFY_POLICY,
  MAX_CERTIFICATE_CODE_LENGTH,
  normalizeCertificateCode,
} from '@/lib/certificate-code';
import { withAction } from '@/server/auth';
import { verifyCertificate, type CertificateVerification } from '@/server/services/certificates';
import { locales } from '@/i18n/routing';

const verifyCertificateSchema = z
  .object({
    code: z.string().max(MAX_CERTIFICATE_CODE_LENGTH),
    /** Only decides the language of the title and the date, never the verdict. */
    locale: z.enum(locales),
  })
  .strict();

export const verifyCertificateAction = withAction(
  verifyCertificateSchema,
  async (input): Promise<CertificateVerification> => {
    const code = normalizeCertificateCode(input.code);

    // Same answer as an unknown code, on purpose (see the header).
    if (!CERTIFICATE_CODE_PATTERN.test(code)) return { found: false };

    return verifyCertificate(code, input.locale);
  },
  {
    auth: 'public',
    rateLimit: {
      policy: CERTIFICATE_VERIFY_POLICY,
      identify: (_input, ctx) => ctx.ip ?? 'unknown',
    },
  },
);
