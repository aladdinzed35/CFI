'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { useDirection } from '@/hooks/use-direction';
import { cn } from '@/lib/cn';

/**
 * Rating — course ratings, read-only in the catalog and interactive in the
 * review form.
 *
 * Read-only mode renders a fractional fill (4.3 shows 30 % of the fifth star) by
 * overlaying a clipped row of filled stars on a row of outlined ones. The clip
 * is anchored with `inset-inline-start`, so the partial star fills from the
 * reading start in Arabic too.
 *
 * Interactive mode is an ARIA slider, not five buttons: one tab stop, arrow keys
 * to change (the horizontal axis is reversed in RTL, per the ARIA practice),
 * Home/End for the extremes, and each star gets its own 44 × 44 px cell so the
 * touch targets are real. `aria-valuetext` is supplied by the caller, so the
 * announcement is « 4 étoiles sur 5 » rather than « 4 ».
 */

export type RatingSize = 'sm' | 'md' | 'lg';

const starSizeClasses: Record<RatingSize, string> = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-6',
};

const gapClasses: Record<RatingSize, string> = {
  sm: 'gap-0.5',
  md: 'gap-0.5',
  lg: 'gap-1',
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

interface StarRowProps {
  count: number;
  size: RatingSize;
  filled: boolean;
  /** Interactive layout: every star sits in its own 44 px cell. */
  cells: boolean;
}

function StarRow({ count, size, filled, cells }: StarRowProps): React.JSX.Element {
  return (
    <span className={cn('flex shrink-0', cells ? 'gap-0' : gapClasses[size])}>
      {Array.from({ length: count }, (_unused, index) => (
        <span
          key={index}
          className={cn('grid shrink-0 place-items-center', cells && 'size-11')}
        >
          <Star
            className={cn(
              starSizeClasses[size],
              'shrink-0',
              filled ? 'fill-brass stroke-brass' : 'fill-none stroke-ink-muted',
            )}
            strokeWidth={1.75}
          />
        </span>
      ))}
    </span>
  );
}

export interface RatingProps {
  /** Current rating. Read-only mode accepts fractions; interactive mode snaps to `step`. */
  value: number;
  max?: number;
  size?: RatingSize;
  /** Accessible name, translated by the caller — e.g. « Note de la formation ». */
  label: string;
  /** Full announced value, e.g. « 4,5 sur 5 ». Falls back to `label`. */
  valueText?: string;
  /** Visible text next to the stars — the numeric note, the review count. */
  caption?: React.ReactNode;
  className?: string;
  /** Providing this switches the component to interactive mode. */
  onValueChange?: (value: number) => void;
  /** Increment in interactive mode. `0.5` enables half stars. */
  step?: 0.5 | 1;
  disabled?: boolean;
  /** Emits a hidden input so the value posts with a plain form. */
  name?: string;
}

export function Rating({
  value,
  max = 5,
  size = 'md',
  label,
  valueText,
  caption,
  className,
  onValueChange,
  step = 1,
  disabled = false,
  name,
}: RatingProps): React.JSX.Element {
  const { isRtl } = useDirection();
  const [hovered, setHovered] = useState<number | null>(null);

  const count = Math.max(1, Math.round(max));
  const interactive = onValueChange !== undefined;
  const enabled = interactive && !disabled;
  const current = clamp(value, 0, count);
  const shown = enabled && hovered !== null ? hovered : current;
  const percent = (shown / count) * 100;

  const commit = (next: number): void => {
    if (!enabled || onValueChange === undefined) return;
    const snapped = Math.round(clamp(next, step, count) / step) * step;
    if (snapped !== current) onValueChange(snapped);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (!enabled) return;
    const forward = isRtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = isRtl ? 'ArrowRight' : 'ArrowLeft';

    switch (event.key) {
      case forward:
      case 'ArrowUp':
        event.preventDefault();
        commit(current + step);
        break;
      case backward:
      case 'ArrowDown':
        event.preventDefault();
        commit(current - step);
        break;
      case 'Home':
        event.preventDefault();
        commit(step);
        break;
      case 'End':
        event.preventDefault();
        commit(count);
        break;
      default:
        break;
    }
  };

  const stars = (
    <span className="relative inline-flex shrink-0">
      <StarRow count={count} size={size} filled={false} cells={interactive} />
      <span
        className="pointer-events-none absolute inset-y-0 start-0 overflow-hidden"
        style={{ width: `${percent}%` }}
      >
        <StarRow count={count} size={size} filled cells={interactive} />
      </span>
    </span>
  );

  if (!interactive) {
    return (
      <span className={cn('inline-flex items-center gap-2 align-middle', className)}>
        <span role="img" aria-label={valueText ?? label} className="inline-flex">
          {stars}
        </span>
        {caption === undefined ? null : (
          <span data-numeric className="text-sm text-ink-muted">
            {caption}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-2 align-middle', className)}>
      <span
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={count}
        aria-valuenow={current}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        onKeyDown={handleKeyDown}
        onPointerLeave={() => {
          setHovered(null);
        }}
        onBlur={() => {
          setHovered(null);
        }}
        className={cn(
          'relative inline-flex items-center rounded-sm touch-manipulation',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        )}
      >
        {stars}
        <span className="absolute inset-0 flex" aria-hidden="true">
          {Array.from({ length: count }, (_unused, index) => (
            <span
              key={index}
              className={cn('flex-1', disabled ? 'pointer-events-none' : 'cursor-pointer')}
              onPointerEnter={() => {
                setHovered(index + 1);
              }}
              onClick={() => {
                commit(index + 1);
              }}
            />
          ))}
        </span>
      </span>

      {caption === undefined ? null : (
        <span data-numeric className="text-sm text-ink-muted">
          {caption}
        </span>
      )}

      {name === undefined ? null : <input type="hidden" name={name} value={current} />}
    </span>
  );
}
