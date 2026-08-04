'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ColumnDef, PaginationState, Row, SortingState } from '@tanstack/react-table';
import { ExternalLink, Pencil, Search } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { DataTable } from '@/components/ui/data-table';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Rating } from '@/components/ui/rating';
import { StatusPill } from '@/components/ui/status-pill';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  COLUMN_TO_SORT,
  COURSE_STATUS_LABEL_KEY,
  PARAM,
  SORT_COLUMN_ID,
  TABS,
  TAB_LABEL_KEY,
  type CourseRowView,
  type CoursesFilterState,
  type SortParam,
  type TabKey,
} from './course-view';

/**
 * The §17.5 catalogue list.
 *
 * Server-side pagination, exactly like the account and payment queues: every
 * control writes to the URL and the server re-queries. Nothing is filtered in
 * the browser, so « 12 formations » always describes the rows underneath it.
 *
 * ## Why the tabs are links and not buttons
 * A status tab is a different URL, so it is an `<a>`: middle-click opens
 * « Brouillons » in a new tab, the browser's back button walks the queues, and
 * a filtered view is something an author can paste to a colleague. A `<button>`
 * that called `router.push` would look identical and do none of that.
 */

export interface CoursesTableProps {
  readonly rows: readonly CourseRowView[];
  readonly counts: Readonly<Record<TabKey, number>>;
  readonly tab: TabKey;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly sortBy: SortParam;
  readonly sortDir: 'asc' | 'desc';
  readonly search: string;
  readonly filters: CoursesFilterState;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly currentParams: Readonly<Record<string, string>>;
}

