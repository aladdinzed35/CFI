import { z } from 'zod';

import { MAX_FORM_AGE_MS, MIN_FORM_FILL_MS, normalizeEmail, normalizeFullName } from './auth';
import { isSlug } from '@/lib/slug';
import { locales } from '@/i18n/routing';
import { parsePhone } from '@/lib/phone';

/**
 * The contact form's shared contract (§12.5).
 *
 * One schema, imported by both sides: the client resolves it through
 * `zodResolver` so a mistake is caught before a round trip, and the server
 * action passes the *same* object to `withAction`, which is the only validation
 * that is actually trusted. Duplicating the rules in the component would let the
 * two drift, and the one that drifts is always the server.
 *
 * ## The messages are tokens, not sentences
 * Every `message` below is a short discriminant — `'fullName'`,
 * `'messageTooShort'` — that the form maps to a translated sentence through an
 * exhaustive `switch`. Rule 5: the server never composes user-facing copy, and
 * a `switch` over a closed union keeps every `t()` call a literal, which is what
 * `scripts/check-i18n-usage.ts` can actually verify.
 *
 * ## What is deliberately NOT checked
 * Disposable e-mail domains are rejected at registration and accepted here. A
 * prospect asking a question before they trust us with a real address is a
 * prospect, not an abuser; the honeypot, the fill-time check and the per-IP rate
 * limit are what stop scripts.
 */

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

export const CONTACT_NAME_MIN = 3;
export const CONTACT_NAME_MAX = 80;
export const CONTACT_EMAIL_MAX = 254;
/** Below this a "message" is a greeting, and we cannot answer it usefully. */
export const CONTACT_MESSAGE_MIN = 20;
export const CONTACT_MESSAGE_MAX = 2_000;
/** `Course.slug`, or the empty string for « je ne sais pas encore ». */
export const CONTACT_SLUG_MAX = 120;

/* -------------------------------------------------------------------------- */
/* Error tokens                                                                */
/* -------------------------------------------------------------------------- */

export const CONTACT_ERRORS = {
  fullName: 'fullName',
  email: 'email',
  phone: 'phone',
  messageRequired: 'messageRequired',
  messageTooShort: 'messageTooShort',
  messageTooLong: 'messageTooLong',
  bot: 'bot',
  invalid: 'invalid',
} as const;

export type ContactErrorToken = (typeof CONTACT_ERRORS)[keyof typeof CONTACT_ERRORS];

/** Narrow an arbitrary server-sent string back to a token the form can translate. */
export function isContactErrorToken(value: unknown): value is ContactErrorToken {
  return (
    typeof value === 'string' &&
    (Object.values(CONTACT_ERRORS) as readonly string[]).includes(value)
  );
}

/* -------------------------------------------------------------------------- */
/* Fields                                                                      */
/* -------------------------------------------------------------------------- */

const fullName = z
  .string({ required_error: CONTACT_ERRORS.fullName, invalid_type_error: CONTACT_ERRORS.fullName })
  .transform(normalizeFullName)
  .refine(
    (value) => value.length >= CONTACT_NAME_MIN && value.length <= CONTACT_NAME_MAX,
    { message: CONTACT_ERRORS.fullName },
  );

const email = z
  .string({ required_error: CONTACT_ERRORS.email, invalid_type_error: CONTACT_ERRORS.email })
  .transform(normalizeEmail)
  .refine((value) => value.length > 0 && value.length <= CONTACT_EMAIL_MAX, {
    message: CONTACT_ERRORS.email,
  })
  // Deliberately permissive: one `@`, a dot in the domain, no spaces. Anything
  // stricter rejects valid addresses, and the only real proof is a reply.
  .refine((value) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value), {
    message: CONTACT_ERRORS.email,
  });

/**
 * Optional. An empty string means "not given" and becomes `undefined`; anything
 * else must parse as a real number, and is stored in E.164.
 */
const phone = z
  .string()
  .optional()
  .transform((value) => (value ?? '').trim())
  .refine((value) => value === '' || parsePhone(value) !== null, {
    message: CONTACT_ERRORS.phone,
  })
  .transform((value) => (value === '' ? undefined : (parsePhone(value)?.e164 ?? undefined)));

/**
 * The slug of the course the visitor picked. Unknown or unpublished slugs are
 * dropped by the action rather than rejected here: the catalogue can change
 * between the render and the submit, and losing a real message over that would
 * be a self-inflicted wound.
 */
const courseSlug = z
  .string()
  .optional()
  .transform((value) => (value ?? '').trim())
  .refine((value) => value === '' || (value.length <= CONTACT_SLUG_MAX && isSlug(value)), {
    message: CONTACT_ERRORS.invalid,
  })
  .transform((value) => (value === '' ? undefined : value));

const message = z
  .string({
    required_error: CONTACT_ERRORS.messageRequired,
    invalid_type_error: CONTACT_ERRORS.messageRequired,
  })
  .transform((value) => value.trim())
  .superRefine((value, ctx) => {
    if (value.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: CONTACT_ERRORS.messageRequired });
      return;
    }
    if (value.length < CONTACT_MESSAGE_MIN) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: CONTACT_ERRORS.messageTooShort });
      return;
    }
    if (value.length > CONTACT_MESSAGE_MAX) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: CONTACT_ERRORS.messageTooLong });
    }
  });

const locale = z.enum(locales, { message: CONTACT_ERRORS.invalid });

/** Off-screen, `aria-hidden`, out of the tab order. Any value at all is a bot. */
const honeypot = z
  .string()
  .optional()
  .transform((value) => value ?? '')
  .refine((value) => value.trim() === '', { message: CONTACT_ERRORS.bot });

/** Epoch milliseconds written when the form rendered. Missing → check skipped. */
const formLoadedAt = z
  .union([z.number(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === '') return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return undefined;
    return Math.trunc(parsed);
  });

/** `true` when the elapsed time proves the form was filled by a script. */
export function contactSubmittedTooFast(
  loadedAt: number | undefined,
  now: number = Date.now(),
): boolean {
  if (loadedAt === undefined || loadedAt === 0) return false;
  const elapsed = now - loadedAt;
  // A negative or very large delta means a wrong clock or a tab left open
  // overnight — skip the check rather than punish an honest visitor.
  if (elapsed < 0 || elapsed > MAX_FORM_AGE_MS) return false;
  return elapsed < MIN_FORM_FILL_MS;
}

/* -------------------------------------------------------------------------- */
/* The schema                                                                  */
/* -------------------------------------------------------------------------- */

const contactObject = z
  .object({
    fullName,
    email,
    phone,
    courseSlug,
    message,
    locale,
    website: honeypot,
    formLoadedAt,
  })
  .strict();

export const contactSchema = contactObject.superRefine((value, ctx) => {
  if (contactSubmittedTooFast(value.formLoadedAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['formLoadedAt'],
      message: CONTACT_ERRORS.bot,
    });
  }
});

export type ContactInput = z.input<typeof contactSchema>;
export type ContactValues = z.output<typeof contactSchema>;
