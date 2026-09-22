import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { HeroVisual } from '@/components/public/home/hero-visual';
import type { HomeLatticeTile, HomeStat } from '@/server/services/home';
import type { Locale } from '@/i18n/routing';

/**
 * §12.2 §1 — the hero, and the page's LCP element.
 *
 * ## Why this is a Server Component
 *
 * The gate for this page is Lighthouse ≥ 95 on **mobile**, so the hero ships no
 * JavaScript of its own: the headline, the promise, the two calls to action and
 * the proof numbers are server-rendered HTML, and so is the illustration beside
 * them (`HeroVisual`). There is no image request here at all: the LCP candidate
 * is text and inline SVG, both of which arrive with the document.
 *
 * ## Why the Lattice left the hero
 *
 * §12.2 made the course Lattice the hero's visual. It renders one tile per
 * published course — and therefore nothing at all on an empty catalogue, which
 * is exactly what the first production deployment showed: half the most
 * important screen on the site blank. The illustration is always there; the
 * catalogue itself is one section further down, in « Formations à la une ».
 *
 * ## The masked reveal, without JavaScript
 *
 * §11.2 asks for one orchestrated load sequence. A `motion` timeline would cost
 * a runtime in the critical path for an animation that plays once, so the
 * headline and the proof row mask up through two CSS keyframes hoisted into a
 * de-duplicated `<style>` (React 19 `href` + `precedence`, the same technique
 * `ui/accordion.tsx` uses for a stylesheet it does not own).
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

const heroKeyframes = `
@keyframes cfi-hero-mask {
  from { opacity: 0; transform: translate3d(0, 0.6em, 0); clip-path: inset(0 0 100% 0); }
  to   { opacity: 1; transform: none;                     clip-path: inset(-20% -20% -20% -20%); }
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

  // The card on the illustration names a real course when there is one: the
  // most popular, which is what the Lattice used to light brightest.
  const courseTitle =
    tiles.reduce<HomeLatticeTile | null>(
      (best, tile) => (best === null || tile.intensity > best.intensity ? tile : best),
      null,
    )?.title ?? null;

  return (
    <section className="texture-bathymetric relative overflow-hidden">
      <style href="cfi-home-hero" precedence="medium">
        {heroKeyframes}
      </style>

      {/* Three blocks, placed by grid area. On a phone the DOM order IS the
          reading order — intro, illustration, proof — so the picture lands
          right under the calls to action instead of below the stats, where it
          used to fall a full screen under the fold. From `lg` the intro and
          the proof stack in the left column and the illustration spans both. */}
      <div className="mx-auto grid w-full max-w-6xl gap-y-12 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-14 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-x-16 lg:gap-y-10 lg:pt-20 lg:[grid-template-areas:'intro_visual'_'proof_visual']">
        <div className="cfi-hero-reveal flex flex-col lg:self-end lg:[grid-area:intro]">
          {/* Tighter tracking below `sm`: at 0.22em the line broke before
              « · MEKNÈS » on a 360 px phone and left the city alone. */}
          <p
            className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-strait sm:text-xs sm:tracking-[0.22em]"
            style={{ '--cfi-hero-step': 0 } as React.CSSProperties}
          >
            {t('eyebrow')}
          </p>

          {/* The page's single h1, sized for the column it actually has.
              It used to take the page-wide `text-hero` — 88 px at 1920 — in a
              half-width column, and « professionnels » did not fit: six lines,
              the last word cut mid-letter by the reveal's clip-path. Capped at
              4 rem here, it sets in three or four lines at every width, and
              `break-words` is the floor under a word that still cannot fit. */}
          <h1
            className="mt-5 text-[clamp(2.25rem,1.1rem+3.6vw,4rem)] leading-[1.05] font-medium tracking-[-0.02em] text-balance break-words"
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

          {/* Full-width and stacked on a phone, side by side from `sm`: two
              buttons that wrap unevenly read as a layout bug. */}
          <div
            className="mt-8 flex flex-col gap-3 sm:mt-9 sm:flex-row sm:flex-wrap sm:items-center"
            style={{ '--cfi-hero-step': 3 } as React.CSSProperties}
          >
            <Link
              href="/inscription"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-pill bg-strait px-6 text-body font-medium text-on-accent shadow-e2 transition-[box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)] hover:shadow-e3 active:translate-y-px motion-reduce:transition-none"
            >
              {t('ctaPrimary')}
              <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
            </Link>

            <Link
              href="/formations"
              className="inline-flex min-h-12 items-center justify-center rounded-pill border border-hairline px-6 text-body font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none"
            >
              {t('ctaSecondary')}
            </Link>
          </div>
        </div>

        {/* Always rendered: an empty catalogue must not leave half the hero
            blank. The course card on it names a real course when one exists. */}
        <div className="lg:self-center lg:[grid-area:visual]">
          <HeroVisual courseTitle={courseTitle} />
        </div>

        <div className="cfi-hero-reveal flex flex-col lg:self-start lg:[grid-area:proof]">
          {stats.length === 0 ? null : (
            <dl
              aria-label={t('proofLabel')}
              className="grid grid-cols-3 gap-x-4 border-t border-hairline pt-8 sm:gap-x-6"
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
      </div>
    </section>
  );
}
