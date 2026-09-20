import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowRight, Compass } from 'lucide-react';

import { SiteFooter } from '@/components/public/site-footer';
import { SiteHeader } from '@/components/public/site-header';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { defaultLocale, isLocale, type Locale } from '@/i18n/routing';
import { getPublicChrome } from '@/server/services/public-chrome';

/**
 * 404 inside a locale segment (§11.5: say what happened, say what to do next,
 * offer exactly one primary action — no apology, no dead end).
 *
 * ## It wears the site's frame
 * This boundary sits *above* the public layout — an unknown public URL, a
 * missing course and the admin's deliberate 404 all land here — so without its
 * own header the page was a paragraph on an empty screen, with no logo, no
 * navigation and no way on but its one button. It now renders the same header
 * and footer as every public page, from the same `getPublicChrome()` the public
 * layout reads (memoised, and it serves defaults when the database is down, so
 * a 404 can never become a 500).
 *
 * ## The illustration
 * The CFI gate — the horseshoe arch of the hero, in the same `--raw-art-*`
 * palette — at night, with a dotted trail that stops in the sand and a signpost
 * pointing both ways. Inline SVG, `aria-hidden`: decoration, no request.
 *
 * ## Below the action
 * A handful of real destinations (the catalogue, the paths, the method, the
 * contact page), for the visitor who came for something specific and would
 * rather not start again from the homepage.
 */

const QUICK_LINKS = [
  { href: '/formations', labelKey: 'formations' },
  { href: '/parcours', labelKey: 'parcours' },
  { href: '/notre-methode', labelKey: 'method' },
  { href: '/contact', labelKey: 'contact' },
] as const;

/* -------------------------------------------------------------------------- */
/* Illustration                                                                */
/* -------------------------------------------------------------------------- */

/** Brand star: two squares, one turned 45°, centred on (cx, cy). */
function Star({ cx, cy, size }: { cx: number; cy: number; size: number }): React.JSX.Element {
  const half = size / 2;
  return (
    <>
      <rect x={cx - half} y={cy - half} width={size} height={size} rx={size * 0.06} />
      <rect
        x={cx - half}
        y={cy - half}
        width={size}
        height={size}
        rx={size * 0.06}
        transform={`rotate(45 ${cx} ${cy})`}
      />
    </>
  );
}

/**
 * Horseshoe arch: circle centred (200, 196), radius 115, continued 20° past
 * the horizontal on each side — narrower at the springing than at its widest,
 * like Bab Mansour.
 */
const ARCH = 'M91.9 400 L91.9 235.3 A115 115 0 1 1 308.1 235.3 L308.1 400 Z';

