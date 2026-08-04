'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import type { ColumnDef, PaginationState, Row, SortingState } from '@tanstack/react-table';
import { FileText, MessageCircle, Search, SlidersHorizontal } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/ui/copy-button';
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
import { StatusPill } from '@/components/ui/status-pill';

import { VerificationDrawer } from './verification-drawer';
import {
  COLUMN_TO_SORT,
  PARAM,
  QUEUES,
  SORT_COLUMN_ID,
  STATUS_LABEL_KEY,
  TRANSFER_TYPES,
  TRANSFER_TYPE_LABEL_KEY,
  TRANSFER_TYPE_PARAM,
  type AgeTone,
  type FlagView,
  type QueueKey,
  type RequestReviewView,
  type RequestRowView,
  type RequestsFilterState,
  type SortParam,
} from './request-view';

/**
 * The §17.3 queue — the table, its tabs, its toolbar and the §2066 row.
 *
 * ## Nothing is filtered in the browser
 * Tabs, search, filters, sorting and pagination all write to the URL and the
 * server re-queries. `DataTable` is configured for exactly that
 * (`manualPagination`, `manualSorting`), so a stray client-side sort cannot make
 * « 25 sur 312 » lie.
 *
 * ## The URL is the state
 * Which tab, which page, which filters and *which request is open* are all
 * search parameters, so « la demande de Salma, file à vérifier, page 3 » is a
 * link that can be pasted into WhatsApp. The drawer reads `fiche`; `J` and `K`
 * only move that parameter.
 *
 * ## This screen must work on a phone
 * §17.3 says so explicitly. Below `md` the table becomes the card list built by
 * `renderCard`, which keeps the four things a decision needs — who, how much,
 * how long it has waited, and the signals — above the fold.
 */

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

