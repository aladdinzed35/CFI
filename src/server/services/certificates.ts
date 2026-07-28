import { db } from '@/server/db';
import { formatDate, formatDuration } from '@/lib/dates';
import type { Locale } from '@/i18n/routing';

/**
 * Public certificate verification (§12.5, §27).
 *
 * ## This is a trust surface, so the contract is a discriminated union
 * An employer holding a printed certificate asks one question — « is this
 * real? » — and there are exactly three honest answers: no certificate carries
 * this code, one does but it was annulled, one does and it stands. Returning a
 * nullable object would let a caller test `!== null` and call an annulled
 * certificate genuine; the union below makes `revoked` impossible to skip,
 * because the `found: true` branch does not expose a single field until the
 * caller has narrowed on it.
 *
 * ## What the verifier gets, and what they never get
 * §27: only the three facts printed on the document itself — the holder's name
 * as it appears on it, the course, the date it was issued — plus the volume of
 * hours and the trainer's name, which are also printed there. Never the
 * holder's e-mail, phone, city or user id, never the enrolment, never the final
 * score, and never `revokedReason`: the reason a certificate was annulled is a
 * matter between the centre and its holder, which is why the revoked copy sends
 * the enquirer to WhatsApp instead of publishing it.
 *
 * ## Nothing here is caught
 * Every other public read model in this codebase swallows its errors and
 * degrades to an empty list, because a marketing page must render. This one must
 * not: an outage that returned « no certificate matches this code » would be a
 * false accusation of forgery. A failed query throws, `withAction` turns it into
 * `server_error`, and the page says the check could not be run — which is the
 * truth.
 *
 * ## Zero certificates exist today
 * `Certificate` rows are written by the milestone that issues them. Until then
 * every lookup legitimately returns `{ found: false }`, and that is a working
 * feature rather than an unfinished one: the code an employer types is genuinely
 * not in the register.
 */

/** The three answers, and the only shape a caller may branch on. */
export type CertificateVerification =
  /** No certificate carries this code. Also what a malformed code returns. */
  | { readonly found: false }
  /** Issued, then annulled by the centre. Never to be reported as valid. */
  | { readonly found: true; readonly revoked: true }
  | {
      readonly found: true;
      readonly revoked: false;
      /** The code as the register stores it, not as the visitor typed it. */
      readonly code: string;
      /** The holder's name exactly as printed on the document. */
      readonly holderName: string;
      /** Course title in the requested locale, falling back to French (§10.2). */
      readonly courseTitle: string | null;
      /** ISO 8601, for the `datetime` attribute of a `<time>` element. */
      readonly issuedAt: string;
      /** The same instant written out for the requested locale, in Casablanca time. */
      readonly issuedAtLabel: string;
      /** `4 h 25 min`, or `null` when the course carries no computed duration. */
      readonly durationLabel: string | null;
      /** The trainer named on the certificate, or `null` when the course has none. */
      readonly instructorName: string | null;
    };

/** A non-empty trimmed string, or `null`. */
function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Look a certificate up by its public verification code.
 *
 * `code` must already be normalised by the caller (the server action owns that,
 * so the browser cannot decide what counts as a match). `locale` only selects
 * which language the course title and the date are rendered in — it can never
 * change whether a certificate is found or whether it is valid.
 */
export async function verifyCertificate(
  code: string,
  locale: Locale,
): Promise<CertificateVerification> {
  const row = await db.certificate.findUnique({
    where: { verifyCode: code },
    select: {
      verifyCode: true,
      issuedAt: true,
      // The one field that decides `revoked`. `revokedReason` is deliberately
      // not selected: it is internal, and code that cannot read it cannot leak it.
      revokedAt: true,
      user: { select: { fullName: true } },
      enrollment: {
        select: {
          course: {
            select: {
              durationMinutes: true,
              instructor: { select: { fullName: true } },
              translations: {
                where: { locale: { in: [locale, 'fr'] } },
                select: { locale: true, title: true },
              },
            },
          },
        },
      },
    },
  });

  if (row === null) return { found: false };

  // Checked before anything else is read, and returned without a single
  // certificate detail: an annulled document is not a document.
  if (row.revokedAt !== null) return { found: true, revoked: true };

  const { course } = row.enrollment;
  const translation =
    course.translations.find((entry) => entry.locale === locale) ??
    course.translations.find((entry) => entry.locale === 'fr') ??
    null;

  return {
    found: true,
    revoked: false,
    code: row.verifyCode,
    holderName: row.user.fullName,
    courseTitle: translation === null ? null : clean(translation.title),
    issuedAt: row.issuedAt.toISOString(),
    issuedAtLabel: formatDate(row.issuedAt, locale),
    // `durationMinutes` is a derived column that is 0 until the curriculum is
    // saved. Zero hours is not a fact worth printing on a proof of training.
    durationLabel: course.durationMinutes > 0 ? formatDuration(course.durationMinutes, locale) : null,
    instructorName: course.instructor === null ? null : clean(course.instructor.fullName),
  };
}
