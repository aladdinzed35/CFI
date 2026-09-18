import { getTranslations } from 'next-intl/server';
import { Award, MessageCircle, PlayCircle } from 'lucide-react';

/**
 * The hero's illustration: Bab Mansour, drawn rather than photographed.
 *
 * ## Why an illustration, and why this one
 * The right half of the hero used to be the course Lattice — which renders
 * nothing when the catalogue is empty. On the first production deployment the
 * database was unreachable, so half the most important screen on the site was
 * blank, and a centre with no published course yet would look the same.
 *
 * A stock photograph was the obvious replacement and the wrong one: generic
 * people at laptops read as borrowed on a real centre's homepage, and it would
 * have been the heaviest request on the page, sitting exactly where the LCP is.
 *
 * So it is drawn, and it is drawn from Meknès. The horseshoe arch in its
 * rectangular frame is Bab Mansour, the city's monumental gate; the pattern in
 * the spandrels and in the sky is the zellige eight-point star that is already
 * the CFI logo; the silhouette along the bottom is the ramparts and a minaret.
 * The sun sits in the gate, so it reads as a threshold — which is what a
 * training centre is.
 *
 * ## What it costs
 * Inline SVG and three server-rendered cards: no image request, no client
 * JavaScript, no layout shift (the aspect ratio is fixed before a byte of data).
 * Every colour is a theme token, so it retints with dark and light mode, and
 * the float animation stops for anyone who asked for reduced motion — through
 * `prefers-reduced-motion` and through the in-app setting alike.
 *
 * ## It is decoration, and says so
 * The whole visual is `aria-hidden`. The cards are an illustration of the
 * product — a course in progress, a reply from a trainer, a certificate — not
 * claims, so a screen reader must not announce « Votre formateur a répondu » as
 * if something had happened. They name a role, never an invented person.
 */

const floatKeyframes = `
@keyframes cfi-hero-float {
  0%, 100% { transform: translate3d(0, 0, 0); }
  50%      { transform: translate3d(0, -8px, 0); }
}
.cfi-hero-float {
  animation: cfi-hero-float 7s ease-in-out infinite;
  will-change: transform;
}
@media (prefers-reduced-motion: reduce) {
  .cfi-hero-float { animation: none; }
}
`;

/** Brand star: two squares, one turned 45°. Centred on (cx, cy), `size` wide. */
function Star({
  cx,
  cy,
  size,
  className,
}: {
  cx: number;
  cy: number;
  size: number;
  className?: string;
}): React.JSX.Element {
  const half = size / 2;
  return (
    <g className={className}>
      <rect x={cx - half} y={cy - half} width={size} height={size} rx={size * 0.06} />
      <rect
        x={cx - half}
        y={cy - half}
        width={size}
        height={size}
        rx={size * 0.06}
        transform={`rotate(45 ${cx} ${cy})`}
      />
    </g>
  );
}

/**
 * The horseshoe arch. Circle centred (240, 250), radius 138, continued 20°
 * past the horizontal on each side — which is what makes a Moorish arch
 * narrower at its springing line than across its widest point.
 */
const ARCH =
  'M110.3 512 L110.3 297.2 A138 138 0 1 1 369.7 297.2 L369.7 512 Z';

export interface HeroVisualProps {
  /** The most popular published course, or `null` on an empty catalogue. */
  readonly courseTitle: string | null;
}