export interface RequestsTableProps {
  readonly rows: readonly RequestRowView[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly sortBy: SortParam;
  readonly sortDir: 'asc' | 'desc';
  readonly queue: QueueKey;
  /** Per-queue totals, for the tab badges. */
  readonly counts: Readonly<Record<QueueKey, number>>;
  readonly search: string;
  readonly filters: RequestsFilterState;
  readonly courses: readonly { readonly id: string; readonly title: string }[];
  /** Every search parameter of the current request, so links keep the context. */
  readonly currentParams: Readonly<Record<string, string>>;
  /** The request whose record is open, already loaded by the server. */
  readonly review: RequestReviewView | null;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function RequestsTable(props: RequestsTableProps): React.JSX.Element {
  const {
    rows,
    total,
    page,
    pageSize,
    pageCount,
    sortBy,
    sortDir,
    queue,
    counts,
    search,
    filters,
    courses,
    currentParams,
    review,
  } = props;

  const t = useTranslations('admin.requests');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();

  const [searchValue, setSearchValue] = useState(search);

  // The URL is the source of truth; when it changes under us — a link, the back
  // button, a decision that moved a row out of the queue — the field follows.
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

  /* ── Search, debounced so every keystroke is not a query ─────────────── */
  useEffect(() => {
    if (searchValue === search) return;
    const timer = setTimeout(() => {
      navigate({ [PARAM.search]: searchValue.trim() === '' ? null : searchValue.trim() });
    }, 350);
    return () => clearTimeout(timer);
  }, [navigate, search, searchValue]);

  const openReview = useCallback(
    (id: string): void => {
      navigate({ [PARAM.review]: id }, false);
    },
    [navigate],
  );

  /* ── Columns — the §2066 row ─────────────────────────────────────────── */

  const columns = useMemo<ColumnDef<RequestRowView>[]>(
    () => [
      {
        id: 'student',
        header: t('columns.student'),
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              onClick={() => openReview(row.original.id)}
              aria-label={t('openReview', { reference: row.original.reference })}
              className="flex min-h-11 min-w-0 flex-col justify-center rounded-sm text-start"
            >
              <span className="truncate font-medium text-ink">{row.original.studentName}</span>
              <span className="force-ltr truncate text-xs text-ink-muted" dir="ltr">
                {row.original.studentPhoneDisplay}
              </span>
            </button>
            <WhatsAppButton href={row.original.whatsappHref} name={row.original.studentName} />
          </span>
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
        id: 'amountDueCentimes',
        header: t('columns.amount'),
        enableSorting: true,
        cell: ({ row }) => (
          <span data-numeric dir="ltr" className="force-ltr text-sm font-medium text-brass">
            {row.original.amountLabel}
          </span>
        ),
      },
      {
        id: 'transferType',
        header: t('columns.transferType'),
        enableSorting: false,
        cell: ({ row }) => (
          <Badge tone="neutral" variant="soft" size="sm">
            {t(TRANSFER_TYPE_LABEL_KEY[row.original.transferType])}
          </Badge>
        ),
      },
      {
        id: 'transferDate',
        header: t('columns.declaredDate'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-ink-muted">{row.original.transferDateLabel ?? '—'}</span>
        ),
      },
      {
        id: 'createdAt',
        header: t('columns.submittedAt'),
        enableSorting: true,
        cell: ({ row }) => (
          <time
            dateTime={row.original.submittedAtIso}
            title={row.original.submittedAtAbsolute}
            className="text-sm text-ink-muted"
          >
            {row.original.submittedAtRelative}
          </time>
        ),
      },
      {
        id: 'age',
        header: t('columns.age'),
        enableSorting: false,
        cell: ({ row }) => <AgeBadge label={row.original.ageLabel} tone={row.original.ageTone} />,
      },
      {
        id: 'reference',
        header: t('columns.reference'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-1">
            <span data-numeric dir="ltr" className="force-ltr font-mono text-xs text-ink">
              {row.original.reference}
            </span>
            <CopyButton
              value={row.original.reference}
              label={tCommon('copy')}
              copiedLabel={tCommon('copied')}
              size="sm"
            />
          </span>
        ),
      },
      {
        id: 'receipt',
        header: t('columns.receipt'),
        enableSorting: false,
        cell: ({ row }) => <ReceiptThumb row={row.original} />,
      },
      {
        id: 'flags',
        header: t('columns.flags'),
        enableSorting: false,
        cell: ({ row }) => <Flags flags={row.original.flags} />,
      },
      {
        id: 'status',
        header: t('columns.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <StatusPill
            domain="request"
            status={row.original.status}
            label={t(STATUS_LABEL_KEY[row.original.status])}
          />
        ),
      },
    ],
    [openReview, t, tCommon],
  );

  const renderCard = useCallback(
    (row: Row<RequestRowView>): React.JSX.Element => {
      const request = row.original;
      return (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <ReceiptThumb row={request} />
            <button
              type="button"
              onClick={() => openReview(request.id)}
              aria-label={t('openReview', { reference: request.reference })}
              className="flex min-w-0 flex-1 flex-col gap-1 text-start"
            >
              <span className="truncate font-medium text-ink">{request.studentName}</span>
              <span className="line-clamp-2 text-sm text-ink-muted">{request.courseTitle}</span>
              <span data-numeric dir="ltr" className="force-ltr font-mono text-xs text-ink-muted">
                {request.reference}
              </span>
            </button>
            <span data-numeric dir="ltr" className="force-ltr text-sm font-medium text-brass">
              {request.amountLabel}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              domain="request"
              status={request.status}
              label={t(STATUS_LABEL_KEY[request.status])}
            />
            <Badge tone="neutral" variant="soft" size="sm">
              {t(TRANSFER_TYPE_LABEL_KEY[request.transferType])}
            </Badge>
            <AgeBadge label={request.ageLabel} tone={request.ageTone} />
            <span className="ms-auto">
              <WhatsAppButton href={request.whatsappHref} name={request.studentName} />
            </span>
          </div>

          <Flags flags={request.flags} />
        </div>
      );
    },
    [openReview, t],
  );

  /* ── Table state, all of it derived from the URL ─────────────────────── */

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

  const activeQueue = QUEUES.find((entry) => entry.key === queue) ?? QUEUES[0];
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const emptyTitle = search === '' ? t(`${activeQueue.emptyKey}.title`) : t('empty.search.title');
  const emptyBody = search === '' ? t(`${activeQueue.emptyKey}.body`) : t('empty.search.body');

  return (
    <>
      <QueueTabs queue={queue} counts={counts} buildHref={buildHref} />

      <DataTable<RequestRowView>
        className="mt-4"
        data={rows as RequestRowView[]}
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
          columnsMenu: t('table.columnsMenu'),
          selectAll: t('bulk.selectAll'),
          selectRow: t('table.selectRow'),
          selectionSummary: t('bulk.selected', { count: 0 }),
          clearSelection: t('bulk.clear'),
          previousPage: t('table.previousPage'),
          nextPage: t('table.nextPage'),
          pageSummary: t('table.pageSummary', { from, to, total }),
          loading: t('table.loading'),
          emptyTitle,
          emptyDescription: emptyBody,
          errorTitle: t('table.errorTitle'),
          errorDescription: t('table.errorDescription'),
        }}
      />

      <VerificationDrawer
        review={review}
        queue={rows.map((row) => ({ id: row.id, reference: row.reference }))}
        onSelect={(id) => navigate({ [PARAM.review]: id }, false)}
        onDecided={() => router.refresh()}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Row pieces                                                                  */
/* -------------------------------------------------------------------------- */

const AGE_CLASSES: Record<AgeTone, string> = {
  calm: 'border-hairline bg-raised text-ink-muted',
  warn: 'border-warn/30 bg-warn-wash text-warn',
  late: 'border-danger/30 bg-danger-wash text-danger',
};

/** The SLA column that colours itself (§17.3). The number is always spelled out. */
function AgeBadge({ label, tone }: { label: string; tone: AgeTone }): React.JSX.Element {
  return (
    <span
      data-numeric
      className={cn(
        'inline-flex items-center rounded-pill border px-2 py-0.5 text-xs whitespace-nowrap',
        AGE_CLASSES[tone],
      )}
    >
      {label}
    </span>
  );
}

/**
 * The receipt thumbnail, served by the authenticated gateway (§19.1): the
 * browser sends the session cookie, the route asks the ownership oracle, and an
 * administrator's read of somebody else's justificatif is written to the audit
 * log. `unoptimized` is required — `/api/files/…` answers 404 to the image
 * optimiser, which carries no session. `loading="lazy"` keeps a page of 100 rows
 * from fetching 100 receipts nobody scrolled to.
 */
function ReceiptThumb({ row }: { row: RequestRowView }): React.JSX.Element {
  const t = useTranslations('admin.requests');

  if (row.receiptPath === null) {
    return <span className="text-xs text-ink-muted">—</span>;
  }

  const label = t('receiptThumbAlt', { name: row.studentName });

  return (
    <a
      href={row.receiptPath}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="inline-flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-hairline bg-raised transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-surface"
    >
      {row.receiptIsImage ? (
        <Image
          src={row.receiptPath}
          alt={label}
          width={44}
          height={44}
          unoptimized
          loading="lazy"
          className="size-11 object-cover"
        />
      ) : (
        <FileText className="size-5 text-ink-muted" aria-hidden="true" />
      )}
    </a>
  );
}

/** The four §2066 signals, as wash badges. Decided in SQL, rendered here. */
function Flags({ flags }: { flags: readonly FlagView[] }): React.JSX.Element | null {
  const t = useTranslations('admin.requests');

  if (flags.length === 0) return null;

  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Badge key={flag.key} tone={flag.tone} variant="soft" size="sm">
          {t(flag.labelKey)}
        </Badge>
      ))}
    </span>
  );
}

