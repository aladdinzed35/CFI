import type { Locale } from '@prisma/client';

import { defaultLocale } from '@/i18n/routing';

/**
 * The locales to read for a translatable row, in fallback order.
 *
 * Every translatable table is queried for the ACTIVE locale plus French, and the
 * caller resolves French when the active translation is missing (§10.2: an
 * untranslated field falls back to the source language rather than rendering
 * empty).
 *
 * It exists as a function returning a MUTABLE array on purpose. Written inline
 * as `{ in: [locale, 'fr'] as const }`, the `as const` produces a readonly tuple
 * that Prisma's generated `EnumLocaleFilter.in: Locale[]` rejects — which is
 * where 41 of this milestone's type errors came from. Writing it without
 * `as const` at every call site works but invites the same mistake again, so
 * there is one helper and no inline literals.
 *
 * It also avoids asking for French twice when the active locale IS French,
 * which halves the rows returned for the default locale — the common case.
 */
export function translationLocales(locale: Locale): Locale[] {
  return locale === defaultLocale ? [defaultLocale] : [locale, defaultLocale];
}

/**
 * Pick the row for `locale`, falling back to French, then to whatever exists.
 *
 * The final fallback is deliberate: a row with neither the active locale nor
 * French is a data defect, but returning `undefined` would blank a course title
 * on a public page. Showing *some* language beats showing nothing.
 */
export function pickTranslation<T extends { locale: Locale }>(
  rows: readonly T[],
  locale: Locale,
): T | undefined {
  return (
    rows.find((row) => row.locale === locale) ??
    rows.find((row) => row.locale === defaultLocale) ??
    rows[0]
  );
}