function LostGate({ className }: { className?: string }): React.JSX.Element {
  return (
    <div aria-hidden="true" className={className}>
      <svg viewBox="0 0 400 440" className="block h-auto w-full overflow-visible" focusable="false">
        <defs>
          <linearGradient id="cfi-404-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--raw-art-sky-top)' }} />
            <stop offset="1" style={{ stopColor: 'var(--raw-art-sky-horizon)' }} />
          </linearGradient>
          <radialGradient id="cfi-404-halo" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" style={{ stopColor: 'var(--raw-accent-strait)', stopOpacity: 0.18 }} />
            <stop offset="1" style={{ stopColor: 'var(--raw-accent-strait)', stopOpacity: 0 }} />
          </radialGradient>
          <pattern id="cfi-404-zellige" width="36" height="36" patternUnits="userSpaceOnUse">
            <g style={{ fill: 'var(--raw-art-tile)' }} opacity="0.7">
              <Star cx={18} cy={18} size={12} />
            </g>
            <g style={{ fill: 'var(--raw-art-tile-accent)' }} opacity="0.5">
              <rect x="-2.5" y="-2.5" width="5" height="5" transform="rotate(45 0 0)" />
              <rect x="33.5" y="-2.5" width="5" height="5" transform="rotate(45 36 0)" />
              <rect x="-2.5" y="33.5" width="5" height="5" transform="rotate(45 0 36)" />
              <rect x="33.5" y="33.5" width="5" height="5" transform="rotate(45 36 36)" />
            </g>
          </pattern>
          <clipPath id="cfi-404-arch">
            <path d={ARCH} />
          </clipPath>
        </defs>

        <circle cx="200" cy="230" r="215" fill="url(#cfi-404-halo)" />

        {/* The alfiz: the rectangular frame the gate sits in. */}
        <rect
          x="40"
          y="20"
          width="320"
          height="400"
          rx="10"
          className="fill-surface stroke-hairline"
          strokeWidth="1.5"
          style={{ filter: 'drop-shadow(0 22px 36px rgb(2 8 20 / 0.2))' }}
        />
        <rect x="40" y="20" width="320" height="400" rx="10" fill="url(#cfi-404-zellige)" />
        <rect x="56" y="36" width="288" height="384" rx="4" className="fill-none stroke-brass opacity-60" strokeWidth="1.25" />

        {/* Night through the gate. */}
        <g clipPath="url(#cfi-404-arch)">
          <rect x="85" y="75" width="230" height="330" fill="url(#cfi-404-sky)" />
          {/* A crescent, and a scatter of stars. */}
          <path d="M252 122 A18 18 0 1 0 252 158 A10 18 0 1 1 252 122 Z" style={{ fill: 'var(--raw-art-sun)' }} />
          <g className="fill-white" opacity="0.85">
            <circle cx="138" cy="150" r="1.6" />
            <circle cx="170" cy="118" r="1.2" />
            <circle cx="205" cy="168" r="1.4" />
            <circle cx="282" cy="196" r="1.2" />
            <circle cx="122" cy="214" r="1.1" />
            <circle cx="232" cy="232" r="1.3" />
            <circle cx="296" cy="252" r="1" />
          </g>

          {/* Dunes, the far one lighter. */}
          <path
            d="M85 318 C130 296 170 304 204 318 S272 336 315 308 L315 405 L85 405 Z"
            style={{ fill: 'var(--raw-art-silhouette)' }}
            opacity="0.55"
          />
          <path
            d="M85 352 C122 338 168 344 206 356 S276 366 315 346 L315 405 L85 405 Z"
            style={{ fill: 'var(--raw-art-silhouette)' }}
          />

          {/* The trail, which stops. */}
          <path
            d="M204 404 C182 390 236 380 210 364"
            fill="none"
            style={{ stroke: 'var(--raw-art-sun)' }}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="0.5 10"
          />

          {/* A signpost that points both ways. */}
          <g style={{ fill: 'var(--raw-art-tile)' }}>
            <rect x="140" y="318" width="4" height="52" rx="1" />
            <path d="M144 322 H170 L176 328 L170 334 H144 Z" />
            <path d="M140 338 H116 L110 344 L116 350 H140 Z" opacity="0.85" />
          </g>
        </g>

        {/* Marble jambs and the arch's double outline. */}
        <rect x="82" y="236" width="10" height="164" rx="2" className="fill-raised stroke-hairline" strokeWidth="1" />
        <rect x="308" y="236" width="10" height="164" rx="2" className="fill-raised stroke-hairline" strokeWidth="1" />
        <path d={ARCH} className="fill-none stroke-brass" strokeWidth="3" />
        <path
          d="M83.5 400 L83.5 238.4 A124 124 0 1 1 316.5 238.4 L316.5 400"
          className="fill-none stroke-brass opacity-40"
          strokeWidth="1.25"
        />

        {/* Keystone: the CFI star, on a plate. */}
        <circle cx="200" cy="46" r="22" className="fill-surface stroke-brass" strokeWidth="1.25" />
        <g style={{ fill: 'var(--raw-art-sun)' }}>
          <Star cx={200} cy={46} size={20} />
        </g>

        {/* Threshold. */}
        <rect x="56" y="400" width="288" height="20" rx="2" className="fill-raised" />
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default async function LocaleNotFound(): Promise<React.JSX.Element> {
  const rawLocale = await getLocale();
  const locale: Locale = isLocale(rawLocale) ? rawLocale : defaultLocale;

  const [chrome, t] = await Promise.all([getPublicChrome(locale), getTranslations()]);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader brandName={chrome.brandName} brandFullName={chrome.brandFullName} />

      <main id="contenu" className="texture-bathymetric flex flex-1 items-center">
        <div
          className={cn(
            'mx-auto grid w-full max-w-6xl items-center gap-8 px-4 py-10 sm:px-6 sm:py-16',
            'md:grid-cols-[minmax(0,1fr)_minmax(0,19rem)] md:gap-12',
            'lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-20 lg:py-24',
          )}
        >
          <LostGate className="mx-auto w-full max-w-[12.5rem] sm:max-w-[15rem] md:order-last md:max-w-none" />

          <div className="flex min-w-0 flex-col items-start">
            <p className="inline-flex h-8 items-center gap-2 rounded-pill border border-hairline bg-surface px-3 font-mono text-xs uppercase tracking-[0.22em] text-ink-muted shadow-e1">
              {/* A compass is not direction-carrying in the RTL sense: never mirrored. */}
              <Compass className="size-4 text-strait" aria-hidden="true" />
              <span className="force-ltr" dir="ltr" data-numeric>
                404
              </span>
            </p>

            <h1 className="mt-5 max-w-[20ch] font-display text-display text-balance text-ink rtl:font-arabic">
              {t('errors.notFound.title')}
            </h1>

            <p className="mt-4 max-w-prose text-lead text-pretty text-ink-muted">
              {t('errors.notFound.body')}
            </p>

            <Link
              href="/"
              className={cn(
                'mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-pill bg-strait px-6 text-body font-medium text-on-accent shadow-e2 sm:w-auto',
                'transition-[box-shadow,translate,background-color] duration-[120ms] ease-[var(--ease-out-strait)]',
                'hover:bg-strait/90 hover:shadow-e3 active:translate-y-px',
              )}
            >
              {t('errors.notFound.action')}
              <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
            </Link>

            <nav aria-labelledby="not-found-links" className="hairline-t mt-10 w-full pt-6">
              <h2
                id="not-found-links"
                className="text-xs font-medium uppercase tracking-[0.14em] text-ink-muted rtl:tracking-normal"
              >
                {t('footer.usefulLinks')}
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {QUICK_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className={cn(
                        'inline-flex h-11 items-center rounded-pill border border-hairline bg-surface px-4 text-sm font-medium text-ink',
                        'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                        'hover:border-strait/40 hover:bg-strait-wash hover:text-strait',
                      )}
                    >
                      {t(`nav.${link.labelKey}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      </main>

      <SiteFooter
        brandFullName={chrome.brandFullName}
        tagline={chrome.tagline}
        contact={chrome.contact}
        socials={chrome.socials}
        categories={chrome.categories}
        whatsappMessage={t('whatsapp.prefillGeneric')}
      />
    </div>
  );
}
