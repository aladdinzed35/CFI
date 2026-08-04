'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ColumnDef, PaginationState, Row, SortingState } from '@tanstack/react-table';
import { Download, Search, SlidersHorizontal } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  COLUMN_TO_SORT,
  METHOD_LABEL_KEY,
  METHOD_PARAM,
  PARAM,
  PAYMENT_METHODS,
  SORT_COLUMN_ID,
  type PaymentRowView,
  type PaymentTotalsView,
  type PaymentsFilterState,
  type SortParam,
} from './payment-view';

/**
 * The §17.4 ledger.
 *
 * Server-side pagination through `listPayments`, exactly like the queue: every
 * control writes to the URL and the server re-queries. The totals panel is
 * recomputed from the same `WHERE`, so « Total » always describes the rows
 * underneath it and never a different filter.
 */

export interface PaymentsTableProps {
  readonly rows: readonly PaymentRowView[];
  readonly totals: PaymentTotalsView;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly sortBy: SortParam;
  readonly sortDir: 'asc' | 'desc';
  readonly search: string;
  readonly filters: PaymentsFilterState;
  readonly courses: readonly { readonly id: string; readonly title: string }[];
  readonly currentParams: Readonly<Record<string, string>>;
}

export function PaymentsTable(props: PaymentsTableProps): React.JSX.Element {
  const {
    rows,
    totals,
    total,
    page,
    pageSize,
    pageCount,
    sortBy,
    sortDir,
    search,
    filters,
    courses,
    currentParams,
  } = props;

  const t = useTranslations('admin.payments');
  const tTable = useTranslations('admin.requests');
  const router = useRouter();
  const pathname = usePathname();

  const [searchValue, setSearchValue] = useState(search);

  useEffect(() => {
    setSearchValue(search);
  }, [search]);

  const buildHref = useCallback(
    (patch: Readonly<Record<string, string | null>>, resetPage = true): string => {
      const next = new URLSearchParams(currentParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      if (resetPage && !(PARAM.page in patch)) next.delete(PARAM.page);
      const query = next.toString();
      return query === '' ? pathname : `${pathname}?${query}`;
    },
    [currentParams, pathname],
  );

  const navigate = useCallback(
    (patch: Readonly<Record<string, string | null>>, resetPage = true): void => {
      router.replace(buildHref(patch, resetPage), { scroll: false });
    },
    [buildHref, router],
  );

  useEffect(() => {
    if (searchValue === search) return;
    const timer = setTimeout(() => {
      navigate({ [PARAM.search]: searchValue.trim() === '' ? null : searchValue.trim() });
    }, 350);
    return () => clearTimeout(timer);
  }, [navigate, search, searchValue]);

  /* ── Columns ─────────────────────────────────────────────────────────── */

  const columns = useMemo<ColumnDef<PaymentRowView>[]>(
    () => [
      {
        id: 'receivedAt',
        header: t('columns.receivedAt'),
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <time dateTime={row.original.receivedAtIso} className="text-sm text-ink-muted">
            {row.original.receivedAtLabel}
          </time>
        ),
      },
      {
        id: 'student',
        header: t('columns.student'),
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            href={`/admin/comptes/${row.original.studentId}`}
            className="flex min-h-11 min-w-0 flex-col justify-center rounded-sm text-start"
          >
            <span className="truncate font-medium text-ink">{row.original.studentName}</span>
            <span className="force-ltr truncate text-xs text-ink-muted" dir="ltr">
              {row.original.studentEmail}
            </span>
          </Link>
        ),
      },
      {
        id: 'course',
        header: t('columns.course'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="line-clamp-2 text-sm text-ink-muted">{row.original.courseTitle}</span>
        ),
      },
      {
        id: 'amountCentimes',
        header: t('columns.amount'),
        enableSorting: true,
        cell: ({ row }) => (
          <span data-numeric dir="ltr" className="force-ltr text-sm font-medium text-brass">
            {row.original.amountLabel}
          </span>
        ),
      },
      {
        id: 'method',
        header: t('columns.method'),
        enableSorting: false,
        cell: ({ row }) => (
          <Badge tone="neutral" variant="soft" size="sm">
            {t(METHOD_LABEL_KEY[row.original.method])}
          </Badge>
        ),
      },
      {
        id: 'invoice',
        header: t('columns.invoice'),
        enableSorting: false,
        cell: ({ row }) => <InvoiceCell row={row.original} />,
      },
      {
        id: 'confirmedBy',
        header: t('columns.confirmedBy'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-ink-muted">{row.original.confirmedByName ?? '—'}</span>
        ),
      },
      {
        id: 'actions',
        header: t('columns.actions'),
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            href={`/admin/demandes?fiche=${row.original.requestId}`}
            className="inline-flex min-h-11 items-center rounded-md px-2 font-mono text-xs text-strait hover:underline"
          >
            <span data-numeric dir="ltr" className="force-ltr">
              {row.original.reference}
            </span>
          </Link>
        ),
      },
    ],
    [t],
  );

  const renderCard = useCallback(
    (row: Row<PaymentRowView>): React.JSX.Element => {
      const payment = row.original;
      return (
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-ink">{payment.studentName}</span>
              <span className="line-clamp-2 text-sm text-ink-muted">{payment.courseTitle}</span>
            </span>
            <span data-numeric dir="ltr" className="force-ltr text-sm font-medium text-brass">
              {payment.amountLabel}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral" variant="soft" size="sm">
              {t(METHOD_LABEL_KEY[payment.method])}
            </Badge>
            <time dateTime={payment.receivedAtIso} className="text-xs text-ink-muted">
              {payment.receivedAtLabel}
            </time>
            <span className="ms-auto">
              <InvoiceCell row={payment} />
            </span>
          </div>
        </div>
      );
    },
    [t],
  );

  /* ── Table state ─────────────────────────────────────────────────────── */

  const sorting: SortingState = useMemo(
    () => [{ id: SORT_COLUMN_ID[sortBy], desc: sortDir === 'desc' }],
    [sortBy, sortDir],
  );

  const pagination: PaginationState = useMemo(
    () => ({ pageIndex: page - 1, pageSize }),
    [page, pageSize],
  );

  const onSortingChange = useCallback(
    (next: SortingState): void => {
      const first = next[0];
      if (first === undefined) {
        navigate({ [PARAM.sortBy]: null, [PARAM.sortDir]: null });
        return;
      }
      const param = COLUMN_TO_SORT[first.id];
      if (param === undefined) return;
      navigate({ [PARAM.sortBy]: param, [PARAM.sortDir]: first.desc ? 'desc' : 'asc' });
    },
    [navigate],
  );

  const onPaginationChange = useCallback(
    (next: PaginationState): void => {
      navigate(
        {
          [PARAM.page]: String(next.pageIndex + 1),
          [PARAM.pageSize]: next.pageSize === 25 ? null : String(next.pageSize),
        },
        false,
      );
    },
    [navigate],
  );

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <>
      <Totals totals={totals} />

      <DataTable<PaymentRowView>
        className="mt-4"
        data={rows as PaymentRowView[]}
        columns={columns}
        getRowId={(row) => row.id}
        pagination={pagination}
        onPaginationChange={onPaginationChange}
        pageCount={pageCount}
        sorting={sorting}
        onSortingChange={onSortingChange}
        renderCard={renderCard}
        toolbar={
          <Toolbar
            search={searchValue}
            onSearch={setSearchValue}
            filters={filters}
            courses={courses}
            buildHref={buildHref}
            navigate={navigate}
            total={total}
          />
        }
        labels={{
          caption: t('table.caption'),
          // Generic table chrome the payments namespace does not restate. The
          // selection strings are never rendered — this table is not selectable —
          // but `DataTableLabels` requires them, so they are real words rather
          // than placeholders.
          columnsMenu: tTable('table.columnsMenu'),
          selectAll: tTable('bulk.selectAll'),
          selectRow: tTable('table.selectRow'),
          selectionSummary: tTable('bulk.selected', { count: 0 }),
          clearSelection: tTable('bulk.clear'),
          previousPage: tTable('table.previousPage'),
          nextPage: tTable('table.nextPage'),
          pageSummary: t('table.pageSummary', { from, to, total }),
          loading: t('table.loading'),
          emptyTitle: t('empty.title'),
          emptyDescription: t('empty.body'),
          errorTitle: t('table.errorTitle'),
          errorDescription: t('table.errorDescription'),
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The invoice link, served by the authenticated gateway with an explicit
 * `Content-Disposition: attachment` (§19.1). Until the `GENERATE_INVOICE` job
 * has produced the PDF there is a number but no file, and the cell says exactly
 * that rather than offering a link that would 404.
 */
function InvoiceCell({ row }: { row: PaymentRowView }): React.JSX.Element {
  const t = useTranslations('admin.payments');

  if (row.invoiceNumber === null) return <span className="text-sm text-ink-muted">—</span>;

  if (row.invoicePath === null) {
    return (
      <span data-numeric dir="ltr" className="force-ltr font-mono text-xs text-ink-muted">
        {row.invoiceNumber}
      </span>
    );
  }

  return (
    <a
      href={row.invoicePath}
      aria-label={t('actions.downloadInvoice')}
      title={t('actions.downloadInvoice')}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-strait hover:underline"
    >
      <Download className="size-4 shrink-0" aria-hidden="true" />
      <span data-numeric dir="ltr" className="force-ltr font-mono text-xs">
        {row.invoiceNumber}
      </span>
    </a>
  );
}

/** Count and sum over the filtered set, plus the same split by method. */
function Totals({ totals }: { totals: PaymentTotalsView }): React.JSX.Element {
  const t = useTranslations('admin.payments');

  return (
    <section
      aria-label={t('reports.title')}
      className="flex flex-wrap items-end gap-x-8 gap-y-4 rounded-md border border-hairline bg-raised p-4"
    >
      <div>
        <p className="text-xs text-ink-muted">{t('reports.total')}</p>
        <p data-numeric dir="ltr" className="force-ltr font-display text-title text-brass">
          {totals.totalLabel}
        </p>
        <p className="text-xs text-ink-muted" data-numeric>
          {t('resultCount', { count: totals.count })}
        </p>
      </div>

      {totals.byMethod.map((entry) => (
        <div key={entry.method}>
          <p className="text-xs text-ink-muted">{t(METHOD_LABEL_KEY[entry.method])}</p>
          <p data-numeric dir="ltr" className="force-ltr text-lead text-ink">
            {entry.totalLabel}
          </p>
          <p className="text-xs text-ink-muted" data-numeric>
            {t('resultCount', { count: entry.count })}
          </p>
        </div>
      ))}
    </section>
  );
}

function Toolbar({
  search,
  onSearch,
  filters,
  courses,
  buildHref,
  navigate,
  total,
}: {
  search: string;
  onSearch: (value: string) => void;
  filters: PaymentsFilterState;
  courses: readonly { readonly id: string; readonly title: string }[];
  buildHref: (patch: Readonly<Record<string, string | null>>, resetPage?: boolean) => string;
  navigate: (patch: Readonly<Record<string, string | null>>, resetPage?: boolean) => void;
  total: number;
}): React.JSX.Element {
  const t = useTranslations('admin.payments');
  const tCommon = useTranslations('common');

  const activeFilters = [filters.course, filters.method, filters.from, filters.to].filter(
    (value) => value !== null,
  ).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <label className="sr-only" htmlFor="recherche-paiements">
            {tCommon('search')}
          </label>
          <Input
            id="recherche-paiements"
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t('searchPlaceholder')}
            iconStart={<Search aria-hidden="true" />}
            inputSize="sm"
          />
        </div>

        <p className="text-sm text-ink-muted" data-numeric>
          {t('resultCount', { count: total })}
        </p>
      </div>

      <details className="group rounded-md border border-hairline bg-surface">
        <summary
          className={cn(
            'flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm text-ink-muted',
            '[&::-webkit-details-marker]:hidden',
            'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-ink',
          )}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          <span>{t('filters.period')}</span>
          <span className="text-xs" data-numeric>
            {activeFilters}
          </span>
        </summary>

        <div className="grid grid-cols-1 gap-3 border-t border-hairline p-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label={t('filters.course')}>
            {(field) => (
              <Select
                value={filters.course ?? 'toutes'}
                onValueChange={(value) =>
                  navigate({ [PARAM.course]: value === 'toutes' ? null : value })
                }
              >
                <SelectTrigger id={field.id} selectSize="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="toutes">{t('filters.anyCourse')}</SelectItem>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label={t('filters.method')}>
            {(field) => (
              <Select
                value={filters.method ?? 'tous'}
                onValueChange={(value) =>
                  navigate({ [PARAM.method]: value === 'tous' ? null : value })
                }
              >
                <SelectTrigger id={field.id} selectSize="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tous">{t('filters.anyMethod')}</SelectItem>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={METHOD_PARAM[method]}>
                      {t(METHOD_LABEL_KEY[method])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label={t('filters.from')}>
            {(field) => (
              <Input
                id={field.id}
                type="date"
                defaultValue={filters.from ?? ''}
                inputSize="sm"
                className="force-ltr"
                dir="ltr"
                onChange={(event) => navigate({ [PARAM.from]: event.target.value })}
              />
            )}
          </FormField>

          <FormField label={t('filters.to')}>
            {(field) => (
              <Input
                id={field.id}
                type="date"
                defaultValue={filters.to ?? ''}
                inputSize="sm"
                className="force-ltr"
                dir="ltr"
                onChange={(event) => navigate({ [PARAM.to]: event.target.value })}
              />
            )}
          </FormField>

          <div className="sm:col-span-2 lg:col-span-4">
            <Link
              href={buildHref({
                [PARAM.course]: null,
                [PARAM.method]: null,
                [PARAM.from]: null,
                [PARAM.to]: null,
                [PARAM.search]: null,
              })}
              className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-strait hover:underline"
            >
              {t('filters.reset')}
            </Link>
          </div>
        </div>
      </details>
    </div>
  );
}
