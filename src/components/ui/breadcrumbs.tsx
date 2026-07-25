import { ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * Breadcrumbs — catalog → category → course, and every admin sub-page.
 *
 * Real links through the locale-aware `Link`, an ordered list for the outline,
 * and `aria-current="page"` on the last crumb, which is text rather than a link
 * because linking to the page you are on is a dead control.
 *
 * The separator chevron is a direction-carrying icon, so it is mirrored in
 * Arabic with `rtl:-scale-x-100` (§10.3).
 */

export interface BreadcrumbItem {
  /** Translated label. */
  readonly label: string;
  /** Locale-relative path. Omit on the current page — the last crumb never links. */
  readonly href?: string;
}

export interface BreadcrumbsProps extends Omit<React.ComponentPropsWithRef<'nav'>, 'children'> {
  items: readonly BreadcrumbItem[];
  /** Accessible name of the navigation landmark, e.g. « Fil d'Ariane ». */
  label: string;
}

export function Breadcrumbs({
  items,
  label,
  className,
  ...props
}: BreadcrumbsProps): React.JSX.Element {
  return (
    <nav aria-label={label} className={cn('min-w-0', className)} {...props}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-muted">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-x-1.5">
              {index === 0 ? null : (
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-ink-muted/70 rtl:-scale-x-100"
                />
              )}

              {isLast || item.href === undefined ? (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={cn('max-w-[18rem] truncate', isLast && 'text-ink')}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="max-w-[14rem] truncate rounded-sm transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-ink motion-reduce:transition-none"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
