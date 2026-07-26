import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { LatticeGrid, type LatticeTile } from '@/components/ui/lattice-grid';
import type { HomeLatticeTile, HomeStat } from '@/server/services/home';
import type { Locale } from '@/i18n/routing';

/**
 * §12.2 §1 — the hero, and the page's LCP element.
 *
 * ## Why this is a Server Component
 *
 * The gate for this page is Lighthouse ≥ 95 on **mobile**, so the hero ships no
 * JavaScript of its own: the headline, the promise, the two calls to action and
 * the proof numbers are server-rendered HTML, and the only client code in the
 * viewport is `LatticeGrid` — which has to be interactive, because §11.2 says
 * the Lattice is a live catalogue and not decoration. There is no image here at
 * all: the LCP candidate is text and inline SVG, both of which arrive with the
 * document.
 *
 * ## The masked reveal, without JavaScript
 *
 * §11.2 asks for one orchestrated load sequence. A `motion` timeline would cost
 * a runtime in the critical path for an animation that plays once, so the
 * headline and the proof row mask up through two CSS keyframes hoisted into a
 * de-duplicated `<style>` (React 19 `href` + `precedence`, the same technique
 * `ui/accordion.tsx` uses for a stylesheet it does not own). The lattice draws
 * itself in — that part already lives in the component.
 *
 * `animation-fill-mode: both` means the end state is also the *pre*-animation
 * state as far as layout is concerned: the text occupies its final box from the
 * first frame, so nothing shifts. `prefers-reduced-motion` removes the movement
 * and leaves everything visible — never `opacity: 0` with no way back.
 *
 * ## Three numbers, or fewer, but never a fake one
 *
 * `stats` arrives already filtered by `getHomeStats()`: a figure is only in the
 * list when the database holds enough rows to defend it (§12.2). A fresh
 * installation therefore shows « Formations » and « Domaines » and stops, rather
 * than a success rate computed from four enrolments.
 */

/** Tiles per row. With up to 24 courses this fixes the block at 6 × 4 — the
 *  aspect ratio is therefore known before the first byte, so no shift. */
const LATTICE_DENSITY = 6;
const LATTICE_ROWS = 4;

const heroKeyframes = `
@keyframes cfi-hero-mask {
  from { opacity: 0; transform: translate3d(0, 0.6em, 0); clip-path: inset(0 0 100% 0); }
  to   { opacity: 1; transform: none;                     clip-path: inset(0 0 -20% 0); }
}
.cfi-hero-reveal > * {
  animation: cfi-hero-mask 620ms var(--ease-out-strait) both;
  animation-delay: calc(var(--cfi-hero-step, 0) * 90ms);
}
@media (prefers-reduced-motion: reduce) {
  .cfi-hero-reveal > * { animation: none; }
}
`;

export interface HomeHeroProps {
  locale: Locale;
  stats: readonly HomeStat[];
  tiles: readonly HomeLatticeTile[];
}

export async function HomeHero({ locale, stats, tiles }: HomeHeroProps): Promise<React.JSX.Element> {
  const t = await getTranslations('home.hero');
  const tProof = await getTranslations('home.proof');
  const numberFormat = new Intl.NumberFormat(locale);

  const latticeTiles: LatticeTile[] = tiles.map((tile) => ({
    id: tile.id,
    label: tile.title,
    intensity: tile.intensity,
    href: `/formations/${tile.slug}`,
  }));

  return (
    <section className="texture-bathymetric relative overflow-hidden">
      <style href="cfi-home-hero" precedence="medium">
        {heroKeyframes}
      </style>

      <div className="mx-auto grid w-full max-w-6xl gap-x-12 gap-y-12 px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-center">
        <div className="cfi-hero-reveal flex flex-col">
          <p
            className="font-mono text-xs uppercase tracking-[0.22em] text-strait"
            style={{ '--cfi-hero-step': 0 } as React.CSSProperties}
          >
            {t('eyebrow')}
          </p>

          {/* The page's single h1. Two lines at every width — `text-balance`
              comes from the base layer, `max-w` keeps the measure honest. */}
          <h1
            className="mt-5 max-w-[15ch] text-hero"
            style={{ '--cfi-hero-step': 1 } as React.CSSProperties}
          >
            {t('headline')}
          </h1>

          <p
            className="mt-6 max-w-[52ch] text-lead text-ink-muted"
            style={{ '--cfi-hero-step': 2 } as React.CSSProperties}
          >
            {t('subheadline')}
          </p>

          <div
            className="mt-9 flex flex-wrap items-center gap-3"
            style={{ '--cfi-hero-step': 3 } as React.CSSProperties}
          >
            <Link
              href="/inscription"
              className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-strait px-6 text-body font-medium text-on-accent shadow-e2 transition-[box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)] hover:shadow-e3 active:translate-y-px motion-reduce:transition-none"
            >
              {t('ctaPrimary')}
              <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
            </Link>

            <Link
              href="/formations"
              className="inline-flex min-h-12 items-center rounded-pill border border-hairline px-6 text-body font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none"
            >
              {t('ctaSecondary')}
            </Link>
          </div>

          {stats.length === 0 ? null : (
            <dl
              aria-label={t('proofLabel')}
              className="mt-12 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-hairline pt-8 sm:grid-cols-3"
              style={{ '--cfi-hero-step': 4 } as React.CSSProperties}
            >
              {stats.map((stat) => (
                <div key={stat.id} className="flex flex-col gap-1">
                  <dt className="order-2 text-sm text-ink-muted">{tProof(stat.id)}</dt>
                  <dd
                    className="order-1 font-display text-title font-medium text-ink"
                    data-numeric
                  >
                    <span className="force-ltr" dir="ltr">
                      {stat.kind === 'percent'
                        ? `${numberFormat.format(stat.value)} %`
                        : numberFormat.format(stat.value)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <p
            className="mt-8 text-sm text-ink-muted"
            style={{ '--cfi-hero-step': 5 } as React.CSSProperties}
          >
            {t('trustLine')}
          </p>
        </div>

        {/* The Lattice: one tile per published course, lit by popularity, every
            tile a real link. It renders at a fixed 6 × 4 ratio whether the
            catalogue holds four courses or twenty-four — the surplus cells are
            ornament — so the column never resizes once data arrives. */}
        {latticeTiles.length === 0 ? null : (
          <div className="relative lg:pt-4" aria-hidden={false}>
            <LatticeGrid
              tiles={latticeTiles}
              label={t('latticeLabel')}
              density={LATTICE_DENSITY}
              rows={LATTICE_ROWS}
              seed="cfi-home-hero"
              className="mx-auto max-w-lg lg:max-w-none"
            />
          </div>
        )}
      </div>
    </section>
  );
}
