import { describe, expect, it } from 'vitest';

import { locales, type Locale } from '@/i18n/routing';
import {
  applyCoupon,
  EN_DASH,
  formatMoney,
  formatMoneyRange,
  fromCentimes,
  MAX_MONEY_CENTIMES,
  MONEY_FORMATS,
  NARROW_NBSP,
  NBSP,
  percentOff,
  toCentimes,
  type CouponLike,
} from '@/lib/money';

/**
 * Money (spec §22, §28.1).
 *
 * Everything is an integer number of centimes; the only float that may ever
 * appear is the human-typed decimal on the way in. These tests pin both halves:
 * the parse boundary must never let drift through, and the four locales must
 * each render their own separator and currency suffix exactly.
 */

describe('toCentimes — round-tripping without float drift', () => {
  it('parses plain integers and decimals', () => {
    expect(toCentimes('1200')).toBe(120_000);
    expect(toCentimes('1200.50')).toBe(120_050);
    expect(toCentimes('1200,50')).toBe(120_050);
    expect(toCentimes('0')).toBe(0);
    expect(toCentimes('0,01')).toBe(1);
    expect(toCentimes('.50')).toBe(50);
    expect(toCentimes('+1200')).toBe(120_000);
  });

  it('accepts every grouping a human or a formatter might produce', () => {
    expect(toCentimes(`1${NARROW_NBSP}200,50`)).toBe(120_050);
    expect(toCentimes(`1${NBSP}200,50`)).toBe(120_050);
    expect(toCentimes('1 200,50')).toBe(120_050);
    expect(toCentimes('1,200.50')).toBe(120_050);
    expect(toCentimes('1.200,50')).toBe(120_050);
    // A lone separator before exactly three digits is a thousands separator.
    expect(toCentimes('1,200')).toBe(120_000);
    expect(toCentimes('1.200')).toBe(120_000);
    expect(toCentimes('1.234.567')).toBe(123_456_700);
  });

  it('pads a single decimal digit to centimes rather than reading it as units', () => {
    expect(toCentimes('12,5')).toBe(1250);
    expect(toCentimes('0,5')).toBe(50);
  });

  it('never lets binary floating point leak into a stored amount', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754.
    expect(toCentimes(0.1 + 0.2)).toBe(30);
    expect(toCentimes(1200.1 * 3)).toBe(360_030); // 3600.2999999999997
    expect(toCentimes(1079.9999999999999)).toBe(108_000);
  });

  it('round-trips every realistic price through centimes and back', () => {
    const prices = [0, 0.05, 8.5, 799.99, 800, 1200, 1200.5, 2499.95, 4500, 99_999.99];
    for (const price of prices) {
      const centimes = toCentimes(price);
      expect(centimes).not.toBeNull();
      expect(Number.isSafeInteger(centimes)).toBe(true);
      expect(fromCentimes(centimes ?? 0)).toBe(price);
    }
  });

  it('round-trips a formatted French amount back through the parser', () => {
    const centimes = 1_234_567;
    const rendered = formatMoney(centimes, 'fr', { decimals: 'always', omitCurrency: true });
    expect(rendered).toBe(`12${NARROW_NBSP}345,67`);
    expect(toCentimes(rendered)).toBe(centimes);
  });

  it('rejects malformed input instead of throwing', () => {
    const rejected = [
      '',
      '   ',
      'abc',
      '12 DH',
      '1200.505',
      '1.2345',
      '-5',
      '-1200,50',
      '1,2,3',
      '12..50',
      '+',
      '1e3',
    ];
    for (const value of rejected) {
      expect(toCentimes(value), `expected ${JSON.stringify(value)} to be rejected`).toBeNull();
    }
  });

  it('rejects non-finite and negative numbers', () => {
    expect(toCentimes(Number.NaN)).toBeNull();
    expect(toCentimes(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toCentimes(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(toCentimes(-1)).toBeNull();
    expect(toCentimes(-0.01)).toBeNull();
  });

  it('rejects a third decimal, which is never a price', () => {
    expect(toCentimes(1200.005)).toBeNull();
    expect(toCentimes('1200,005')).toBeNull();
  });

  it('enforces the ceiling', () => {
    expect(toCentimes(MAX_MONEY_CENTIMES / 100)).toBe(MAX_MONEY_CENTIMES);
    expect(toCentimes(MAX_MONEY_CENTIMES / 100 + 1)).toBeNull();
  });
});

describe('fromCentimes', () => {
  it('converts to dirhams for exports', () => {
    expect(fromCentimes(120_000)).toBe(1200);
    expect(fromCentimes(120_050)).toBe(1200.5);
    expect(fromCentimes(1)).toBe(0.01);
    expect(fromCentimes(0)).toBe(0);
  });

  it('is total for garbage input', () => {
    expect(fromCentimes(Number.NaN)).toBe(0);
    expect(fromCentimes(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('formatMoney — four locales, four conventions', () => {
  it('renders 1 200 DH in each locale with the right separator and suffix', () => {
    expect(formatMoney(120_000, 'fr')).toBe(`1${NARROW_NBSP}200${NARROW_NBSP}DH`);
    expect(formatMoney(120_000, 'ar')).toBe(`1${NARROW_NBSP}200${NARROW_NBSP}د.م.`);
    expect(formatMoney(120_000, 'en')).toBe(`1,200${NBSP}MAD`);
    // RAE: four-digit numbers are written unbroken in Spanish.
    expect(formatMoney(120_000, 'es')).toBe(`1200${NBSP}MAD`);
  });

  it('applies the Spanish grouping threshold from five digits', () => {
    expect(formatMoney(1_000_000, 'es')).toBe(`10.000${NBSP}MAD`);
    expect(formatMoney(1_000_000, 'fr')).toBe(`10${NARROW_NBSP}000${NARROW_NBSP}DH`);
    expect(formatMoney(1_000_000, 'en')).toBe(`10,000${NBSP}MAD`);
  });

  it('leaves three-digit amounts ungrouped everywhere', () => {
    for (const locale of locales) {
      const format = MONEY_FORMATS[locale];
      expect(formatMoney(99_900, locale)).toBe(`999${format.currencySpace}${format.currency}`);
    }
  });

  it('groups millions in threes', () => {
    expect(formatMoney(123_456_700, 'fr')).toBe(
      `1${NARROW_NBSP}234${NARROW_NBSP}567${NARROW_NBSP}DH`,
    );
    expect(formatMoney(123_456_700, 'en')).toBe(`1,234,567${NBSP}MAD`);
    expect(formatMoney(123_456_700, 'es')).toBe(`1.234.567${NBSP}MAD`);
  });

  it('shows decimals only when the amount is not a whole dirham', () => {
    expect(formatMoney(120_050, 'fr')).toBe(`1${NARROW_NBSP}200,50${NARROW_NBSP}DH`);
    expect(formatMoney(120_050, 'en')).toBe(`1,200.50${NBSP}MAD`);
    expect(formatMoney(120_050, 'es')).toBe(`1200,50${NBSP}MAD`);
    expect(formatMoney(120_005, 'fr')).toBe(`1${NARROW_NBSP}200,05${NARROW_NBSP}DH`);
    expect(formatMoney(120_000, 'fr')).toBe(`1${NARROW_NBSP}200${NARROW_NBSP}DH`);
  });

  it('honours decimals: always and never', () => {
    expect(formatMoney(120_000, 'fr', { decimals: 'always' })).toBe(
      `1${NARROW_NBSP}200,00${NARROW_NBSP}DH`,
    );
    expect(formatMoney(120_000, 'en', { decimals: 'always' })).toBe(`1,200.00${NBSP}MAD`);
    // never rounds to the nearest dirham for display only.
    expect(formatMoney(120_050, 'fr', { decimals: 'never' })).toBe(
      `1${NARROW_NBSP}201${NARROW_NBSP}DH`,
    );
    expect(formatMoney(120_049, 'fr', { decimals: 'never' })).toBe(
      `1${NARROW_NBSP}200${NARROW_NBSP}DH`,
    );
  });

  it('omits the currency label on request', () => {
    expect(formatMoney(120_000, 'fr', { omitCurrency: true })).toBe(`1${NARROW_NBSP}200`);
    expect(formatMoney(120_050, 'ar', { omitCurrency: true })).toBe(`1${NARROW_NBSP}200,50`);
  });

  it('formats a free course as a plain zero, not an empty string', () => {
    expect(formatMoney(0, 'fr')).toBe(`0${NARROW_NBSP}DH`);
    expect(formatMoney(0, 'ar')).toBe(`0${NARROW_NBSP}د.م.`);
    expect(formatMoney(0, 'en')).toBe(`0${NBSP}MAD`);
    expect(formatMoney(0, 'es')).toBe(`0${NBSP}MAD`);
    expect(formatMoney(0, 'fr', { decimals: 'always' })).toBe(`0,00${NARROW_NBSP}DH`);
  });

  it('keeps the sign in front for refunds and credit notes', () => {
    expect(formatMoney(-120_000, 'fr')).toBe(`-1${NARROW_NBSP}200${NARROW_NBSP}DH`);
    expect(formatMoney(-50, 'en')).toBe(`-0.50${NBSP}MAD`);
  });

  it('never renders NaN in a price widget', () => {
    for (const locale of locales) {
      const format = MONEY_FORMATS[locale];
      const zero = `0${format.currencySpace}${format.currency}`;
      expect(formatMoney(Number.NaN, locale)).toBe(zero);
      expect(formatMoney(Number.POSITIVE_INFINITY, locale)).toBe(zero);
    }
  });

  it('uses Western digits in every locale, including Arabic', () => {
    for (const locale of locales) {
      expect(formatMoney(1_234_567, locale)).toMatch(/[0-9]/);
      // No Arabic-Indic or Extended Arabic-Indic digits.
      expect(formatMoney(1_234_567, locale)).not.toMatch(/[٠-٩۰-۹]/);
    }
  });
});

describe('formatMoneyRange', () => {
  it('labels the currency once, at the end', () => {
    expect(formatMoneyRange(120_000, 240_000, 'fr')).toBe(
      `1${NARROW_NBSP}200${NBSP}${EN_DASH}${NBSP}2${NARROW_NBSP}400${NARROW_NBSP}DH`,
    );
    expect(formatMoneyRange(80_000, 450_000, 'en')).toBe(`800${NBSP}${EN_DASH}${NBSP}4,500${NBSP}MAD`);
  });

  it('collapses equal bounds to a single amount', () => {
    expect(formatMoneyRange(120_000, 120_000, 'fr')).toBe(`1${NARROW_NBSP}200${NARROW_NBSP}DH`);
  });

  it('swaps reversed bounds instead of rendering backwards', () => {
    expect(formatMoneyRange(240_000, 120_000, 'fr')).toBe(formatMoneyRange(120_000, 240_000, 'fr'));
  });
});

describe('percentOff', () => {
  it('computes the badge percentage from the compare-at price', () => {
    expect(percentOff(90_000, 120_000)).toBe(25);
    expect(percentOff(60_000, 120_000)).toBe(50);
    expect(percentOff(79_900, 99_900)).toBe(20); // 20.02 % → 20
    expect(percentOff(89_900, 119_900)).toBe(25); // 25.02 % → 25
  });

  it('reports a full discount on a course given away', () => {
    expect(percentOff(0, 120_000)).toBe(100);
  });

  it('returns null when there is nothing to advertise', () => {
    expect(percentOff(120_000, null)).toBeNull();
    expect(percentOff(120_000, undefined)).toBeNull();
    expect(percentOff(120_000, 120_000)).toBeNull();
    expect(percentOff(120_000, 100_000)).toBeNull();
    expect(percentOff(120_000, 0)).toBeNull();
    expect(percentOff(120_000, -1)).toBeNull();
    expect(percentOff(-1, 120_000)).toBeNull();
  });

  it('never renders a -0 % badge for a rounding-dust discount', () => {
    expect(percentOff(119_999, 120_000)).toBeNull();
  });

  it('is total for non-finite input', () => {
    expect(percentOff(Number.NaN, 120_000)).toBeNull();
    expect(percentOff(120_000, Number.NaN)).toBeNull();
    expect(percentOff(Number.POSITIVE_INFINITY, 120_000)).toBeNull();
  });
});

describe('applyCoupon', () => {
  const now = new Date('2026-01-15T10:30:00.000Z');
  const percent = (value: number, extra: Partial<CouponLike> = {}): CouponLike => ({
    type: 'PERCENT',
    value,
    ...extra,
  });

  it('applies a percentage in integer centimes', () => {
    const result = applyCoupon(120_000, percent(25), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discountCentimes).toBe(30_000);
    expect(result.finalCentimes).toBe(90_000);
    expect(result.percent).toBe(25);
    expect(Number.isSafeInteger(result.finalCentimes)).toBe(true);
  });

  it('rounds a percentage to the nearest centime', () => {
    // 10 % of 129 999 centimes = 12 999.9 → 13 000.
    const result = applyCoupon(129_999, percent(10), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discountCentimes).toBe(13_000);
    expect(result.finalCentimes).toBe(116_999);
    expect(result.originalCentimes).toBe(result.discountCentimes + result.finalCentimes);
  });

  it('applies a fixed discount and clamps it at the price', () => {
    const cheap = applyCoupon(50_000, { type: 'FIXED', value: 80_000 }, now);
    expect(cheap.ok).toBe(true);
    if (!cheap.ok) return;
    expect(cheap.discountCentimes).toBe(50_000);
    expect(cheap.finalCentimes).toBe(0);
    expect(cheap.percent).toBe(100);
  });

  it('rejects a coupon outside its validity window', () => {
    const notStarted = applyCoupon(
      120_000,
      percent(25, { startsAt: new Date('2026-02-01T00:00:00.000Z') }),
      now,
    );
    expect(notStarted).toMatchObject({ ok: false, reason: 'NOT_STARTED', finalCentimes: 120_000 });

    const expired = applyCoupon(
      120_000,
      percent(25, { expiresAt: new Date('2026-01-01T00:00:00.000Z') }),
      now,
    );
    expect(expired).toMatchObject({ ok: false, reason: 'EXPIRED', finalCentimes: 120_000 });
  });

  it('rejects inactive, exhausted, below-minimum and malformed coupons', () => {
    expect(applyCoupon(120_000, percent(25, { isActive: false }), now)).toMatchObject({
      ok: false,
      reason: 'INACTIVE',
    });
    expect(applyCoupon(120_000, percent(25, { maxUses: 10, usedCount: 10 }), now)).toMatchObject({
      ok: false,
      reason: 'EXHAUSTED',
    });
    expect(
      applyCoupon(120_000, percent(25, { minAmountCentimes: 200_000 }), now),
    ).toMatchObject({ ok: false, reason: 'BELOW_MIN_AMOUNT' });
    expect(applyCoupon(120_000, percent(0), now)).toMatchObject({
      ok: false,
      reason: 'INVALID_COUPON',
    });
    expect(applyCoupon(120_000, percent(101), now)).toMatchObject({
      ok: false,
      reason: 'INVALID_COUPON',
    });
    expect(applyCoupon(Number.NaN, percent(25), now)).toMatchObject({
      ok: false,
      reason: 'INVALID_PRICE',
      finalCentimes: 0,
    });
  });

  it('always returns a renderable final price, even when it rejects', () => {
    const rejected = applyCoupon(120_000, percent(25, { isActive: false }), now);
    expect(rejected.finalCentimes).toBe(120_000);
    expect(formatMoney(rejected.finalCentimes, 'fr')).toBe(`1${NARROW_NBSP}200${NARROW_NBSP}DH`);
  });
});

describe('MONEY_FORMATS', () => {
  it('declares a format for every locale', () => {
    for (const locale of locales) {
      const format: (typeof MONEY_FORMATS)[Locale] = MONEY_FORMATS[locale];
      expect(format.currency.length).toBeGreaterThan(0);
      expect(format.groupFrom).toBeGreaterThanOrEqual(4);
    }
  });
});
