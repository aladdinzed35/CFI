import { getTranslations } from 'next-intl/server';
import { Award, MessageCircle } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * The brand column's illustration: the gate at dawn, with the road leading in.
 *
 * The homepage hero draws Bab Mansour at dusk; these screens draw the same gate
 * from the other side of the day, because they are the threshold itself —
 * whoever is looking at this column is about to walk through. The sun rises in
 * the arch, the road runs from the viewer to the horizon, and Meknès sits on it
 * in silhouette: ramparts, a dome, a minaret.
 *
 * ## Same rules as the hero
 * Inline SVG and two server-rendered chips: no image request, no client
 * JavaScript, no layout shift. Every colour is a theme token or one of the
 * `--raw-art-*` illustration variables, so it retints with the theme. The float
 * stops under `prefers-reduced-motion` and under the in-app setting, which
 * zeroes every animation from `globals.css`.
 *
 * ## Sized by the space it is given, not by a breakpoint
 * The column it sits in is as tall as the viewport, and the logo, the value
 * line and the footer take what they need first. The wrapper is a size
 * container, and the visual takes the largest 480:560 box that fits in it —
 * `min(100cqw, 100cqh × 480/560)` — so it never pushes the text off a short
 * laptop screen and never overflows a narrow tablet column.
 *
 * ## Decoration, and it says so
 * `aria-hidden` on the whole thing. The chips illustrate the product (a
 * certificate, a trainer's reply); they are not events, and a screen reader
 * must not announce them as if something had happened. Their copy is the
 * homepage's, on purpose: one product, described once.
 */

const floatKeyframes = `
@keyframes cfi-auth-float {
  0%, 100% { transform: translate3d(0, 0, 0); }
  50%      { transform: translate3d(0, -6px, 0); }
}
.cfi-auth-float {
  animation: cfi-auth-float 8s ease-in-out infinite;
  will-change: transform;
}
@media (prefers-reduced-motion: reduce) {
  .cfi-auth-float { animation: none; }
}
`;

/** Brand star: two squares, one turned 45°. Centred on (cx, cy), `size` wide. */
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

/** A four-point sparkle for the morning sky. */
function Sparkle({ cx, cy, r }: { cx: number; cy: number; r: number }): React.JSX.Element {
  const w = r * 0.28;
  return (
    <path
      d={`M${cx} ${cy - r} L${cx + w} ${cy - w} L${cx + r} ${cy} L${cx + w} ${cy + w} L${cx} ${cy + r} L${cx - w} ${cy + w} L${cx - r} ${cy} L${cx - w} ${cy - w} Z`}
    />
  );
}

/**
 * The horseshoe arch — the same geometry as the homepage's gate, so the two
 * read as one place: circle centred (240, 250), radius 138, continued 20° past
 * the horizontal on each side.
 */
const ARCH = 'M110.3 512 L110.3 297.2 A138 138 0 1 1 369.7 297.2 L369.7 512 Z';

/**
 * A crenellated wall from `x0` to `x1`: merlons `merlon` wide and `height`
 * tall, every `step`, standing on `top`, filled down to `bottom`.
 */
function ramparts(
  x0: number,
  x1: number,
  top: number,
  bottom: number,
  step: number,
  merlon: number,
  height: number,
): string {
  let d = `M${x0} ${top}`;
  for (let x = x0; x + step <= x1; x += step) {
    d += ` h${step - merlon} v${-height} h${merlon} v${height}`;
  }
  return `${d} H${x1} V${bottom} H${x0} Z`;
}

const GATE_WALLS = ramparts(100, 380, 446, 480, 22, 10, 9);
const BANNER_WALLS = ramparts(0, 400, 86, 104, 18, 8, 6);

export async function AuthVisual(): Promise<React.JSX.Element> {
  const t = await getTranslations('home.hero.visual');

  return (
    <div
      aria-hidden="true"
      className="relative aspect-[480/560] w-[min(100cqw,calc(100cqh*480/560))] select-none"
    >
      <style href="cfi-auth-visual" precedence="medium">
        {floatKeyframes}
      </style>

      <svg
        viewBox="0 0 480 560"
        className="absolute inset-0 size-full overflow-visible"
        role="presentation"
        focusable="false"
      >
        <defs>
          {/* Dawn: the sky runs the other way from the hero's dusk — light at
              the top of the arch is wrong for morning, so the horizon glows and
              the zenith stays deep. Same `--raw-art-*` palette, both themes. */}
          <linearGradient id="cfi-auth-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--raw-art-sky-top)' }} />
            <stop offset="0.72" style={{ stopColor: 'var(--raw-art-sky-horizon)' }} />
            <stop offset="1" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.85 }} />
          </linearGradient>

          <radialGradient id="cfi-auth-sun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.9 }} />
            <stop offset="0.5" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.35 }} />
            <stop offset="1" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0 }} />
          </radialGradient>

          <radialGradient id="cfi-auth-halo" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" style={{ stopColor: 'var(--raw-accent-strait)', stopOpacity: 0.18 }} />
            <stop offset="1" style={{ stopColor: 'var(--raw-accent-strait)', stopOpacity: 0 }} />
          </radialGradient>

          {/* The road catches the light: brightest at the horizon, fading
              towards the viewer. */}
          <linearGradient id="cfi-auth-road" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.95 }} />
            <stop offset="1" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.25 }} />
          </linearGradient>

          {/* Zellige tilework: the logo's star in the tile glaze, set in a
              lattice of accent diamonds. */}
          <pattern id="cfi-auth-zellige" width="40" height="40" patternUnits="userSpaceOnUse">
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

          <pattern id="cfi-auth-zellige-sky" width="40" height="40" patternUnits="userSpaceOnUse">
            <g className="fill-none stroke-white" strokeWidth="1">
              <Star cx={20} cy={20} size={14} />
            </g>
          </pattern>

          <clipPath id="cfi-auth-arch">
            <path d={ARCH} />
          </clipPath>
        </defs>

        <circle cx="240" cy="290" r="250" fill="url(#cfi-auth-halo)" />

        {/* The alfiz — the rectangular frame the gate is set in. */}
        <rect
          x="62"
          y="24"
          width="356"
          height="512"
          rx="10"
          className="fill-surface stroke-hairline"
          strokeWidth="1.5"
          style={{ filter: 'drop-shadow(0 24px 36px rgb(2 8 20 / 0.2))' }}
        />
        <rect x="62" y="24" width="356" height="512" rx="10" fill="url(#cfi-auth-zellige)" />
        <rect
          x="80"
          y="42"
          width="320"
          height="494"
          rx="4"
          className="fill-none stroke-brass opacity-60"
          strokeWidth="1.25"
        />

        {/* Through the gate. */}
        <g clipPath="url(#cfi-auth-arch)">
          <rect x="100" y="100" width="280" height="420" fill="url(#cfi-auth-sky)" />
          <rect
            x="100"
            y="100"
            width="280"
            height="420"
            fill="url(#cfi-auth-zellige-sky)"
            opacity="0.08"
          />

          <g className="fill-white" opacity="0.7">
            <Sparkle cx={170} cy={168} r={7} />
            <Sparkle cx={316} cy={200} r={5} />
            <Sparkle cx={282} cy={142} r={4} />
            <Sparkle cx={146} cy={250} r={4} />
          </g>

          {/* The sun, half risen behind the ramparts. */}
          <circle cx="240" cy="420" r="130" fill="url(#cfi-auth-sun)" />
          <circle cx="240" cy="422" r="42" style={{ fill: 'var(--raw-art-sun)' }} />

          {/* Meknès on the horizon: a minaret, a dome, the crenellated walls. */}
          <g style={{ fill: 'var(--raw-art-silhouette)' }}>
            <rect x="150" y="352" width="26" height="100" />
            <rect x="153" y="338" width="20" height="16" />
            <rect x="159" y="326" width="8" height="14" />
            <circle cx="163" cy="322" r="3.5" />
            <path d="M292 420 a26 26 0 0 1 52 0 z" />
            <rect x="290" y="418" width="56" height="34" />
            <path d={GATE_WALLS} />
            {/* The ground between the walls and the viewer. */}
            <path d="M100 478 Q240 468 380 478 V520 H100 Z" />
          </g>

          {/* The road in, lit by the sun at its far end. */}
          <path d="M233 472 L247 472 L312 520 L168 520 Z" fill="url(#cfi-auth-road)" />
          <path
            d="M240 476 L240 516"
            className="fill-none"
            style={{ stroke: 'var(--raw-art-silhouette)' }}
            strokeWidth="2"
            strokeDasharray="5 6"
            opacity="0.55"
          />
        </g>

        {/* Columns at the jambs, and the arch's double outline. */}
        <rect
          x="100"
          y="298"
          width="11"
          height="214"
          rx="2"
          className="fill-raised stroke-hairline"
          strokeWidth="1"
        />
        <rect
          x="369"
          y="298"
          width="11"
          height="214"
          rx="2"
          className="fill-raised stroke-hairline"
          strokeWidth="1"
        />
        <path d={ARCH} className="fill-none stroke-brass" strokeWidth="3" />
        <path
          d="M100.6 512 L100.6 300.8 A148 148 0 1 1 379.4 300.8 L379.4 512"
          className="fill-none stroke-brass opacity-40"
          strokeWidth="1.25"
        />

        {/* Keystone: the CFI star on its plate. */}
        <circle cx="240" cy="70" r="26" className="fill-surface stroke-brass" strokeWidth="1.25" />
        <g style={{ fill: 'var(--raw-art-sun)' }}>
          <Star cx={240} cy={70} size={24} />
        </g>

        {/* Threshold. */}
        <rect x="80" y="512" width="320" height="24" rx="2" className="fill-raised" />
      </svg>

      {/* Logical insets only, so the composition mirrors in Arabic. Placed in
          the sky, clear of the sun, the minaret and the road. They hang past
          the frame only from lg, where the visual is height-bound and the
          column has room on both sides; below that they stay inside it. */}
      <div
        className="cfi-auth-float absolute start-0 top-[17%] flex max-w-[64%] lg:-start-[12%] items-center gap-2 rounded-lg border border-hairline bg-surface/95 p-2 shadow-e3 backdrop-blur-sm lg:gap-3 lg:p-3"
        style={{ animationDelay: '-1.2s' }}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-pill bg-brass-wash text-brass lg:size-9">
          <Award className="size-3.5 lg:size-4.5" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[0.6875rem] font-medium leading-tight text-ink lg:text-xs">
            {t('certificateTitle')}
          </span>
          <span className="text-[0.6875rem] leading-tight text-ink-muted lg:text-xs">
            {t('certificateBody')}
          </span>
        </span>
      </div>

      <div
        className="cfi-auth-float absolute end-0 top-[45%] w-[60%] lg:-end-[12%] rounded-lg border border-hairline bg-surface/95 p-2.5 shadow-e3 backdrop-blur-sm lg:p-3"
        style={{ animationDelay: '-4.8s' }}
      >
        <div className="flex items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-pill bg-strait-wash text-strait lg:size-7">
            <MessageCircle className="size-3 lg:size-3.5" />
          </span>
          <span className="text-[0.6875rem] font-medium leading-tight text-ink lg:text-xs">
            {t('mentorTitle')}
          </span>
        </div>
        <p className="mt-1.5 text-[0.6875rem] leading-snug text-ink-muted lg:text-xs">
          {t('mentorBody')}
        </p>
      </div>
    </div>
  );
}

