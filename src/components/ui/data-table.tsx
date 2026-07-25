'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Columns3,
  Inbox,
  TriangleAlert,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { useDirection } from '@/hooks/use-direction';

/**
 * `DataTable` (§11.3, §11.4) — headless `@tanstack/react-table`, **server-side
 * everything**.
 *
 * The table receives the current page of rows and the current sort / filter /
 * pagination state, and emits change events. It never holds the full dataset
 * and never slices one: an admin list of 40 000 payments is paginated by the
 * database, which is the only place that can do it. That is why
 * `manualPagination`, `manualSorting` and `manualFiltering` are all on and why
 * no `getSortedRowModel` / `getFilteredRowModel` / `getPaginationRowModel` is
 * ever installed — installing one would silently re-sort the current page and
 * make the UI lie about the data.
 *
 * Below `md` the table is replaced by a card list built from `renderCard`
 * (required by §11.4: an admin must be able to approve a payment from a phone).
 * Both layouts render the same `Row<TData>` objects, so selection, sorting and
 * pagination behave identically on either side of the breakpoint.
 */

export interface DataTableLabels {
  /** Accessible name of the table and of the mobile card list. */
  caption: string;
  /** Trigger of the column-visibility menu, e.g. « Colonnes ». */
  columnsMenu: string;
  /** Header checkbox, e.g. « Tout sélectionner sur cette page ». */
  selectAll: string;
  /** Row checkbox, e.g. « Sélectionner la ligne ». */
  selectRow: string;
  /** Preformatted, e.g. « 3 lignes sélectionnées ». */
  selectionSummary: string;
  clearSelection: string;
  previousPage: string;
  nextPage: string;
  /** Preformatted, e.g. « 1–20 sur 134 ». */
  pageSummary: string;
  /** sr-only status while loading, e.g. « Chargement des résultats ». */
  loading: string;
  emptyTitle: string;
  emptyDescription?: string;
  errorTitle: string;
  errorDescription?: string;
  retry?: string;
}

export type DataTableStatus = 'idle' | 'loading' | 'error';

export interface DataTableProps<TData> {
  /** The current page only — never the whole dataset. */
  data: TData[];
  columns: ColumnDef<TData>[];
  labels: DataTableLabels;
  /** Stable identity, used as the row-selection key. */
  getRowId: (row: TData, index: number) => string;

  pagination: PaginationState;
  onPaginationChange: (next: PaginationState) => void;
  /** Total pages, computed server-side from the filtered count. */
  pageCount: number;

  /** Omit to disable sorting entirely. */
  sorting?: SortingState;
  onSortingChange?: (next: SortingState) => void;

  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (next: ColumnFiltersState) => void;

  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (next: VisibilityState) => void;

  /** Omit to disable row selection entirely. */
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (next: RowSelectionState) => void;
  /** Contents of the bulk action bar, given the selected row ids. */
  bulkActions?: (selectedIds: string[]) => React.ReactNode;

  /** Required below `md`. Receives the same `Row` the table cells receive. */
  renderCard: (row: Row<TData>) => React.ReactNode;

  status?: DataTableStatus;
  onRetry?: () => void;
  /** Search field, saved filters, CSV export — anything the screen owns. */
  toolbar?: React.ReactNode;
  className?: string;
}

/**
 * `Updater<T>` is `T | ((old: T) => T)`; TypeScript cannot narrow that union by
 * `typeof` because `T` itself may be callable. The assertion is confined here.
 */
function resolveUpdater<T>(updater: Updater<T>, current: T): T {
  return typeof updater === 'function' ? (updater as (old: T) => T)(current) : updater;
}

/**
 * `useReactTable` merges `options.state` over its own state with a plain
 * spread, so an explicitly `undefined` slice *erases* the default instead of
 * falling back to it — and `row.getIsSelected()` then reads `undefined`. Every
 * slice is therefore always a real value; these frozen constants keep the
 * identity stable so the table does not see a new state object every render.
 */
const EMPTY_SORTING: SortingState = [];
const EMPTY_FILTERS: ColumnFiltersState = [];
const EMPTY_VISIBILITY: VisibilityState = {};
const EMPTY_SELECTION: RowSelectionState = {};

