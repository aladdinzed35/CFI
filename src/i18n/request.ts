import { getRequestConfig } from 'next-intl/server';
import type { AbstractIntlMessages } from 'next-intl';
import { defaultLocale, isLocale, type Locale } from './routing';

/**
 * Request-scoped i18n configuration (§10.2).
 *
 * Two guarantees are implemented here:
 *
 * 1. **Never throw on an unknown locale.** The `[locale]` segment behaves like
 *    a catch-all, so anything that is not one of the four supported locales
 *    falls back to French.
 * 2. **Never throw on a missing key.** French is the source language; the
 *    messages of the requested locale are deep-merged *over* the French ones,
 *    so a key that has not been translated yet renders in French instead of
 *    crashing the page.
 *
 * The centre is in Tanger: every server-rendered date and time is formatted in
 * `Africa/Casablanca`, whatever the timezone of the host.
 */
const timeZone = 'Africa/Casablanca';

type MessageModule = { default: AbstractIntlMessages };

const messageLoaders: Record<Locale, () => Promise<MessageModule>> = {
  fr: () => import('./messages/fr.json'),
  ar: () => import('./messages/ar.json'),
  en: () => import('./messages/en.json'),
  es: () => import('./messages/es.json'),
};

function isMessageGroup(value: AbstractIntlMessages | string): value is AbstractIntlMessages {
  return typeof value !== 'string';
}

/**
 * Recursively overlays `override` on top of `base`. Keys present only in
 * `base` (the French source) survive, which is exactly the fallback we want.
 */
function deepMerge(
  base: AbstractIntlMessages,
  override: AbstractIntlMessages,
): AbstractIntlMessages {
  const merged: Record<string, AbstractIntlMessages | string> = { ...base };

  for (const key of Object.keys(override)) {
    const overrideValue = override[key];
    if (overrideValue === undefined) continue;

    const baseValue = merged[key];
    merged[key] =
      baseValue !== undefined && isMessageGroup(baseValue) && isMessageGroup(overrideValue)
        ? deepMerge(baseValue, overrideValue)
        : overrideValue;
  }

  return merged;
}

async function loadMessages(locale: Locale): Promise<AbstractIntlMessages> {
  const source = (await messageLoaders[defaultLocale]()).default;
  if (locale === defaultLocale) return source;

  const translated = (await messageLoaders[locale]()).default;
  return deepMerge(source, translated);
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
    timeZone,
    // A single, stable "now" per request keeps relative times consistent
    // between the server-rendered HTML and the first client render.
    now: new Date(),
  };
});
