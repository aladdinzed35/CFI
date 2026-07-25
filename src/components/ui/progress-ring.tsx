'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotionSafe } from '@/hooks/use-reduced-motion-safe';
import { cn } from '@/lib/cn';

/**
 * ProgressRing — course completion, quiz score, storage quota.
 *
 * Fills **once**, when it first scrolls into view, then never animates again on
 * its own. No loop, no re-trigger on scroll-back.
 *
 * Direction: the ring starts at 12 o'clock and fills clockwise in French *and*
 * in Arabic. A ring is a clock face, and clocks are never mirrored (§10.3) — so
 * the SVG carries a plain `-rotate-90` and no `rtl:` variant.
 */

export type ProgressRingSize = 'sm' | 'md' | 'lg' | 'xl';
export type ProgressRingTone = 'strait' | 'brass' | 'success' | 'warn' | 'danger';

interface RingGeometry {
  readonly box: number;
  readonly stroke: number;
}

const geometry: Record<ProgressRingSize, RingGeometry> = {
  sm: { box: 48, stroke: 4 },
  md: { box: 72, stroke: 6 },
  lg: { box: 104, stroke: 8 },
  xl: { box: 152, stroke: 10 },
};

const toneClasses: Record<ProgressRingTone, string> = {
  strait: 'stroke-strait',
  brass: 'stroke-brass',
  success: 'stroke-success',
  warn: 'stroke-warn',
  danger: 'stroke-danger',
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export interface ProgressRingProps {
  /** Percentage, 0–100. */
  value: number;
  /** Accessible name, translated by the caller. */
  label: string;
  /** Announced instead of the raw number, e.g. « 72 % terminé ». */
  valueText?: string;
  size?: ProgressRingSize;
  tone?: ProgressRingTone;
  /** Centre slot — a percentage, a score, an icon. Decorative: it is aria-hidden. */
  children?: React.ReactNode;
  className?: string;
}

export function ProgressRing({
  value,
  label,
  valueText,
  size = 'md',
  tone = 'strait',
  children,
  className,
}: ProgressRingProps): React.JSX.Element {
  const { box, stroke } = geometry[size];
  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = clampPercent(value);
  const filledOffset = circumference * (1 - percent / 100);

  const { reduced } = useReducedMotionSafe();
  const rootRef = useRef<HTMLDivElement>(null);
  // Starts empty so the fill has somewhere to travel from; SSR renders it empty
  // too, and the effect below settles it on the very first client commit when
  // motion is reduced or IntersectionObserver is unavailable.
  const [dashOffset, setDashOffset] = useState(circumference);

  useEffect(() => {
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setDashOffset(filledOffset);
      return;
    }

    const node = rootRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setDashOffset(filledOffset);
            observer.disconnect();
            return;
          }
        }
      },
      { threshold: 0.35 },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [filledOffset, reduced]);

  return (
    <div
      ref={rootRef}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={valueText}
      className={cn('relative inline-block shrink-0 align-middle', className)}
      style={{ width: box, height: box }}
    >
      <svg
        width={box}
        height={box}
        viewBox={`0 0 ${box} ${box}`}
        className="-rotate-90"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          strokeWidth={stroke}
          className="fill-none stroke-raised"
        />
        <circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          strokeWidth={stroke}
          strokeLinecap="round"
          className={cn(
            'fill-none transition-[stroke-dashoffset] duration-300 ease-[var(--ease-out-strait)] motion-reduce:transition-none',
            toneClasses[tone],
          )}
          style={{ strokeDasharray: circumference, strokeDashoffset: dashOffset }}
        />
      </svg>

      {children === undefined ? null : (
        <div
          className="absolute inset-0 grid place-items-center text-center leading-none"
          aria-hidden="true"
        >
          {children}
        </div>
      )}
    </div>
  );
}
