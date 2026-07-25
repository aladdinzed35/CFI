/**
 * Authentication schemas — the single validation contract shared by the client
 * forms and the server actions (spec §9.1, §20).
 *
 * ## Rules this file enforces
 * - Every object is `.strict()`: an unknown key is a rejected request, not a
 *   silently ignored one (§20 "Reject unknown keys").
 * - Every message is an **i18n key**, never a rendered sentence. The client
 *   passes it through `useTranslations()`, the server through
 *   `getTranslations()`. See {@link AUTH_ERROR_KEYS} for the full list and the
 *   French source copy each key must carry.
 * - Nothing here touches the database, the network or `node:` built-ins, so the
 *   whole module is safe to bundle into a client component.
 *
 * ## Two schemas per form
 * `xxxFormSchema` validates the raw form shape and is what `zodResolver` gets.
 * `xxxSchema` adds a normalising transform (trimmed name, lower-cased e-mail,
 * E.164 phone, secrets stripped) and is what the server action parses. They
 * share their refinements, so the two layers can never disagree about what is
 * valid.
 */

import { z } from 'zod';

import { parsePhone, type ParsedPhone } from '@/lib/phone';
import { locales, type Locale } from '@/i18n/routing';

import { isDisposableDomain } from './disposable-domains';

/* -------------------------------------------------------------------------- */
/* Message keys                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every message key these schemas can emit, with the French source copy the
 * `errors` namespace must provide. Keys already present in
 * `src/i18n/messages/fr.json` are marked ✔; the rest have to be added there.
 *
 * | Key | ✔ | French source (§28.1 — vouvoiement, says what to do) |
 * |---|:-:|---|
 * | `errors.required`               | ✔ | Ce champ est obligatoire. |
 * | `errors.invalidEmail`           | ✔ | L'adresse e-mail n'est pas valide. Format attendu : nom@exemple.com. |
 * | `errors.invalidPhone`           | ✔ | Le numéro de téléphone n'est pas valide. Format attendu : 06 12 34 56 78. |
 * | `errors.weakPassword`           | ✔ | Le mot de passe est trop simple. Utilisez au moins 10 caractères, avec des lettres et des chiffres. |
 * | `errors.passwordMismatch`       | ✔ | Les deux mots de passe ne sont pas identiques. Saisissez-les à nouveau. |
 * | `errors.nameLength`             |   | Le nom complet doit contenir entre 3 et 80 caractères. |
 * | `errors.nameCharacters`         |   | Le nom ne peut contenir que des lettres, des espaces, des traits d'union et des apostrophes. |
 * | `errors.nameTwoWords`           |   | Indiquez votre prénom et votre nom, séparés par un espace. |
 * | `errors.emailTooLong`           |   | L'adresse e-mail est trop longue. Elle ne peut pas dépasser 254 caractères. |
 * | `errors.disposableEmail`        |   | Les adresses e-mail jetables ne sont pas acceptées. Utilisez votre adresse personnelle ou professionnelle. |
 * | `errors.passwordTooShort`       |   | Le mot de passe doit contenir au moins 10 caractères. |
 * | `errors.passwordTooLong`        |   | Le mot de passe ne peut pas dépasser 128 caractères. |
 * | `errors.commonPassword`         |   | Ce mot de passe fait partie des plus utilisés au monde. Choisissez-en un autre, connu de vous seul. |
 * | `errors.cityLength`             |   | La ville doit contenir entre 2 et 60 caractères. |
 * | `errors.invalidChoice`          |   | Choisissez une option dans la liste. |
 * | `errors.termsRequired`          |   | Vous devez accepter les conditions générales pour créer un compte. |
 * | `errors.submittedTooFast`       |   | Le formulaire a été envoyé trop rapidement. Prenez un instant, puis réessayez. |
 * | `errors.invalidToken`           |   | Ce lien n'est plus valide. Demandez-en un nouveau pour continuer. |
 */
