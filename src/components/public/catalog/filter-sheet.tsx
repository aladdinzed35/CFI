'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Link } from '@/i18n/navigation';
import {
  activeFilterCount,
  clearFilters,
  serializeFilters,
  type CatalogFilters,
} from '@/server/services/catalog/filters';

/**
 * The catalogue's mobile filter sheet (§12.3).
 *
 * Below `lg` the desktop rail is hidden, so this is the *only* way to narrow the
 * catalogue on a phone. It therefore holds the exact same element the rail
 * holds: the page renders `<FilterGroups>` — a Server Component — and passes it
 * here as `children`. Nothing about the filters is re-declared in this file, so
 * the rail and the sheet cannot drift into offering different options,
 * different counts or different links, and none of the facet markup is shipped
 * to the browser twice.
 *
 * ## Applying is a navigation, not client state
 * Every option inside `children` is an `<a>` produced by `toggleFilter` +
 * `serializeFilters`. Tapping one navigates immediately and the sheet stays
 * open, so filters can be stacked and each tap is a real history entry. The
 * footer's primary button therefore does not "submit" anything — the results
 * behind it are already correct — it closes the sheet and says how many courses
 * are waiting. The URL remains the single source of truth end to end.
 *
 * ## Why a context rather than a prop
 * The trigger lives in `CatalogControls`, inside the toolbar where it visually
 * belongs, while the sheet is rendered by the page (which is what can build the
 * server-side `FilterGroups`). A Server Component cannot hand a callback across
 * that gap, so the open state lives in {@link FilterSheetProvider} and the
 * trigger reaches it through {@link useFilterSheetOpener}. One state, one sheet,
 * no duplicated trigger markup.
 *
 * ## Shape
 * `ModalContent` is already a bottom sheet under `md` — pinned to the block end,
 * rounded top corners, flick-down-to-dismiss, `env(safe-area-inset-bottom)`
 * padding — so no second sheet exists here. Radix supplies the focus trap, the
 * focus restore, `Esc`, the scroll lock and `aria-modal`. What this file adds is
 * the layout that makes a long facet list usable on a 360 px screen: a
 * scrolling body between a fixed header and a footer that never leaves the
 * viewport.
 */

/* -------------------------------------------------------------------------- */
/* Open state                                                                  */
/* -------------------------------------------------------------------------- */

interface FilterSheetValue {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}

const FilterSheetContext = createContext<FilterSheetValue | null>(null);

export interface FilterSheetProviderProps {
  readonly children: ReactNode;
}

/**
 * Owns whether the sheet is open. Wrap the whole catalogue column in it: the
 * trigger and the sheet itself both read from here.
 *
 * It renders no markup of its own, so the Server Components it wraps stay
 * Server Components — only the two leaves that need the state are client code.
 */
export function FilterSheetProvider({ children }: FilterSheetProviderProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const value = useMemo<FilterSheetValue>(() => ({ open, setOpen }), [open]);

  return <FilterSheetContext.Provider value={value}>{children}</FilterSheetContext.Provider>;
}

/**
 * The opener for the toolbar's « Filtrer » button.
 *
 * Returns `null` when no provider is present, which is the signal to render no
 * trigger at all — a button that opens nothing is worse than no button.
 */
export function useFilterSheetOpener(): (() => void) | null {
  const context = useContext(FilterSheetContext);
  const setOpen = context?.setOpen;

  return useMemo(
    () =>
      setOpen === undefined
        ? null
        : () => {
            setOpen(true);
          },
    [setOpen],
  );
}

function useFilterSheetContext(): FilterSheetValue {
  const context = useContext(FilterSheetContext);
  if (context === null) {
    throw new Error('<FilterSheet> must be rendered inside <FilterSheetProvider>.');
  }
  return context;
}

/* -------------------------------------------------------------------------- */
/* The sheet                                                                   */
/* -------------------------------------------------------------------------- */

/** The breakpoint at which the desktop rail takes over from the sheet. */
const RAIL_BREAKPOINT = '(min-width: 64rem)';

export interface FilterSheetProps {
  /** The filters the current URL resolves to — the same object the rail gets. */
  readonly filters: CatalogFilters;
  /** Courses matching those filters right now; the number on the apply button. */
  readonly resultCount: number;
  /**
   * The page's `<FilterGroups …>` element. Rendered on the server, streamed
   * into the sheet's body, identical to the rail's.
   */
  readonly children: ReactNode;
}

export function FilterSheet({
  filters,
  resultCount,
  children,
}: FilterSheetProps): React.JSX.Element {
  const { open, setOpen } = useFilterSheetContext();
  const t = useTranslations('catalog');
  const tCommon = useTranslations('common');

  const close = useCallback((): void => {
    setOpen(false);
  }, [setOpen]);

  /**
   * At `lg` the rail appears and the trigger disappears; a sheet left open by a
   * rotation or a window resize would otherwise sit on top of the very filters
   * it duplicates, with the page scroll locked behind it.
   */
  useEffect(() => {
    if (!open) return undefined;

    const media = window.matchMedia(RAIL_BREAKPOINT);
    const sync = (): void => {
      if (media.matches) setOpen(false);
    };

    sync();
    media.addEventListener('change', sync);
    return () => {
      media.removeEventListener('change', sync);
    };
  }, [open, setOpen]);

  const activeCount = activeFilterCount(filters);
  const clearHref = serializeFilters(clearFilters(filters));

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalContent size="md" closeLabel={tCommon('close')}>
        <ModalHeader>
          <ModalTitle>{t('filters.sheetTitle')}</ModalTitle>
          {/* Announced as facets are toggled, so the count is available without
              closing the sheet to look at the grid behind it. */}
          <ModalDescription aria-live="polite">
            {t('resultCount', { count: resultCount })}
          </ModalDescription>
        </ModalHeader>

        <ModalBody className="pb-4">{children}</ModalBody>

        <ModalFooter className="mt-0 flex-row items-center justify-between gap-3 sm:justify-between">
          {activeCount > 0 ? (
            <Link
              href={clearHref}
              className="inline-flex h-12 shrink-0 items-center rounded-sm px-2 text-sm text-strait underline-offset-4 hover:underline"
            >
              {t('filters.clearAll')}
            </Link>
          ) : null}

          <Button
            type="button"
            onClick={close}
            fullWidth={activeCount === 0}
            className={activeCount > 0 ? 'min-w-0 flex-1' : undefined}
          >
            <span className="truncate">
              {t('filters.applyWithCount', { count: resultCount })}
            </span>
            {activeCount > 0 ? (
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-pill bg-on-accent/20 text-xs font-medium">
                <span className="sr-only">{t('filters.activeLabel')}</span>
                <span data-numeric>{activeCount}</span>
              </span>
            ) : null}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
