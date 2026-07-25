import { cn } from '@/lib/cn';

/**
 * EmptyState — §11.5.
 *
 * The contract of this component *is* the writing rule: say what happened, say
 * what to do next, offer exactly one way to do it. No « Oups ! », no apology,
 * no dead end — which is why there is a single `action` slot and no secondary
 * one. If a screen seems to need two exits, it needs a better primary action.
 *
 * The same component covers "no results", "nothing yet" and "this failed":
 * `tone` only tints the illustration frame, never the copy, so an error state
 * stays legible and calm.
 *
 * All copy arrives as props — the primitive holds none.
 */

export type EmptyStateTone = 'neutral' | 'strait' | 'warn' | 'danger';
export type EmptyStateSize = 'sm' | 'md';

const frameToneClasses: Record<EmptyStateTone, string> = {
  neutral: 'border-hairline bg-raised text-ink-muted',
  strait: 'border-strait/30 bg-strait-wash text-strait',
  warn: 'border-warn/30 bg-warn-wash text-warn',
  danger: 'border-danger/30 bg-danger-wash text-danger',
};

const frameSizeClasses: Record<EmptyStateSize, string> = {
  sm: 'size-12 [&_svg]:size-5',
  md: 'size-16 [&_svg]:size-7',
};

const paddingClasses: Record<EmptyStateSize, string> = {
  sm: 'gap-3 px-4 py-8',
  md: 'gap-4 px-6 py-14',
};

const titleClasses: Record<EmptyStateSize, string> = {
  sm: 'text-body',
  md: 'text-heading',
};

export interface EmptyStateProps extends Omit<React.ComponentPropsWithRef<'div'>, 'title'> {
  /** Icon or illustration. Decorative — the title carries the meaning. */
  illustration?: React.ReactNode;
  /** What happened, in the interface's voice. Never an apology. */
  title: string;
  /** What to do next. One or two sentences. */
  description?: string;
  /** Exactly one primary action — a Button or a Link styled as one. */
  action?: React.ReactNode;
  tone?: EmptyStateTone;
  size?: EmptyStateSize;
}

export function EmptyState({
  illustration,
  title,
  description,
  action,
  tone = 'neutral',
  size = 'md',
  className,
  children,
  ...props
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center text-center',
        paddingClasses[size],
        className,
      )}
      {...props}
    >
      {illustration === undefined ? null : (
        <span
          aria-hidden="true"
          className={cn(
            'grid shrink-0 place-items-center rounded-md border',
            frameToneClasses[tone],
            frameSizeClasses[size],
          )}
        >
          {illustration}
        </span>
      )}

      <div className="flex max-w-prose flex-col gap-2">
        <p className={cn('font-display font-medium text-balance text-ink', titleClasses[size])}>
          {title}
        </p>
        {description === undefined ? null : (
          <p className="text-sm text-pretty text-ink-muted">{description}</p>
        )}
      </div>

      {children}

      {action === undefined ? null : <div className="pt-1">{action}</div>}
    </div>
  );
}
