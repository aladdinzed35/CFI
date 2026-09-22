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
@keyframes cfi-hero-tick {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
.cfi-hero-tick {
  transform-origin: 0% 50%;
  animation: cfi-hero-tick 720ms var(--ease-out-strait) both;
  animation-delay: 420ms;
}
[dir='rtl'] .cfi-hero-tick { transform-origin: 100% 50%; }
@media (prefers-reduced-motion: reduce) {
  .cfi-hero-reveal > * { animation: none; }
  .cfi-hero-tick { animation: none; }
}
`;

/* -------------------------------------------------------------------------- */
/* The proof block's zellige                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The figures are not set on a rule, they are set on a panel of the same
 * tilework the gate beside them carries: a real khatam net, a brass thread
 * strung across it with a knot over each figure, and the trust line tied
 * inside the panel rather than dropped under it.
 *
 * ## Why the geometry is real
 * `STAR` is a square unioned with the same square turned 45 degrees: eight tips
 * at radius R and eight re-entrant vertices at R*(1-sqrt(1/2)), where the two
 * squares' edges cross. Stars on a square lattice of side 2R touch tip to tip,
 * and what they leave at each cell centre is a pointed cross whose every edge
 * is already a star edge — so the tile carries four quarter-stars and the
 * crosses draw themselves in the negative space.
 *
 * ## The masks are the design
 * The net never comes near a numeral. Below 480 px it stands as a wall on the
 * side of the column the text is not on (mirrored in Arabic). From 480 px it
 * lies down into a frieze across the top — solid through the thread, gone
 * before the figures — the way a gate carries its band of zellige above the
 * opening and nothing over the threshold. Where a browser has no mask at all
 * the net is removed rather than left behind the numbers, and high-contrast
 * mode drops it and strengthens the thread instead.
 *
 * Brass stays hairline-weight throughout (§11.2 reserves it for money and
 * achievement): a 1 px thread, 7 px nodes, a 1.15 px knot outline.
 */

const K = Math.SQRT1_2;
const J = 1 - Math.SQRT1_2;

const STAR: readonly (readonly [number, number])[] = [
  [1, 0], [K, J], [K, K], [J, K], [0, 1], [-J, K], [-K, K], [-K, J],
  [-1, 0], [-K, -J], [-K, -K], [-J, -K], [0, -1], [J, -K], [K, -K], [K, -J],
];

function star(cx: number, cy: number, r: number): string {
  return `${STAR.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(cx + x * r).toFixed(2)} ${(cy + y * r).toFixed(2)}`).join(' ')}Z`;
}

/** One cell of the net: four quarter-stars. The crosses are what is left. */
const CELL = 44;
const NET = [star(0, 0, CELL / 2), star(CELL, 0, CELL / 2), star(0, CELL, CELL / 2), star(CELL, CELL, CELL / 2)].join(' ');

/** The knot on the thread, and the cross-node at its heart. */
const KNOT = star(12, 12, 10.4);
const KNOT_CORE = 'M12 7.9 L16.1 12 L12 16.1 L7.9 12 Z';