export const AUTH_ERROR_KEYS = {
  required: 'errors.required',
  invalidEmail: 'errors.invalidEmail',
  invalidPhone: 'errors.invalidPhone',
  weakPassword: 'errors.weakPassword',
  passwordMismatch: 'errors.passwordMismatch',
  nameLength: 'errors.nameLength',
  nameCharacters: 'errors.nameCharacters',
  nameTwoWords: 'errors.nameTwoWords',
  emailTooLong: 'errors.emailTooLong',
  disposableEmail: 'errors.disposableEmail',
  passwordTooShort: 'errors.passwordTooShort',
  passwordTooLong: 'errors.passwordTooLong',
  commonPassword: 'errors.commonPassword',
  cityLength: 'errors.cityLength',
  invalidChoice: 'errors.invalidChoice',
  termsRequired: 'errors.termsRequired',
  submittedTooFast: 'errors.submittedTooFast',
  invalidToken: 'errors.invalidToken',
} as const;

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

export const FULL_NAME_MIN = 3;
export const FULL_NAME_MAX = 80;
/** RFC 5321: 64 octets of local part + `@` + 255 of domain, capped at 254 in practice. */
export const EMAIL_MAX = 254;
export const EMAIL_LOCAL_MAX = 64;
export const PASSWORD_MIN = 10;
/** Argon2id happily hashes megabytes; a cap keeps a submitted novel from becoming a CPU DoS. */
export const PASSWORD_MAX = 128;
export const CITY_MIN = 2;
export const CITY_MAX = 60;

/**
 * A human cannot read a nine-field form, type a name, an e-mail, a phone number
 * and a password twice in under two and a half seconds. A script can.
 */
export const MIN_FORM_FILL_MS = 2_500;
/**
 * Above this the timestamp is meaningless — a tab left open overnight, or a
 * forged value. We then simply skip the timing check rather than reject a real
 * student who went to make tea.
 */
export const MAX_FORM_AGE_MS = 12 * 60 * 60 * 1_000;

/** 64 random bytes in base64url ≈ 86 characters; the bounds stay generous. */
const TOKEN_MIN = 32;
const TOKEN_MAX = 256;

/* -------------------------------------------------------------------------- */
/* Full name                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * Character classes for a personal name, written out as explicit code-point
 * ranges rather than `\p{L}` so a reviewer can see exactly what is allowed and
 * so nothing outside these scripts (CJK, emoji, box drawing, control codes)
 * can slip into a name printed on a certificate.
 */

/** Basic Latin letters. */
const LATIN_BASIC = 'A-Za-z';
/**
 * Latin-1 Supplement letters — À-Ö, Ø-ö, ø-ÿ. The two holes are deliberate:
 * U+00D7 is `×` and U+00F7 is `÷`, which are maths operators, not letters.
 * Then Latin Extended-A and Extended-B (U+0100–U+024F) for Ā, ő, ș, ǧ, ɐ… —
 * this is what covers transliterated Amazigh and Central-European names.
 */
const LATIN_ACCENTED = '\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F';
/**
 * Arabic letters: U+0621–U+063A (ء … غ), U+0640 tatweel (the kashida used to
 * stretch a name calligraphically), U+0641–U+064A (ف … ي), U+066E–U+066F
 * (dotless bā/qāf), U+0671–U+06D3 (Arabic Supplement + Extended, which carries
 * the Persian/Urdu forms some Moroccan names are written with), U+06D5 and
 * U+06FA–U+06FC. Arabic-Indic **digits** (U+0660–U+0669) are excluded on
 * purpose: a name is not a number.
 */
const ARABIC_LETTERS = '\\u0621-\\u063A\\u0640-\\u064A\\u066E\\u066F\\u0671-\\u06D3\\u06D5\\u06FA-\\u06FC';
/**
 * Arabic combining marks: the harakat (fatha, damma, kasra, shadda, sukun…)
 * U+064B–U+0652 plus the superscript alef U+0670. They carry no width of their
 * own but a student may well paste a fully vocalised name.
 */
