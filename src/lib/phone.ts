/**
 * Moroccan-first phone parsing, with no `libphonenumber` dependency.
 *
 * The center's students type their number in every shape a Moroccan keyboard
 * allows: `0612345678`, `06 12 34 56 78`, `06-12-34-56-78`, `06.12.34.56.78`,
 * `(+212) 6 12 34 56 78`, `00212612345678`, `212612345678`. All of them must
 * land in the database as one canonical E.164 string, `+212612345678`, so that
 * "did this person already register?" is a plain equality check and the WhatsApp
 * deep link always works.
 *
 * Foreign numbers are accepted — the center has students abroad — but flagged
 * with `isMoroccan: false` so the admin queue can show a marker (spec §9.1).
 *
 * ## Moroccan numbering plan
 * A national significant number (NSN) is 9 digits:
 * - `5…` fixed line (Maroc Telecom, Orange, Inwi)
 * - `6…` and `7…` mobile
 * Written nationally with a leading trunk `0`, internationally as `+212` + NSN.
 */

/** Morocco's E.164 country calling code, without the `+`. */
export const MOROCCO_COUNTRY_CODE = '212';

/** First digit of a Moroccan NSN that we accept as a subscriber line. */
const MOROCCAN_NSN = /^[567]\d{8}$/;

/** Moroccan NSNs that identify a mobile handset — the only ones WhatsApp works with. */
const MOROCCAN_MOBILE_NSN = /^[67]\d{8}$/;

export interface ParsedPhone {
  /** Canonical storage form, e.g. `+212612345678`. This is what goes in the database. */
  readonly e164: string;
  /**
   * National dialling form without separators — `0612345678` for Morocco. For a
   * foreign number whose country code we recognise, the subscriber digits; for
   * one we do not, the full digit string.
   */
  readonly national: string;
  /** `false` marks a foreign number: valid, but surfaced to the admin (spec §9.1). */
  readonly isMoroccan: boolean;
}

/**
 * Country calling codes we can split off a foreign number, longest first so that
 * `1` never shadows `212`. This is not the full ITU list — it covers the
 * diaspora and partner countries CFI actually deals with. An unlisted code is
 * still accepted; we simply do not split it.
 */
const COUNTRY_CODES: readonly string[] = [
  // 3-digit
  '212', '213', '216', '218', '220', '221', '222', '223', '224', '225', '226',
  '227', '228', '229', '230', '231', '232', '233', '234', '235', '236', '237',
  '238', '239', '240', '241', '242', '243', '244', '245', '248', '249', '250',
  '251', '252', '253', '254', '255', '256', '257', '258', '260', '261', '262',
  '263', '264', '265', '266', '267', '268', '269', '351', '352', '353', '354',
  '355', '356', '357', '358', '359', '370', '371', '372', '373', '374', '375',
  '376', '377', '378', '380', '381', '382', '383', '385', '386', '387', '389',
  '420', '421', '423', '852', '853', '855', '856', '880', '886', '960', '961',
  '962', '963', '964', '965', '966', '967', '968', '970', '971', '972', '973',
  '974', '975', '976', '977', '992', '993', '994', '995', '996', '998',
  // 2-digit
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44',
  '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58',
  '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91',
  '92', '93', '94', '95', '98',
  // 1-digit
  '1', '7',
];

/** Longest-prefix-first, computed once. */
const SORTED_COUNTRY_CODES: readonly string[] = [...COUNTRY_CODES].sort(
  (a, b) => b.length - a.length,
);

/** Everything a human might sprinkle between digits. */
const SEPARATORS = /[\s()./-]/g;

/**
 * Parse a phone number typed by a human.
 *
 * Returns `null` for anything unusable rather than throwing, so it drops
 * straight into a Zod `superRefine` or a `react-hook-form` validator.
 *
 * A bare number starting with `0` is read as Moroccan — that is the overwhelming
 * majority of our traffic and the reason this module exists. Students abroad
 * must type their country code (`+33…`), which is what they are used to anyway.
 */
