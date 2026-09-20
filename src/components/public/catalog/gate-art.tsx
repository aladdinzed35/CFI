import {
  BriefcaseBusiness,
  Code2,
  GraduationCap,
  Languages,
  Megaphone,
  Palette,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * The catalogue's illustration vocabulary — a small Bab Mansour, the zellige
 * backdrop and the domain icons — shared by the catalogue header and the
 * course page header so the two read as one place.
 *
 * It is the same gate the homepage hero draws, at a size that fits beside a
 * page title: the horseshoe arch in its rectangular frame, the CFI star as the
 * keystone, Meknès on the horizon. Every colour is a theme token (`--raw-art-*`
 * for the dusk, the UI tokens for the frame), so it retints with the theme; it
 * costs no image request and no client JavaScript.
 *
 * Everything here is decoration and is `aria-hidden`: the page's own heading
 * and text carry the meaning.
 */

/** The float the homepage cards use, slower, and off for reduced motion. */
const floatKeyframes = `
@keyframes cfi-gate-float {
  0%, 100% { transform: translate3d(0, 0, 0); }
  50%      { transform: translate3d(0, -6px, 0); }
}
.cfi-gate-float {
  animation: cfi-gate-float 8s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .cfi-gate-float { animation: none; }
}
`;

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
 * The horseshoe arch: a circle centred (120, 140), radius 70, continued 20°
 * past the horizontal on each side — narrower at the springing line than
 * across its widest point, which is what makes it Moorish rather than Roman.
 */
const ARCH = 'M54.2 276 L54.2 163.9 A70 70 0 1 1 185.8 163.9 L185.8 276 Z';
const ARCH_OUTER = 'M46.7 276 L46.7 166.7 A78 78 0 1 1 193.3 166.7 L193.3 276';

/** The ramparts, crenellated across the opening. */
const RAMPARTS = (() => {
  let path = 'M54 244';
  for (let x = 54; x < 180; x += 18) path += ' h9 v-7 h9 v7';
  return `${path} H186 V276 H54 Z`;
})();

export interface GateArtProps {
  /** Unique per instance on a page: it prefixes the SVG `id`s. */
  readonly id: string;
  readonly className?: string;
}

/** The gate alone, 240 × 300. Sized by its container through `className`. */
export function GateArt({ id, className }: GateArtProps): React.JSX.Element {
  const ids = {
    sky: `${id}-sky`,
    sun: `${id}-sun`,
    halo: `${id}-halo`,
    tiles: `${id}-tiles`,
    stars: `${id}-stars`,
    clip: `${id}-clip`,
  };

  return (
    <svg
      viewBox="0 0 240 300"
      className={cn('overflow-visible', className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={ids.sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--raw-art-sky-top)' }} />
          <stop offset="1" style={{ stopColor: 'var(--raw-art-sky-horizon)' }} />
        </linearGradient>

        <radialGradient id={ids.sun} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.9 }} />
          <stop offset="0.5" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0.35 }} />
          <stop offset="1" style={{ stopColor: 'var(--raw-art-sun)', stopOpacity: 0 }} />
        </radialGradient>

        <radialGradient id={ids.halo} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: 'var(--raw-accent-strait)', stopOpacity: 0.18 }} />
          <stop offset="1" style={{ stopColor: 'var(--raw-accent-strait)', stopOpacity: 0 }} />
        </radialGradient>

        {/* Zellige: the logo's star in the tile glaze, set in a lattice of
            small accent diamonds. */}
        <pattern id={ids.tiles} width="24" height="24" patternUnits="userSpaceOnUse">
          <g style={{ fill: 'var(--raw-art-tile)' }} opacity="0.7">
            <Star cx={12} cy={12} size={8.5} />
          </g>
          <g style={{ fill: 'var(--raw-art-tile-accent)' }} opacity="0.5">
            <rect x="-2" y="-2" width="4" height="4" transform="rotate(45 0 0)" />
            <rect x="22" y="-2" width="4" height="4" transform="rotate(45 24 0)" />
            <rect x="-2" y="22" width="4" height="4" transform="rotate(45 0 24)" />
            <rect x="22" y="22" width="4" height="4" transform="rotate(45 24 24)" />
          </g>
        </pattern>

        <pattern id={ids.stars} width="24" height="24" patternUnits="userSpaceOnUse">
          <g className="fill-none stroke-white" strokeWidth="0.8">
            <Star cx={12} cy={12} size={8.5} />
          </g>
        </pattern>

        <clipPath id={ids.clip}>
          <path d={ARCH} />
        </clipPath>
      </defs>

      <circle cx="120" cy="160" r="160" fill={`url(#${ids.halo})`} />

      {/* The alfiz — the rectangular frame every Moroccan gate sits in. */}
      <rect
        x="24"
        y="14"
        width="192"
        height="276"
        rx="8"
        className="fill-surface stroke-hairline"
        strokeWidth="1.25"
        style={{ filter: 'drop-shadow(0 18px 28px rgb(2 8 20 / 0.18))' }}
      />
      <rect x="24" y="14" width="192" height="276" rx="8" fill={`url(#${ids.tiles})`} />
      <rect
        x="34"
        y="24"
        width="172"
        height="266"
        rx="3"
        className="fill-none stroke-brass opacity-60"
        strokeWidth="1"
      />

      {/* The opening, and Meknès seen through it at dusk. */}
      <g clipPath={`url(#${ids.clip})`}>
        <rect x="50" y="66" width="140" height="214" fill={`url(#${ids.sky})`} />
        <rect x="50" y="66" width="140" height="214" fill={`url(#${ids.stars})`} opacity="0.1" />
        <circle cx="120" cy="214" r="66" fill={`url(#${ids.sun})`} />
        <circle cx="120" cy="214" r="22" style={{ fill: 'var(--raw-art-sun)' }} />

        <g style={{ fill: 'var(--raw-art-silhouette)' }}>
          <rect x="70" y="200" width="18" height="76" />
          <rect x="73" y="190" width="12" height="11" />
          <rect x="77" y="181" width="4" height="10" />
          <circle cx="79" cy="178" r="2.6" />
          <path d="M150 252 a18 18 0 0 1 36 0 z" />
          <rect x="148" y="251" width="40" height="25" />
          <path d={RAMPARTS} />
        </g>
      </g>

      {/* Marble jambs and the arch's double outline. */}
      <rect x="54" y="164" width="7" height="112" rx="1.5" className="fill-raised stroke-hairline" strokeWidth="0.8" />
      <rect x="179" y="164" width="7" height="112" rx="1.5" className="fill-raised stroke-hairline" strokeWidth="0.8" />
      <path d={ARCH} className="fill-none stroke-brass" strokeWidth="2.25" />
      <path d={ARCH_OUTER} className="fill-none stroke-brass opacity-40" strokeWidth="1" />

      {/* Keystone: the CFI star on a plate. */}
      <circle cx="120" cy="42" r="15" className="fill-surface stroke-brass" strokeWidth="1" />
      <g style={{ fill: 'var(--raw-art-sun)' }}>
        <Star cx={120} cy={42} size={13} />
      </g>

      {/* Threshold. */}
      <rect x="34" y="276" width="172" height="14" rx="2" className="fill-raised" />
    </svg>
  );
}

