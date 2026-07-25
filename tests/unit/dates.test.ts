import { describe, expect, it } from 'vitest';

import { locales } from '@/i18n/routing';
import {
  CASABLANCA_TZ,
  endOfCasablancaDay,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatDuration,
  formatRelative,
  formatTime,
  isSameCasablancaDay,
  startOfCasablancaDay,
  toCasablanca,
  toDateOrNull,
  toDateTimeAttribute,
} from '@/lib/dates';

/**
 * Dates (spec §22, §28.1).
 *
 * Morocco sits at UTC+1 all year and drops to UTC+0 for Ramadan. In 2026 the
 * IANA database puts the two transitions at 2026-02-15T02:00Z (back to UTC+0)
 * and 2026-03-22T02:00Z (forward to UTC+1). Every assertion below is anchored on
 * real instants either side of those, so a hand-rolled `+1 hour` would fail.
 */

/** 2026-01-15 11:30 in Casablanca — winter, UTC+1. */
const WINTER = new Date('2026-01-15T10:30:00.000Z');
/** 2026-03-12 12:00 in Casablanca — inside the Ramadan window, UTC+0. */
const RAMADAN = new Date('2026-03-12T12:00:00.000Z');

describe('timezone — Africa/Casablanca across the DST boundary', () => {
  it('names the only timezone the product displays', () => {
    expect(CASABLANCA_TZ).toBe('Africa/Casablanca');
  });

  it('reads UTC+1 before the February transition', () => {
    // 01:59 UTC on 15 Feb is still 02:59 local.
    expect(formatTime('2026-02-15T01:59:00.000Z', 'en')).toBe('02:59');
    expect(formatDateShort('2026-02-15T01:59:00.000Z', 'fr')).toBe('15/02/2026');
  });

  it('reads UTC+0 after the February transition', () => {
    // 02:30 UTC on 15 Feb is 02:30 local — the clock went back an hour.
    expect(formatTime('2026-02-15T02:30:00.000Z', 'en')).toBe('02:30');
    expect(formatTime('2026-03-12T12:00:00.000Z', 'en')).toBe('12:00');
  });

  it('reads UTC+1 again after the March transition', () => {
    expect(formatTime('2026-03-22T01:30:00.000Z', 'en')).toBe('01:30');
    expect(formatTime('2026-03-22T02:30:00.000Z', 'en')).toBe('03:30');
  });

  it('keeps the calendar day a Moroccan sees, not the server day', () => {
    // 23:30 UTC on 14 Feb is already 00:30 on 15 Feb in Casablanca.
    expect(formatDateShort('2026-02-14T23:30:00.000Z', 'fr')).toBe('15/02/2026');
    // 23:30 UTC on 12 March (UTC+0 window) is still 12 March locally.
    expect(formatDateShort('2026-03-12T23:30:00.000Z', 'fr')).toBe('12/03/2026');
  });

  it('exposes Casablanca wall-clock getters via toCasablanca', () => {
    const winter = toCasablanca(WINTER);
    expect(winter).not.toBeNull();
    expect(winter?.getHours()).toBe(11);
    expect(winter?.getDate()).toBe(15);

    const ramadan = toCasablanca(RAMADAN);
    expect(ramadan?.getHours()).toBe(12);
    expect(ramadan?.getDate()).toBe(12);
  });

  it('returns null rather than an Invalid Date', () => {
    expect(toCasablanca(null)).toBeNull();
    expect(toCasablanca('not a date')).toBeNull();
  });
});

describe('day boundaries', () => {
  it('starts the day at local midnight, not server midnight', () => {
    expect(startOfCasablancaDay(WINTER)?.toISOString()).toBe('2026-01-14T23:00:00.000Z');
    expect(endOfCasablancaDay(WINTER)?.toISOString()).toBe('2026-01-15T23:00:00.000Z');
  });

  it('uses UTC+0 boundaries inside the Ramadan window', () => {
    expect(startOfCasablancaDay(RAMADAN)?.toISOString()).toBe('2026-03-12T00:00:00.000Z');
    expect(endOfCasablancaDay(RAMADAN)?.toISOString()).toBe('2026-03-13T00:00:00.000Z');
  });

  it('produces a 25-hour day on the transition date', () => {
    const start = startOfCasablancaDay('2026-02-15T12:00:00.000Z');
    const end = endOfCasablancaDay('2026-02-15T12:00:00.000Z');
    expect(start?.toISOString()).toBe('2026-02-14T23:00:00.000Z');
    expect(end?.toISOString()).toBe('2026-02-16T00:00:00.000Z');
    const hours = ((end?.getTime() ?? 0) - (start?.getTime() ?? 0)) / 3_600_000;
    expect(hours).toBe(25);
  });

  it('gives the same bounds for every instant inside the same local day', () => {
    const morning = startOfCasablancaDay('2026-01-14T23:00:00.000Z');
    const evening = startOfCasablancaDay('2026-01-15T22:59:59.999Z');
    expect(morning?.toISOString()).toBe(evening?.toISOString());
  });

  it('is exclusive at the upper bound', () => {
    const end = endOfCasablancaDay(WINTER);
    expect(startOfCasablancaDay(end)?.toISOString()).toBe(end?.toISOString());
  });

  it('returns null for unusable input', () => {
    expect(startOfCasablancaDay(undefined)).toBeNull();
    expect(endOfCasablancaDay('nope')).toBeNull();
  });
});

