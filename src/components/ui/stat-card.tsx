import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Card } from './card';
import { cn } from '@/lib/cn';

/**
 * StatCard — one number, stated plainly.
 *
 * Used across the student dashboard and the admin KPI row. The value is
 * rendered in tabular mono figures (`data-numeric`) so a column of stat cards
 * lines up, and it is wrapped LTR: a revenue figure or a percentage must not be
 * re-ordered by the Arabic bidi algorithm (§10.3).
 *
 * A trend is two independent things — which way the number moved (`direction`,
 * which picks the arrow) and whether that is good news (`intent`, which picks
 * the colour). Refund rate going up is not a success, and this API refuses to
 * conflate them. `intent` defaults to neutral, never to "up is green".
 */

export type StatTone = 'ink' | 'strait' | 'brass' | 'success' | 'warn' | 'danger';
export type StatTrendDirection = 'up' | 'down' | 'flat';
export type StatTrendIntent = 'positive' | 'negative' | 'neutral';

export interface StatTrend {
  readonly direction: StatTrendDirection;
  /** Translated, pre-formatted, e.g. « +12 % vs. mois dernier ». */
  readonly label: string;
  readonly intent?: StatTrendIntent;
}

const valueToneClasses: Record<StatTone, string> = {
  ink: 'text-ink',
  strait: 'text-strait',
  brass: 'text-brass',
  success: 'text-success',
  warn: 'text-warn',
  danger: 'text-danger',
};

const trendIntentClasses: Record<StatTrendIntent, string> = {
  positive: 'text-success',
  negative: 'text-danger',
  neutral: 'text-ink-muted',
};

type TrendIconComponent = React.ComponentType<{
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}>;

const trendIcons: Record<StatTrendDirection, TrendIconComponent> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

export interface StatCardProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children'> {
  /** What the number counts, translated. */
  label: string;
  /** The number itself, already formatted (money via `formatMoney`, counts via Intl). */
  value: string;
  /** Small leading icon in the header row. Decorative. */
  icon?: React.ReactNode;
  /** Use `brass` for money and achievement only (§11.2). */
  tone?: StatTone;
  trend?: StatTrend;
  /** One line of context under the value — a comparison, a period, a caveat. */
  hint?: string;
  /** Sparkline, mini bar chart or progress bar rendered at the bottom. */
  footer?: React.ReactNode;
}

export function StatCard({
  label,
  value,
  icon,
  tone = 'ink',
  trend,
  hint,
  footer,
  className,
  ...props
}: StatCardProps): React.JSX.Element {
  const TrendIcon = trend === undefined ? null : trendIcons[trend.direction];

  return (
    <Card padding="md" className={cn('flex flex-col gap-3', className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm text-ink-muted">{label}</span>
        {icon === undefined ? null : (
          <span
            className="grid size-8 shrink-0 place-items-center rounded-sm bg-raised text-ink-muted [&_svg]:size-4"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </div>

      <p
        data-numeric
        dir="ltr"
        className={cn(
          'force-ltr font-display text-title leading-none font-medium',
          valueToneClasses[tone],
        )}
      >
        {value}
      </p>

      {trend === undefined || TrendIcon === null ? null : (
        <p
          className={cn(
            'flex items-center gap-1.5 text-sm',
            trendIntentClasses[trend.intent ?? 'neutral'],
          )}
        >
          <TrendIcon className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{trend.label}</span>
        </p>
      )}

      {hint === undefined ? null : <p className="text-xs text-ink-muted">{hint}</p>}

      {footer === undefined ? null : <div className="pt-1">{footer}</div>}
    </Card>
  );
}
