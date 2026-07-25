import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/system/providers';
import { SkipLink } from '@/components/system/skip-link';
import { ThemeScript } from '@/components/system/theme-script';
import { defaultLocale, isRtl, locales, type Locale } from '@/i18n/routing';
import '@/styles/globals.css';

/**
 * Locale layout — owner of <html>, <body>, the theme bootstrap, the fonts and
 * the per-locale metadata (§10.1, §11.2, §21).
 */

type LocaleParams = { locale: string };

export function generateStaticParams(): LocaleParams[] {
  return locales.map((locale) => ({ locale }));
}

function isSupportedLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/**
 * BCP-47 tags for `lang`. The Moroccan regional variants matter: they drive
 * hyphenation, quotation marks and the digit shaping browsers pick for Arabic.
 * `:lang(ar)` in globals.css matches `ar-MA` through normal subtag matching.
 */
const HTML_LANG: Record<Locale, string> = {
  fr: 'fr-MA',
  ar: 'ar-MA',
  en: 'en',
  es: 'es',
};

/** Open Graph wants underscored locale identifiers, not BCP-47 tags. */
const OG_LOCALE: Record<Locale, string> = {
  fr: 'fr_MA',
  ar: 'ar_MA',
  en: 'en_US',
  es: 'es_ES',
};

function htmlLangFor(locale: Locale): string {
  return HTML_LANG[locale];
}

function dirFor(locale: Locale): 'ltr' | 'rtl' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

/**
 * Raw colours are forbidden in components, but a <meta name="theme-color">
 * cannot read a CSS custom property: the browser paints its chrome before any
 * stylesheet is parsed. These two values mirror `--raw-bg-abyss` (dark) and
 * `--raw-bg-abyss` (light) in src/styles/globals.css — keep them in sync.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never below 5: pinch-zoom to 200 % is a WCAG 2.2 AA requirement (§21).
  maximumScale: 5,
  colorScheme: 'dark light',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#060a12' },
    { media: '(prefers-color-scheme: light)', color: '#f6f4ef' },
  ],
};

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const active: Locale = isSupportedLocale(locale) ? locale : defaultLocale;
  setRequestLocale(active);

  const t = await getTranslations({ locale: active, namespace: 'metadata' });
  const base = siteUrl();
  const title = t('title');
  const description = t('description');
  const siteName = t('siteName');

  return {
    metadataBase: new URL(base),
    title: { default: title, template: '%s · CFI' },
    description,
    applicationName: siteName,
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [
        { url: '/brand/favicon.ico', sizes: '32x32' },
        { url: '/brand/icon-192.png', type: 'image/png', sizes: '192x192' },
      ],
      apple: [{ url: '/brand/apple-touch-icon.png', sizes: '180x180' }],
    },
    alternates: {
      canonical: `${base}/${active}`,
      languages: {
        fr: `${base}/fr`,
        ar: `${base}/ar`,
        en: `${base}/en`,
        es: `${base}/es`,
        // Slugs stay French, so the default entry points at the source locale.
        'x-default': `${base}/${defaultLocale}`,
      },
    },
    openGraph: {
      type: 'website',
      siteName,
      title,
      description,
      url: `${base}/${active}`,
      locale: OG_LOCALE[active],
      alternateLocale: locales.filter((l) => l !== active).map((l) => OG_LOCALE[l]),
      images: [{ url: '/brand/og-default.png', width: 1200, height: 630, alt: siteName }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/brand/og-default.png'],
    },
    robots: { index: true, follow: true },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    // The 404 below still renders inside this segment, so next-intl needs a
    // resolvable locale before we bail out.
    setRequestLocale(defaultLocale);
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages({ locale });
  const t = await getTranslations({ locale, namespace: 'a11y' });

  return (
    <html
      lang={htmlLangFor(locale)}
      dir={dirFor(locale)}
      /* The bootstrap script mutates <html> before React hydrates. */
      suppressHydrationWarning
    >
      <head>
        {/* Must be the very first thing the parser executes: zero theme flash. */}
        <ThemeScript />
        {/* Only the display face is preloaded (§21); the body and mono faces
            are `font-display: swap` and fetched with normal priority. */}
        <link
          rel="preload"
          href="/fonts/chillax-variable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {locale === 'ar' ? (
          <link
            rel="preload"
            href="/fonts/ibm-plex-sans-arabic-400.woff2"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        ) : null}
      </head>
      <body className="min-h-dvh bg-abyss text-ink">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <SkipLink label={t('skipToContent')} />
          <Providers toastLabel={t('notifications')}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