const ARABIC_MARKS = '\\u064B-\\u0652\\u0670';
/**
 * Separators: ASCII space, no-break space (U+00A0, produced by some Arabic
 * keyboards), apostrophe in its three real-world spellings — `'`, U+2019 the
 * typographic apostrophe Word substitutes, U+02BC the modifier letter
 * apostrophe used in Amazigh transliteration — and the hyphen in its ASCII and
 * non-breaking (U+2011) forms. The `-` sits last so it is a literal, not a range.
 */
const NAME_SEPARATORS = " \\u00A0'\\u2019\\u02BC\\u2011-";

const FULL_NAME_PATTERN = new RegExp(
  `^[${LATIN_BASIC}${LATIN_ACCENTED}${ARABIC_LETTERS}${ARABIC_MARKS}${NAME_SEPARATORS}]+$`,
  'u',
);

/** At least one character from a letter class — a name of only hyphens is not a name. */
const CONTAINS_LETTER = new RegExp(`[${LATIN_BASIC}${LATIN_ACCENTED}${ARABIC_LETTERS}]`, 'u');

/** Any run of whitespace — `\s` already covers the no-break space and its cousins. */
const WHITESPACE_RUN = /\s+/gu;

/**
 * Trim, collapse internal whitespace, and normalise to NFC so that `é` typed as
 * `e` + combining acute compares equal to `é` typed directly — otherwise the
 * duplicate detection in §17.2 would miss half its matches.
 */
export function normalizeFullName(value: string): string {
  return value.normalize('NFC').trim().replace(WHITESPACE_RUN, ' ');
}

/** The words of a name, after normalisation. */
function nameWords(value: string): string[] {
  return normalizeFullName(value).split(' ').filter((word) => word !== '');
}

export const fullNameSchema = z
  .string({ required_error: AUTH_ERROR_KEYS.required, invalid_type_error: AUTH_ERROR_KEYS.required })
  .superRefine((value, ctx) => {
    const normalized = normalizeFullName(value);

    if (normalized.length < FULL_NAME_MIN || normalized.length > FULL_NAME_MAX) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_ERROR_KEYS.nameLength });
      return;
    }

    if (!FULL_NAME_PATTERN.test(normalized) || !CONTAINS_LETTER.test(normalized)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_ERROR_KEYS.nameCharacters });
      return;
    }

    const words = nameWords(normalized);
    if (words.length < 2 || !words.every((word) => CONTAINS_LETTER.test(word))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_ERROR_KEYS.nameTwoWords });
    }
  });

/* -------------------------------------------------------------------------- */
/* E-mail                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * RFC-ish, deliberately not RFC-complete. The full grammar accepts quoted local
 * parts and bracketed IP domains that no student will ever own and that only
 * widen the attack surface. This requires: a local part of printable characters
 * without `@` or whitespace, no leading/trailing/doubled dot, an `@`, then a
 * domain of at least two labels whose last label is alphabetic.
 */
const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/u;

/** Lower-case and trim. Domains are case-insensitive and nobody means `JEAN@…` literally. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const emailSchema = z
  .string({ required_error: AUTH_ERROR_KEYS.required, invalid_type_error: AUTH_ERROR_KEYS.required })
  .superRefine((value, ctx) => {
    const normalized = normalizeEmail(value);

    if (normalized === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_ERROR_KEYS.required });
      return;
    }

    if (normalized.length > EMAIL_MAX) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_ERROR_KEYS.emailTooLong });
      return;
    }

    const at = normalized.lastIndexOf('@');
    if (!EMAIL_PATTERN.test(normalized) || at > EMAIL_LOCAL_MAX) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_ERROR_KEYS.invalidEmail });
      return;
    }

    if (isDisposableDomain(normalized)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_ERROR_KEYS.disposableEmail });
    }
  })
  .transform(normalizeEmail);

/* -------------------------------------------------------------------------- */
/* Phone                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Accepts every Moroccan spelling and any foreign number in international form.
 * A non-Moroccan number is **valid** — the center has students abroad — and is
 * surfaced to the admin through `ParsedPhone.isMoroccan` (§9.1, §17.2), never
 * rejected here.
 */
