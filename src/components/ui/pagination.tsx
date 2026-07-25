import { ChevronLeft, ChevronRight, Ellipsis } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * Pagination — the catalog, the admin queues, every long list.
 *
 * These are **real links**, built by the caller's `hrefForPage` (`?page=2`), not
 * buttons that mutate client state: the back button works, a page can be shared,
 * and a crawler can walk the catalog (§12.3). The previous/next controls degrade
 * to inert `<span aria-disabled>` at the ends rather than disappearing, so the
 * control row never reflows on the first and last page.
 *
 * The chevrons are direction-carrying, so they mirror in Arabic. Page numbers
 * are Western digits in tabular figures and stay LTR (§10.3).
 */

export interface PaginationLabels {
  /** Accessible name of the navigation landmark, e.g. « Pagination ». */
  readonly nav: string;
  readonly previous: string;
  readonly next: string;
  /** Accessible name of a page link, e.g. `(n) => \`Page ${n}\``. */
  readonly page: (page: number) => string;
  /** Accessible name of the skipped range, e.g. « Pages omises ». */
  readonly ellipsis: string;
}

export interface PaginationProps extends Omit<React.ComponentPropsWithRef<'nav'>, 'children'> {
  /** Current page, 1-based. Clamped into `[1, totalPages]`. */
  page: number;
  totalPages: number;
  /** Builds the href for a page — keep the other search params, change `page`. */
  hrefForPage: (page: number) => string;
  labels: PaginationLabels;
  /** Page numbers shown on each side of the current one. */
  siblingCount?: number;
}

type PageSlot = { kind: 'page'; value: number } | { kind: 'gap'; key: string };

/** 1 … 4 5 [6] 7 8 … 20 — always the ends, always the neighbours, never a jump of one. */
function buildSlots(current: number, total: number, siblingCount: number): PageSlot[] {
  const pages = new Set<number>([1, total, current]);
  for (let offset = 1; offset <= siblingCount; offset += 1) {
    pages.add(current - offset);
    pages.add(current + offset);
  }

  const visible = [...pages].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);

  const slots: PageSlot[] = [];
  let previous: number | null = null;

  for (const value of visible) {
    if (previous !== null && value - previous > 1) {
      // A gap of exactly one page is silly — show the page instead of an ellipsis.
      if (value - previous === 2) {
        slots.push({ kind: 'page', value: previous + 1 });
      } else {
        slots.push({ kind: 'gap', key: `gap-${previous}-${value}` });
      }
    }
    slots.push({ kind: 'page', value });
    previous = value;
  }

  return slots;
}

const cellClasses =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border px-3 text-sm font-medium';

function EdgeLink({
  href,
  label,
  disabled,
  direction,
}: {
  href: string;
  label: string;
  disabled: boolean;
  direction: 'previous' | 'next';
}): React.JSX.Element {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;
  const icon = <Icon aria-hidden="true" className="size-4 shrink-0 rtl:-scale-x-100" />;

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={cn(cellClasses, 'cursor-not-allowed border-transparent text-ink-muted/50')}
      >
        {icon}
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        cellClasses,
        'border-hairline bg-surface text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait/45 hover:text-ink motion-reduce:transition-none',
      )}
    >
      {icon}
    </Link>
  );
}

export function Pagination({
  page,
  totalPages,
  hrefForPage,
  labels,
  siblingCount = 1,
  className,
  ...props
}: PaginationProps): React.JSX.Element | null {
  const total = Math.max(1, Math.round(totalPages));
  if (total <= 1) return null;

  const current = Math.min(Math.max(Math.round(page), 1), total);
  const slots = buildSlots(current, total, Math.max(0, Math.round(siblingCount)));

  return (
    <nav aria-label={labels.nav} className={cn('flex w-full justify-center', className)} {...props}>
      <ul className="flex flex-wrap items-center justify-center gap-1">
        <li>
          <EdgeLink
            href={hrefForPage(Math.max(1, current - 1))}
            label={labels.previous}
            disabled={current === 1}
            direction="previous"
          />
        </li>

        {slots.map((slot) =>
          slot.kind === 'gap' ? (
            <li key={slot.key}>
              <span className={cn(cellClasses, 'border-transparent text-ink-muted')}>
                <Ellipsis className="size-4" aria-hidden="true" />
                <span className="sr-only">{labels.ellipsis}</span>
              </span>
            </li>
          ) : (
            <li key={`page-${slot.value}`}>
              <Link
                href={hrefForPage(slot.value)}
                aria-label={labels.page(slot.value)}
                aria-current={slot.value === current ? 'page' : undefined}
                dir="ltr"
                className={cn(
                  cellClasses,
                  'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none',
                  slot.value === current
                    ? 'border-strait bg-strait-wash text-ink'
                    : 'border-hairline bg-surface text-ink-muted hover:border-strait/45 hover:text-ink',
                )}
              >
                <span data-numeric>{slot.value}</span>
              </Link>
            </li>
          ),
        )}

        <li>
          <EdgeLink
            href={hrefForPage(Math.min(total, current + 1))}
            label={labels.next}
            disabled={current === total}
            direction="next"
          />
        </li>
      </ul>
    </nav>
  );
}