function WhatsAppButton({
  href,
  name,
}: {
  href: string | null;
  name: string;
}): React.JSX.Element | null {
  const tAccounts = useTranslations('admin.accounts');
  if (href === null) return null;
  const label = tAccounts('whatsapp', { name });

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-md text-success',
        'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-success-wash',
      )}
    >
      <MessageCircle className="size-4" aria-hidden="true" />
    </a>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs and toolbar                                                            */
/* -------------------------------------------------------------------------- */

function QueueTabs({
  queue,
  counts,
  buildHref,
}: {
  queue: QueueKey;
  counts: Readonly<Record<QueueKey, number>>;
  buildHref: (patch: Readonly<Record<string, string | null>>, resetPage?: boolean) => string;
}): React.JSX.Element {
  const t = useTranslations('admin.requests');

  return (
    <nav
      aria-label={t('title')}
      className="hairline-b -mx-1 flex items-stretch gap-1 overflow-x-auto px-1"
    >
      {QUEUES.map((entry) => {
        const active = entry.key === queue;
        return (
          <Link
            key={entry.key}
            href={buildHref({
              [PARAM.queue]: entry.key,
              [PARAM.page]: null,
              [PARAM.review]: null,
              [PARAM.sortBy]: null,
              [PARAM.sortDir]: null,
            })}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative -mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
              'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
              active ? 'border-strait text-ink' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t(entry.labelKey)}
            <Badge tone={active ? 'strait' : 'neutral'} variant="soft" size="sm">
              <span data-numeric className="force-ltr" dir="ltr">
                {counts[entry.key]}
              </span>
            </Badge>
          </Link>
        );
      })}
    </nav>
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
  filters: RequestsFilterState;
  courses: readonly { readonly id: string; readonly title: string }[];
  buildHref: (patch: Readonly<Record<string, string | null>>, resetPage?: boolean) => string;
  navigate: (patch: Readonly<Record<string, string | null>>, resetPage?: boolean) => void;
  total: number;
}): React.JSX.Element {
  const t = useTranslations('admin.requests');
  const tCommon = useTranslations('common');

  const activeFilters = [
    filters.course,
    filters.transferType,
    filters.amountMin,
    filters.amountMax,
    filters.from,
    filters.to,
    filters.flagged ? 'oui' : null,
  ].filter((value) => value !== null).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <label className="sr-only" htmlFor="recherche-demandes">
            {tCommon('search')}
          </label>
          <Input
            id="recherche-demandes"
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
          <span>{t('filters.title')}</span>
          <span className="text-xs">{t('filters.active', { count: activeFilters })}</span>
        </summary>

        <div className="grid grid-cols-1 gap-3 border-t border-hairline p-3 sm:grid-cols-2 lg:grid-cols-3">
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

          <FormField label={t('filters.transferType')}>
            {(field) => (
              <Select
                value={filters.transferType ?? 'tous'}
                onValueChange={(value) =>
                  navigate({ [PARAM.transferType]: value === 'tous' ? null : value })
                }
              >
                <SelectTrigger id={field.id} selectSize="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tous">{t('filters.anyTransferType')}</SelectItem>
                  {TRANSFER_TYPES.map((type) => (
                    <SelectItem key={type} value={TRANSFER_TYPE_PARAM[type]}>
                      {t(TRANSFER_TYPE_LABEL_KEY[type])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label={t('filters.amountMin')}>
            {(field) => (
              <Input
                id={field.id}
                inputMode="decimal"
                defaultValue={filters.amountMin ?? ''}
                inputSize="sm"
                className="force-ltr"
                dir="ltr"
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== (filters.amountMin ?? '')) navigate({ [PARAM.amountMin]: value });
                }}
              />
            )}
          </FormField>

          <FormField label={t('filters.amountMax')}>
            {(field) => (
              <Input
                id={field.id}
                inputMode="decimal"
                defaultValue={filters.amountMax ?? ''}
                inputSize="sm"
                className="force-ltr"
                dir="ltr"
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== (filters.amountMax ?? '')) navigate({ [PARAM.amountMax]: value });
                }}
              />
            )}
          </FormField>

          <FormField label={t('filters.submittedFrom')}>
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

          <FormField label={t('filters.submittedTo')}>
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

          <div className="flex items-center sm:col-span-2 lg:col-span-1">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={filters.flagged}
                onChange={(event) =>
                  navigate({ [PARAM.flagged]: event.target.checked ? 'oui' : null })
                }
                className="size-5 rounded-sm border border-hairline bg-surface accent-strait"
              />
              {t('filters.flaggedOnly')}
            </label>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <Link
              href={buildHref({
                [PARAM.course]: null,
                [PARAM.transferType]: null,
                [PARAM.amountMin]: null,
                [PARAM.amountMax]: null,
                [PARAM.from]: null,
                [PARAM.to]: null,
                [PARAM.flagged]: null,
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
