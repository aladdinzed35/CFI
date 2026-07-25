import { cn } from '@/lib/cn';

/**
 * Skeleton — shape-matched loading placeholders, never a spinner (§11.5).
 *
 * A skeleton must occupy the same box the real content will occupy, or the page
 * jumps when the data arrives. That is why `SkeletonCard` and `SkeletonTable`
 * exist as named shapes instead of leaving every screen to reinvent them.
 *
 * The shimmer is `animate-pulse`, removed under `prefers-reduced-motion` and
 * under the in-app reduce-motion preference (globals.css neutralises both).
 *
 * Accessibility: the bars are `aria-hidden`. Give the wrapper a `label` when the
 * region genuinely needs to be announced — it renders a polite `role="status"`
 * so the screen reader says « Chargement… » once instead of reading forty
 * meaningless boxes.
 */

export interface SkeletonProps extends React.ComponentPropsWithRef<'div'> {
  /** Turn the shimmer off for a static placeholder (e.g. inside a printed view). */
  animate?: boolean;
}

export function Skeleton({
  className,
  animate = true,
  ...props
}: SkeletonProps): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-sm bg-raised',
        animate && 'animate-pulse motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

/** Wraps a skeleton block and announces it once, politely, when `label` is given. */
function LoadingRegion({
  label,
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<'div'> & { label?: string }): React.JSX.Element {
  return (
    <div
      role={label === undefined ? undefined : 'status'}
      aria-live={label === undefined ? undefined : 'polite'}
      aria-busy={label === undefined ? undefined : true}
      className={className}
      {...props}
    >
      {label === undefined ? null : <span className="sr-only">{label}</span>}
      {children}
    </div>
  );
}

export interface SkeletonTextProps extends React.ComponentPropsWithRef<'div'> {
  /** Number of lines. The last one is short, the way a real paragraph ends. */
  lines?: number;
  /** Height of each line — match the text style it replaces. */
  lineClassName?: string;
  label?: string;
}

export function SkeletonText({
  lines = 3,
  lineClassName,
  label,
  className,
  ...props
}: SkeletonTextProps): React.JSX.Element {
  const count = Math.max(1, Math.round(lines));

  return (
    <LoadingRegion label={label} className={cn('flex w-full flex-col gap-2', className)} {...props}>
      {Array.from({ length: count }, (_unused, index) => (
        <Skeleton
          key={index}
          className={cn('h-3 w-full', index === count - 1 && count > 1 && 'w-3/5', lineClassName)}
        />
      ))}
    </LoadingRegion>
  );
}

export interface SkeletonCardProps extends React.ComponentPropsWithRef<'div'> {
  /** Renders the 16:9 cover block that a course card carries. */
  media?: boolean;
  lines?: number;
  /** Reserves the footer row (price + CTA) so the card keeps its final height. */
  footer?: boolean;
  label?: string;
}

export function SkeletonCard({
  media = true,
  lines = 2,
  footer = true,
  label,
  className,
  ...props
}: SkeletonCardProps): React.JSX.Element {
  return (
    <LoadingRegion
      label={label}
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-md border border-hairline bg-surface',
        className,
      )}
      {...props}
    >
      {media ? <Skeleton className="aspect-video w-full rounded-none" /> : null}
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-4 w-2/3" />
        <SkeletonText lines={lines} />
        {footer ? (
          <div className="flex items-center justify-between gap-3 pt-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-9 w-28 rounded-pill" />
          </div>
        ) : null}
      </div>
    </LoadingRegion>
  );
}

export interface SkeletonTableProps extends React.ComponentPropsWithRef<'div'> {
  rows?: number;
  columns?: number;
  /** Reserves the header row of the table. */
  header?: boolean;
  label?: string;
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  header = true,
  label,
  className,
  ...props
}: SkeletonTableProps): React.JSX.Element {
  const rowCount = Math.max(1, Math.round(rows));
  const columnCount = Math.max(1, Math.round(columns));
  const template = `repeat(${columnCount}, minmax(0, 1fr))`;

  return (
    <LoadingRegion
      label={label}
      className={cn('w-full overflow-hidden rounded-md border border-hairline bg-surface', className)}
      {...props}
    >
      {header ? (
        <div
          className="hairline-b grid items-center gap-4 bg-raised px-4 py-3"
          style={{ gridTemplateColumns: template }}
        >
          {Array.from({ length: columnCount }, (_unused, index) => (
            <Skeleton key={index} className="h-3 w-20" />
          ))}
        </div>
      ) : null}

      {Array.from({ length: rowCount }, (_unused, rowIndex) => (
        <div
          key={rowIndex}
          className="grid items-center gap-4 border-b border-hairline px-4 py-4 last:border-b-0"
          style={{ gridTemplateColumns: template }}
        >
          {Array.from({ length: columnCount }, (_unusedCell, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-3.5', columnIndex === 0 ? 'w-4/5' : 'w-3/5')}
            />
          ))}
        </div>
      ))}
    </LoadingRegion>
  );
}