/**
 * The faint zellige field behind a page header. It fades out toward the text
 * (the inline start), and mirrors in Arabic with the rest of the layout.
 */
export function ZelligeBackdrop({
  id,
  className,
}: {
  readonly id: string;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={cn('pointer-events-none absolute inset-0 size-full rtl:-scale-x-100', className)}
    >
      <defs>
        <pattern id={`${id}-pattern`} width="44" height="44" patternUnits="userSpaceOnUse">
          <g className="fill-none stroke-strait" strokeWidth="1">
            <Star cx={22} cy={22} size={15} />
          </g>
          <g className="fill-brass">
            <rect x="-2.5" y="-2.5" width="5" height="5" transform="rotate(45 0 0)" />
            <rect x="41.5" y="-2.5" width="5" height="5" transform="rotate(45 44 0)" />
            <rect x="-2.5" y="41.5" width="5" height="5" transform="rotate(45 0 44)" />
            <rect x="41.5" y="41.5" width="5" height="5" transform="rotate(45 44 44)" />
          </g>
        </pattern>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0.25" stopColor="white" stopOpacity="0" />
          <stop offset="1" stopColor="white" stopOpacity="1" />
        </linearGradient>
        <mask id={`${id}-mask`}>
          <rect width="100%" height="100%" fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill={`url(#${id}-pattern)`}
        mask={`url(#${id}-mask)`}
        className="opacity-[0.14]"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Domain icons                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A category slug → the icon that stands for its domain. Matched on words in
 * the slug rather than on exact values, so a category created later in the
 * admin (« marketing-reseaux-sociaux ») still finds its icon; anything unknown
 * gets the mortarboard.
 */
const DOMAIN_ICONS: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  [/developpement|web|code|programm/u, Code2],
  [/marketing|communication|vente/u, Megaphone],
  [/design|creation|graph|video/u, Palette],
  [/gestion|entrepren|compta|finance/u, BriefcaseBusiness],
  [/langue|anglais|francais|arabe|espagnol/u, Languages],
  [/bureautique|(^|-)ia($|-)|intelligence|numerique/u, Sparkles],
];

export function domainIcon(slug: string | null | undefined): LucideIcon {
  if (slug === null || slug === undefined) return GraduationCap;
  for (const [pattern, icon] of DOMAIN_ICONS) {
    if (pattern.test(slug)) return icon;
  }
  return GraduationCap;
}

/** The six domains, in the order the tiles float around the gate. */
const ORBIT: ReadonlyArray<{
  readonly icon: LucideIcon;
  readonly tone: 'strait' | 'brass';
  readonly position: string;
  readonly delay: string;
}> = [
  { icon: Code2, tone: 'strait', position: 'start-0 top-[12%]', delay: '0s' },
  { icon: Megaphone, tone: 'brass', position: 'start-[4%] top-[45%]', delay: '-2.1s' },
  { icon: Palette, tone: 'strait', position: 'start-[10%] bottom-[5%]', delay: '-4.4s' },
  { icon: Sparkles, tone: 'brass', position: 'end-0 top-[6%]', delay: '-1.2s' },
  { icon: Languages, tone: 'strait', position: 'end-[3%] top-[39%]', delay: '-3.3s' },
  { icon: BriefcaseBusiness, tone: 'brass', position: 'end-[9%] bottom-[10%]', delay: '-5.6s' },
];

function Tile({
  icon: Icon,
  tone,
  className,
  delay,
  large = false,
}: {
  icon: LucideIcon;
  tone: 'strait' | 'brass';
  className?: string;
  delay?: string;
  large?: boolean;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'cfi-gate-float absolute grid place-items-center rounded-md border border-hairline bg-surface/95 shadow-e3 backdrop-blur-sm',
        large ? 'size-14 lg:size-16' : 'size-10 lg:size-12',
        className,
      )}
      style={delay === undefined ? undefined : { animationDelay: delay }}
    >
      <span
        className={cn(
          'grid place-items-center rounded-sm',
          large ? 'size-10 lg:size-11' : 'size-7 lg:size-8',
          tone === 'strait' ? 'bg-strait-wash text-strait' : 'bg-brass-wash text-brass',
        )}
      >
        <Icon className={large ? 'size-5 lg:size-6' : 'size-4 lg:size-[1.125rem]'} strokeWidth={1.75} />
      </span>
    </span>
  );
}

