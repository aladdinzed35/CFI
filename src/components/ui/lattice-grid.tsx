'use client';

import { useEffect, useId, useMemo, useState } from 'react';

import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import { useDirection } from '@/hooks/use-direction';
import { useReducedMotionSafe } from '@/hooks/use-reduced-motion-safe';

/**
 * The Lattice (§11.2) — the signature element, and the only decorative
 * geometry in the system. Used in exactly three places: the homepage hero (one
 * tile per published course), the student dashboard (one tile per lesson) and
 * the certificate seal (a seeded fragment). Nowhere else.
 *
 * ## The geometry is derived, never drawn by hand
 *
 * The tile is the Moroccan *khatim*: the eight-pointed star formed by two
 * squares at 45°, i.e. the {8/2} octagram. With outer radius `R`, its sixteen
 * vertices are, exactly:
 *
 *   outer, every 45°   → radius R
 *   inner, offset 22.5° → radius R·cos(45°)/cos(22.5°)
 *
 * and that inner radius collapses to two clean numbers:
 *
 *   B = R·cos 45° = R/√2          (inner vertex, long ordinate)
 *   A = R·cos 45°·tan 22.5° = R(1 − 1/√2)
 *
 * so every vertex of both shapes is a rotation of a four-vertex quarter. That
 * is what `tessellate()` does.
 *
 * ## It really tessellates
 *
 * Place the stars on a square lattice of pitch `2R`. Neighbouring stars then
 * meet tip-to-tip exactly at each cell-edge midpoint, and the region left
 * around every lattice corner is closed by a single sixteen-vertex four-pointed
 * cross — the *chalipa* — with the same A/B construction. Star + cross tile the
 * plane with no gap and no overlap. This is the classic star-and-cross zellige
 * tiling, and it is generated here rather than traced.
 *
 * ## Direction
 *
 * RTL mirrors the *order* of the tiles, never the geometry (§10.3): the CSS
 * grid overlay flows right-to-left on its own, and the SVG cell → tile mapping
 * is mirrored to match. The star itself is eight-fold symmetric anyway;
 * flipping the drawing would be meaningless, and flipping the reading order is
 * the part that actually matters.
 *
 * ## Structure
 *
 * The SVG is a decorative layer (`aria-hidden`); the interactive layer is a
 * real list of real links laid over it on the same grid. That is deliberate:
 * links inside SVG behave inconsistently with the App Router, focus rings are
 * unreliable on `SVGAElement`, and a star's touch target would be smaller than
 * 44 px. A list of links over a drawn lattice is correct in every one of those
 * respects and looks identical.
 *
 * Reduced motion: the reveal is skipped. Everything stays interactive.
 */

export interface LatticeTile {
  /** Stable key. A course id, a lesson id, a certificate fragment index. */
  id: string;
  /** Accessible name and hover label. Already translated by the caller. */
  label: string;
  /** 0…1. Drives fill and glow: popularity in the hero, mastery on the map. */
  intensity: number;
  /** When set, the tile becomes a link. Locale-relative, as for `<Link>`. */
  href?: string;
  /** Overrides the state inferred from `intensity`. */
  state?: 'empty' | 'filled' | 'active';
}