/**
 * The same morning, as a strip, for phones — where the brand column is hidden
 * and these screens would otherwise open on a bare form. Short on purpose
 * (≈ 90 px at 360): it sets the place, then gets out of the way of the fields.
 */
export function AuthBanner({ className }: { className?: string }): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden rounded-lg border border-hairline bg-surface shadow-e1 select-none',
        className,
      )}
    >
      <svg
        viewBox="0 0 400 112"
        className="block h-auto w-full"
        role="presentation"
        focusable="false"
      >
        <defs>
          <linearGradient id="cfi-auth-banner-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--raw-art-sky-top)' }} />
            <stop offset="0.7" style={{ stopColor: 'var(--raw-art-sky-horizon)' }} />
            <stop offset="1" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.85 }} />
          </linearGradient>
          <radialGradient id="cfi-auth-banner-sun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.85 }} />
            <stop offset="0.5" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.3 }} />
            <stop offset="1" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0 }} />
          </radialGradient>
          <pattern
            id="cfi-auth-banner-sky-tiles"
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <g className="fill-none stroke-white" strokeWidth="0.8">
              <Star cx={14} cy={14} size={10} />
            </g>
          </pattern>
          <pattern id="cfi-auth-banner-tiles" width="16" height="8" patternUnits="userSpaceOnUse">
            <g style={{ fill: 'var(--raw-art-tile)' }} opacity="0.8">
              <Star cx={8} cy={4} size={4.6} />
            </g>
          </pattern>
        </defs>

        <rect width="400" height="104" fill="url(#cfi-auth-banner-sky)" />
        <rect width="400" height="104" fill="url(#cfi-auth-banner-sky-tiles)" opacity="0.08" />

        <g className="fill-white" opacity="0.7">
          <Sparkle cx={58} cy={26} r={5} />
          <Sparkle cx={146} cy={18} r={3.5} />
          <Sparkle cx={262} cy={30} r={4} />
          <Sparkle cx={352} cy={20} r={5} />
        </g>

        <circle cx="200" cy="88" r="78" fill="url(#cfi-auth-banner-sun)" />
        <circle cx="200" cy="88" r="22" style={{ fill: 'var(--raw-art-sun)' }} />

        <g style={{ fill: 'var(--raw-art-silhouette)' }}>
          {/* Minaret. */}
          <rect x="300" y="48" width="18" height="44" />
          <rect x="302" y="38" width="14" height="11" />
          <rect x="306" y="29" width="6" height="10" />
          <circle cx="309" cy="26" r="2.5" />
          {/* Dome. */}
          <path d="M74 80 a20 20 0 0 1 40 0 z" />
          <rect x="72" y="78" width="44" height="14" />
          <path d={BANNER_WALLS} />
        </g>

        {/* A band of zellige along the bottom edge. */}
        <rect y="104" width="400" height="8" className="fill-raised" />
        <rect y="104" width="400" height="8" fill="url(#cfi-auth-banner-tiles)" />
      </svg>
    </div>
  );
}