/**
 * The catalogue header's picture: the gate, with the six domains the centre
 * teaches floating around it — a threshold, and what lies beyond it.
 */
export function CatalogGateArt({ className }: { readonly className?: string }): React.JSX.Element {
  return (
    <div aria-hidden="true" className={cn('relative select-none', className)}>
      <style href="cfi-gate-art" precedence="medium">
        {floatKeyframes}
      </style>
      <div className="relative mx-auto aspect-[16/15] w-full">
        <GateArt id="cfi-catalog-gate" className="absolute inset-y-0 start-[12.5%] h-full w-3/4" />
        {ORBIT.map(({ icon, tone, position, delay }) => (
          <Tile key={position} icon={icon} tone={tone} className={position} delay={delay} />
        ))}
      </div>
    </div>
  );
}

/**
 * A course page's picture when the course has no cover: the same gate, with
 * the course's own domain as a tile in front of it.
 */
export function CourseGateArt({
  categorySlug,
  className,
}: {
  readonly categorySlug: string | null;
  readonly className?: string;
}): React.JSX.Element {
  const Icon = domainIcon(categorySlug);

  return (
    <div aria-hidden="true" className={cn('relative select-none', className)}>
      <style href="cfi-gate-art" precedence="medium">
        {floatKeyframes}
      </style>
      <div className="relative mx-auto aspect-[16/15] w-full">
        <GateArt id="cfi-course-gate" className="absolute inset-y-0 start-[12.5%] h-full w-3/4" />
        <Tile icon={Icon} tone="strait" large className="start-[2%] top-[18%]" delay="0s" />
        <Tile icon={Sparkles} tone="brass" className="end-[3%] top-[8%]" delay="-2.6s" />
        <Tile icon={GraduationCap} tone="brass" className="end-0 bottom-[14%]" delay="-5.1s" />
      </div>
    </div>
  );
}