export const phoneSchema = z
  .string({ required_error: AUTH_ERROR_KEYS.required, invalid_type_error: AUTH_ERROR_KEYS.required })
  .refine((value) => parsePhone(value) !== null, { message: AUTH_ERROR_KEYS.invalidPhone });

/** Parse a value the schema has already accepted. Throws only on a programming error. */
function parseAcceptedPhone(value: string): ParsedPhone {
  const parsed = parsePhone(value);
  if (parsed === null) {
    throw new Error('parseAcceptedPhone called on a value phoneSchema rejected');
  }
  return parsed;
}

/* -------------------------------------------------------------------------- */
/* Password                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Bundled weak-password list (spec §9.1 "checked against a bundled weak list").
 *
 * The full top-1000 lists in circulation are dominated by six-to-eight character
 * strings that our own length and composition rules already reject. What is
 * bundled here is therefore the useful residue: the passwords people actually
 * pick **once a site demands ten characters, letters and digits** — a common
 * word with `123` glued on, a keyboard walk, a French or Arabic-transliterated
 * favourite. Comparison is case-insensitive and ignores surrounding whitespace.
 *
 * Never mutate this set at runtime: §17.12 exposes a separate, additive policy
 * setting for that.
 */
export const WEAK_PASSWORDS: ReadonlySet<string> = new Set([
  '000000000000', '010203040506', '0123456789', '01234567890', '111111111',
  '1111111111', '112233445566', '1122334455', '1212121212', '123123123',
  '1231231234', '123321123321', '123456789', '1234567890', '12345678901',
  '123456789012', '1234567890a', '123456789a', '123456789abc', '123456abcdef',
  '1234abcdefg', '147258369', '1q2w3e4r5t', '1q2w3e4r5t6y', '1qaz2wsx3edc',
  '20202020', '2020202020', '654321654321', '741852963', '789456123',
  '987654321', '9876543210', 'a1234567890', 'aaaaaaaaaa1', 'abc123456789',
  'abcd12345678', 'abcdefgh123', 'abcdefghij1', 'admin1234567', 'admin123456',
  'administrator1', 'alexandre123', 'algerie2024', 'alhamdulillah1', 'allah12345',
  'amine123456', 'anthony1234', 'azerty123456', 'azertyuiop1', 'azertyuiop123',
  'barcelona10', 'baseball123', 'basketball1', 'batman12345', 'bismillah1',
  'bonjour1234', 'casablanca1', 'casablanca123', 'casablanca2024', 'changeme123',
  'charlie1234', 'chelsea1234', 'chocolat123', 'computer123', 'cristiano7',
  'dragon12345', 'facebook123', 'family12345', 'fatima12345', 'football123',
  'formation123', 'france12345', 'freedom1234', 'friends1234', 'internet123',
  'iloveyou123', 'iloveyou1234', 'jennifer123', 'jesuschrist1', 'jordan12345',
  'julie123456', 'liverpool123', 'liverpool1', 'login123456', 'maghreb2024',
  'mahmoud1234', 'manchester1', 'marhaba1234', 'marrakech1', 'marrakech123',
  'martine1234', 'maroc123456', 'maroc2024', 'maroc2025', 'maroc2026',
  'mohamed1234', 'mohamed123456', 'monkey12345', 'motdepasse1', 'motdepasse12',
  'motdepasse123', 'motdepasse2024', 'mustapha123', 'nicolas1234', 'orange1234',
  'p@ssw0rd123', 'passer1234', 'password01', 'password100', 'password111',
  'password123', 'password1234', 'password12345', 'password2024', 'password2025',
  'password2026', 'passw0rd123', 'passwordpassword', 'princess123', 'printemps2024',
  'qawsedrftg', 'qwerty12345', 'qwerty123456', 'qwertyuiop1', 'qwertyuiop123',
  'rabat123456', 'rachid12345', 'ramadan2024', 'ramadan2025', 'randompassword1',
  'realmadrid1', 'realmadrid123', 'sabrina1234', 'salamalaykum1', 'samsung1234',
  'secret12345', 'soleil12345', 'sophie12345', 'starwars123', 'sunshine123',
  'superman123', 'telephone123', 'temporaire1', 'test12345678', 'testtest123',
  'thomas12345', 'trustno1234', 'utilisateur1', 'welcome1234', 'welcome12345',
  'whatever123', 'williams123', 'yasmine1234', 'youssef1234', 'zaq12wsxcde3',
  'zxcvbnm1234', 'zxcvbnm12345',
]);

