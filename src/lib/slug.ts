/**
 * URL slugs.
 *
 * Slugs stay **French for every locale** (spec §10.1): `/ar/formations/comptabilite-generale`
 * and `/fr/formations/comptabilite-generale` are the same path with a different
 * locale prefix. One canonical slug per entity means one set of database lookups,
 * one set of redirects, and no risk of an Arabic slug percent-encoding into an
 * unreadable URL that breaks when shared on WhatsApp.
 *
 * The Arabic transliteration below therefore exists for the case where an
 * instructor titles a course in Arabic and no French title is available yet: we
 * still produce a readable Latin slug instead of an empty string.
 */

/** Hard cap on slug length; matches the `@db.VarChar` width used for slug columns. */
export const MAX_SLUG_LENGTH = 80;

/** Slug shape guarantee: lowercase alphanumerics separated by single hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Arabic letter to Latin. Deliberately lossy and pronunciation-oriented rather
 * than a scholarly transliteration: the goal is a URL a Moroccan can read aloud,
 * not a reversible encoding. Emphatic consonants collapse onto their plain
 * counterparts (sad to `s`, dad to `d`) because URLs have no diacritics.
 */
const ARABIC_TRANSLITERATION: Readonly<Record<string, string>> = {
  'ا': 'a', // alif
  'أ': 'a', // alif hamza above
  'إ': 'i', // alif hamza below
  'آ': 'a', // alif madda
  'ٱ': 'a', // alif wasla
  'ب': 'b',
  'ت': 't',
  'ث': 'th',
  'ج': 'j',
  'ح': 'h',
  'خ': 'kh',
  'د': 'd',
  'ذ': 'dh',
  'ر': 'r',
  'ز': 'z',
  'س': 's',
  'ش': 'ch',
  'ص': 's',
  'ض': 'd',
  'ط': 't',
  'ظ': 'z',
  'ع': 'a', // ayn
  'غ': 'gh',
  'ف': 'f',
  'ق': 'q',
  'ك': 'k',
  'ل': 'l',
  'م': 'm',
  'ن': 'n',
  'ه': 'h',
  'و': 'w',
  'ي': 'y',
  'ى': 'a', // alif maqsura
  'ة': 'a', // ta marbuta
  'ء': '', // hamza
  'ئ': 'e', // ya hamza
  'ؤ': 'o', // waw hamza
  // Maghrebi / Persian letters that show up in Moroccan Arabic and loanwords.
  'پ': 'p',
  'چ': 'ch',
  'ژ': 'j',
  'گ': 'g',
  'ڤ': 'v',
  'ڢ': 'f',
  'ڨ': 'g',
  // Arabic-Indic digits.
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  // Extended (Eastern) Arabic-Indic digits.
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

/**
 * Latin characters and symbols that Unicode normalisation cannot decompose into
 * base + combining mark, so they need an explicit mapping.
 */
const LATIN_TRANSLITERATION: Readonly<Record<string, string>> = {
  'æ': 'ae', // ae
  'œ': 'oe', // oe
  'ß': 'ss', // eszett
  'ø': 'o',
  'đ': 'd',
  'ð': 'd',
  'ł': 'l',
  'þ': 'th',
  'ħ': 'h',
  'ı': 'i',
  'ŋ': 'n',
  '€': 'eur', // euro sign
  '&': ' et ',
  '@': ' at ',
  '%': ' pourcent ',
};

/** Arabic tatweel: a letter-stretching glyph with no phonetic value. */
const TATWEEL = /ـ/g;

/**
 * Build a URL-safe slug from arbitrary text.
 *
 * - French accents are stripped (`é` to `e`, `ç` to `c`, `ï` to `i`).
 * - Arabic diacritics (tashkeel, shadda, tatweel) are removed and letters
 *   transliterated to Latin.
 * - Everything outside `[a-z0-9]` collapses to a single hyphen.
 * - The result is trimmed to {@link MAX_SLUG_LENGTH} characters on a word
 *   boundary where possible, so a truncated slug never ends mid-syllable.
 *
 * Always returns a string; text with no usable characters yields `''`, which the
 * caller must handle (fall back to the entity id) rather than persisting.
 *
 * `slugify` is idempotent: `slugify(slugify(x)) === slugify(x)`.
 */
export function slugify(input: string): string {
  if (typeof input !== 'string' || input === '') return '';

  // NFKD also unpacks Arabic presentation forms and full-width Latin.
  const decomposed = input.normalize('NFKD');

  let mapped = '';
  for (const char of decomposed) {
    const arabic = ARABIC_TRANSLITERATION[char];
    if (arabic !== undefined) {
      mapped += arabic;
      continue;
    }
    const latin = LATIN_TRANSLITERATION[char.toLowerCase()];
    if (latin !== undefined) {
      mapped += latin;
      continue;
    }
    mapped += char;
  }

  const withoutMarks = mapped
    // Combining marks: French accents left over from NFKD *and* Arabic tashkeel.
    .replace(/\p{M}+/gu, '')
    .replace(TATWEEL, '')
    .toLowerCase();

  const hyphenated = withoutMarks
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return truncateSlug(hyphenated, MAX_SLUG_LENGTH);
}

/** Cut a slug to `maxLength`, preferring a hyphen boundary, never leaving a trailing hyphen. */
function truncateSlug(slug: string, maxLength: number): string {
  const cut = slug.length <= maxLength ? slug : slug.slice(0, maxLength);
  if (cut.length < slug.length) {
    const lastHyphen = cut.lastIndexOf('-');
    // Prefer a clean word boundary, but not at the cost of losing most of the slug.
    if (lastHyphen > maxLength / 2) return cut.slice(0, lastHyphen).replace(/-+$/, '');
  }
  return cut.replace(/-+$/, '');
}

/** `true` when a value is already a well-formed slug — usable directly in Zod `.refine()`. */
export function isSlug(value: string): boolean {
  return typeof value === 'string' && value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value);
}

/**
 * Produce a slug that does not collide with any slug already in use, appending
 * `-2`, `-3`, … as needed. The suffix budget is taken out of the base, so the
 * result always respects {@link MAX_SLUG_LENGTH}.
 *
 * `existing` is the set of slugs taken *by other rows* — when renaming an entity,
 * exclude its own current slug so an unchanged title does not drift to `-2`.
 *
 * ```ts
 * uniqueSlug('Comptabilité générale', ['comptabilite-generale']) // 'comptabilite-generale-2'
 * ```
 *
 * Returns `''` when the base slugifies to nothing — the caller decides on the
 * fallback. This is advisory only: the database unique constraint remains the
 * real guarantee, and a caller that loses a race must retry.
 */
export function uniqueSlug(base: string, existing: Set<string> | readonly string[]): string {
  const taken = existing instanceof Set ? existing : new Set(existing);
  const root = slugify(base);
  if (root === '') return '';
  if (!taken.has(root)) return root;

  // Bounded by construction: at most `taken.size` candidates can already be occupied.
  const ceiling = taken.size + 2;
  for (let suffix = 2; suffix <= ceiling; suffix += 1) {
    const tail = `-${suffix}`;
    const head = truncateSlug(root, MAX_SLUG_LENGTH - tail.length);
    const candidate = `${head === '' ? root.slice(0, 1) : head}${tail}`;
    if (!taken.has(candidate)) return candidate;
  }

  // Unreachable with a consistent `existing`, but keeps the function total.
  const tail = `-${ceiling + 1}`;
  return `${truncateSlug(root, MAX_SLUG_LENGTH - tail.length)}${tail}`;
}
