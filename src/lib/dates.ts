import { formatDistance, type Locale as DateFnsLocale } from 'date-fns';
import { arMA, enGB, es, fr } from 'date-fns/locale';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

import type { Locale } from '@/i18n/routing';

/**
 * Dates, times and durations — always in the center's timezone.
 *
 * ## One timezone, everywhere
 * The server may run in UTC, an admin may be travelling, a student may have a
 * misconfigured phone. None of that may change what "12 mars" means: a transfer
 * declared on the 12th must read as the 12th on the receipt, in the admin queue,
 * on the invoice and in the audit log.
 *
 * So every value is stored as a UTC instant and rendered in `Africa/Casablanca`.
 * Morocco sits at UTC+1 year-round but drops to UTC+0 for the month of Ramadan —
 * a rule no hand-rolled offset survives, which is exactly why every function here
 * goes through the IANA database via `date-fns-tz` rather than adding hours.
 *
 * ## Conventions (spec §28.1)
 * - prose date: `12 mars 2026`
 * - dense table date: `12/03/2026`
 * - time: `14 h 30` in French, `14:30` elsewhere (Morocco reads 24-hour clocks)
 * - duration: `4 h 25 min`
 *
 * Every formatter is total: an unparseable input returns `''` rather than
 * `Invalid Date`, because a broken timestamp must never break a page render.
 */

/** The center's timezone. The only one this application ever displays. */
export const CASABLANCA_TZ = 'Africa/Casablanca';

/** Anything a caller might reasonably hold: a `Date`, an ISO string, or epoch milliseconds. */
export type DateInput = Date | string | number;

const DATE_FNS_LOCALES: Record<Locale, DateFnsLocale> = {
  fr,
  ar: arMA,
  en: enGB,
  es,
};

/** `date-fns` patterns for a date written out in prose. */
const LONG_DATE_PATTERNS: Record<Locale, string> = {
  fr: 'd MMMM yyyy',
  ar: 'd MMMM yyyy',
  en: 'd MMMM yyyy',
  es: "d 'de' MMMM 'de' yyyy",
};

/** Hour and minute unit labels for {@link formatDuration}. */
const DURATION_UNITS: Record<Locale, { readonly hour: string; readonly minute: string }> = {
  fr: { hour: 'h', minute: 'min' },
  ar: { hour: 'س', minute: 'د' },
  en: { hour: 'h', minute: 'min' },
  es: { hour: 'h', minute: 'min' },
};

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Coerce a {@link DateInput} to a valid `Date`, or `null`.
 *
 * Exported because callers that branch on validity (an optional `completedAt`,
 * a user-supplied filter bound) should test once rather than compare formatter
 * output against `''`.
 */
export function toDateOrNull(input: DateInput | null | undefined): Date | null {
  if (input === null || input === undefined) return null;

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === 'number') {
    return Number.isFinite(input) ? new Date(input) : null;
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed === '') return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Timezone                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Shift an instant into Casablanca wall-clock time.
 *
 * The returned `Date` has the **local** getters (`getHours`, `getDate`) set to
 * what a clock in Casablanca shows — it is a display value, not an instant. Do
 * not persist it, do not compare it with an untranslated `Date`, and prefer the
 * formatters below wherever you only need a string.
 *
 * Returns `null` on invalid input.
 */
export function toCasablanca(input: DateInput | null | undefined): Date | null {
  const date = toDateOrNull(input);
  return date === null ? null : toZonedTime(date, CASABLANCA_TZ);
}

/**
 * The instant at which the Casablanca day containing `input` begins (00:00 local).
 *
 * This is the correct lower bound for a `createdAt: { gte: … }` query when an
 * admin filters "today" — using the server's local midnight would silently shift
 * the results by an hour, or by a day during Ramadan.
 */
export function startOfCasablancaDay(input: DateInput | null | undefined): Date | null {
  const date = toDateOrNull(input);
  if (date === null) return null;
  const day = formatInTimeZone(date, CASABLANCA_TZ, 'yyyy-MM-dd');
  return fromZonedTime(`${day}T00:00:00`, CASABLANCA_TZ);
}

/**
 * The instant at which the Casablanca day containing `input` ends — exclusive,
 * i.e. the next day's midnight. Pair it with `lt` (not `lte`) so a record stamped
 * at exactly 00:00:00.000 the next morning is not counted twice.
 */
export function endOfCasablancaDay(input: DateInput | null | undefined): Date | null {
  const start = startOfCasablancaDay(input);
  if (start === null) return null;
  const nextDay = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  return startOfCasablancaDay(nextDay);
}

/**
 * Whether two instants fall on the same calendar day in Casablanca — the test
 * behind "aujourd'hui" separators in the AI conversation and the activity feed.
 */