export interface LatticeGridProps {
  tiles: readonly LatticeTile[];
  /** Accessible name of the lattice, e.g. « Nos formations ». */
  label: string;
  /** Tiles per row — the density of the tessellation. 2…16, default 6. */
  density?: number;
  /**
   * Forces a row count. Cells beyond `tiles.length` render as ornament, chosen
   * deterministically from `seed` — this is how the certificate seal gets a
   * fragment that is unique to one serial and identical on every reprint.
   */
  rows?: number;
  /** Any stable value: a certificate serial, a course id, a constant. */
  seed?: string | number;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

type Point = readonly [number, number];

/** Half the lattice pitch. The whole drawing is in these user units. */
const R = 50;
const PITCH = 2 * R;
/** R·cos 45° — the inner vertex's long ordinate. */
const B = R * Math.SQRT1_2;
/** R(1 − cos 45°) — its short one. Equal to R·cos45°·tan22.5°. */
const A = R - B;

const STAR_QUARTER: readonly Point[] = [
  [R, 0],
  [B, A],
  [B, B],
  [A, B],
];

const CROSS_QUARTER: readonly Point[] = [
  [0, -R],
  [A, -B],
  [A, -A],
  [B, -A],
];

/**
 * Expand a four-fold-symmetric quarter into the full sixteen-vertex polygon by
 * rotating it three times through 90°.
 */
function tessellate(quarter: readonly Point[]): string {
  const vertices: string[] = [];

  for (let turn = 0; turn < 4; turn += 1) {
    for (const [qx, qy] of quarter) {
      let x = qx;
      let y = qy;
      for (let step = 0; step < turn; step += 1) {
        const rotatedX = -y;
        y = x;
        x = rotatedX;
      }
      vertices.push(`${round(x)},${round(y)}`);
    }
  }

  return vertices.join(' ');
}

function round(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

const STAR_POINTS = tessellate(STAR_QUARTER);
const CROSS_POINTS = tessellate(CROSS_QUARTER);

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                    */
/* -------------------------------------------------------------------------- */

/** FNV-1a, so a serial like `CFI-2026-000123` becomes a usable 32-bit seed. */
function hashSeed(seed: string | number): number {
  const text = typeof seed === 'number' ? seed.toString(36) : seed;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast, and identical on the server and in the browser. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/* -------------------------------------------------------------------------- */
/* Cells                                                                       */
/* -------------------------------------------------------------------------- */

type CellState = 'empty' | 'filled' | 'active';

interface Cell {
  key: string;
  /** `null` on an ornamental cell that carries no datum. */
  tile: LatticeTile | null;
  row: number;
  /** Physical column in the drawing, already mirrored for RTL. */
  column: number;
  intensity: number;
  state: CellState;
  /** Reveal order, shuffled from the seed so the draw-in never reads as a wipe. */
  delayMs: number;
}

const REVEAL_STEP_MS = 26;
const REVEAL_MAX_MS = 620;

/**
 * Every lattice corner, including the ones on the border: the crosses there are
 * clipped by the viewBox, which is exactly how a real zellige panel reads at its
 * edge.
 */
function crossOrigins(columns: number, rowCount: number): Point[] {
  const origins: Point[] = [];
  for (let row = 0; row <= rowCount; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      origins.push([column, row]);
    }
  }
  return origins;
}

export function LatticeGrid({
  tiles,
  label,
  density = 6,
  rows,
  seed = 0,
  className,
}: LatticeGridProps): React.JSX.Element {
  const uid = useId();
  const { isRtl } = useDirection();
  const { reduced } = useReducedMotionSafe();
  const [revealed, setRevealed] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const columns = Math.max(2, Math.min(16, Math.round(density)));
  const rowCount = Math.max(1, rows ?? Math.ceil(Math.max(tiles.length, 1) / columns));

  const cells = useMemo<Cell[]>(() => {
    const random = createRandom(hashSeed(seed));
    const total = columns * rowCount;

    // A seeded permutation of the reveal order — and, for ornamental cells, of
    // which ones are lit at all.
    const order: number[] = Array.from({ length: total }, (_unused, index) => index);
    for (let index = total - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      const left = order[index];
      const right = order[swap];
      if (left !== undefined && right !== undefined) {
        order[index] = right;
        order[swap] = left;
      }
    }

    const built: Cell[] = [];

    for (let row = 0; row < rowCount; row += 1) {
      for (let logical = 0; logical < columns; logical += 1) {
        const index = row * columns + logical;
        const tile = tiles[index] ?? null;
        const ornamentIntensity = random() * 0.28;

        const intensity = tile === null ? ornamentIntensity : clamp01(tile.intensity);
        const state: CellState =
          tile === null ? 'empty' : (tile.state ?? (intensity > 0 ? 'filled' : 'empty'));

        const position = order[index] ?? index;

        built.push({
          key: tile?.id ?? `${uid}-ornament-${index}`,
          tile,
          row,
          // Geometry never flips; the reading order does.
          column: isRtl ? columns - 1 - logical : logical,
          intensity,
          state,
          delayMs: Math.min(REVEAL_MAX_MS, position * REVEAL_STEP_MS),
        });
      }
    }

    return built;
  }, [columns, isRtl, rowCount, seed, tiles, uid]);

  useEffect(() => {
    if (reduced) {
      setRevealed(true);
      return;
    }
    // One frame later, so the transition has a start value to animate from.
    const frame = window.requestAnimationFrame(() => setRevealed(true));
    return () => window.cancelAnimationFrame(frame);
  }, [reduced]);

  const starId = `${uid}-star`;
  const crossId = `${uid}-cross`;
  const glowId = `${uid}-glow`;

  return (
    <div className={cn('relative isolate w-full', className)}>
      <svg
        viewBox={`0 0 ${columns * PITCH} ${rowCount * PITCH}`}
        className="pointer-events-none block h-auto w-full"
        aria-hidden="true"
      >
        <defs>
          <polygon id={starId} points={STAR_POINTS} />
          <polygon id={crossId} points={CROSS_POINTS} />
          <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        {/* The crosses that close the tessellation. Pure ornament: they sit on
            every lattice corner, including the ones the viewBox clips. */}
        <g fill="none" stroke="var(--color-hairline)" strokeWidth="1.25" strokeOpacity="0.9">
          {crossOrigins(columns, rowCount).map(([column, row]) => (
            <use
              key={`cross-${column}-${row}`}
              href={`#${crossId}`}
              x={column * PITCH}
              y={row * PITCH}
            />
          ))}
        </g>

        {cells.map((cell) => {
          const x = cell.column * PITCH + R;
          const y = cell.row * PITCH + R;
          const highlighted = activeKey === cell.key;
          const paint = paintFor(cell.state, cell.intensity, highlighted);

          return (
            <g
              key={cell.key}
              style={{
                opacity: revealed ? 1 : 0,
                transition: reduced ? undefined : 'opacity 280ms var(--ease-out-strait)',
                transitionDelay: reduced ? undefined : `${cell.delayMs}ms`,
              }}
            >
              {paint.glow > 0 ? (
                <use
                  href={`#${starId}`}
                  x={x}
                  y={y}
                  fill="var(--color-strait)"
                  fillOpacity={paint.glow}
                  filter={`url(#${glowId})`}
                />
              ) : null}
              <use
                href={`#${starId}`}
                x={x}
                y={y}
                fill="var(--color-strait)"
                fillOpacity={paint.fill}
                stroke={paint.stroke}
                strokeOpacity={paint.strokeOpacity}
                strokeWidth={highlighted ? 2.4 : 1.6}
                strokeLinejoin="round"
                style={{
                  transition: reduced
                    ? undefined
                    : 'fill-opacity 160ms var(--ease-out-strait), stroke-opacity 160ms var(--ease-out-strait), stroke-width 160ms var(--ease-out-strait)',
                }}
              />
            </g>
          );
        })}
      </svg>

      <ul
        role="list"
        aria-label={label}
        className="absolute inset-0 grid"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))`,
        }}
      >
        {cells.map((cell) => {
          const { tile } = cell;

          if (tile === null) {
            return <li key={cell.key} aria-hidden="true" className="relative" />;
          }

          // Tiles in the top half reveal their label below, the bottom half
          // above, so a chip is never pushed outside the lattice.
          const below = cell.row < rowCount / 2;

          const chip = (
            <span
              className={cn(
                'pointer-events-none absolute inset-x-0 z-20 flex justify-center',
                below ? 'top-full mt-1' : 'bottom-full mb-1',
                'opacity-0 transition-opacity duration-[120ms] ease-[var(--ease-out-strait)]',
                'group-hover:opacity-100 group-focus-visible:opacity-100',
              )}
            >
              <span className="whitespace-nowrap rounded-pill border border-hairline bg-raised px-2.5 py-1 text-xs text-ink shadow-e2">
                {tile.label}
              </span>
            </span>
          );

          const interactions = {
            onPointerEnter: () => setActiveKey(cell.key),
            onPointerLeave: () => setActiveKey((current) => (current === cell.key ? null : current)),
            onFocus: () => setActiveKey(cell.key),
            onBlur: () => setActiveKey((current) => (current === cell.key ? null : current)),
          };

          return (
            <li key={cell.key} className="relative">
              {tile.href === undefined ? (
                <span
                  {...interactions}
                  className="group absolute inset-0 flex items-center justify-center rounded-md"
                >
                  <span className="sr-only">{tile.label}</span>
                  {chip}
                </span>
              ) : (
                <Link
                  href={tile.href}
                  {...interactions}
                  aria-current={tile.state === 'active' ? 'true' : undefined}
                  className="group absolute inset-0 flex items-center justify-center rounded-md"
                >
                  <span className="sr-only">{tile.label}</span>
                  {chip}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface Paint {
  fill: number;
  glow: number;
  stroke: string;
  strokeOpacity: number;
}

/**
 * Light as information: intensity drives how much of the tile is lit, and only
 * the brightest tiles earn a glow (a filter on every tile is both expensive and
 * the "glow soup" §11.2 explicitly bans).
 */
function paintFor(state: CellState, intensity: number, highlighted: boolean): Paint {
  const lit = clamp01(intensity);

  if (state === 'active') {
    return {
      fill: 0.55 + 0.35 * lit,
      glow: 0.3,
      stroke: 'var(--color-strait)',
      strokeOpacity: 1,
    };
  }

  if (state === 'filled') {
    return {
      fill: (highlighted ? 0.22 : 0.1) + 0.45 * lit,
      glow: lit >= 0.6 || highlighted ? 0.16 * lit + (highlighted ? 0.12 : 0) : 0,
      stroke: 'var(--color-strait)',
      strokeOpacity: (highlighted ? 0.6 : 0.32) + 0.45 * lit,
    };
  }

  return {
    fill: highlighted ? 0.08 : 0.03 + 0.05 * lit,
    glow: 0,
    stroke: highlighted ? 'var(--color-strait)' : 'var(--color-hairline)',
    strokeOpacity: highlighted ? 0.7 : 1,
  };
}