export function DataTable<TData>({
  data,
  columns,
  labels,
  getRowId,
  pagination,
  onPaginationChange,
  pageCount,
  sorting,
  onSortingChange,
  columnFilters,
  onColumnFiltersChange,
  columnVisibility,
  onColumnVisibilityChange,
  rowSelection,
  onRowSelectionChange,
  bulkActions,
  renderCard,
  status = 'idle',
  onRetry,
  toolbar,
  className,
}: DataTableProps<TData>): React.JSX.Element {
  const { isRtl } = useDirection();

  const selectable = onRowSelectionChange !== undefined || rowSelection !== undefined;
  const sortable = sorting !== undefined && onSortingChange !== undefined;

  // Column visibility and row selection are pure view state: they work whether
  // or not the screen chooses to own them. Sorting, filtering and pagination
  // never do — those must round-trip to the server or the page would lie.
  const [ownVisibility, setOwnVisibility] = useState<VisibilityState>(EMPTY_VISIBILITY);
  const [ownSelection, setOwnSelection] = useState<RowSelectionState>(EMPTY_SELECTION);

  const visibilityState = columnVisibility ?? ownVisibility;
  const selectionState = rowSelection ?? ownSelection;

  const handlePagination = useCallback(
    (updater: Updater<PaginationState>): void => {
      onPaginationChange(resolveUpdater(updater, pagination));
    },
    [onPaginationChange, pagination],
  );

  const handleSorting = useCallback(
    (updater: Updater<SortingState>): void => {
      onSortingChange?.(resolveUpdater(updater, sorting ?? []));
    },
    [onSortingChange, sorting],
  );

  const handleFilters = useCallback(
    (updater: Updater<ColumnFiltersState>): void => {
      onColumnFiltersChange?.(resolveUpdater(updater, columnFilters ?? []));
    },
    [columnFilters, onColumnFiltersChange],
  );

  const handleVisibility = useCallback(
    (updater: Updater<VisibilityState>): void => {
      const next = resolveUpdater(updater, visibilityState);
      if (onColumnVisibilityChange === undefined) setOwnVisibility(next);
      else onColumnVisibilityChange(next);
    },
    [onColumnVisibilityChange, visibilityState],
  );

  const handleSelection = useCallback(
    (updater: Updater<RowSelectionState>): void => {
      const next = resolveUpdater(updater, selectionState);
      if (onRowSelectionChange === undefined) setOwnSelection(next);
      else onRowSelectionChange(next);
    },
    [onRowSelectionChange, selectionState],
  );

  const clearSelection = useCallback((): void => {
    if (onRowSelectionChange === undefined) setOwnSelection(EMPTY_SELECTION);
    else onRowSelectionChange({});
  }, [onRowSelectionChange]);

  const table = useReactTable<TData>({
    data,
    columns,
    pageCount,
    getRowId,
    state: {
      pagination,
      sorting: sorting ?? EMPTY_SORTING,
      columnFilters: columnFilters ?? EMPTY_FILTERS,
      columnVisibility: visibilityState,
      rowSelection: selectionState,
    },
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableSorting: sortable,
    enableRowSelection: selectable,
    onPaginationChange: handlePagination,
    onSortingChange: handleSorting,
    onColumnFiltersChange: handleFilters,
    onColumnVisibilityChange: handleVisibility,
    onRowSelectionChange: handleSelection,
    getCoreRowModel: getCoreRowModel(),
  });

  const rows = table.getRowModel().rows;
  const leafColumns = table.getAllLeafColumns();
  const hideableColumns = leafColumns.filter((column) => column.getCanHide());
  const visibleColumnCount = table.getVisibleLeafColumns().length + (selectable ? 1 : 0);

  const selectedIds = useMemo(
    () =>
      Object.entries(selectionState)
        .filter(([, on]) => on === true)
        .map(([id]) => id),
    [selectionState],
  );

  const isLoading = status === 'loading';
  const isError = status === 'error';
  const isEmpty = !isLoading && !isError && rows.length === 0;

  const skeletonRows = Math.max(3, Math.min(8, pagination.pageSize));

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {toolbar !== undefined || hideableColumns.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">{toolbar}</div>

          {hideableColumns.length > 0 ? (
            <DropdownMenu.Root dir={isRtl ? 'rtl' : 'ltr'}>
              <DropdownMenu.Trigger
                className={cn(
                  'inline-flex h-11 items-center gap-2 rounded-md border border-hairline bg-surface px-3 text-sm',
                  'text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                  'hover:bg-raised hover:text-ink data-[state=open]:bg-raised data-[state=open]:text-ink',
                )}
              >
                <Columns3 className="size-4" aria-hidden="true" />
                <span>{labels.columnsMenu}</span>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  collisionPadding={12}
                  className="z-50 max-h-[60vh] min-w-[13rem] overflow-y-auto rounded-md border border-hairline bg-raised p-1 shadow-e3"
                >
                  {hideableColumns.map((column) => (
                    <DropdownMenu.CheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(checked) => column.toggleVisibility(checked === true)}
                      onSelect={(event) => event.preventDefault()}
                      className={cn(
                        'flex h-11 cursor-pointer select-none items-center gap-2 rounded-sm px-3 text-sm outline-none',
                        'text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                        'data-[highlighted]:bg-strait-wash data-[highlighted]:text-ink',
                        'data-[state=checked]:text-ink',
                      )}
                    >
                      <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-hairline">
                        <DropdownMenu.ItemIndicator>
                          <span className="block size-2 rounded-[2px] bg-strait" />
                        </DropdownMenu.ItemIndicator>
                      </span>
                      <span className="text-start">{columnLabel(column.id, column.columnDef.header)}</span>
                    </DropdownMenu.CheckboxItem>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : null}
        </div>
      ) : null}

      {selectable && selectedIds.length > 0 ? (
        <div
          role="region"
          aria-label={labels.selectionSummary}
          className="flex flex-wrap items-center gap-3 rounded-md border border-strait bg-strait-wash px-3 py-2"
        >
          <p className="text-sm font-medium text-ink">{labels.selectionSummary}</p>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            {bulkActions?.(selectedIds)}
            <button
              type="button"
              onClick={clearSelection}
              className="inline-flex h-11 items-center rounded-md px-3 text-sm text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-ink"
            >
              {labels.clearSelection}
            </button>
          </div>
        </div>
      ) : null}

      <span role="status" aria-live="polite" className="sr-only">
        {isLoading ? labels.loading : ''}
      </span>

      {isError ? (
        <StatusBlock
          icon={<TriangleAlert className="size-6 text-danger" aria-hidden="true" />}
          title={labels.errorTitle}
          description={labels.errorDescription}
          action={
            labels.retry !== undefined && onRetry !== undefined ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-11 items-center rounded-md bg-strait px-4 text-sm font-medium text-on-accent transition-opacity duration-[120ms] ease-[var(--ease-out-strait)] hover:opacity-90"
              >
                {labels.retry}
              </button>
            ) : null
          }
          tone="danger"
        />
      ) : isEmpty ? (
        <StatusBlock
          icon={<Inbox className="size-6 text-ink-muted" aria-hidden="true" />}
          title={labels.emptyTitle}
          description={labels.emptyDescription}
          action={null}
          tone="neutral"
        />
      ) : (
        <>
          {/* ── Desktop and tablet: the table ─────────────────────────────── */}
          <div className="hidden overflow-x-auto rounded-lg border border-hairline bg-surface md:block">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{labels.caption}</caption>
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {selectable ? (
                      <th
                        scope="col"
                        className="sticky top-0 z-10 w-12 bg-surface px-3 py-3 hairline-b"
                      >
                        <SelectionCheckbox
                          checked={table.getIsAllPageRowsSelected()}
                          indeterminate={table.getIsSomePageRowsSelected()}
                          onChange={(next) => table.toggleAllPageRowsSelected(next)}
                          label={labels.selectAll}
                        />
                      </th>
                    ) : null}

                    {headerGroup.headers.map((header) => {
                      const canSort = header.column.getCanSort();
                      const sorted = header.column.getIsSorted();

                      return (
                        <th
                          key={header.id}
                          scope="col"
                          colSpan={header.colSpan}
                          aria-sort={
                            !canSort
                              ? undefined
                              : sorted === 'asc'
                                ? 'ascending'
                                : sorted === 'desc'
                                  ? 'descending'
                                  : 'none'
                          }
                          className="sticky top-0 z-10 bg-surface px-3 py-3 text-start font-medium text-ink-muted hairline-b"
                        >
                          {header.isPlaceholder ? null : canSort ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className={cn(
                                'inline-flex min-h-11 items-center gap-1.5 rounded-sm text-start',
                                'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-ink',
                                sorted === false ? null : 'text-ink',
                              )}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sorted === 'asc' ? (
                                <ChevronUp className="size-4 shrink-0 text-strait" aria-hidden="true" />
                              ) : sorted === 'desc' ? (
                                <ChevronDown
                                  className="size-4 shrink-0 text-strait"
                                  aria-hidden="true"
                                />
                              ) : (
                                <ChevronsUpDown
                                  className="size-4 shrink-0 opacity-50"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>

              <tbody>
                {isLoading
                  ? Array.from({ length: skeletonRows }, (_unused, index) => (
                      <tr key={`skeleton-${index}`} className="hairline-b">
                        {Array.from({ length: visibleColumnCount }, (_cell, cellIndex) => (
                          <td key={`skeleton-${index}-${cellIndex}`} className="px-3 py-3">
                            <span className="block h-4 w-full max-w-40 animate-pulse rounded-sm bg-raised" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rows.map((row) => (
                      <tr
                        key={row.id}
                        data-state={row.getIsSelected() ? 'selected' : undefined}
                        className={cn(
                          'hairline-b transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                          'hover:bg-raised data-[state=selected]:bg-strait-wash',
                        )}
                      >
                        {selectable ? (
                          <td className="w-12 px-3 py-3 align-middle">
                            <SelectionCheckbox
                              checked={row.getIsSelected()}
                              indeterminate={false}
                              disabled={!row.getCanSelect()}
                              onChange={(next) => row.toggleSelected(next)}
                              label={labels.selectRow}
                            />
                          </td>
                        ) : null}
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-3 py-3 align-middle text-ink">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>

          {/* ── Mobile: the same rows as cards (§11.4) ────────────────────── */}
          <ul role="list" aria-label={labels.caption} className="flex flex-col gap-2 md:hidden">
            {isLoading
              ? Array.from({ length: skeletonRows }, (_unused, index) => (
                  <li
                    key={`card-skeleton-${index}`}
                    className="rounded-lg border border-hairline bg-surface p-4"
                  >
                    <span className="mb-2 block h-4 w-2/3 animate-pulse rounded-sm bg-raised" />
                    <span className="block h-4 w-1/3 animate-pulse rounded-sm bg-raised" />
                  </li>
                ))
              : rows.map((row) => (
                  <li
                    key={row.id}
                    data-state={row.getIsSelected() ? 'selected' : undefined}
                    className={cn(
                      'rounded-lg border border-hairline bg-surface p-4',
                      'data-[state=selected]:border-strait data-[state=selected]:bg-strait-wash',
                    )}
                  >
                    {renderCard(row)}
                  </li>
                ))}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted" data-numeric>
          <span className="force-ltr" dir="ltr">
            {labels.pageSummary}
          </span>
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage() || isLoading}
            aria-label={labels.previousPage}
            className={cn(
              'inline-flex size-11 items-center justify-center rounded-md border border-hairline bg-surface',
              'text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
              'hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            {/* A chevron carries direction: mirrored in RTL (§10.3). */}
            <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage() || isLoading}
            aria-label={labels.nextPage}
            className={cn(
              'inline-flex size-11 items-center justify-center rounded-md border border-hairline bg-surface',
              'text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
              'hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function columnLabel(id: string, header: unknown): string {
  return typeof header === 'string' && header.length > 0 ? header : id;
}

interface SelectionCheckboxProps {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

/**
 * `indeterminate` has no HTML attribute — it exists only as a DOM property, so
 * it has to be written through a ref. A native checkbox is used deliberately:
 * it is the one control every assistive technology and every mobile browser
 * already agrees on.
 */
function SelectionCheckbox({
  checked,
  indeterminate,
  disabled = false,
  onChange,
  label,
}: SelectionCheckboxProps): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = indeterminate && !checked;
  }, [checked, indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
      className={cn(
        'size-5 cursor-pointer rounded-sm border border-hairline bg-surface accent-strait',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    />
  );
}

interface StatusBlockProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action: React.ReactNode;
  tone: 'neutral' | 'danger';
}

function StatusBlock({
  icon,
  title,
  description,
  action,
  tone,
}: StatusBlockProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border px-6 py-12 text-center',
        tone === 'danger' ? 'border-danger bg-danger-wash' : 'border-hairline bg-surface',
      )}
    >
      {icon}
      <p className="font-display text-heading text-ink">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-prose text-sm text-ink-muted">{description}</p>
      )}
      {action}
    </div>
  );
}
