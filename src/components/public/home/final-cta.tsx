import { getTranslations } from 'next-intl/server';
import { ArrowRight, MessageCircle } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { AUTH_ROUTES } from '@/server/auth';
import { ROUTES } from '@/server/auth/route-policy';
import type { Locale } from '@/i18n/routing';

/**
 * §12.2 #11 — the closing call to action.
 *
 * Two actions, and they are deliberately of different weight: registering is
 * the primary path, and WhatsApp is for the person who still has a question.
 * §12.1 already puts a WhatsApp button on every page, so this repeats it only
 * because the end of a long scroll is where an undecided visitor gives up.
 *
 * Renders for everyone. A signed-in visitor reaching the bottom of the homepage
 * is browsing, not registering, so the primary CTA points at their space rather
 * than at a registration form they have already completed.
 *
 * ## A panel, and a sunrise
 *
 * This used to be a centred paragraph on the page background, then 80 px of
 * the same background before the footer: the page did not end so much as run
 * out. It is now a contained panel on the shared content edge — a clear last
 * object, and the gap under it reads as the space before the footer.
 *
 * The panel is the bookend of the hero. The hero draws Bab Mansour with the sun
 * inside the gate; this draws the ramparts and a minaret of Meknès with the sun
 * rising behind them, under a sky of the same zellige star as the logo. « Start
 * today », drawn. It is inline SVG in the illustration palette of hero-visual
 * (`--raw-art-*`), so it costs no request, retints with the theme, and mirrors
 * in Arabic so the sun stays at the inline end. All of it is `aria-hidden`.
 */

export interface HomeFinalCtaProps {
  locale: Locale;
  whatsappUrl: string | null;
}

/* ── The skyline ─────────────────────────────────────────────────────────── */

/** A 1200 × 300 scene; the wall's walk is at y = 252. */
const WALL_TOP = 252;

/** Crenellations along [x0, x1] at height `top`: 12-wide merlons every 24. */
function merlons(x0: number, x1: number, top: number): string {
  let d = '';
  for (let x = x0; x + 12 <= x1; x += 24) {
    d += `M${x} ${top}h12v-9h-12z`;
  }
  return d;
}

/** A bastion: a taller block of wall with its own crenellations. */
function bastion(x: number, width: number, top: number): string {
  return `M${x} 300V${top}h${width}V300z${merlons(x + 4, x + width - 4, top)}`;
}

/** A Moroccan minaret: square shaft, crenellated gallery, lantern, dome, finial. */
function minaret(cx: number): string {
  const shaft = 26;
  const lantern = 12;
  return [
    `M${cx - shaft} 300V100h${shaft * 2}V300z`,
    merlons(cx - shaft + 2, cx + shaft - 2, 100),
    `M${cx - lantern} 100V70h${lantern * 2}V100z`,
    `M${cx - 9} 70a9 9 0 0 1 18 0z`,
    `M${cx - 1} 62h2v-24h-2z`,
  ].join('');
}

const SKYLINE = [
  `M0 300V${WALL_TOP}h1200V300z`,
  merlons(0, 1200, WALL_TOP),
  bastion(150, 70, 222),
  bastion(520, 90, 214),
  bastion(1120, 80, 226),
  minaret(1030),
].join('');

/** The brand star — two squares, one turned 45° — centred on (cx, cy). */
function starPath(cx: number, cy: number, size: number): string {
  const h = size / 2;
  const r = h * Math.SQRT2;
  const square = `M${cx - h} ${cy - h}h${size}v${size}h-${size}z`;
  const diamond = `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}z`;
  return square + diamond;
}

const SKY_STARS: readonly (readonly [number, number, number])[] = [
  [760, 56, 10],
  [872, 118, 7],
  [1118, 70, 12],
  [980, 30, 6],
  [690, 150, 6],
  [1170, 160, 7],
];