const CONTAINS_LATIN_LETTER = /[A-Za-z]/u;
const CONTAINS_DIGIT = /[0-9]/u;

/**
 * `true` when the password is on the bundled weak list.
 *
 * Compared after trimming and lower-casing, because `Password123 ` and
 * `password123` are the same guess to an attacker running a dictionary.
 */
export function isWeakPassword(value: string): boolean {
  return WEAK_PASSWORDS.has(value.trim().toLowerCase());
}

/**
 * §9.1: ten characters, letters **and** digits, checked against the weak list.
 * No forced special characters — the "special-character theatre" the spec calls
 * out pushes people towards `Password1!` and a sticky note.
 *
 * The password is never trimmed: a leading space is a legitimate character and
 * silently removing it would lock the owner out at the next login.
 */
export const passwordSchema = z
  .string({ required_error: AUTH_ERROR_KEYS.required, invalid_type_error: AUTH_ERROR_KEYS.required })
  .superRefine((value, ctx) => {
    if (value.length < PASSWORD_MIN) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_ERROR_KEYS.passwordTooShort });
      return;
    }

    if (value.length > PASSWORD_MAX) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_ERROR_KEYS.passwordTooLong });
      return;
    }

    // `errors.weakPassword` already reads « … au moins 10 caractères, avec des
    // lettres et des chiffres », which is exactly the rule that was broken here.
    if (!CONTAINS_LATIN_LETTER.test(value) || !CONTAINS_DIGIT.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_ERROR_KEYS.weakPassword });
      return;
    }

    if (isWeakPassword(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AUTH_ERROR_KEYS.commonPassword });
    }
  });

/* -------------------------------------------------------------------------- */
/* Optional profile fields                                                     */
/* -------------------------------------------------------------------------- */

/**
 * An untouched optional input arrives as `''`; that means "not provided".
 *
 * These schemas deliberately avoid `z.preprocess`, which erases the input type
 * to `unknown` and would leave the registration form's `zodResolver` untyped.
 * `.optional().transform()` keeps `string | undefined` on the way in.
 */
function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export const citySchema = z
  .string()
  .optional()
  .transform(emptyToUndefined)
  .refine(
    (value) => value === undefined || (value.length >= CITY_MIN && value.length <= CITY_MAX),
    { message: AUTH_ERROR_KEYS.cityLength },
  );

/**
 * Values stored in `User.professionalStatus`. Codes, not French labels: the
 * select renders `auth.professionalStatus.<code>` through next-intl, so the same
 * row reads correctly in all four locales (§10.2).
 */
export const PROFESSIONAL_STATUSES = [
  'ETUDIANT',
  'SALARIE',
  'INDEPENDANT',
  'FONCTIONNAIRE',
  'EN_RECHERCHE',
  'AUTRE',
] as const;

export type ProfessionalStatus = (typeof PROFESSIONAL_STATUSES)[number];

export const professionalStatusSchema = z
  .string()
  .optional()
  .transform(emptyToUndefined)
  .pipe(z.enum(PROFESSIONAL_STATUSES, { message: AUTH_ERROR_KEYS.invalidChoice }).optional());

/** One of the four locales the platform ships (§10.1). */
export const localeSchema = z.enum(locales, { message: AUTH_ERROR_KEYS.invalidChoice });

/* -------------------------------------------------------------------------- */
/* Bot traps                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Honeypot. Rendered off-screen with `aria-hidden`, `tabIndex={-1}` and
 * `autoComplete="off"`; a human never sees it, a form-filling bot fills it.
 * Any non-empty value fails the same way an invalid field would — we do not
 * tell the bot which trap it hit.
 */
export const honeypotSchema = z
  .string()
  .optional()
  .transform((value) => value ?? '')
  .refine((value) => value.trim() === '', { message: AUTH_ERROR_KEYS.submittedTooFast });

