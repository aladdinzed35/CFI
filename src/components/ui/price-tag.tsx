import { formatMoney, percentOff, NARROW_NBSP, type MoneyDecimals } from '@/lib/money';
import type { Locale } from '@/i18n/routing';
import { cn } from '@/lib/cn';

/**
 * PriceTag — the one place a price is rendered.
 *
 * Brass, because brass is money and achievement and nothing else (§11.2).
 * Amounts arrive as integer centimes and are formatted by `formatMoney`, which
 * owns the per-locale separators and currency label (§28.1) — this component
 * never does arithmetic on a float and never assembles a currency string itself.
 *
 * Direction: a price is a number, and numbers stay left-to-right inside Arabic
 * (§10.3), so the price, the struck-through compare-at price and the discount
 * pill are all isolated with `.force-ltr` + `dir="ltr"`.
 *
 * The discount pill appears only when `percentOff` returns a real saving, so a
 * misconfigured course can never advertise a « -0 % » discount.
 */

export type PriceTagSize = 'sm' | 'md' | 'lg' | 'xl';

const priceClasses: Record<PriceTagSize, string> = {
  sm: 'text-sm',
  md: 'text-lead',
  lg: 'font-display text-heading',
  xl: 'font-display text-title',
};

const secondaryClasses: Record<PriceTagSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-body',
  xl: 'text-lead',
};

const pillClasses: Record<PriceTagSize, string> = {
  sm: 'px-1.5 py-0.5 text-xs',
  md: 'px-2 py-0.5 text-xs',
  lg: 'px-2 py-0.5 text-sm',
  xl: 'px-2.5 py-1 text-sm',
};

/** U+2212 MINUS SIGN — a real minus, not a hyphen. */
const MINUS = '−';

export interface PriceTagProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children'> {
  /** Price in integer centimes (1 MAD = 100 centimes). */
  centimes: number;
  /** Struck-through reference price, in centimes. Ignored unless it beats `centimes`. */
  compareAtCentimes?: number | null;
  locale: Locale;
  size?: PriceTagSize;
  decimals?: MoneyDecimals;
  /** Shown instead of a formatted zero when the course is free. Translated by the caller. */
  freeLabel?: string;
  /** Screen-reader-only prefix for the struck price, e.g. « Prix initial ». */
  compareAtSrLabel?: string;
  /** Screen-reader-only prefix for the discount pill, e.g. « Réduction ». */
  discountSrLabel?: string;
  /** Small trailing note — « TTC », « par module », « paiement en 2 fois ». */
  note?: string;
  /** Stacks the compare-at row under the price instead of beside it. */
  stacked?: boolean;
}

export function PriceTag({
  centimes,
  compareAtCentimes,
  locale,
  size = 'md',
  decimals = 'auto',
  freeLabel,
  compareAtSrLabel,
  discountSrLabel,
  note,
  stacked = false,
  className,
  ...props
}: PriceTagProps): React.JSX.Element {
  const isFree = Number.isFinite(centimes) && Math.round(centimes) === 0;
  const compareAt = compareAtCentimes ?? null;
  const saving = percentOff(centimes, compareAt);

  return (
    <div
      className={cn(
        'flex min-w-0 gap-x-2 gap-y-1',
        stacked ? 'flex-col items-start' : 'flex-wrap items-baseline',
        className,
      )}
      {...props}
    >
      {isFree && freeLabel !== undefined ? (
        <span className={cn('font-medium text-brass', priceClasses[size])}>{freeLabel}</span>
      ) : (
        <span
          data-numeric
          dir="ltr"
          className={cn('force-ltr font-medium text-brass', priceClasses[size])}
        >
          {formatMoney(centimes, locale, { decimals })}
        </span>
      )}

      {compareAt !== null && saving !== null ? (
        <span className={cn('flex flex-wrap items-baseline gap-2', stacked && 'w-full')}>
          <s className={cn('text-ink-muted', secondaryClasses[size])}>
            {compareAtSrLabel === undefined ? null : (
              <span className="sr-only">{`${compareAtSrLabel} `}</span>
            )}
            <span data-numeric dir="ltr" className="force-ltr">
              {formatMoney(compareAt, locale, { decimals })}
            </span>
          </s>

          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-pill bg-brass-wash font-medium text-brass',
              pillClasses[size],
            )}
          >
            {discountSrLabel === undefined ? null : (
              <span className="sr-only">{`${discountSrLabel} `}</span>
            )}
            <span data-numeric dir="ltr" className="force-ltr">
              {`${MINUS}${saving}${NARROW_NBSP}%`}
            </span>
          </span>
        </span>
      ) : null}

      {note === undefined ? null : (
        <span className={cn('text-ink-muted', secondaryClasses[size])}>{note}</span>
      )}
    </div>
  );
}
