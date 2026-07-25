import { cn } from '@/lib/cn';

/**
 * Badge — a small, non-interactive label.
 *
 * Categories, levels, counts, "nouveau", fallback-language notices. For a value
 * of a domain enum use `StatusPill` instead: it locks the tone to the status so
 * a `REJECTED` request can never be painted green.
 *
 * `brass` is reserved for money and achievement (§11.2). Do not use it as a
 * generic highlight.
 */

export type BadgeTone = 'neutral' | 'strait' | 'deep' | 'brass' | 'success' | 'warn' | 'danger';
export type BadgeVariant = 'soft' | 'solid' | 'outline';
export type BadgeSize = 'sm' | 'md';

const toneClasses: Record<BadgeVariant, Record<BadgeTone, string>> = {
  soft: {
    neutral: 'border-hairline bg-raised text-ink-muted',
    strait: 'border-strait/30 bg-strait-wash text-strait',
    deep: 'border-deep/45 bg-deep/15 text-ink',
    brass: 'border-brass/30 bg-brass-wash text-brass',
    success: 'border-success/30 bg-success/12 text-success',
    warn: 'border-warn/30 bg-warn-wash text-warn',
    danger: 'border-danger/30 bg-danger-wash text-danger',
  },
  solid: {
    neutral: 'border-hairline bg-raised text-ink',
    strait: 'border-transparent bg-strait text-on-accent',
    deep: 'border-transparent bg-deep text-ink',
    brass: 'border-transparent bg-brass text-on-brass',
    success: 'border-transparent bg-success text-on-accent',
    warn: 'border-transparent bg-warn text-on-brass',
    danger: 'border-transparent bg-danger text-on-danger',
  },
  outline: {
    neutral: 'border-hairline bg-transparent text-ink-muted',
    strait: 'border-strait/50 bg-transparent text-strait',
    deep: 'border-deep/60 bg-transparent text-ink',
    brass: 'border-brass/50 bg-transparent text-brass',
    success: 'border-success/50 bg-transparent text-success',
    warn: 'border-warn/50 bg-transparent text-warn',
    danger: 'border-danger/50 bg-transparent text-danger',
  },
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'gap-1 px-2 py-0.5 text-xs [&_svg]:size-3.5',
  md: 'gap-1.5 px-2.5 py-1 text-sm [&_svg]:size-4',
};

export interface BadgeProps extends React.ComponentPropsWithRef<'span'> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Leading icon. Always paired with a text label — never colour alone (§21). */
  icon?: React.ReactNode;
}

export function Badge({
  className,
  tone = 'neutral',
  variant = 'soft',
  size = 'sm',
  icon,
  children,
  ...props
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-pill border align-middle font-medium',
        sizeClasses[size],
        toneClasses[variant][tone],
        className,
      )}
      {...props}
    >
      {icon === undefined ? null : (
        <span className="grid shrink-0 place-items-center" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}