/**
 * Timestamp (epoch milliseconds) written into a hidden field when the form is
 * rendered. Together with {@link MIN_FORM_FILL_MS} it rejects instant submits.
 *
 * A missing, future, or very old timestamp disables the check rather than
 * failing it: an honest student with a slow clock or a long-open tab must still
 * be able to register. The rate limiter is the backstop that a bot cannot talk
 * its way out of.
 */
export const formLoadedAtSchema = z
  .union([z.number(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === '') return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return undefined;
    return Math.trunc(parsed);
  });

/** `true` when the elapsed time proves the form was submitted by a script. */
export function submittedTooFast(formLoadedAt: number | undefined, now: number = Date.now()): boolean {
  if (formLoadedAt === undefined || formLoadedAt === 0) return false;
  const elapsed = now - formLoadedAt;
  if (elapsed < 0 || elapsed > MAX_FORM_AGE_MS) return false;
  return elapsed < MIN_FORM_FILL_MS;
}

function refineBotTraps(
  value: { readonly website: string; readonly formLoadedAt?: number | undefined },
  ctx: z.RefinementCtx,
): void {
  if (submittedTooFast(value.formLoadedAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['formLoadedAt'],
      message: AUTH_ERROR_KEYS.submittedTooFast,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

const registerObject = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    passwordConfirm: z.string({ required_error: AUTH_ERROR_KEYS.required }),
    city: citySchema,
    professionalStatus: professionalStatusSchema,
    preferredLocale: localeSchema,
    /** Must be literally `true` — an unchecked box is a refusal (§9.1). */
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: AUTH_ERROR_KEYS.termsRequired }),
    }),
    website: honeypotSchema,
    formLoadedAt: formLoadedAtSchema,
  })
  .strict();

function refineRegister(value: z.output<typeof registerObject>, ctx: z.RefinementCtx): void {
  if (value.password !== value.passwordConfirm) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['passwordConfirm'],
      message: AUTH_ERROR_KEYS.passwordMismatch,
    });
  }
  refineBotTraps(value, ctx);
}

/** What `zodResolver` validates in the registration form — raw field shape. */
export const registerFormSchema = registerObject.superRefine(refineRegister);

/**
 * What the server action parses. Same rules, plus normalisation: the confirm
 * copy, the honeypot and the timing field have done their job and are dropped,
 * so nothing downstream can accidentally persist them.
 */
export const registerSchema = registerFormSchema.transform((value) => ({
  fullName: normalizeFullName(value.fullName),
  email: value.email,
  phone: parseAcceptedPhone(value.phone),
  password: value.password,
  city: value.city,
  professionalStatus: value.professionalStatus,
  preferredLocale: value.preferredLocale,
}));

/** Raw form values, before normalisation — the type a `<form>` produces. */
export type RegisterInput = z.input<typeof registerSchema>;
/** Normalised values, the type a service consumes. */
export type RegisterValues = z.output<typeof registerSchema>;

/* -------------------------------------------------------------------------- */
/* Login                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Login validates *shape only*. It must never apply the password policy: telling
 * a caller their input is "too short" before checking it would leak that the
 * policy changed, and a legacy password that predates a policy change must still
 * let its owner in. Wrong credentials always produce one generic error (§20).
 */
const loginObject = z
  .object({
    email: emailSchema,
    password: z
      .string({ required_error: AUTH_ERROR_KEYS.required })
      .min(1, { message: AUTH_ERROR_KEYS.required })
      .max(PASSWORD_MAX, { message: AUTH_ERROR_KEYS.passwordTooLong }),
    // A checkbox posts `'on'` or nothing. `z.coerce.boolean()` would read the
    // string `'false'` as `true`, so the mapping is written out explicitly.
    rememberMe: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((value) => value === true || value === 'on' || value === 'true'),
    website: honeypotSchema,
    formLoadedAt: formLoadedAtSchema,
  })
  .strict();

