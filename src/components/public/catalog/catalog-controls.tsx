'use client';

import { useTransition } from 'react';
import { LayoutGrid, List, SlidersHorizontal, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { usePathname, useRouter } from '@/i18n/navigation';
import type { CatalogFilters } from '@/server/services/catalog/filters';
import { catalogHref, clearFilters, serializeFilters } from '@/server/services/catalog/filters';

/**
 * The bar above the results: sort, grid/list, the mobile filter trigger, and the
 * removable chips for what is currently applied.
 *
 * Every control is a NAVIGATION, not client state. §12.3 requires the catalogue
 * to be shareable and back-button-safe, so the URL is the single source of
 * truth: the server renders from `?…`, and these controls only push a new one.
 * That is also why `serializeFilters` is imported rather than reimplemented —
 * client and server cannot disagree about what a URL means if they share the
 * function that writes it.
 *
 * `useTransition` keeps the current results on screen, dimmed, while the next
 * page streams. Blanking the grid on every filter click makes a fast page feel
 * broken.
 */

export interface CatalogControlsProps {
  filters: CatalogFilters;

  activeCount: number;
  labels: {
    readonly resultCount: string;
    readonly sortLabel: string;
    readonly sortOptions: ReadonlyArray<{ readonly value: string; readonly label: string }>;
    readonly viewGrid: string;
    readonly viewList: string;
    readonly openFilters: string;
    readonly clearAll: string;
    readonly removeFilter: string;
    readonly activeChips: ReadonlyArray<{ readonly key: string; readonly label: string; readonly href: string }>;
  };
  onOpenFilters?: () => void;
}

export function CatalogControls({
  filters,

  activeCount,
  labels,
  onOpenFilters,
}: CatalogControlsProps): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const go = (next: CatalogFilters): void => {
    startTransition(() => {
      router.push(`${pathname}${serializeFilters(next)}`, { scroll: false });
    });
  };

  return (
    <div className={cn('flex flex-col gap-4', pending && 'opacity-70 transition-opacity')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted" aria-live="polite">
          {labels.resultCount}
        </p>

        <div className="flex items-center gap-2">
          {/* Below lg the rail is hidden and the sheet takes over. */}
          {onOpenFilters === undefined ? null : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="lg:hidden"
              onClick={onOpenFilters}
              iconStart={<SlidersHorizontal className="size-4" />}
            >
              {labels.openFilters}
              {activeCount > 0 ? (
                <span className="ms-1.5 inline-flex size-5 items-center justify-center rounded-pill bg-strait text-xs font-medium text-on-accent">
                  <span data-numeric>{activeCount}</span>
                </span>
              ) : null}
            </Button>
          )}

          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">{labels.sortLabel}</span>
            <select
              value={filters.sort}
              onChange={(event) => {
                go({ ...filters, sort: event.target.value as CatalogFilters['sort'], page: 1 });
              }}
              className="h-11 rounded-md border border-hairline bg-surface px-3 text-sm text-ink"
            >
              {labels.sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div
            className="flex items-center rounded-pill border border-hairline bg-surface p-1"
            role="group"
            aria-label={labels.viewGrid}
          >
            {(
              [
                { value: 'grille', icon: LayoutGrid, label: labels.viewGrid },
                { value: 'liste', icon: List, label: labels.viewList },
              ] as const
            ).map(({ value, icon: Icon, label }) => {
              const current = filters.view === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={current}
                  aria-label={label}
                  onClick={() => {
                    go({ ...filters, view: value });
                  }}
                  className={cn(
                    'inline-flex size-9 items-center justify-center rounded-pill transition-colors duration-[120ms]',
                    current ? 'bg-strait text-on-accent' : 'text-ink-muted hover:bg-raised hover:text-ink',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {labels.activeChips.length === 0 ? null : (
        <ul className="flex flex-wrap items-center gap-2">
          {labels.activeChips.map((chip) => (
            <li key={chip.key}>
              <a
                href={chip.href}
                className="inline-flex h-9 items-center gap-1.5 rounded-pill border border-hairline bg-raised ps-3 pe-2 text-sm text-ink transition-colors hover:border-strait"
              >
                {chip.label}
                <span className="sr-only">{labels.removeFilter}</span>
                <X className="size-3.5 text-ink-muted" aria-hidden="true" />
              </a>
            </li>
          ))}

          <li>
            <a
              href={catalogHref(clearFilters(filters))}
              className="inline-flex h-9 items-center px-2 text-sm text-strait underline-offset-4 hover:underline"
            >
              {labels.clearAll}
            </a>
          </li>
        </ul>
      )}
    </div>
  );
}