const proofStyles = `
.cfi-proof{--net:.38;--thread:.36;--bead:.85;--node:.55}
:root[data-theme='light'] .cfi-proof{--net:.16;--thread:.42;--bead:.9;--node:.6}
@media (prefers-color-scheme:light){
  :root:not([data-theme]) .cfi-proof{--net:.16;--thread:.42;--bead:.9;--node:.6}
}
:root[data-contrast='high'] .cfi-proof{--thread:.8;--bead:1;--node:.9}

/* Below 480px: a wall of tile standing on the side the text is not on. */
.cfi-proof-net{
  opacity:var(--net);
  -webkit-mask-image:radial-gradient(ellipse 88% 92% at 18% 50%,transparent 0%,transparent 44%,black 86%);
  mask-image:radial-gradient(ellipse 88% 92% at 18% 50%,transparent 0%,transparent 44%,black 86%);
}
[dir='rtl'] .cfi-proof-net{
  -webkit-mask-image:radial-gradient(ellipse 88% 92% at 82% 50%,transparent 0%,transparent 44%,black 86%);
  mask-image:radial-gradient(ellipse 88% 92% at 82% 50%,transparent 0%,transparent 44%,black 86%);
}
:root[data-contrast='high'] .cfi-proof-net{display:none}
@supports not ((-webkit-mask-image:linear-gradient(black,transparent)) or (mask-image:linear-gradient(black,transparent))){
  .cfi-proof-net{display:none}
}
.cfi-proof-net-in{
  -webkit-mask-image:linear-gradient(to bottom,transparent 0%,black 9%,black 90%,transparent 100%);
  mask-image:linear-gradient(to bottom,transparent 0%,black 9%,black 90%,transparent 100%);
  animation:cfi-proof-fade 900ms var(--ease-out-strait) both;
  animation-delay:60ms;
}

/* The leading line: down the start edge on a phone, the corner of an L above. */
.cfi-proof::before{
  content:'';position:absolute;inset-inline-start:20px;inset-block-start:0;inset-block-end:.45rem;width:1px;
  background:var(--color-brass);opacity:var(--thread);
  -webkit-mask-image:linear-gradient(to bottom,black 0%,black 74%,transparent 100%);
  mask-image:linear-gradient(to bottom,black 0%,black 74%,transparent 100%);
  transform-origin:50% 0;animation:cfi-proof-draw-y 820ms var(--ease-out-strait) both;animation-delay:140ms;
}
.cfi-proof::after{
  content:'';position:absolute;inset-inline-start:17px;inset-block-start:-3px;width:7px;height:7px;
  background:var(--color-brass);opacity:var(--node);transform:rotate(45deg);
  animation:cfi-proof-node-in 480ms var(--ease-out-strait) both;animation-delay:120ms;
}

.cfi-proof-bead{
  position:absolute;display:block;inset-inline-start:-33px;inset-block-start:50%;margin-block-start:-13px;width:26px;height:26px;
  animation:cfi-proof-bead-in 560ms var(--ease-out-strait) both;animation-delay:calc(var(--i, 0) * 110ms + 230ms);
}
.cfi-proof-bead-i{opacity:var(--bead)}
.cfi-proof-num{animation:cfi-proof-rise 620ms var(--ease-out-strait) both;animation-delay:calc(var(--i, 0) * 110ms + 190ms)}
.cfi-proof-lab{animation:cfi-proof-rise 620ms var(--ease-out-strait) both;animation-delay:calc(var(--i, 0) * 110ms + 270ms)}
.cfi-proof-capline{animation:cfi-proof-rise 620ms var(--ease-out-strait) both;animation-delay:640ms}

@media (min-width:480px){
  .cfi-proof-net,[dir='rtl'] .cfi-proof-net{
    -webkit-mask-image:linear-gradient(to bottom,transparent 0%,black 9%,black 21%,transparent 46%);
    mask-image:linear-gradient(to bottom,transparent 0%,black 9%,black 21%,transparent 46%);
  }
  .cfi-proof-net-in{
    -webkit-mask-image:linear-gradient(to right,transparent 0%,black 8%,black 92%,transparent 100%);
    mask-image:linear-gradient(to right,transparent 0%,black 8%,black 92%,transparent 100%);
  }
  .cfi-proof::before{inset-inline-start:0;inset-block-start:12px}
  .cfi-proof::after{inset-inline-start:-3px;inset-block-start:9px}
  .cfi-proof-fig::before{
    content:'';display:block;position:absolute;inset-block-start:12px;inset-inline:0;height:1px;
    background:var(--color-brass);opacity:var(--thread);transform-origin:0 50%;
    animation:cfi-proof-draw-x 720ms var(--ease-out-strait) both;animation-delay:calc(var(--i, 0) * 90ms + 180ms);
  }
  [dir='rtl'] .cfi-proof-fig::before{transform-origin:100% 50%}
  .cfi-proof-fig:last-child::after{
    content:'';display:block;position:absolute;inset-inline-end:-3px;inset-block-start:9px;width:7px;height:7px;
    background:var(--color-brass);opacity:var(--node);transform:rotate(45deg);
    animation:cfi-proof-node-in 480ms var(--ease-out-strait) both;animation-delay:calc(var(--i, 0) * 90ms + 520ms);
  }
  .cfi-proof-bead{inset-inline-start:50%;margin-inline-start:-13px;inset-block-start:-1px;margin-block-start:0}
}

@keyframes cfi-proof-draw-y{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes cfi-proof-draw-x{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes cfi-proof-rise{from{opacity:0;transform:translate3d(0,10px,0)}to{opacity:1;transform:none}}
@keyframes cfi-proof-bead-in{from{opacity:0;transform:rotate(-45deg) scale(.4)}to{opacity:1;transform:none}}
@keyframes cfi-proof-node-in{from{opacity:0;transform:rotate(45deg) scale(.3)}to{opacity:var(--node);transform:rotate(45deg) scale(1)}}
@keyframes cfi-proof-fade{from{opacity:0}to{opacity:1}}

@media (prefers-reduced-motion:reduce){
  .cfi-proof-net-in,.cfi-proof::before,.cfi-proof::after,.cfi-proof-fig::before,
  .cfi-proof-fig:last-child::after,.cfi-proof-bead,.cfi-proof-num,.cfi-proof-lab,.cfi-proof-capline{animation:none}
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

        {/* The proof block has its own choreography — the net fades in, the
            thread draws, the knots land, the figures rise — so it is not also
            wrapped in the hero's reveal. */}
        <div className="cfi-proof relative isolate flex flex-col lg:self-start lg:[grid-area:proof]">
          <style href="cfi-home-proof" precedence="medium">
            {proofStyles}
          </style>

          {stats.length === 0 ? null : (
            <div className="relative">
              {/* The tilework. Masked away from every band that is read, and
                  kept inside this box so it cannot reach the buttons above. */}
              <div
                aria-hidden="true"
                className="cfi-proof-net pointer-events-none absolute -top-2 -bottom-6 -start-3 -end-3 -z-10 text-strait"
              >
                <svg className="cfi-proof-net-in size-full" role="presentation" focusable="false">
                  <defs>
                    <pattern id="cfi-home-khatam" width={CELL} height={CELL} patternUnits="userSpaceOnUse">
                      <path d={NET} fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#cfi-home-khatam)" />
                </svg>
              </div>

              <dl aria-label={t('proofLabel')} className="flex flex-col sm:flex-row sm:items-start">
                {stats.map((stat, index) => (
                  <div
                    key={stat.id}
                    className="cfi-proof-fig relative flex flex-col items-start py-5 pe-0 ps-10 sm:min-w-0 sm:flex-1 sm:items-center sm:py-0 sm:pe-2 sm:ps-2 sm:text-center"
                    style={{ '--i': index } as React.CSSProperties}
                  >
                    <dt className="cfi-proof-lab order-2 mt-2.5 font-mono text-[0.6875rem] tracking-[0.16em] text-ink-muted uppercase rtl:font-arabic rtl:text-xs rtl:normal-case rtl:tracking-normal sm:mt-3.5 lg:text-xs lg:tracking-[0.18em]">
                      {tProof(stat.id)}
                    </dt>
                    <dd
                      className="relative order-1 font-display text-[clamp(2.5rem,1.15rem+2.7vw,3.5rem)] leading-none font-medium tracking-[-0.02em] text-ink sm:pt-[3.25rem]"
                      data-numeric
                    >
                      {/* The knot: the net's own node, strung on the thread. */}
                      <span aria-hidden="true" className="cfi-proof-bead">
                        <svg viewBox="0 0 24 24" className="cfi-proof-bead-i size-full" role="presentation" focusable="false">
                          <path d={KNOT} className="fill-none stroke-brass" strokeWidth="1.15" strokeLinejoin="round" />
                          <path d={KNOT_CORE} className="fill-strait" />
                        </svg>
                      </span>

                      <span className="cfi-proof-num force-ltr" dir="ltr">
                        {numberFormat.format(stat.value)}
                        {stat.kind === 'percent' ? (
                          <span className="ps-[0.1em] text-[0.44em] font-medium text-ink-muted">%</span>
                        ) : null}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <div className="relative mt-7 pe-0 ps-10 sm:mt-10 sm:ps-5">
            <p className="cfi-proof-capline max-w-[48ch] text-xs leading-relaxed text-balance text-ink-muted">
              {t('trustLine')}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