export const loginFormSchema = loginObject;
export const loginSchema = loginObject.transform((value) => ({
  email: value.email,
  password: value.password,
  rememberMe: value.rememberMe,
}));

export type LoginInput = z.input<typeof loginSchema>;
export type LoginValues = z.output<typeof loginSchema>;

/* -------------------------------------------------------------------------- */
/* Password reset                                                              */
/* -------------------------------------------------------------------------- */

const requestPasswordResetObject = z
  .object({
    email: emailSchema,
    website: honeypotSchema,
    formLoadedAt: formLoadedAtSchema,
  })
  .strict();

export const requestPasswordResetFormSchema =
  requestPasswordResetObject.superRefine(refineBotTraps);

export const requestPasswordResetSchema = requestPasswordResetFormSchema.transform((value) => ({
  email: value.email,
}));

export type RequestPasswordResetInput = z.input<typeof requestPasswordResetSchema>;
export type RequestPasswordResetValues = z.output<typeof requestPasswordResetSchema>;

/** The raw token from the e-mail link. Only its SHA-256 hash exists server-side. */
export const tokenSchema = z
  .string({ required_error: AUTH_ERROR_KEYS.invalidToken })
  .trim()
  .min(TOKEN_MIN, { message: AUTH_ERROR_KEYS.invalidToken })
  .max(TOKEN_MAX, { message: AUTH_ERROR_KEYS.invalidToken })
  // base64url alphabet, matching `generateToken` in `@/lib/crypto`.
  .regex(/^[A-Za-z0-9_-]+$/u, { message: AUTH_ERROR_KEYS.invalidToken });

const resetPasswordObject = z
  .object({
    token: tokenSchema,
    password: passwordSchema,
    passwordConfirm: z.string({ required_error: AUTH_ERROR_KEYS.required }),
  })
  .strict();

export const resetPasswordFormSchema = resetPasswordObject.superRefine((value, ctx) => {
  if (value.password !== value.passwordConfirm) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['passwordConfirm'],
      message: AUTH_ERROR_KEYS.passwordMismatch,
    });
  }
});

export const resetPasswordSchema = resetPasswordFormSchema.transform((value) => ({
  token: value.token,
  password: value.password,
}));

export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;
export type ResetPasswordValues = z.output<typeof resetPasswordSchema>;

/* -------------------------------------------------------------------------- */
/* E-mail verification                                                         */
/* -------------------------------------------------------------------------- */

/** The link target: `/[locale]/verification-email/[token]`. */
export const verifyEmailSchema = z.object({ token: tokenSchema }).strict();

export type VerifyEmailValues = z.output<typeof verifyEmailSchema>;

const resendVerificationObject = z
  .object({
    email: emailSchema,
    website: honeypotSchema,
    formLoadedAt: formLoadedAtSchema,
  })
  .strict();

export const resendVerificationFormSchema = resendVerificationObject.superRefine(refineBotTraps);

export const resendVerificationSchema = resendVerificationFormSchema.transform((value) => ({
  email: value.email,
}));

export type ResendVerificationInput = z.input<typeof resendVerificationSchema>;
export type ResendVerificationValues = z.output<typeof resendVerificationSchema>;

/* -------------------------------------------------------------------------- */
/* Display helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Mask an address for a screen the owner is not authenticated on — the
 * `/[locale]/verification-email?email=masked` redirect in §9.1.
 *
 * `youssef.benali@gmail.com` → `y•••••••••••i@gmail.com`. Enough for the student
 * to recognise their own address, useless to anyone reading over their shoulder
 * or fishing through a server log.
 */
export function maskEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  if (at <= 0) return '';

  const local = normalized.slice(0, at);
  const domain = normalized.slice(at);

  if (local.length <= 2) return `${local.slice(0, 1)}•${domain}`;

  const first = local.slice(0, 1);
  const last = local.slice(-1);
  return `${first}${'•'.repeat(local.length - 2)}${last}${domain}`;
}

/** Narrow an unknown value (a query param, a database column) to a `Locale`. */
export function toLocale(value: unknown, fallback: Locale = 'fr'): Locale {
  const parsed = localeSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}
