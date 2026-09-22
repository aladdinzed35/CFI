import { getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  GraduationCap,
  MapPin,
  Presentation,
  Shapes,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { HeroVisual } from '@/components/public/home/hero-visual';
import type { HomeLatticeTile, HomeStat, HomeStatId } from '@/server/services/home';
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
 *
 * ## The proof strip
 * It used to be three bare numbers over a hairline — correct, and the least
 * designed thing on the page, directly under the most designed one. It is now
 * one panel, cut into cells by hairlines that carry the zellige star at their
 * midpoint (the same eight-point star as the logo and the gate), each figure
 * crowned by its icon. Brass marks achievement (§11.2 reserves it for money
 * and achievement): the success rate and the graduates. Everything else is
 * the brand teal.
 *
 * `dl` rules still hold — every cell is a `div` holding exactly one `dt` and
 * one `dd`, and the icon and the star live INSIDE the `dd` (an element loose
 * in a `dl` group is an axe definition-list violation, which is how the last
 * redesign of this block failed CI).
 */

const STAT_ICONS: Readonly<Record<HomeStatId, { icon: LucideIcon; tone: 'strait' | 'brass' }>> = {
  learners: { icon: Users, tone: 'strait' },
  courses: { icon: BookOpen, tone: 'strait' },
  successRate: { icon: BadgeCheck, tone: 'brass' },
  graduates: { icon: GraduationCap, tone: 'brass' },
  instructors: { icon: Presentation, tone: 'strait' },
  categories: { icon: Shapes, tone: 'strait' },
};

/** The eight-point star, as a 16-point polygon in a 24 × 24 box. */
const STAR_POINTS =
  '12,1 14.2,6.7 19.8,4.2 17.3,9.8 23,12 17.3,14.2 19.8,19.8 14.2,17.3 12,23 9.8,17.3 4.2,19.8 6.7,14.2 1,12 6.7,9.8 4.2,4.2 9.8,6.7';

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

        <div className="cfi-hero-reveal flex flex-col gap-4 lg:self-start lg:[grid-area:proof]">
          {stats.length === 0 ? null : (
            <dl
              aria-label={t('proofLabel')}
              className="relative grid overflow-hidden rounded-lg border border-hairline bg-surface/70 shadow-e1 backdrop-blur-sm"
              style={
                {
                  '--cfi-hero-step': 4,
                  gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))`,
                } as React.CSSProperties
              }
            >
              {/* A line of light along the top edge, fading out at both ends. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-strait/70 to-transparent"
              />
              {stats.map((stat, index) => {
                const { icon: Icon, tone } = STAT_ICONS[stat.id];
                return (
                  <div
                    key={stat.id}
                    className={
                      index === 0
                        ? 'relative flex flex-col gap-2 px-3.5 py-5 sm:px-6 sm:py-6'
                        : 'relative flex flex-col gap-2 border-s border-hairline px-3.5 py-5 sm:px-6 sm:py-6'
                    }
                  >
                    <dt className="order-2 text-xs text-ink-muted sm:text-sm">{tProof(stat.id)}</dt>
                    <dd className="order-1 flex flex-col gap-3 sm:gap-4">
                      {index === 0 ? null : (
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          className="absolute start-0 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 fill-brass rtl:translate-x-1/2"
                        >
                          <polygon points={STAR_POINTS} />
                        </svg>
                      )}
                      <span
                        aria-hidden="true"
                        className={
                          tone === 'brass'
                            ? 'grid size-9 place-items-center rounded-md bg-brass-wash text-brass ring-1 ring-brass/25 sm:size-10'
                            : 'grid size-9 place-items-center rounded-md bg-strait-wash text-strait ring-1 ring-strait/25 sm:size-10'
                        }
                      >
                        <Icon className="size-[1.125rem] sm:size-5" />
                      </span>
                      <span
                        className="font-display text-[clamp(1.875rem,1.45rem+1.6vw,2.75rem)] leading-none font-medium tracking-[-0.03em] text-ink"
                        data-numeric
                      >
                        <span className="force-ltr" dir="ltr">
                          {numberFormat.format(stat.value)}
                          {stat.kind === 'percent' ? (
                            <span className="ms-0.5 text-[0.6em] text-strait">%</span>
                          ) : null}
                        </span>
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}

          <p
            className="flex items-start gap-3 rounded-md border border-hairline/70 bg-surface/40 px-4 py-3 text-sm text-ink-muted"
            style={{ '--cfi-hero-step': 5 } as React.CSSProperties}
          >
            <MapPin className="mt-0.5 size-4 shrink-0 text-strait" aria-hidden="true" />
            <span>{t('trustLine')}</span>
          </p>
        </div>
      </div>
    </section>
  );
}
