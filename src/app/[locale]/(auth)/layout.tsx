import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ShellControls } from '@/components/system/shell-controls';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';

/**
 * Shell for every authentication screen (§9.1, §11.4).
 *
 * A calm split: the brand and one quiet value line on one side, the form on the
 * other. Deliberately **not** the student or admin chrome — no sidebar, no tab
 * bar, no notification bell. Someone on these screens has no account yet, or
 * has one that cannot do anything; showing them navigation they cannot use is
 * noise, and a header that renders session state would fight the very redirects
 * these pages exist to perform.
 *
 * Below `md` the brand column disappears entirely and the form becomes the
 * page: at 360 px every pixel belongs to the fields. The two shell controls
 * (language, theme) stay reachable at both widths, because choosing the
 * interface language *before* registering is the whole point of offering four.
 */

type LocaleParams = { locale: string };

/** The zellige eight-point star: two squares, one rotated 45°. */
function BrandMark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
    >
      <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="1" />
      <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="1" transform="rotate(45 12 12)" />
    </svg>
  );
}

export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const shell = await getTranslations('landing');
  const home = await getTranslations('home');
  const footer = await getTranslations('footer');

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      {/* ── Brand column — md and up only ─────────────────────────────────── */}
      <aside className="hairline-e texture-bathymetric relative hidden flex-col justify-between p-8 md:flex lg:p-12">
        <Link
          href="/"
          aria-label={shell('brandFull')}
          className="inline-flex items-center gap-3 self-start rounded-md py-1"
        >
          <BrandMark className="size-8 shrink-0 text-strait" />
          <span className="font-display text-heading tracking-tight text-ink">CFI</span>
        </Link>

        <div className="max-w-md">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
            {home('hero.eyebrow')}
          </p>
          <p className="mt-5 font-display text-title text-balance text-ink">
            {home('hero.headline')}
          </p>
          <p className="mt-4 text-body text-pretty text-ink-muted">{home('hero.subheadline')}</p>
        </div>

        <p className="text-xs text-ink-muted">{shell('brandFull')} · Tanger</p>
      </aside>

      {/* ── Form column ───────────────────────────────────────────────────── */}
      <div className="flex min-h-dvh flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link
            href="/"
            aria-label={shell('brandFull')}
            className="inline-flex items-center gap-3 rounded-md py-1 md:invisible"
          >
            <BrandMark className="size-7 shrink-0 text-strait" />
            <span className="font-display text-heading tracking-tight text-ink">CFI</span>
          </Link>

          <ShellControls
            languageLabel={shell('languageLabel')}
            switchToLightLabel={shell('switchToLight')}
            switchToDarkLabel={shell('switchToDark')}
          />
        </header>

        <main id="contenu" className="flex flex-1 items-center px-4 py-8 sm:px-6 sm:py-12">
          <div className="mx-auto w-full max-w-md">{children}</div>
        </main>

        <footer className="px-4 py-6 sm:px-6">
          <p className="text-xs text-ink-muted">{footer('rights')}</p>
        </footer>
      </div>
    </div>
  );
}
