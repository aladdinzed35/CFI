import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { ShellControls } from '@/components/system/shell-controls';
import { ShowcaseSections } from '@/components/showcase/showcase-sections';
import { locales, type Locale } from '@/i18n/routing';

/**
 * The design-system showcase — the acceptance surface for Milestone 0 (§25).
 *
 * M0 is done when the tokens and every component render correctly in both
 * themes and in both writing directions; with four locales that means all four.
 * This page is therefore not documentation *about* the system, it is the system
 * running: every specimen below is the real component, in a real state, reading
 * the real tokens.
 *
 * It stays a Server Component. All the interactivity — the contrast probe, the
 * button-state switches, the overlays, the table — lives in the client sections
 * file, so this file ships no JavaScript of its own.
 */

type LocaleParams = { locale: string };
type ShowcaseSearchParams = { page?: string | string[] };

export function generateStaticParams(): LocaleParams[] {
  return locales.map((locale) => ({ locale }));
}

function isSupportedLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) return {};

  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'showcase' });

  return {
    title: t('title'),
    description: t('subtitle'),
    // An internal reference surface, not a page for the public index.
    robots: { index: false, follow: false },
  };
}

/** `?page=` for the pagination specimen. Clamped, so a hand-typed value is safe. */
function readPage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), 12);
}

export default async function ShowcasePage({
  params,
  searchParams,
}: {
  params: Promise<LocaleParams>;
  searchParams: Promise<ShowcaseSearchParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();

  setRequestLocale(locale);
  const [t, landing, query] = await Promise.all([
    getTranslations('showcase'),
    getTranslations('landing'),
    searchParams,
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="hairline-b">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link
            href={`/${locale}`}
            className="inline-flex items-center gap-3 rounded-md py-1"
            aria-label={landing('brandFull')}
          >
            {/* Zellige eight-point star — symmetrical, and a logo is never
                mirrored in RTL (§10.3). */}
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
              <span className="mt-1 hidden text-xs text-ink-muted sm:block">
                {landing('brandFull')}
              </span>
            </span>
          </Link>

          <ShellControls
            languageLabel={landing('languageLabel')}
            switchToLightLabel={landing('switchToLight')}
            switchToDarkLabel={landing('switchToDark')}
          />
        </div>
      </header>

      <main id="contenu" className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col gap-3 py-10">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
              {landing('eyebrow')}
            </p>
            <h1 className="max-w-3xl text-display">{t('title')}</h1>
            <p className="max-w-2xl text-lead text-ink-muted">{t('subtitle')}</p>
          </div>

          <ShowcaseSections demoPage={readPage(query.page)} />
        </div>
      </main>

      <footer className="hairline-t">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 sm:px-6">
          <Link
            href={`/${locale}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-ink"
          >
            {/* Direction-carrying: mirrored in Arabic, and turned back on itself
                because this one points the other way. */}
            <ArrowRight className="size-4 shrink-0 rotate-180 rtl:-scale-x-100" aria-hidden="true" />
            {landing('brandFull')}
          </Link>
          <p className="text-xs text-ink-muted">
            <span className="me-2">{landing('stageLabel')}</span>
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
