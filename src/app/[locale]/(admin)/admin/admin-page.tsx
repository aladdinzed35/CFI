import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The frame every administration screen sits in.
 *
 * One outer container for the whole panel, so the title of « Comptes », of
 * « Réglages » and of the dashboard starts on the same vertical line and does
 * not jump sideways as the administrator moves through the rail. Screens whose
 * content reads better narrow — a form, a record — narrow the *inner* column
 * and keep it on the start edge rather than re-centring it, which is what used
 * to make the heading hop by a hundred pixels between two clicks.
 *
 * Deliberately not a client component: the pages that use it are Server
 * Components, and a frame has no state.
 */

export type AdminPageWidth = 'full' | 'record' | 'form';

const INNER_WIDTH: Record<AdminPageWidth, string | null> = {
  /** Tables, queues, the dashboard: the whole container. */
  full: null,
  /** A record or an editor: wide enough for two columns of fields. */
  record: 'max-w-5xl',
  /** A stack of settings cards: line length, not screen width, decides. */
  form: 'max-w-4xl',
};

export function AdminPage({
  width = 'full',
  className,
  children,
}: {
  readonly width?: AdminPageWidth;
  readonly className?: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  const inner = INNER_WIDTH[width];

  return (
    <div className={cn('mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8', className)}>
      {inner === null ? children : <div className={cn('w-full', inner)}>{children}</div>}
    </div>
  );
}

/**
 * The heading block every screen opens with — title, one line of context and,
 * optionally, the screen's primary action on the end edge (which drops under
 * the text on a phone instead of squeezing it).
 */
export function AdminPageHeader({
  title,
  subtitle,
  action,
  className,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <header
      className={cn(
        'flex flex-col gap-4 pb-5 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-display text-title text-balance text-ink">{title}</h1>
        {subtitle === undefined ? null : (
          <p className="max-w-prose text-sm text-pretty text-ink-muted">{subtitle}</p>
        )}
      </div>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </header>
  );
}