describe('isSameCasablancaDay', () => {
  it('compares local days, not UTC days', () => {
    // Both are 16 January locally.
    expect(isSameCasablancaDay('2026-01-15T23:30:00.000Z', '2026-01-16T09:00:00.000Z')).toBe(true);
    // 23:30 on the 15th vs. 00:30 on the 16th, locally.
    expect(isSameCasablancaDay('2026-01-15T22:30:00.000Z', '2026-01-15T23:30:00.000Z')).toBe(false);
  });

  it('is false when either side is unusable', () => {
    expect(isSameCasablancaDay(null, WINTER)).toBe(false);
    expect(isSameCasablancaDay(WINTER, 'garbage')).toBe(false);
  });
});

describe('formatDate — prose', () => {
  it('renders 12 mars 2026 and its three siblings', () => {
    expect(formatDate(RAMADAN, 'fr')).toBe('12 mars 2026');
    expect(formatDate(RAMADAN, 'ar')).toBe('12 مارس 2026');
    expect(formatDate(RAMADAN, 'en')).toBe('12 March 2026');
    expect(formatDate(RAMADAN, 'es')).toBe('12 de marzo de 2026');
  });

  it('accepts a Date, an ISO string and epoch milliseconds alike', () => {
    expect(formatDate(RAMADAN, 'fr')).toBe('12 mars 2026');
    expect(formatDate('2026-03-12T12:00:00.000Z', 'fr')).toBe('12 mars 2026');
    expect(formatDate(RAMADAN.getTime(), 'fr')).toBe('12 mars 2026');
  });

  it('renders an empty string instead of Invalid Date', () => {
    for (const locale of locales) {
      expect(formatDate(null, locale)).toBe('');
      expect(formatDate(undefined, locale)).toBe('');
      expect(formatDate('', locale)).toBe('');
      expect(formatDate('not a date', locale)).toBe('');
      expect(formatDate(new Date(Number.NaN), locale)).toBe('');
    }
  });
});

