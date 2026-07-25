import type { Locale } from '@/i18n/routing';

/**
 * Money handling for CFI.
 *
 * ## The one rule
 * Every amount in the system is an **integer number of centimes** (1 MAD = 100
 * centimes). Floats never touch a price: no `parseFloat` on a form value, no
 * `price * 0.9` producing `1079.9999999999999`. Rounding happens exactly once,
 * at the boundary where a human-supplied decimal string becomes an integer
 * (`toCentimes`) — everything after that is integer arithmetic.
 *
 * ## Display conventions (spec §28.1)
 * | locale | example      | thousands sep            | decimal sep | currency |
 * |--------|--------------|--------------------------|-------------|----------|
 * | `fr`   | `1 200 DH`   | U+202F narrow NBSP, ≥4 digits | `,`    | `DH`     |
 * | `ar`   | `1 200 د.م.` | U+202F narrow NBSP, ≥4 digits | `,`    | `د.م.`   |
 * | `en`   | `1,200 MAD`  | `,`, ≥4 digits           | `.`         | `MAD`    |
 * | `es`   | `1200 MAD`   | `.`, ≥5 digits (RAE rule)| `,`         | `MAD`    |
 *
 * Digits are always Western `0123456789`, including in Arabic — that is what
 * Moroccan users read on their bank statements. `Intl.NumberFormat` is
 * deliberately not used: it would emit Arabic-Indic digits for some `ar`
 * variants and its separators vary between Node and browser ICU builds.
 */

/** U+00A0 NO-BREAK SPACE. */
export const NBSP = '\u00A0';
/** U+202F NARROW NO-BREAK SPACE — the French thousands separator (spec §28.1). */
export const NARROW_NBSP = '\u202F';
/** U+2013 EN DASH — used between the two ends of a price range. */
export const EN_DASH = '\u2013';

/**
 * Upper bound for any amount we will accept, in centimes (10 000 000 000 =
 * 100 000 000 MAD). Far above any real course price, far below `Number.MAX_SAFE_INTEGER`,
 * so every intermediate multiplication in this module stays exact.
 */
export const MAX_MONEY_CENTIMES = 10_000_000_000;

/** Per-locale money presentation rules. Exported so tests and the invoice renderer can introspect them. */
export interface MoneyFormat {
  /** Inserted every three digits of the integer part. */
  readonly thousands: string;
  /** Inserted before the two decimal digits. */
  readonly decimal: string;
  /** Currency label placed after the number. */
  readonly currency: string;
  /** Inserted between the number and the currency label. */
  readonly currencySpace: string;
  /**
   * Minimum number of integer digits before grouping kicks in. 4 everywhere
   * except Spanish, where RAE says four-digit numbers are written unbroken
   * (`1200`, but `10.000`).
   */
  readonly groupFrom: number;
}

export const MONEY_FORMATS: Record<Locale, MoneyFormat> = {
  fr: {
    thousands: NARROW_NBSP,
    decimal: ',',
    currency: 'DH',
    currencySpace: NARROW_NBSP,
    groupFrom: 4,
  },
  ar: {
    thousands: NARROW_NBSP,
    decimal: ',',
    currency: 'د.م.',
    currencySpace: NARROW_NBSP,
    groupFrom: 4,
  },
  en: {
    thousands: ',',
    decimal: '.',
    currency: 'MAD',
    currencySpace: NBSP,
    groupFrom: 4,
  },
  es: {
    thousands: '.',
    decimal: ',',
    currency: 'MAD',
    currencySpace: NBSP,
    groupFrom: 5,
  },
};

/** How many decimal places `formatMoney` shows. */
export type MoneyDecimals =
  /** Two decimals only when the amount is not a whole dirham (default). */
  | 'auto'
  /** Always two decimals — invoices and accounting exports. */
  | 'always'
  /** Never decimals; the amount is rounded to the nearest dirham for display only. */
  | 'never';

