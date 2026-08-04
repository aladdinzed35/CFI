import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/system/providers';
import { SkipLink } from '@/components/system/skip-link';
import { ThemeScript } from '@/components/system/theme-script';
import { PUBLIC_EXCLUDED_NAMESPACES, omitNamespaces } from '@/i18n/client-messages';
import { defaultLocale, dirFor, htmlLangFor, isLocale, locales, type Locale } from '@/i18n/routing';
import '@/styles/globals.css';

/**
 * Locale layout — owner of <html>, <body>, the theme bootstrap, the fonts and
 * the per-locale metadata (§10.1, §11.2, §21). Everything above it in the tree
 * is a passthrough.
 */

type LocaleParams = { locale: string };

export function generateStaticParams(): LocaleParams[] {
  return locales.map((locale) => ({ locale }));
}

/**
 * The brand name is not translated copy: it is the centre's own name and stays
 * identical in all four locales (§28.2 keeps Latin brand names as-is).
 */
const BRAND_NAME = 'CFI';
const BRAND_FULL_NAME = 'CFI — Centre de Formation Immersive';

/** Open Graph wants underscored locale identifiers, not the BCP-47 tags. */
const OG_LOCALE: Record<Locale, string> = {
  fr: 'fr_MA',
  ar: 'ar_MA',
  en: 'en_US',
  es: 'es_ES',
};

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

/**
 * `<meta name="theme-color">` cannot read a CSS custom property — the browser
 * paints its own chrome before any stylesheet is parsed — so these two values
 * are written literally. They mirror `--raw-bg-abyss` in the dark and light
 * palettes of src/styles/globals.css; keep them in sync.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never lower than 5: pinch-zoom to 200 % is a WCAG 2.2 AA requirement (§21).
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
  const active: Locale = isLocale(locale) ? locale : defaultLocale;
  setRequestLocale(active);

  const t = await getTranslations({ locale: active, namespace: 'home' });
  const base = siteUrl();
  const description = t('hero.subheadline');

  return {
    metadataBase: new URL(base),
    title: { default: BRAND_FULL_NAME, template: `%s · ${BRAND_NAME}` },
    description,
    applicationName: BRAND_NAME,
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
      siteName: BRAND_NAME,
      title: BRAND_FULL_NAME,
      description,
      url: `${base}/${active}`,
      locale: OG_LOCALE[active],
      alternateLocale: locales.filter((other) => other !== active).map((other) => OG_LOCALE[other]),
      images: [{ url: '/brand/og-default.png', width: 1200, height: 630, alt: BRAND_FULL_NAME }],
    },
    twitter: {
      card: 'summary_large_image',
      title: BRAND_FULL_NAME,
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

  if (!isLocale(locale)) {
    // The 404 still renders inside this segment, so next-intl needs a
    // resolvable locale before we bail out.
    setRequestLocale(defaultLocale);
    notFound();
  }

  setRequestLocale(locale);
  // NOT the whole catalogue: whatever this provider receives is serialised into
  // the flight payload of every page beneath it, so the administration
  // vocabulary and the e-mail templates would ride along on the homepage. The
  // admin layout re-provides its own superset. See `@/i18n/client-messages`.
  const messages = omitNamespaces(await getMessages({ locale }), PUBLIC_EXCLUDED_NAMESPACES);
  const t = await getTranslations({ locale, namespace: 'a11y' });

  return (
    <html
      lang={htmlLangFor(locale)}
      dir={dirFor(locale)}
      /* The bootstrap script mutates <html> before React hydrates. */
      suppressHydrationWarning
    >
      <head>
        {/* First thing the parser executes, so the theme is right before the
            first paint. Nothing may be inserted above it. */}
        <ThemeScript />
        {/* Only the display face is preloaded (§21). The body and mono faces
            are `font-display: swap` and fetched at normal priority; the Arabic
            face is preloaded on `ar` only and is otherwise gated by its
            unicode-range, so Latin locales never download it. */}
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