export function isSameCasablancaDay(
  a: DateInput | null | undefined,
  b: DateInput | null | undefined,
): boolean {
  const left = toDateOrNull(a);
  const right = toDateOrNull(b);
  if (left === null || right === null) return false;
  return (
    formatInTimeZone(left, CASABLANCA_TZ, 'yyyy-MM-dd') ===
    formatInTimeZone(right, CASABLANCA_TZ, 'yyyy-MM-dd')
  );
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Prose date: `12 mars 2026` (fr), `12 مارس 2026` (ar), `12 March 2026` (en),
 * `12 de marzo de 2026` (es).
 */
export function formatDate(input: DateInput | null | undefined, locale: Locale): string {
  const date = toDateOrNull(input);
  if (date === null) return '';
  return formatInTimeZone(date, CASABLANCA_TZ, LONG_DATE_PATTERNS[locale], {
    locale: DATE_FNS_LOCALES[locale],
  });
}

/**
 * Dense date for tables and exports: `12/03/2026`.
 *
 * Day-first in all four locales — that is what Morocco writes, and mixing
 * `03/12` into an admin table is how a payment gets verified against the wrong
 * transfer. Wrap it in `force-ltr` inside Arabic text.
 */
export function formatDateShort(input: DateInput | null | undefined, locale: Locale): string {
  const date = toDateOrNull(input);
  if (date === null) return '';
  return formatInTimeZone(date, CASABLANCA_TZ, 'dd/MM/yyyy', {
    locale: DATE_FNS_LOCALES[locale],
  });
}

/**
 * Time of day on a 24-hour clock: `14 h 30` in French (spec §28.1), `14:30`
 * elsewhere.
 */
export function formatTime(input: DateInput | null | undefined, locale: Locale): string {
  const date = toDateOrNull(input);
  if (date === null) return '';
  if (locale === 'fr') {
    return formatInTimeZone(date, CASABLANCA_TZ, "HH 'h' mm", {
      locale: DATE_FNS_LOCALES[locale],
    });
  }
  return formatInTimeZone(date, CASABLANCA_TZ, 'HH:mm', { locale: DATE_FNS_LOCALES[locale] });
}

/**
 * Date and time together: `12 mars 2026 à 14 h 30`.
 *
 * Used wherever a moment must be auditable rather than merely readable —
 * the request timeline, the payment record, the audit log, the invoice.
 */
export function formatDateTime(input: DateInput | null | undefined, locale: Locale): string {
  const date = toDateOrNull(input);
  if (date === null) return '';
  const day = formatDate(date, locale);
  const time = formatTime(date, locale);
  const joiner: Record<Locale, string> = {
    fr: ' à ',
    ar: ' — ',
    en: ' at ',
    es: ' a las ',
  };
  return `${day}${joiner[locale]}${time}`;
}

/**
 * A course or lesson length, given in minutes: `4 h 25 min`, `45 min`, `4 h`.
 *
 * Whole hours drop the minutes, sub-hour durations drop the hours, and zero or
 * invalid input renders as `0 min` so a length badge is never blank.
 */
export function formatDuration(totalMinutes: number, locale: Locale): string {
  const units = DURATION_UNITS[locale];

  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return `0 ${units.minute}`;

  const minutes = Math.round(totalMinutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest} ${units.minute}`;
  if (rest === 0) return `${hours} ${units.hour}`;
  return `${hours} ${units.hour} ${rest} ${units.minute}`;
}

/**
 * Distance from now in words, with a direction: `il y a 3 jours`, `dans 2 heures`,
 * `منذ 3 أيام`, `3 days ago`, `hace 3 días`.
 *
 * `baseDate` is injectable so the function stays pure and testable; it also lets
 * a Server Component pass the request time so the string does not change between
 * render and hydration.
 *
 * Relative time is fine for "il y a 3 jours" but useless for an accounting
 * record — pair it with an absolute `title`/`dateTime` on the `<time>` element.
 */
export function formatRelative(
  input: DateInput | null | undefined,
  locale: Locale,
  baseDate: DateInput = new Date(),
): string {
  const date = toDateOrNull(input);
  const base = toDateOrNull(baseDate);
  if (date === null || base === null) return '';
  return formatDistance(date, base, { locale: DATE_FNS_LOCALES[locale], addSuffix: true });
}

/**
 * Machine-readable value for the `dateTime` attribute of a `<time>` element —
 * a full ISO 8601 timestamp with the Casablanca offset, so assistive technology
 * and search engines read the same instant the user sees.
 */
export function toDateTimeAttribute(input: DateInput | null | undefined): string {
  const date = toDateOrNull(input);
  if (date === null) return '';
  return formatInTimeZone(date, CASABLANCA_TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}
