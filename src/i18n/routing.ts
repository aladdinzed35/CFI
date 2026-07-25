import { defineRouting } from 'next-intl/routing';

/**
 * Locale contract for the whole application (§10).
 *
 * The owner requires four locales instead of the two in the original brief:
 * `fr` is the default and the source language for every string, `ar` is the
 * only right-to-left locale, `en` and `es` are full translations of `fr`.
 *
 * Slugs stay in French for every locale so links remain stable and SEO-safe.
 */
export const locales = ['fr', 'ar', 'en', 'es'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale = 'fr' satisfies Locale;

/** The only right-to-left locale. Everything else is left-to-right. */
export const rtlLocales = ['ar'] as const;

export type RtlLocale = (typeof rtlLocales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Every URL carries its locale: `/fr/formations`, `/ar/formations`, …
  // `/` is redirected by the middleware to the detected locale.
  localePrefix: 'always',
  // Detection order is handled by next-intl: path prefix → NEXT_LOCALE cookie
  // → Accept-Language → `defaultLocale`.
  localeDetection: true,
});

/** Narrows an unknown value (route param, cookie, database column) to a `Locale`. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** `true` when the locale is written right-to-left. */
export function isRtl(locale: Locale): boolean {
  return (rtlLocales as readonly Locale[]).includes(locale);
}

/** The value for the `dir` attribute of `<html>` (and of any nested override). */
export function dirFor(locale: Locale): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

/** Full, autonymous language names — used in the locale switcher menu. */
export const localeLabels: Record<Locale, string> = {
  fr: 'Français',
  ar: 'العربية',
  en: 'English',
  es: 'Español',
};

/** Compact labels for the segmented locale switcher in the header. */
export const localeShortLabels: Record<Locale, string> = {
  fr: 'FR',
  ar: 'ع',
  en: 'EN',
  es: 'ES',
};

/**
 * BCP 47 tags for the `lang` attribute and for `hreflang` alternates.
 * French and Arabic are regionalised to Morocco, which drives the correct
 * date, number and currency conventions in the browser.
 */
const htmlLangs: Record<Locale, string> = {
  fr: 'fr-MA',
  ar: 'ar-MA',
  en: 'en',
  es: 'es',
};

export function htmlLangFor(locale: Locale): string {
  return htmlLangs[locale];
}
