import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ShellControls } from '@/components/system/shell-controls';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';

import { AuthBanner, AuthVisual } from './auth-visual';

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
 * The brand column carries an illustration — the gate of Meknès at dawn
 * (`auth-visual.tsx`) — sized to whatever height the text leaves it. Below `md`
 * the column disappears and the form becomes the page, opened by a ninety-pixel
 * strip of the same morning so the screen still says where it is; after that,
 * every pixel belongs to the fields. The two shell controls (language, theme)
 * stay reachable at both widths, because choosing the interface language
 * *before* registering is the whole point of offering four.
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
      {/* The column stretches with the form beside it (the registration form
          is three screens tall), so its border and texture run the full page;
          its content is sticky and exactly one viewport tall, so the gate
          stays in view while the fields scroll past. */}
      <aside className="hairline-e texture-bathymetric relative hidden bg-surface md:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-6 p-8 lg:gap-8 lg:p-12">
          <Link
            href="/"
            aria-label={shell('brandFull')}
            className="inline-flex items-center gap-3 self-start rounded-md py-1"
          >
            <BrandMark className="size-8 shrink-0 text-strait" />
            <span className="font-display text-heading tracking-tight text-ink">CFI</span>
          </Link>

          {/* A size container: the visual takes the largest 480:560 box that
              fits whatever height the text leaves it, and disappears on a
              viewport too short to give it any. */}
          <div className="flex min-h-0 flex-1 items-center justify-center [container-type:size] [@media(max-height:34rem)]:hidden">
            <AuthVisual />
          </div>

          <div className="max-w-md">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
              {home('hero.eyebrow')}
            </p>
            <p className="mt-4 font-display text-heading text-balance text-ink lg:text-title">
              {home('hero.headline')}
            </p>
            <p className="mt-3 max-w-[46ch] text-sm text-pretty text-ink-muted lg:text-body">
              {home('hero.subheadline')}
            </p>
          </div>

          <p className="text-xs text-ink-muted">{shell('brandFull')} · Meknès</p>
        </div>
      </aside>

      {/* ── Form column ───────────────────────────────────────────────────── */}
      <div className="flex min-h-dvh min-w-0 flex-col">
        {/* One row down to 360 px: the language control and the theme button
            need 250 px, so under 380 px the mark stands alone — the link keeps
            its accessible name, and the banner below says where this is. */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link
            href="/"
            aria-label={shell('brandFull')}
            className="inline-flex min-h-11 items-center gap-3 rounded-md md:invisible"
          >
            <BrandMark className="size-7 shrink-0 text-strait" />
            <span className="hidden font-display text-heading tracking-tight text-ink min-[23.75rem]:inline">
              CFI
            </span>
          </Link>

          <ShellControls
            languageLabel={shell('languageLabel')}
            switchToLightLabel={shell('switchToLight')}
            switchToDarkLabel={shell('switchToDark')}
          />
        </header>

        <main id="contenu" className="flex flex-1 items-center px-4 pt-2 pb-8 sm:px-6 sm:py-12">
          <div className="mx-auto w-full max-w-md">
            {/* Phones get the same place in miniature: the brand column is
                gone below md, and without it these screens are a bare form. */}
            <AuthBanner className="mb-6 md:hidden" />
            {children}
          </div>
        </main>

        <footer className="px-4 py-6 sm:px-6">
          {/* On the form's edge, not the column's: at md and up the form is a
              centred 28 rem measure, and a footer line starting 100 px to its
              side read as belonging to nothing. */}
          <p className="mx-auto w-full max-w-md text-xs text-ink-muted">{footer('rights')}</p>
        </footer>
      </div>
    </div>
  );
}
