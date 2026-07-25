import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import { ShellControls } from '@/components/system/shell-controls';
import { locales, type Locale } from '@/i18n/routing';

/**
 * M0 landing shell. Not the homepage — the Lattice hero and the twelve
 * marketing sections of §12.2 land in Milestone 2. What this page must do is
 * prove the shell works: brand, copy from the message catalogue, a way into the
 * design-system showcase, and the two controls that exercise both themes and
 * both directions.
 */

type LocaleParams = { locale: string };

export function generateStaticParams(): LocaleParams[] {
  return locales.map((locale) => ({ locale }));
}

function isSupportedLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export default async function LandingPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();

  setRequestLocale(locale);
  const t = await getTranslations('landing');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="hairline-b">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link
            href={`/${locale}`}
            className="inline-flex items-center gap-3 rounded-md py-1"
            aria-label={t('brandFull')}
          >
            {/* Zellige eight-point star: two squares, one rotated 45°.
                Symmetrical — a logo is never mirrored in RTL (§10.3). */}
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-7 shrink-0 text-strait"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinejoin="round"
            >
              <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="1" />
              <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="1" transform="rotate(45 12 12)" />
            </svg>
            <span className="flex flex-col leading-none">
              <span className="font-display text-heading tracking-tight text-ink">CFI</span>
              <span className="mt-1 hidden text-xs text-ink-muted sm:block">{t('brandFull')}</span>
            </span>
          </Link>

          <ShellControls
            languageLabel={t('languageLabel')}
            switchToLightLabel={t('switchToLight')}
            switchToDarkLabel={t('switchToDark')}
          />
        </div>
      </header>

      <main id="contenu" className="texture-bathymetric flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
            {t('eyebrow')}
          </p>

          <h1 className="mt-5 max-w-3xl text-display">{t('title')}</h1>

          <p className="mt-6 max-w-2xl text-lead text-ink-muted">{t('tagline')}</p>

          <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link
              href={`/${locale}/showcase`}
              className="inline-flex h-12 items-center gap-2 rounded-pill bg-strait px-6 text-sm font-medium text-on-accent shadow-e2 transition-[box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)] hover:shadow-e3 active:translate-y-px"
            >
              {t('showcaseCta')}
              {/* Direction-carrying: mirrored in Arabic. */}
              <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
            </Link>
            <p className="text-sm text-ink-muted">{t('showcaseHint')}</p>
          </div>
        </div>
      </main>

      <footer className="hairline-t">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 sm:px-6">
          <p className="text-sm text-ink-muted">{t('brandFull')} · Tanger</p>
          <p className="text-xs text-ink-muted">
            <span className="me-2">{t('stageLabel')}</span>
            <span data-numeric className="text-ink">
              <span className="force-ltr" dir="ltr">
                M0
              </span>
            </span>
          </p>
        </div>
      </footer>
    </div>
  );
}