export function parsePhone(input: string): ParsedPhone | null {
  if (typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (trimmed === '') return null;

  const hasPlus = trimmed.startsWith('+');
  const stripped = (hasPlus ? trimmed.slice(1) : trimmed).replace(SEPARATORS, '');
  if (!/^\d+$/.test(stripped)) return null;

  let digits: string;

  if (hasPlus) {
    digits = stripped;
  } else if (stripped.startsWith('00')) {
    digits = stripped.slice(2);
  } else if (
    stripped.startsWith(MOROCCO_COUNTRY_CODE) &&
    stripped.length === MOROCCO_COUNTRY_CODE.length + 9
  ) {
    digits = stripped;
  } else if (stripped.startsWith('0')) {
    // National form — Moroccan by convention.
    const nsn = stripped.slice(1);
    if (!MOROCCAN_NSN.test(nsn)) return null;
    return { e164: `+${MOROCCO_COUNTRY_CODE}${nsn}`, national: `0${nsn}`, isMoroccan: true };
  } else if (MOROCCAN_NSN.test(stripped)) {
    // Nine digits with the trunk zero forgotten: `612345678`.
    return {
      e164: `+${MOROCCO_COUNTRY_CODE}${stripped}`,
      national: `0${stripped}`,
      isMoroccan: true,
    };
  } else {
    return null;
  }

  if (digits === '' || digits.startsWith('0')) return null;
  // E.164 caps the whole number at 15 digits; nothing real is shorter than 8.
  if (digits.length < 8 || digits.length > 15) return null;

  if (digits.startsWith(MOROCCO_COUNTRY_CODE)) {
    const nsn = digits.slice(MOROCCO_COUNTRY_CODE.length);
    if (!MOROCCAN_NSN.test(nsn)) return null;
    return { e164: `+${MOROCCO_COUNTRY_CODE}${nsn}`, national: `0${nsn}`, isMoroccan: true };
  }

  const countryCode = findCountryCode(digits);
  const national = countryCode === null ? digits : digits.slice(countryCode.length);
  if (national === '') return null;

  return { e164: `+${digits}`, national, isMoroccan: false };
}

function findCountryCode(digits: string): string | null {
  for (const code of SORTED_COUNTRY_CODES) {
    if (digits.startsWith(code) && digits.length > code.length) return code;
  }
  return null;
}

/** Convenience predicate for Zod `.refine()` and form validation. */
export function isValidPhone(input: string): boolean {
  return parsePhone(input) !== null;
}

/** `true` when the number is a Moroccan mobile — the only case where WhatsApp is a safe CTA. */
export function isMoroccanMobile(input: string): boolean {
  const parsed = parsePhone(input);
  if (parsed === null || !parsed.isMoroccan) return false;
  return MOROCCAN_MOBILE_NSN.test(parsed.national.slice(1));
}

/**
 * Render a stored number for reading: `+212 6 12 34 56 78`.
 *
 * Moroccan numbers get the conventional Moroccan grouping — country code, the
 * single operator digit, then four pairs. Foreign numbers whose country code we
 * recognise are grouped in pairs after the code. Anything we cannot parse is
 * returned unchanged, so a legacy or hand-edited value still renders as itself
 * instead of disappearing.
 *
 * Inside Arabic text this must be wrapped: `<span className="force-ltr" dir="ltr">`.
 */
export function formatPhoneDisplay(e164: string): string {
  const parsed = parsePhone(e164);
  if (parsed === null) return typeof e164 === 'string' ? e164 : '';

  const digits = parsed.e164.slice(1);

  if (parsed.isMoroccan) {
    const nsn = digits.slice(MOROCCO_COUNTRY_CODE.length);
    const operator = nsn.slice(0, 1);
    const pairs = chunk(nsn.slice(1), 2);
    return `+${MOROCCO_COUNTRY_CODE} ${operator} ${pairs.join(' ')}`;
  }

  const countryCode = findCountryCode(digits);
  if (countryCode === null) return `+${digits}`;

  const rest = digits.slice(countryCode.length);
  return `+${countryCode} ${chunk(rest, 2).join(' ')}`;
}

/**
 * Render a number in the national form a Moroccan expects to see on a form:
 * `06 12 34 56 78`. Foreign numbers fall back to {@link formatPhoneDisplay},
 * because a national form is meaningless without the country context.
 */
export function formatPhoneNational(e164: string): string {
  const parsed = parsePhone(e164);
  if (parsed === null) return typeof e164 === 'string' ? e164 : '';
  if (!parsed.isMoroccan) return formatPhoneDisplay(e164);
  return chunk(parsed.national, 2).join(' ');
}

/**
 * Digits only, no `+` — the form `https://wa.me/<number>` requires.
 *
 * Returns an empty string when the input cannot be parsed, so a caller can test
 * it before rendering a WhatsApp button rather than shipping a broken link.
 */
export function toWhatsAppNumber(e164: string): string {
  const parsed = parsePhone(e164);
  if (parsed === null) return '';
  return parsed.e164.slice(1);
}

/**
 * Partially hide a number for screens the owner is not authenticated on, e.g.
 * `+212 6 •• •• •• 78`. Only the operator digit and the last pair survive.
 */
export function maskPhone(e164: string): string {
  const parsed = parsePhone(e164);
  if (parsed === null) return '';

  const digits = parsed.e164.slice(1);
  const code = parsed.isMoroccan ? MOROCCO_COUNTRY_CODE : (findCountryCode(digits) ?? '');
  const rest = digits.slice(code.length);
  if (rest.length <= 3) return `+${code} ${rest}`;

  const head = rest.slice(0, 1);
  const tail = rest.slice(-2);
  const hiddenPairs = Math.max(0, Math.ceil((rest.length - 3) / 2));
  const hidden = Array.from({ length: hiddenPairs }, () => '••').join(' ');

  return `+${code} ${head}${hidden === '' ? '' : ` ${hidden}`} ${tail}`;
}

function chunk(value: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < value.length; i += size) {
    out.push(value.slice(i, i + size));
  }
  return out;
}