describe('formatDateShort — dense tables', () => {
  it('is day-first in all four locales', () => {
    for (const locale of locales) {
      expect(formatDateShort(RAMADAN, locale)).toBe('12/03/2026');
    }
  });

  it('zero-pads single-digit days and months', () => {
    expect(formatDateShort('2026-01-05T12:00:00.000Z', 'fr')).toBe('05/01/2026');
  });

  it('emits only ASCII digits and slashes — safe inside force-ltr', () => {
    expect(formatDateShort(RAMADAN, 'ar')).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe('formatTime — 24-hour clock', () => {
  it('writes 14 h 30 in French and 14:30 elsewhere', () => {
    const afternoon = '2026-01-15T13:30:00.000Z'; // 14:30 in Casablanca, UTC+1
    expect(formatTime(afternoon, 'fr')).toBe('14 h 30');
    expect(formatTime(afternoon, 'ar')).toBe('14:30');
    expect(formatTime(afternoon, 'en')).toBe('14:30');
    expect(formatTime(afternoon, 'es')).toBe('14:30');
  });

  it('zero-pads and never falls back to a 12-hour clock', () => {
    expect(formatTime('2026-01-15T08:05:00.000Z', 'fr')).toBe('09 h 05');
    expect(formatTime('2026-01-15T22:00:00.000Z', 'en')).toBe('23:00');
    expect(formatTime('2026-01-15T23:00:00.000Z', 'en')).toBe('00:00');
  });

  it('is empty for unusable input', () => {
    expect(formatTime(null, 'fr')).toBe('');
    expect(formatTime('garbage', 'en')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('joins date and time with the locale connector', () => {
    expect(formatDateTime(RAMADAN, 'fr')).toBe('12 mars 2026 à 12 h 00');
    expect(formatDateTime(RAMADAN, 'ar')).toBe('12 مارس 2026 — 12:00');
    expect(formatDateTime(RAMADAN, 'en')).toBe('12 March 2026 at 12:00');
    expect(formatDateTime(RAMADAN, 'es')).toBe('12 de marzo de 2026 a las 12:00');
  });

  it('is empty for unusable input', () => {
    for (const locale of locales) {
      expect(formatDateTime(null, locale)).toBe('');
    }
  });
});

describe('formatDuration', () => {
  it('writes 4 h 25 min', () => {
    expect(formatDuration(265, 'fr')).toBe('4 h 25 min');
    expect(formatDuration(265, 'en')).toBe('4 h 25 min');
    expect(formatDuration(265, 'es')).toBe('4 h 25 min');
    expect(formatDuration(265, 'ar')).toBe('4 س 25 د');
  });

  it('drops the minutes on a whole hour and the hours below one', () => {
    expect(formatDuration(240, 'fr')).toBe('4 h');
    expect(formatDuration(60, 'fr')).toBe('1 h');
    expect(formatDuration(45, 'fr')).toBe('45 min');
    expect(formatDuration(1, 'fr')).toBe('1 min');
    expect(formatDuration(240, 'ar')).toBe('4 س');
    expect(formatDuration(45, 'ar')).toBe('45 د');
  });

  it('rounds fractional minutes rather than printing them', () => {
    expect(formatDuration(90.4, 'fr')).toBe('1 h 30 min');
    expect(formatDuration(90.6, 'fr')).toBe('1 h 31 min');
  });

  it('never renders a blank badge', () => {
    for (const locale of locales) {
      expect(formatDuration(0, locale)).not.toBe('');
      expect(formatDuration(-10, locale)).toBe(formatDuration(0, locale));
      expect(formatDuration(Number.NaN, locale)).toBe(formatDuration(0, locale));
    }
    expect(formatDuration(0, 'fr')).toBe('0 min');
    expect(formatDuration(0, 'ar')).toBe('0 د');
  });

  it('handles a long path of several hundred hours', () => {
    expect(formatDuration(6_000, 'fr')).toBe('100 h');
    expect(formatDuration(6_001, 'fr')).toBe('100 h 1 min');
  });
});

describe('formatRelative', () => {
  const base = WINTER;

  it('adds a direction in every locale', () => {
    const threeDaysAgo = new Date(base.getTime() - 3 * 24 * 3_600_000);
    expect(formatRelative(threeDaysAgo, 'fr', base)).toBe('il y a 3 jours');
    expect(formatRelative(threeDaysAgo, 'en', base)).toBe('3 days ago');
    expect(formatRelative(threeDaysAgo, 'es', base)).toBe('hace 3 días');
    expect(formatRelative(threeDaysAgo, 'ar', base)).toBe('منذ 3 أيام');
  });

  it('handles a future instant', () => {
    const inTwoHours = new Date(base.getTime() + 2 * 3_600_000);
    expect(formatRelative(inTwoHours, 'en', base)).toBe('in about 2 hours');
    expect(formatRelative(inTwoHours, 'fr', base)).toBe('dans environ 2 heures');
  });

  it('is empty for unusable input', () => {
    expect(formatRelative(null, 'fr', base)).toBe('');
    expect(formatRelative(base, 'fr', 'garbage')).toBe('');
  });
});

describe('toDateTimeAttribute', () => {
  it('carries the Casablanca offset for the <time> element', () => {
    expect(toDateTimeAttribute(WINTER)).toBe('2026-01-15T11:30:00+01:00');
    expect(toDateTimeAttribute(RAMADAN)).toBe('2026-03-12T12:00:00Z');
  });

  it('parses back to the very same instant', () => {
    expect(new Date(toDateTimeAttribute(WINTER)).getTime()).toBe(WINTER.getTime());
    expect(new Date(toDateTimeAttribute(RAMADAN)).getTime()).toBe(RAMADAN.getTime());
  });

  it('is empty for unusable input', () => {
    expect(toDateTimeAttribute(null)).toBe('');
    expect(toDateTimeAttribute('garbage')).toBe('');
  });
});

describe('toDateOrNull', () => {
  it('accepts Date, ISO string and epoch milliseconds', () => {
    expect(toDateOrNull(WINTER)?.getTime()).toBe(WINTER.getTime());
    expect(toDateOrNull('2026-01-15T10:30:00.000Z')?.getTime()).toBe(WINTER.getTime());
    expect(toDateOrNull(WINTER.getTime())?.getTime()).toBe(WINTER.getTime());
    expect(toDateOrNull('  2026-01-15T10:30:00.000Z  ')?.getTime()).toBe(WINTER.getTime());
  });

  it('rejects everything else', () => {
    expect(toDateOrNull(null)).toBeNull();
    expect(toDateOrNull(undefined)).toBeNull();
    expect(toDateOrNull('')).toBeNull();
    expect(toDateOrNull('   ')).toBeNull();
    expect(toDateOrNull('not a date')).toBeNull();
    expect(toDateOrNull(Number.NaN)).toBeNull();
    expect(toDateOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toDateOrNull(new Date(Number.NaN))).toBeNull();
  });
});