export interface FormatMoneyOptions {
  readonly decimals?: MoneyDecimals;
  /** Drop the currency label and return the bare number (`1 200`). */
  readonly omitCurrency?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/** Every space-ish code point a human or a locale formatter might have inserted. */
const SPACE_CHARS = /[\s\u00A0\u202F\u2009\u200A\u2007\u2060]/g;
/** A run of digits optionally grouped in threes by `.` or `,`. */
const GROUPED_INT = /^\d{1,3}(?:[.,]\d{3})*$/;
const PLAIN_INT = /^\d*$/;
const DIGITS_ONLY = /^\d+$/;

/**
 * Convert a human-entered dirham amount into an integer number of centimes.
 *
 * Returns `null` — never throws — for anything that is not a clean, non-negative
 * amount with at most two decimals. That makes it directly usable inside a Zod
 * transform:
 *
 * ```ts
 * const priceSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
 *   const centimes = toCentimes(value);
 *   if (centimes === null) {
 *     ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Montant invalide.' });
 *     return z.NEVER;
 *   }
 *   return centimes;
 * });
 * ```
 *
 * Accepted shapes: `1200`, `1200.50`, `1200,50`, `1 200,50`, `1 200,50`,
 * `1,200.50`, `1.200,50`, `+1200`, `.50`.
 * Rejected: `NaN`, `Infinity`, negatives, `1200.505`, `abc`, `''`, amounts above
 * {@link MAX_MONEY_CENTIMES}.
 *
 * A lone separator followed by exactly three digits is read as a thousands
 * separator when the whole string is a valid grouping (`1,200` and `1.200` are
 * both 1200 MAD). Three decimals are never valid for a price, so nothing is lost.
 */
export function toCentimes(mad: string | number): number | null {
  if (typeof mad === 'number') return centimesFromNumber(mad);
  if (typeof mad !== 'string') return null;

  const cleaned = mad.replace(SPACE_CHARS, '');
  if (cleaned === '') return null;

  const body = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (body === '' || body.startsWith('-')) return null;
  if (!/^[\d.,]+$/.test(body)) return null;

  const lastSeparator = Math.max(body.lastIndexOf('.'), body.lastIndexOf(','));

  let integerSource: string;
  let fraction: string;

  if (lastSeparator === -1) {
    integerSource = body;
    fraction = '';
  } else {
    const after = body.slice(lastSeparator + 1);
    if (!DIGITS_ONLY.test(after)) return null;

    if (after.length <= 2) {
      integerSource = body.slice(0, lastSeparator);
      fraction = after;
    } else if (after.length === 3 && GROUPED_INT.test(body)) {
      integerSource = body;
      fraction = '';
    } else {
      // More than two decimals — not a price.
      return null;
    }
  }

  if (!GROUPED_INT.test(integerSource) && !PLAIN_INT.test(integerSource)) return null;

  const integerDigits = integerSource.replace(/[.,]/g, '');
  if (!PLAIN_INT.test(integerDigits)) return null;

  const units = integerDigits === '' ? 0 : Number(integerDigits);
  const cents = fraction === '' ? 0 : Number(fraction.padEnd(2, '0'));
  if (!Number.isFinite(units) || !Number.isFinite(cents)) return null;

  const total = units * 100 + cents;
  return isAcceptableCentimes(total) ? total : null;
}

function centimesFromNumber(mad: number): number | null {
  if (!Number.isFinite(mad) || mad < 0) return null;
  const scaled = mad * 100;
  const rounded = Math.round(scaled);
  // A genuine two-decimal value survives the float round-trip within a hair;
  // 0.005 (three decimals) does not.
  if (Math.abs(scaled - rounded) > 1e-6) return null;
  return isAcceptableCentimes(rounded) ? rounded : null;
}

function isAcceptableCentimes(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_MONEY_CENTIMES;
}

/**
 * Turn centimes back into a dirham number — for CSV exports, charts and any
 * external system that insists on decimals. Never use the result for arithmetic
 * that feeds back into the database.
 */
export function fromCentimes(centimes: number): number {
  if (!Number.isFinite(centimes)) return 0;
  return Math.round(centimes) / 100;
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

function groupDigits(digits: string, separator: string, groupFrom: number): string {
  if (separator === '' || digits.length < groupFrom) return digits;
  let out = '';
  for (let end = digits.length; end > 0; end -= 3) {
    const chunk = digits.slice(Math.max(0, end - 3), end);
    out = out === '' ? chunk : `${chunk}${separator}${out}`;
  }
  return out;
}

/**
 * Render an amount for humans: `1 200 DH` (fr), `1 200 د.م.` (ar),
 * `1,200 MAD` (en), `1200 MAD` (es).
 *
 * Non-finite input formats as zero rather than `NaN DH` — a price widget must
 * never render garbage. Negative amounts (refunds, credit notes) keep a leading
 * `-` before the number.
 */
export function formatMoney(
  centimes: number,
  locale: Locale,
  options: FormatMoneyOptions = {},
): string {
  const format = MONEY_FORMATS[locale];
  const { decimals = 'auto', omitCurrency = false } = options;

  const safe = Number.isFinite(centimes) ? Math.round(centimes) : 0;
  const negative = safe < 0;
  const absolute = Math.abs(safe);

  let units = Math.trunc(absolute / 100);
  const remainder = absolute % 100;

  let showDecimals: boolean;
  if (decimals === 'always') {
    showDecimals = true;
  } else if (decimals === 'never') {
    showDecimals = false;
    if (remainder >= 50) units += 1;
  } else {
    showDecimals = remainder !== 0;
  }

  const integerPart = groupDigits(String(units), format.thousands, format.groupFrom);
  const numberPart = showDecimals
    ? `${integerPart}${format.decimal}${String(remainder).padStart(2, '0')}`
    : integerPart;

  const signed = `${negative ? '-' : ''}${numberPart}`;
  return omitCurrency ? signed : `${signed}${format.currencySpace}${format.currency}`;
}

/**
 * Render a price span, e.g. a catalog filter or a course family sold at several
 * tiers: `1 200 – 2 400 DH`. The currency label appears once, at the end.
 * Equal bounds collapse to a single amount. Reversed bounds are swapped rather
 * than rendered backwards.
 */
export function formatMoneyRange(
  minCentimes: number,
  maxCentimes: number,
  locale: Locale,
  options: FormatMoneyOptions = {},
): string {
  const a = Number.isFinite(minCentimes) ? Math.round(minCentimes) : 0;
  const b = Number.isFinite(maxCentimes) ? Math.round(maxCentimes) : 0;
  const low = Math.min(a, b);
  const high = Math.max(a, b);

  if (low === high) return formatMoney(low, locale, options);

  const lowText = formatMoney(low, locale, { ...options, omitCurrency: true });
  const highText = formatMoney(high, locale, options);
  return `${lowText}${NBSP}${EN_DASH}${NBSP}${highText}`;
}

/* -------------------------------------------------------------------------- */
/* Discounts                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Discount percentage of a struck-through "compare at" price, rounded to the
 * nearest whole percent (that is what the badge shows: `-25 %`).
 *
 * Returns `null` when there is nothing to advertise: no compare price, a compare
 * price at or below the actual price, or invalid input. Callers render the badge
 * only when this is a number, so a misconfigured course never shows `-0 %`.
 */
export function percentOff(
  priceCentimes: number,
  compareAtCentimes: number | null | undefined,
): number | null {
  if (compareAtCentimes === null || compareAtCentimes === undefined) return null;
  if (!Number.isFinite(priceCentimes) || !Number.isFinite(compareAtCentimes)) return null;

  const price = Math.round(priceCentimes);
  const compareAt = Math.round(compareAtCentimes);
  if (price < 0 || compareAt <= 0 || compareAt <= price) return null;

  const percent = Math.round(((compareAt - price) * 100) / compareAt);
  if (percent <= 0) return null;
  return Math.min(percent, 100);
}

export type CouponType = 'PERCENT' | 'FIXED';

/**
 * The subset of `Coupon` (spec §7) this module needs. Declared structurally so
 * `src/lib` stays free of Prisma — a Prisma `Coupon` row satisfies it as-is.
 */
export interface CouponLike {
  readonly type: CouponType;
  /** Whole percent for `PERCENT`, centimes for `FIXED`. */
  readonly value: number;
  readonly minAmountCentimes?: number | null;
  readonly maxUses?: number | null;
  readonly usedCount?: number | null;
  readonly isActive?: boolean | null;
  readonly startsAt?: Date | null;
  readonly expiresAt?: Date | null;
}

export type CouponRejectionReason =
  | 'INVALID_PRICE'
  | 'INVALID_COUPON'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'EXHAUSTED'
  | 'BELOW_MIN_AMOUNT';

export type CouponApplication =
  | {
      readonly ok: true;
      readonly originalCentimes: number;
      readonly discountCentimes: number;
      readonly finalCentimes: number;
      /** Effective discount as a whole percent, for the "−25 %" pill. */
      readonly percent: number;
    }
  | {
      readonly ok: false;
      readonly reason: CouponRejectionReason;
      readonly originalCentimes: number;
      /** Unchanged price, so the caller can render a total without branching. */
      readonly finalCentimes: number;
    };

/**
 * Apply a coupon to a price, in integer centimes.
 *
 * Checks the coupon's own validity window, activation flag, global usage cap and
 * minimum-amount threshold; per-user usage (`maxUsesPerUser`) needs a database
 * read and stays in the enrollment service. The discount is clamped so the final
 * price is never negative, and a `PERCENT` coupon rounds to the nearest centime.
 *
 * `now` is injectable so the function stays pure and testable.
 */
export function applyCoupon(
  priceCentimes: number,
  coupon: CouponLike,
  now: Date = new Date(),
): CouponApplication {
  const original = Number.isFinite(priceCentimes) ? Math.round(priceCentimes) : Number.NaN;

  if (!Number.isFinite(original) || original < 0) {
    return { ok: false, reason: 'INVALID_PRICE', originalCentimes: 0, finalCentimes: 0 };
  }

  const reject = (reason: CouponRejectionReason): CouponApplication => ({
    ok: false,
    reason,
    originalCentimes: original,
    finalCentimes: original,
  });

  if (!Number.isFinite(coupon.value) || coupon.value <= 0) return reject('INVALID_COUPON');
  if (coupon.type === 'PERCENT' && coupon.value > 100) return reject('INVALID_COUPON');
  if (coupon.isActive === false) return reject('INACTIVE');

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return reject('INVALID_COUPON');
  if (coupon.startsAt && nowMs < coupon.startsAt.getTime()) return reject('NOT_STARTED');
  if (coupon.expiresAt && nowMs >= coupon.expiresAt.getTime()) return reject('EXPIRED');

  if (
    coupon.maxUses !== null &&
    coupon.maxUses !== undefined &&
    (coupon.usedCount ?? 0) >= coupon.maxUses
  ) {
    return reject('EXHAUSTED');
  }

  if (
    coupon.minAmountCentimes !== null &&
    coupon.minAmountCentimes !== undefined &&
    original < coupon.minAmountCentimes
  ) {
    return reject('BELOW_MIN_AMOUNT');
  }

  const rawDiscount =
    coupon.type === 'PERCENT'
      ? Math.round((original * Math.round(coupon.value)) / 100)
      : Math.round(coupon.value);

  const discount = Math.min(Math.max(rawDiscount, 0), original);
  const final = original - discount;

  return {
    ok: true,
    originalCentimes: original,
    discountCentimes: discount,
    finalCentimes: final,
    percent: original === 0 ? 0 : Math.round((discount * 100) / original),
  };
}