function FinalCtaArt(): React.JSX.Element {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 select-none">
      {/* A zellige sky: the star lattice, fading out toward the horizon. */}
      <svg
        className="absolute inset-0 size-full text-white opacity-[0.07] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
        focusable="false"
      >
        <defs>
          <pattern id="cfi-cta-lattice" width="56" height="56" patternUnits="userSpaceOnUse">
            <path d={starPath(28, 28, 18)} fill="none" stroke="currentColor" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#cfi-cta-lattice)" />
      </svg>

      {/* The sunrise over the ramparts. Pinned to the bottom, cropped from the
          inline start on narrow panels so the sun and the minaret stay in. */}
      <svg
        viewBox="0 0 1200 300"
        preserveAspectRatio="xMaxYMax slice"
        className="absolute inset-x-0 bottom-0 h-28 w-full sm:h-36 md:h-44 lg:h-64 rtl:-scale-x-100"
        focusable="false"
      >
        <defs>
          <radialGradient id="cfi-cta-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.55 }} />
            <stop offset="0.5" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.16 }} />
            <stop offset="1" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0 }} />
          </radialGradient>
          <radialGradient id="cfi-cta-horizon" cx="0.5" cy="1" r="0.8">
            <stop offset="0" style={{ stopColor: 'var(--raw-art-sky-horizon)', stopOpacity: 0.45 }} />
            <stop offset="1" style={{ stopColor: 'var(--raw-art-sky-horizon)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>

        <ellipse cx="880" cy="300" rx="420" ry="190" fill="url(#cfi-cta-horizon)" />
        <circle cx="880" cy={WALL_TOP} r="190" fill="url(#cfi-cta-glow)" />
        <circle cx="880" cy={WALL_TOP} r="62" style={{ fill: 'var(--raw-art-sun)' }} />

        <g className="fill-none stroke-white" strokeOpacity="0.5" strokeWidth="1.2">
          {SKY_STARS.map(([x, y, size]) => (
            <path key={`${x}-${y}`} d={starPath(x, y, size)} />
          ))}
        </g>

        <path d={SKYLINE} style={{ fill: 'var(--raw-art-silhouette)' }} />
      </svg>
    </div>
  );
}

/* ── The section ─────────────────────────────────────────────────────────── */

/* Pills, like every other call to action on the page, restyled for a dark
   panel: the sun's colour for the primary, a white outline for the second.
   The focus ring turns white, because the default strait ring disappears on
   a strait-blue sky. */
const PRIMARY =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-pill bg-[var(--raw-art-sun)] px-6 text-body font-medium text-[var(--raw-art-silhouette)] shadow-e2 transition-[box-shadow,transform,filter] duration-[120ms] ease-[var(--ease-out-strait)] hover:shadow-e3 hover:brightness-105 active:translate-y-px focus-visible:outline-white motion-reduce:transition-none';

const SECONDARY =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-pill border border-white/40 px-6 text-body font-medium text-white transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-white hover:bg-white/10 focus-visible:outline-white motion-reduce:transition-none';

export async function HomeFinalCta({
  locale,
  whatsappUrl,
}: HomeFinalCtaProps): Promise<React.JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'home.finalCta' });
  const tNav = await getTranslations({ locale, namespace: 'publicNav' });

  return (
    /*
      `plain` like the sections above it: after another plain section the top
      padding goes (the panel is its own separation), and no bottom padding at
      all — the footer's own top margin is the space under the panel.
    */
    <section
      aria-labelledby="home-final-title"
      data-home-band="plain"
      className="mx-auto w-full max-w-6xl px-4 pt-16 sm:px-6 sm:pt-24 [[data-home-band=plain]+&]:pt-0"
    >
      <div className="relative isolate overflow-hidden rounded-lg border border-white/10 bg-[linear-gradient(165deg,var(--raw-art-sky-top)_0%,var(--raw-accent-deep)_100%)] text-white shadow-e3">
        <FinalCtaArt />

        {/* Bottom padding clears the skyline on a phone, where the buttons
            would otherwise sit on the ramparts; from `md` the text keeps to
            the inline start and the scene has the inline end to itself. */}
        <div className="px-6 pb-36 pt-12 sm:px-10 sm:pb-44 sm:pt-16 md:max-w-[62%] md:pb-16 lg:max-w-[60%] lg:px-16 lg:py-20">
          <h2 id="home-final-title" className="max-w-[18ch] text-display text-balance text-white">
            {t('title')}
          </h2>
          <p className="mt-5 max-w-[52ch] text-lead text-pretty text-white/85">{t('body')}</p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {/* Both variants ship; CSS reveals one from `data-chrome`, written
                before the first paint. Reading the session here would make the
                homepage dynamic — see `src/styles/globals.css`. */}
            <span className="cfi-chrome-guest">
              <Link href={ROUTES.register} className={PRIMARY}>
                {t('primary')}
                <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </span>
            <span className="cfi-chrome-account">
              <Link href={AUTH_ROUTES.home} className={PRIMARY}>
                {tNav('dashboard')}
                <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </span>

            {whatsappUrl === null ? null : (
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={SECONDARY}>
                <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
                {t('secondary')}
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
