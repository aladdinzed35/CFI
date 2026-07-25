import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/cn';

/**
 * Card — the base surface of the design system (§11.2).
 *
 * Everything that sits above the page background is a Card: course cards, the
 * purchase panel, admin queue rows, dashboard tiles. It is a *surface*, not a
 * layout: it owns background, hairline border, radius and elevation, and
 * nothing else.
 *
 * `interactive` is for cards that are themselves a link or a button target. It
 * animates **transform and border colour only**, in 120 ms, so a grid of cards
 * never reflows on hover. Under reduced motion the transform is dropped
 * entirely and the border colour still communicates the state.
 *
 * Padding: either give the Card a `padding` (single-block cards) or compose
 * `CardHeader` / `CardContent` / `CardFooter`, which carry their own spacing.
 * Do not do both.
 */

export type CardElevation = 0 | 1 | 2 | 3 | 4;
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const elevationClasses: Record<CardElevation, string> = {
  0: 'shadow-none',
  1: 'shadow-e1',
  2: 'shadow-e2',
  3: 'shadow-e3',
  4: 'shadow-e4',
};

const paddingClasses: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6 sm:p-8',
};

export interface CardProps extends React.ComponentPropsWithRef<'div'> {
  /** Maps to shadow-e1 … shadow-e4. `0` renders a flat, border-only surface. */
  elevation?: CardElevation;
  /** Hover / focus-within affordance for cards that are a single click target. */
  interactive?: boolean;
  padding?: CardPadding;
  /** Render as the single child instead of a `div` — e.g. an `<article>` or a `<Link>`. */
  asChild?: boolean;
}

export function Card({
  className,
  elevation = 1,
  interactive = false,
  padding = 'none',
  asChild = false,
  ...props
}: CardProps): React.JSX.Element {
  const classes = cn(
    'relative rounded-md border border-hairline bg-surface text-ink',
    elevationClasses[elevation],
    paddingClasses[padding],
    interactive && [
      'transition-[transform,border-color,box-shadow] duration-[120ms] ease-[var(--ease-out-strait)]',
      'hover:-translate-y-0.5 hover:border-strait/45',
      'focus-within:border-strait/60',
      'active:translate-y-0 active:duration-[80ms]',
      'motion-reduce:transform-none motion-reduce:transition-none',
    ],
    className,
  );

  if (asChild) {
    return <Slot className={classes} {...props} />;
  }

  return <div className={classes} {...props} />;
}

export interface CardHeaderProps extends React.ComponentPropsWithRef<'div'> {
  /** Trailing slot pinned to the inline end — a status pill, a menu, a price. */
  action?: React.ReactNode;
}

export function CardHeader({
  className,
  action,
  children,
  ...props
}: CardHeaderProps): React.JSX.Element {
  return (
    <div className={cn('flex items-start justify-between gap-4 p-5 pb-4', className)} {...props}>
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}

export interface CardTitleProps extends React.ComponentPropsWithRef<'h3'> {
  /** Pick the level that keeps the page outline correct — never pick it for looks. */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

export function CardTitle({
  as: Heading = 'h3',
  className,
  ...props
}: CardTitleProps): React.JSX.Element {
  return (
    <Heading
      className={cn('font-display text-heading font-medium text-balance text-ink', className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.ComponentPropsWithRef<'p'>): React.JSX.Element {
  return <p className={cn('text-sm text-ink-muted', className)} {...props} />;
}

export function CardContent({
  className,
  ...props
}: React.ComponentPropsWithRef<'div'>): React.JSX.Element {
  return <div className={cn('px-5 pb-5 first:pt-5', className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.ComponentPropsWithRef<'div'>): React.JSX.Element {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-3 px-5 pb-5 first:pt-5', className)}
      {...props}
    />
  );
}
