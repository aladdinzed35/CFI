/**
 * The rejection-reason codec — a LEAF module, deliberately.
 *
 * This used to live in `moderation.ts`, which `queries.ts` imported for
 * `parseRejectionReason`. That closed an import cycle through the accounts
 * services, and under webpack the binding resolved to `undefined` at runtime:
 * the admin review drawer threw `parseRejectionReason is not a function` and
 * the whole accounts page answered 500. TypeScript could not see it — a cycle
 * is perfectly well-typed — and neither could lint or the build, because the
 * page only breaks when a reviewer actually opens a record.
 *
 * Nothing here may import from another `accounts/*` module. It is pure data
 * plus two pure functions, so it can sit at the bottom of the graph and be
 * imported by anyone.
 */

/**
 * The four reasons the review drawer offers. Codes, not French labels: the
 * student's rejection e-mail is written in *their* locale, so the reason has to
 * survive as data (§10.2).
 *
 * `INCOMPLETE_INFO` → « Informations incomplètes »
 * `DUPLICATE`       → « Doublon »
 * `INVALID_PHONE`   → « Numéro invalide »
 * `OTHER`           → « Autre », which is why free text is mandatory with it.
 */
export const REJECTION_REASON_CODES = [
  'INCOMPLETE_INFO',
  'DUPLICATE',
  'INVALID_PHONE',
  'OTHER',
] as const;

export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

export interface RejectionReason {
  readonly code: RejectionReasonCode;
  /** Free text. Required for `OTHER`, optional and additive for the others. */
  readonly details: string | null;
}

export const REJECTION_DETAILS_MIN = 5;
export const REJECTION_DETAILS_MAX = 1_000;

/**
 * `User.rejectionReason` is a single TEXT column but the reason is two fields, so
 * it is stored as compact JSON. {@link parseRejectionReason} reads it back and
 * tolerates a legacy plain string, which it reports as `OTHER` + details.
 */
export function serializeRejectionReason(reason: RejectionReason): string {
  return JSON.stringify({ code: reason.code, details: reason.details });
}

export function parseRejectionReason(raw: string | null): RejectionReason | null {
  if (raw === null || raw.trim() === '') return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const code = record.code;
      if (typeof code === 'string' && (REJECTION_REASON_CODES as readonly string[]).includes(code)) {
        const details = record.details;
        return {
          code: code as RejectionReasonCode,
          details: typeof details === 'string' && details.trim() !== '' ? details : null,
        };
      }
    }
  } catch {
    // Not JSON — fall through to the legacy interpretation.
  }

  return { code: 'OTHER', details: raw };
}