export async function HeroVisual({ courseTitle }: HeroVisualProps): Promise<React.JSX.Element> {
  const t = await getTranslations('home.hero.visual');

  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[21rem] select-none sm:max-w-md lg:max-w-none">
      <style href="cfi-hero-visual" precedence="medium">
        {floatKeyframes}
      </style>

      {/* A fixed ratio, so the column is sized before anything paints. */}
      <div className="relative aspect-[480/560]">
        <svg
          viewBox="0 0 480 560"
          className="absolute inset-0 size-full overflow-visible"
          role="presentation"
          focusable="false"
        >
          <defs>
            {/* Dusk through the gate. `--raw-art-*`, never the UI accents:
                the light theme darkens brass for text contrast, and as the sun
                that turned it brown. Raw variables, because the theme aliases
                are inlined into utilities and are not guaranteed to exist. */}
            <linearGradient id="cfi-hero-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--raw-art-sky-top)' }} />
              <stop offset="1" style={{ stopColor: 'var(--raw-art-sky-horizon)' }} />
            </linearGradient>

            <radialGradient id="cfi-hero-sun" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.95 }} />
              <stop offset="0.45" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.45 }} />
              <stop offset="1" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0 }} />
            </radialGradient>

            {/* A halo that fades out, rather than a flat disc behind the gate. */}
            <radialGradient id="cfi-hero-halo" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" style={{ stopColor: 'var(--raw-accent-strait)', stopOpacity: 0.2 }} />
              <stop offset="1" style={{ stopColor: 'var(--raw-accent-strait)', stopOpacity: 0 }} />
            </radialGradient>

            {/* Zellige as tilework, not as an outline: the logo's star filled
                in the tile colour, set in a lattice of small accent diamonds —
                the way the real panels alternate two glazes. */}
            <pattern id="cfi-hero-zellige" width="40" height="40" patternUnits="userSpaceOnUse">
              <g style={{ fill: 'var(--raw-art-tile)' }} opacity="0.75">
                <Star cx={20} cy={20} size={14} />
              </g>
              <g style={{ fill: 'var(--raw-art-tile-accent)' }} opacity="0.55">
                <rect x="-3" y="-3" width="6" height="6" transform="rotate(45 0 0)" />
                <rect x="37" y="-3" width="6" height="6" transform="rotate(45 40 0)" />
                <rect x="-3" y="37" width="6" height="6" transform="rotate(45 0 40)" />
                <rect x="37" y="37" width="6" height="6" transform="rotate(45 40 40)" />
              </g>
            </pattern>

            {/* The same star, as a faint outline, for the sky. */}
            <pattern id="cfi-hero-zellige-sky" width="40" height="40" patternUnits="userSpaceOnUse">
              <g className="fill-none stroke-white" strokeWidth="1">
                <Star cx={20} cy={20} size={14} />
              </g>
            </pattern>

            <clipPath id="cfi-hero-arch">
              <path d={ARCH} />
            </clipPath>
          </defs>

          {/* Halo behind the whole gate. */}
          <circle cx="240" cy="280" r="250" fill="url(#cfi-hero-halo)" />

          {/* The alfiz: the rectangular frame every Moroccan gate sits in. */}
          <rect
            x="62"
            y="24"
            width="356"
            height="512"
            rx="10"
            className="fill-surface stroke-hairline"
            strokeWidth="1.5"
            style={{ filter: 'drop-shadow(0 26px 40px rgb(2 8 20 / 0.22))' }}
          />
          <rect x="62" y="24" width="356" height="512" rx="10" fill="url(#cfi-hero-zellige)" />
          <rect x="80" y="42" width="320" height="494" rx="4" className="fill-none stroke-brass opacity-60" strokeWidth="1.25" />

          {/* The opening, and everything seen through it. */}
          <g clipPath="url(#cfi-hero-arch)">
            <rect x="100" y="100" width="280" height="420" fill="url(#cfi-hero-sky)" />
            <rect x="100" y="100" width="280" height="420" fill="url(#cfi-hero-zellige-sky)" opacity="0.09" />
            <circle cx="240" cy="352" r="118" fill="url(#cfi-hero-sun)" />
            <circle cx="240" cy="352" r="40" style={{ fill: 'var(--raw-art-sun)' }} />

            {/* Meknès on the horizon: a minaret, a dome, and the ramparts the
                city is known for, crenellated. One dark silhouette, in the
                deep accent, which reads against the dusk in both themes. */}
            <g style={{ fill: 'var(--raw-art-silhouette)' }}>
              <rect x="146" y="360" width="30" height="130" />
              <rect x="150" y="344" width="22" height="18" />
              <rect x="157" y="330" width="8" height="16" />
              <circle cx="161" cy="326" r="4" />
              <path d="M268 430 a34 34 0 0 1 68 0 z" />
              <rect x="266" y="428" width="72" height="62" />
              <path d="M100 452 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 V520 H100 Z" />
            </g>
          </g>

          {/* Marble columns at the jambs, and the arch's double outline. */}
          <rect x="100" y="298" width="11" height="214" rx="2" className="fill-raised stroke-hairline" strokeWidth="1" />
          <rect x="369" y="298" width="11" height="214" rx="2" className="fill-raised stroke-hairline" strokeWidth="1" />
          <path d={ARCH} className="fill-none stroke-brass" strokeWidth="3" />
          <path
            d="M100.6 512 L100.6 300.8 A148 148 0 1 1 379.4 300.8 L379.4 512"
            className="fill-none stroke-brass opacity-40"
            strokeWidth="1.25"
          />

          {/* The keystone: the CFI star, on a plate so it reads against the tiles. */}
          <circle cx="240" cy="70" r="26" className="fill-surface stroke-brass" strokeWidth="1.25" />
          <g style={{ fill: 'var(--raw-art-sun)' }}>
            <Star cx={240} cy={70} size={24} />
          </g>

          {/* Threshold. */}
          <rect x="80" y="512" width="320" height="24" rx="2" className="fill-raised" />
        </svg>

        {/* ── Floating cards ────────────────────────────────────────────────
            Logical insets only (`start` / `end`), so the composition mirrors
            in Arabic like everything else. Kept inside the column below `lg`,
            where there is no gutter for them to hang into. */}
        <div
          className="cfi-hero-float absolute start-0 top-[21%] w-[56%] rounded-lg border border-hairline bg-surface/95 p-2.5 shadow-e3 backdrop-blur-sm sm:w-[60%] sm:p-3 lg:-start-[12%] lg:w-[58%] lg:p-4"
          style={{ animationDelay: '0s' }}
        >
          <div className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-strait sm:gap-2 sm:text-xs">
            <PlayCircle className="size-3.5 shrink-0 sm:size-4" />
            {t('courseEyebrow')}
          </div>
          <p className="mt-1 line-clamp-2 text-xs font-medium leading-snug text-ink sm:mt-1.5 sm:text-sm">
            {courseTitle ?? t('courseFallback')}
          </p>
          <div className="mt-2 flex items-center gap-2 sm:mt-3">
            <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-raised">
              <span className="block h-full w-[68%] rounded-pill bg-strait" />
            </span>
            <span className="font-mono text-xs text-ink-muted" dir="ltr">
              68 %
            </span>
          </div>
        </div>

        <div
          className="cfi-hero-float absolute end-0 top-[50%] w-[56%] rounded-lg border border-hairline bg-surface/95 p-2.5 shadow-e3 backdrop-blur-sm sm:top-[47%] sm:w-[60%] sm:p-3 lg:-end-[10%] lg:w-[56%] lg:p-4"
          style={{ animationDelay: '-2.3s' }}
        >
          <div className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-pill bg-strait-wash text-strait sm:size-7">
              <MessageCircle className="size-3 sm:size-3.5" />
            </span>
            <span className="text-[0.6875rem] font-medium leading-tight text-ink sm:text-xs">{t('mentorTitle')}</span>
          </div>
          <p className="mt-1.5 text-[0.6875rem] leading-snug text-ink-muted sm:mt-2 sm:text-xs sm:leading-relaxed">{t('mentorBody')}</p>
        </div>

        <div
          className="cfi-hero-float absolute bottom-[5%] start-[3%] flex items-center gap-2 rounded-lg border border-hairline bg-surface/95 p-2 shadow-e3 backdrop-blur-sm sm:gap-3 sm:p-3 lg:-start-[6%]"
          style={{ animationDelay: '-4.6s' }}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-pill bg-brass-wash text-brass sm:size-9">
            <Award className="size-3.5 sm:size-4.5" />
          </span>
          <span className="flex flex-col">
            <span className="text-[0.6875rem] font-medium text-ink sm:text-xs">{t('certificateTitle')}</span>
            <span className="text-[0.6875rem] text-ink-muted sm:text-xs">{t('certificateBody')}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
