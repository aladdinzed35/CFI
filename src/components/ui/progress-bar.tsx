import { cn } from '@/lib/cn';

/**
 * ProgressBar — lesson, module and course progress; upload progress; quota bars.
 *
 * A plain `role="progressbar"` div rather than a Radix primitive: this needs no
 * state, so it stays a server component and costs zero JavaScript on the many
 * screens that render dozens of them.
 *
 * RTL: the fill is a block-level child, so it grows from the inline start on its
 * own — the bar mirrors correctly in Arabic without a single physical property.
 */

export type ProgressTone = 'strait' | 'brass' | 'success' | 'warn' | 'danger';
export type ProgressSize = 'xs' | 'sm' | 'md';

const toneClasses: Record<ProgressTone, string> = {
  strait: 'bg-strait',
  brass: 'bg-brass',
  success: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

const sizeClasses: Record<ProgressSize, string> = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2.5',
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export interface ProgressBarProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children'> {
  /** Percentage, 0–100. Non-finite input is treated as 0 rather than rendered as NaN. */
  value: number;
  /** Accessible name, translated by the caller. Required — a bare bar means nothing. */
  label: string;
  /** Human-readable value announced instead of the raw number, e.g. « 45 % ». */
  valueText?: string;
  tone?: ProgressTone;
  size?: ProgressSize;
  /** Renders `label` and `valueText` above the track. */
  showLabel?: boolean;
}

export function ProgressBar({
  value,
  label,
  valueText,
  tone = 'strait',
  size = 'sm',
  showLabel = false,
  className,
  ...props
}: ProgressBarProps): React.JSX.Element {
  const percent = clampPercent(value);

  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)} {...props}>
      {showLabel ? (
        <div className="flex items-baseline justify-between gap-3 text-sm" aria-hidden="true">
          <span className="min-w-0 truncate text-ink-muted">{label}</span>
          {valueText === undefined ? null : (
            <span data-numeric className="shrink-0 text-ink">
              {valueText}
            </span>
          )}
        </div>
      ) : null}

      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={valueText}
        className={cn('w-full overflow-hidden rounded-pill bg-raised', sizeClasses[size])}
      >
        <div
          className={cn(
            'h-full rounded-pill transition-[width] duration-300 ease-[var(--ease-out-strait)] motion-reduce:transition-none',
            toneClasses[tone],
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