export function CoursesTable(props: CoursesTableProps): React.JSX.Element {
  const {
    rows,
    counts,
    tab,
    total,
    page,
    pageSize,
    pageCount,
    sortBy,
    sortDir,
    search,
    filters,
    categories,
    currentParams,
  } = props;

  const t = useTranslations('admin.courses');
  const tQueue = useTranslations('admin.requests');
  const tAccounts = useTranslations('admin.accounts');
  const tCatalog = useTranslations('catalog');
  const tCommon = useTranslations('common');
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

  // Debounced so a five-letter search is one query, not five.
  useEffect(() => {
    if (searchValue === search) return;
    const timer = setTimeout(() => {
      navigate({ [PARAM.search]: searchValue.trim() === '' ? null : searchValue.trim() });
    }, 350);
    return () => clearTimeout(timer);
  }, [navigate, search, searchValue]);

  /* ── Columns ─────────────────────────────────────────────────────────── */

  const columns = useMemo<ColumnDef<CourseRowView>[]>(
    () => [
      {
        id: 'title',
        header: t('columns.title'),
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <Link
            href={`/admin/formations/${row.original.id}`}
            className="flex min-h-11 min-w-0 flex-col justify-center rounded-sm text-start"
          >
            <span className="truncate font-medium text-ink">{row.original.title}</span>
            <span className="force-ltr truncate font-mono text-xs text-ink-muted" dir="ltr">
              {row.original.slug}
            </span>
          </Link>
        ),
      },
      {
        id: 'category',
        header: t('columns.category'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-ink-muted">{row.original.categoryName ?? '—'}</span>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <StatusPill
            domain="course"
            status={row.original.status}
            label={t(COURSE_STATUS_LABEL_KEY[row.original.status])}
          />
        ),
      },
      {
        id: 'price',
        header: t('columns.price'),
        enableSorting: true,
        cell: ({ row }) => <PriceCell row={row.original} />,
      },
      {
        id: 'lessons',
        header: t('columns.lessons'),
        enableSorting: false,
        cell: ({ row }) => (
          <span data-numeric dir="ltr" className="force-ltr text-sm text-ink-muted">
            {row.original.lessonCount}
          </span>
        ),
      },
      {
        id: 'enrollments',
        header: t('columns.enrollments'),
        enableSorting: true,
        cell: ({ row }) => (
          <span data-numeric dir="ltr" className="force-ltr text-sm text-ink-muted">
            {row.original.enrollmentCount}
          </span>
        ),
      },
      {
        id: 'rating',
        header: t('columns.rating'),
        enableSorting: true,
        cell: ({ row }) => <RatingCell row={row.original} />,
      },
      {
        id: 'updatedAt',
        header: t('columns.updatedAt'),
        enableSorting: true,
        cell: ({ row }) => (
          <time dateTime={row.original.updatedAtIso} className="text-sm text-ink-muted">
            {row.original.updatedAtLabel}
          </time>
        ),
      },
      {
        id: 'actions',
        // `admin.courses.columns` has no word for this column; the accounts
        // queue already owns the panel-wide one.
        header: tAccounts('columns.actions'),
        enableSorting: false,
        cell: ({ row }) => <RowActions row={row.original} />,
      },
    ],
    [t, tAccounts],
  );

  const renderCard = useCallback(
    (row: Row<CourseRowView>): React.JSX.Element => {
      const course = row.original;
      return (
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <Link
              href={`/admin/formations/${course.id}`}
              className="flex min-w-0 flex-col rounded-sm text-start"
            >
              <span className="truncate font-medium text-ink">{course.title}</span>
              <span className="truncate text-sm text-ink-muted">{course.categoryName ?? '—'}</span>
            </Link>
            <StatusPill
              domain="course"
              status={course.status}
              label={t(COURSE_STATUS_LABEL_KEY[course.status])}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-muted">
            <PriceCell row={course} />
            <span data-numeric dir="ltr" className="force-ltr">
              {`${t('columns.lessons')} ${course.lessonCount}`}
            </span>
            <span data-numeric dir="ltr" className="force-ltr">
              {`${t('columns.enrollments')} ${course.enrollmentCount}`}
            </span>
            <time dateTime={course.updatedAtIso} className="ms-auto">
              {course.updatedAtLabel}
            </time>
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
  const searching = search !== '' || filters.category !== null;

  return (
    <DataTable<CourseRowView>
      data={rows as CourseRowView[]}
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
          tab={tab}
          counts={counts}
          search={searchValue}
          onSearch={setSearchValue}
          filters={filters}
          categories={categories}
          buildHref={buildHref}
          navigate={navigate}
          total={total}
        />
      }
      labels={{
        caption: t('title'),
        // Generic table chrome the courses namespace does not restate. The
        // selection strings are never rendered — this table is not selectable —
        // but `DataTableLabels` requires them, so they are real words rather
        // than placeholders.
        columnsMenu: tQueue('table.columnsMenu'),
        selectAll: tQueue('bulk.selectAll'),
        selectRow: tQueue('table.selectRow'),
        selectionSummary: tQueue('bulk.selected', { count: 0 }),
        clearSelection: tQueue('bulk.clear'),
        previousPage: tQueue('table.previousPage'),
        nextPage: tQueue('table.nextPage'),
        pageSummary: tQueue('table.pageSummary', { from, to, total }),
        loading: tCommon('loading'),
        emptyTitle: searching ? tCatalog('empty.title') : tCatalog('emptyCatalog.title'),
        emptyDescription: searching ? tCatalog('empty.body') : tCatalog('emptyCatalog.body'),
        errorTitle: tQueue('table.errorTitle'),
        errorDescription: tQueue('table.errorDescription'),
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Cells                                                                       */
/* -------------------------------------------------------------------------- */

/** Brass is money (§11.2), and a free course is not a price — it is a fact. */
function PriceCell({ row }: { row: CourseRowView }): React.JSX.Element {
  const t = useTranslations('admin.courses');

  if (row.isFree) return <span className="text-sm text-ink-muted">{t('pricing.free')}</span>;

  return (
    <span data-numeric dir="ltr" className="force-ltr text-sm font-medium text-brass">
      {row.priceLabel}
    </span>
  );
}

/**
 * A course with no reviews has no rating — stars at zero would read as « noté
 * 0 sur 5 », which is a judgement nobody made.
 */
function RatingCell({ row }: { row: CourseRowView }): React.JSX.Element {
  const t = useTranslations('admin.courses');

  if (row.ratingCount === 0) return <span className="text-sm text-ink-muted">—</span>;

  return (
    <Rating
      value={row.ratingAvg}
      size="sm"
      label={t('columns.rating')}
      caption={
        <span data-numeric dir="ltr" className="force-ltr">
          {row.ratingCount}
        </span>
      }
    />
  );
}

/**
 * Edit, plus « prévisualiser » for a course that has a public page.
 *
 * A draft has no published URL, so the second link is absent there rather than
 * present and 404ing: §17.5's « preview as student » in draft mode needs a
 * preview-token route this milestone does not have, and a button that leads
 * nowhere is worse than a button that is not offered.
 */
function RowActions({ row }: { row: CourseRowView }): React.JSX.Element {
  const t = useTranslations('admin.courses');
  const tA11y = useTranslations('a11y');

  return (
    <span className="flex items-center gap-1">
      <Link
        href={`/admin/formations/${row.id}`}
        aria-label={`${t('rowActions.edit')} — ${row.title}`}
        title={t('rowActions.edit')}
        className={cn(
          'inline-flex size-11 items-center justify-center rounded-md text-ink-muted',
          'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-ink',
        )}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </Link>

      {row.status === 'PUBLISHED' ? (
        <Link
          href={`/formations/${row.slug}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`${t('rowActions.preview')} — ${tA11y('newWindow')}`}
          title={t('rowActions.preview')}
          className={cn(
            'inline-flex size-11 items-center justify-center rounded-md text-ink-muted',
            'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-ink',
          )}
        >
          <ExternalLink className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                     */
/* -------------------------------------------------------------------------- */

function Toolbar({
  tab,
  counts,
  search,
  onSearch,
  filters,
  categories,
  buildHref,
  navigate,
  total,
}: {
  tab: TabKey;
  counts: Readonly<Record<TabKey, number>>;
  search: string;
  onSearch: (value: string) => void;
  filters: CoursesFilterState;
  categories: readonly { readonly id: string; readonly name: string }[];
  buildHref: (patch: Readonly<Record<string, string | null>>, resetPage?: boolean) => string;
  navigate: (patch: Readonly<Record<string, string | null>>, resetPage?: boolean) => void;
  total: number;
}): React.JSX.Element {
  const t = useTranslations('admin.courses');
  const tQueue = useTranslations('admin.requests');
  const tCatalog = useTranslations('catalog');
  const tCommon = useTranslations('common');

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label={t('title')}>
        <ul className="flex flex-wrap gap-1 border-b border-hairline">
          {TABS.map((entry) => {
            const active = entry.key === tab;
            return (
              <li key={entry.key}>
                <Link
                  href={buildHref({
                    [PARAM.tab]: entry.key === 'toutes' ? null : entry.key,
                  })}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm',
                    'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                    active
                      ? 'border-strait font-medium text-ink'
                      : 'border-transparent text-ink-muted hover:text-ink',
                  )}
                >
                  <span>
                    {entry.key === 'toutes'
                      ? tQueue('tabs.all')
                      : t(TAB_LABEL_KEY[entry.key])}
                  </span>
                  <span data-numeric dir="ltr" className="force-ltr text-xs text-ink-muted">
                    {counts[entry.key]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <label className="sr-only" htmlFor="recherche-formations">
            {tCommon('search')}
          </label>
          <Input
            id="recherche-formations"
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t('searchPlaceholder')}
            iconStart={<Search aria-hidden="true" />}
            inputSize="sm"
          />
        </div>

        <FormField label={t('columns.category')} className="w-full sm:w-56">
          {(field) => (
            <Select
              value={filters.category ?? 'toutes'}
              onValueChange={(value) =>
                navigate({ [PARAM.category]: value === 'toutes' ? null : value })
              }
            >
              <SelectTrigger id={field.id} selectSize="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="toutes">{tCatalog('filters.category.all')}</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>

        <p className="ms-auto pb-2 text-sm text-ink-muted" data-numeric>
          {t('resultCount', { count: total })}
        </p>
      </div>
    </div>
  );
}
