'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ColumnDef, PaginationState, Row, RowSelectionState, SortingState } from '@tanstack/react-table';
import { Check, MessageCircle, Search, SlidersHorizontal, TriangleAlert, X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { localeLabels, locales } from '@/i18n/routing';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import {
  bulkApproveAccountsAction,
  bulkRejectAccountsAction,
  type BulkOutcome,
} from '@/server/actions/admin-accounts';
import { ReviewDrawer } from './review-drawer';
import {
  ACCOUNT_ROLES,
  ACTION_ERROR_KEY,
  COLUMN_TO_SORT,
  PARAM,
  QUEUES,
  REJECTION_DETAILS_MIN,
  REJECTION_REASONS,
  ROLE_LABEL_KEY,
  ROLE_PARAM,
  SORT_COLUMN_ID,
  STATUS_LABEL_KEY,
  type AccountReviewView,
  type AccountRowView,
  type AccountsFilterState,
  type QueueKey,
  type RejectionCode,
  type SortParam,
} from './account-view';

/**
 * The accounts queue (§17.2) — the table, its toolbar and its bulk actions.
 *
 * ## Nothing is filtered in the browser
 * Every control writes to the URL and the server re-queries: tabs, search,
 * filters, sorting and pagination are all round trips through
 * `listAccounts`, which pushes the work into SQL. The component holds one page
 * of rows and never sees a second one, which is the only shape that survives
 * the tens of thousands of accounts the centre will accumulate. `DataTable` is
 * configured for exactly this — `manualPagination`, `manualSorting`,
 * `manualFiltering` — so a stray client-side sort cannot make the screen lie.
 *
 * ## The URL is the state
 * Which queue, which page, which filters and *which account is under review*
 * are all search parameters, so a link to « Salma, dans la file à valider, page
 * 3 » can be pasted into WhatsApp and opens on exactly that. The review drawer
 * reads `fiche`; `J` and `K` simply move that parameter.
 */

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

export interface AccountsTableProps {
  readonly rows: readonly AccountRowView[];
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
  readonly filters: AccountsFilterState;
  /** Every search parameter of the current request, so links keep the context. */
  readonly currentParams: Readonly<Record<string, string>>;
  /** The account whose record is open, already loaded by the server. */
  readonly review: AccountReviewView | null;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function AccountsTable(props: AccountsTableProps): React.JSX.Element {
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
    currentParams,
    review,
  } = props;

  const t = useTranslations('admin.accounts');
  const tCommon = useTranslations('common');
  const tError = useTranslations('admin.actionError');
  const router = useRouter();
  const pathname = usePathname();

  const [searchValue, setSearchValue] = useState(search);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [bulkMode, setBulkMode] = useState<'approve' | 'reject' | null>(null);
  const [bulkPending, setBulkPending] = useState(false);

  // The URL is the source of truth; when it changes under us — a link, the back
  // button, a decision that moved a row out of the queue — the field follows.
  useEffect(() => {
    setSearchValue(search);
  }, [search]);

  // A selection is a set of ids on *this* page. Changing page or queue makes it
  // meaningless, so it is dropped rather than silently carried over.
  useEffect(() => {
    setSelection({});
  }, [queue, page, search]);

  const buildHref = useCallback(
    (patch: Readonly<Record<string, string | null>>, resetPage = true): string => {
      const next = new URLSearchParams(currentParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      if (resetPage && !('page' in patch)) next.delete(PARAM.page);
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

  const selectedIds = useMemo(
    () =>
      Object.entries(selection)
        .filter(([, on]) => on)
        .map(([id]) => id),
    [selection],
  );

  const reportFailure = useCallback(
    (code: keyof typeof ACTION_ERROR_KEY): void => {
      toast.error({ title: tError(ACTION_ERROR_KEY[code]), dismissLabel: tCommon('close') });
    },
    [tCommon, tError],
  );

  const reportBulk = useCallback(
    (outcome: BulkOutcome, kind: 'approve' | 'reject'): void => {
      const lines = [
        outcome.unchanged > 0 ? t('bulk.unchanged', { count: outcome.unchanged }) : null,
        outcome.failed > 0 ? t('bulk.failed', { count: outcome.failed }) : null,
      ].filter((line): line is string => line !== null);

      const title =
        kind === 'approve'
          ? t('bulk.approveSuccess', { count: outcome.changed })
          : t('bulk.rejectSuccess', { count: outcome.changed });

      const options = {
        title,
        ...(lines.length > 0 ? { description: lines.join(' · ') } : {}),
        dismissLabel: tCommon('close'),
      };

      if (outcome.failed > 0) toast.warning(options);
      else toast.success(options);
    },
    [t, tCommon],
  );

  const runBulkApprove = useCallback(async (): Promise<void> => {
    setBulkPending(true);
    const result = await bulkApproveAccountsAction({ userIds: selectedIds });
    setBulkPending(false);

    if (!result.ok) {
      reportFailure(result.error);
      return;
    }
    reportBulk(result.data, 'approve');
    setBulkMode(null);
    setSelection({});
    router.refresh();
  }, [reportBulk, reportFailure, router, selectedIds]);

  const runBulkReject = useCallback(
    async (code: RejectionCode, details: string): Promise<void> => {
      setBulkPending(true);
      const result = await bulkRejectAccountsAction({
        userIds: selectedIds,
        code,
        ...(details.trim() === '' ? {} : { details: details.trim() }),
      });
      setBulkPending(false);

      if (!result.ok) {
        reportFailure(result.error);
        return;
      }
      reportBulk(result.data, 'reject');
      setBulkMode(null);
      setSelection({});
      router.refresh();
    },
    [reportBulk, reportFailure, router, selectedIds],
  );

  /* ── Columns ─────────────────────────────────────────────────────────── */

  const columns = useMemo<ColumnDef<AccountRowView>[]>(
    () => [
      {
        id: 'fullName',
        header: t('columns.name'),
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => navigate({ [PARAM.review]: row.original.id }, false)}
            aria-label={t('openReview', { name: row.original.fullName })}
            className="flex min-h-11 w-full items-center gap-3 rounded-sm text-start"
          >
            <Avatar name={row.original.fullName} size="sm" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-ink">{row.original.fullName}</span>
              {row.original.role === 'STUDENT' ? null : (
                <span className="text-xs text-ink-muted">{t(ROLE_LABEL_KEY[row.original.role])}</span>
              )}
            </span>
          </button>
        ),
      },
      {
        id: 'email',
        header: t('columns.email'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="force-ltr truncate text-sm text-ink-muted" dir="ltr">
              {row.original.email}
            </span>
            {row.original.emailVerified ? (
              <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
            ) : null}
            {row.original.emailDisposable ? (
              <TriangleAlert className="size-4 shrink-0 text-warn" aria-hidden="true" />
            ) : null}
            <span className="sr-only">
              {row.original.emailVerified ? t('emailVerified') : t('emailUnverified')}
            </span>
          </span>
        ),
      },
      {
        id: 'phone',
        header: t('columns.phone'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-1">
            <span className="force-ltr text-sm text-ink-muted" dir="ltr">
              {row.original.phoneDisplay}
            </span>
            <WhatsAppButton row={row.original} label={t('whatsapp', { name: row.original.fullName })} />
          </span>
        ),
      },
      {
        id: 'city',
        header: t('columns.city'),
        enableSorting: false,
        cell: ({ row }) => <span className="text-sm text-ink-muted">{row.original.city ?? '—'}</span>,
      },
      {
        id: 'createdAt',
        header: t('columns.registeredAt'),
        enableSorting: true,
        cell: ({ row }) => (
          <time
            dateTime={row.original.registeredAtIso}
            title={row.original.registeredAtAbsolute}
            className="text-sm text-ink-muted"
          >
            {row.original.registeredAtRelative}
          </time>
        ),
      },
      {
        id: 'lastLoginAt',
        header: t('columns.lastLogin'),
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-sm text-ink-muted">
            {row.original.lastLoginRelative ?? t('never')}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        enableSorting: true,
        cell: ({ row }) => (
          <StatusPill
            domain="account"
            status={row.original.status}
            label={t(STATUS_LABEL_KEY[row.original.status])}
          />
        ),
      },
      {
        id: 'actions',
        header: t('columns.actions'),
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Link
            href={`/admin/comptes/${row.original.id}`}
            className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-strait hover:underline"
          >
            {t('drawer.openDetail')}
          </Link>
        ),
      },
    ],
    [navigate, t],
  );

  const renderCard = useCallback(
    (row: Row<AccountRowView>): React.JSX.Element => {
      const account = row.original;
      return (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={row.getIsSelected()}
              onChange={(event) => row.toggleSelected(event.target.checked)}
              aria-label={t('table.selectRow')}
              className="mt-1 size-5 shrink-0 rounded-sm border border-hairline bg-surface accent-strait"
            />
            <button
              type="button"
              onClick={() => navigate({ [PARAM.review]: account.id }, false)}
              aria-label={t('openReview', { name: account.fullName })}
              className="flex min-w-0 flex-1 items-start gap-3 text-start"
            >
              <Avatar name={account.fullName} size="sm" />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate font-medium text-ink">{account.fullName}</span>
                <span className="force-ltr truncate text-sm text-ink-muted" dir="ltr">
                  {account.email}
                </span>
                <span className="force-ltr text-sm text-ink-muted" dir="ltr">
                  {account.phoneDisplay}
                </span>
              </span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              domain="account"
              status={account.status}
              label={t(STATUS_LABEL_KEY[account.status])}
            />
            <time dateTime={account.registeredAtIso} className="text-xs text-ink-muted">
              {account.registeredAtRelative}
            </time>
            {account.city === null ? null : (
              <span className="text-xs text-ink-muted">{account.city}</span>
            )}
            <span className="ms-auto flex items-center gap-1">
              <WhatsAppButton row={account} label={t('whatsapp', { name: account.fullName })} />
              <Link
                href={`/admin/comptes/${account.id}`}
                className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-strait"
              >
                {t('drawer.openDetail')}
              </Link>
            </span>
          </div>
        </div>
      );
    },
    [navigate, t],
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

      <DataTable<AccountRowView>
        className="mt-4"
        data={rows as AccountRowView[]}
        columns={columns}
        getRowId={(row) => row.id}
        pagination={pagination}
        onPaginationChange={onPaginationChange}
        pageCount={pageCount}
        sorting={sorting}
        onSortingChange={onSortingChange}
        rowSelection={selection}
        onRowSelectionChange={setSelection}
        renderCard={renderCard}
        bulkActions={(ids) => (
          <>
            <Button size="sm" variant="primary" onClick={() => setBulkMode('approve')} disabled={ids.length === 0}>
              {t('bulk.approve')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setBulkMode('reject')} disabled={ids.length === 0}>
              {t('bulk.reject')}
            </Button>
          </>
        )}
        toolbar={
          <Toolbar
            search={searchValue}
            onSearch={setSearchValue}
            filters={filters}
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
          selectionSummary: t('bulk.selected', { count: selectedIds.length }),
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

      <ReviewDrawer
        review={review}
        queue={rows.map((row) => ({ id: row.id, fullName: row.fullName }))}
        onSelect={(id) => navigate({ [PARAM.review]: id }, false)}
        onDecided={() => router.refresh()}
      />

      <BulkModal
        mode={bulkMode}
        count={selectedIds.length}
        pending={bulkPending}
        onClose={() => setBulkMode(null)}
        onApprove={() => void runBulkApprove()}
        onReject={(code, details) => void runBulkReject(code, details)}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbar, tabs, small pieces                                                 */
/* -------------------------------------------------------------------------- */

function WhatsAppButton({
  row,
  label,
}: {
  row: AccountRowView;
  label: string;
}): React.JSX.Element | null {
  if (row.whatsappHref === null) return null;

  return (
    <a
      href={row.whatsappHref}
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

function QueueTabs({
  queue,
  counts,
  buildHref,
}: {
  queue: QueueKey;
  counts: Readonly<Record<QueueKey, number>>;
  buildHref: (patch: Readonly<Record<string, string | null>>, resetPage?: boolean) => string;
}): React.JSX.Element {
  const t = useTranslations('admin.accounts');

  return (
    <nav aria-label={t('title')} className="hairline-b -mx-1 flex items-stretch gap-1 overflow-x-auto px-1">
      {QUEUES.map((entry) => {
        const active = entry.key === queue;
        return (
          <Link
            key={entry.key}
            href={buildHref({
              [PARAM.queue]: entry.key,
              [PARAM.page]: null,
              [PARAM.review]: null,
            })}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative -mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
              'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
              active
                ? 'border-strait text-ink'
                : 'border-transparent text-ink-muted hover:text-ink',
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
  buildHref,
  navigate,
  total,
}: {
  search: string;
  onSearch: (value: string) => void;
  filters: AccountsFilterState;
  buildHref: (patch: Readonly<Record<string, string | null>>, resetPage?: boolean) => string;
  navigate: (patch: Readonly<Record<string, string | null>>, resetPage?: boolean) => void;
  total: number;
}): React.JSX.Element {
  const t = useTranslations('admin.accounts');
  const tCommon = useTranslations('common');

  const activeFilters = [
    filters.role,
    filters.locale,
    filters.city,
    filters.from,
    filters.to,
    filters.emailStatus,
  ].filter((value) => value !== null).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <label className="sr-only" htmlFor="recherche-comptes">
            {tCommon('search')}
          </label>
          <Input
            id="recherche-comptes"
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
          <FormField label={t('filters.role')}>
            {(field) => (
              <Select
                value={filters.role ?? 'tous'}
                onValueChange={(value) => navigate({ [PARAM.role]: value === 'tous' ? null : value })}
              >
                <SelectTrigger id={field.id} selectSize="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tous">{t('filters.anyRole')}</SelectItem>
                  {ACCOUNT_ROLES.map((role) => (
                    <SelectItem key={role} value={ROLE_PARAM[role]}>
                      {t(ROLE_LABEL_KEY[role])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label={t('filters.locale')}>
            {(field) => (
              <Select
                value={filters.locale ?? 'toutes'}
                onValueChange={(value) =>
                  navigate({ [PARAM.locale]: value === 'toutes' ? null : value })
                }
              >
                <SelectTrigger id={field.id} selectSize="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="toutes">{t('filters.anyLocale')}</SelectItem>
                  {locales.map((locale) => (
                    <SelectItem key={locale} value={locale}>
                      {localeLabels[locale]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label={t('filters.emailStatus')}>
            {(field) => (
              <Select
                value={filters.emailStatus ?? 'tous'}
                onValueChange={(value) =>
                  navigate({ [PARAM.emailStatus]: value === 'tous' ? null : value })
                }
              >
                <SelectTrigger id={field.id} selectSize="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tous">{t('filters.anyEmailStatus')}</SelectItem>
                  <SelectItem value="confirme">{t('filters.verified')}</SelectItem>
                  <SelectItem value="non-confirme">{t('filters.unverified')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label={t('filters.city')}>
            {(field) => (
              <Input
                id={field.id}
                defaultValue={filters.city ?? ''}
                placeholder={t('filters.cityPlaceholder')}
                inputSize="sm"
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== (filters.city ?? '')) navigate({ [PARAM.city]: value });
                }}
              />
            )}
          </FormField>

          <FormField label={t('filters.registeredFrom')}>
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

          <FormField label={t('filters.registeredTo')}>
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

          <div className="sm:col-span-2 lg:col-span-3">
            <Link
              href={buildHref({
                [PARAM.role]: null,
                [PARAM.locale]: null,
                [PARAM.city]: null,
                [PARAM.from]: null,
                [PARAM.to]: null,
                [PARAM.emailStatus]: null,
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

/* -------------------------------------------------------------------------- */
/* Bulk confirmation                                                           */
/* -------------------------------------------------------------------------- */

function BulkModal({
  mode,
  count,
  pending,
  onClose,
  onApprove,
  onReject,
}: {
  mode: 'approve' | 'reject' | null;
  count: number;
  pending: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: (code: RejectionCode, details: string) => void;
}): React.JSX.Element {
  const t = useTranslations('admin.accounts');
  const tCommon = useTranslations('common');

  const [code, setCode] = useState<RejectionCode>('INCOMPLETE_INFO');
  const [details, setDetails] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);

  const word = t('bulk.confirmWord');

  useEffect(() => {
    setConfirmation('');
    setError(null);
  }, [mode]);

  const submitRejection = (): void => {
    if (confirmation.trim() !== word) {
      setError(t('bulk.mismatch', { word }));
      return;
    }
    if (code === 'OTHER' && details.trim().length < REJECTION_DETAILS_MIN) {
      setError(t('reject.detailsRequired'));
      return;
    }
    onReject(code, details);
  };

  return (
    <Modal
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {mode === null ? null : (
        <ModalContent size="md" closeLabel={tCommon('close')}>
          <ModalHeader>
            <ModalTitle>
              {mode === 'approve'
                ? t('bulk.confirmApprove', { count })
                : t('bulk.confirmTitle')}
            </ModalTitle>
            <ModalDescription>
              {mode === 'approve' ? t('subtitle') : t('bulk.confirmReject', { count })}
            </ModalDescription>
          </ModalHeader>

          {mode === 'reject' ? (
            <ModalBody className="flex flex-col gap-4">
              <FormField label={t('bulk.reasonLabel')} required requiredHint={tCommon('required')}>
                {(field) => (
                  <Select value={code} onValueChange={(value) => setCode(value as RejectionCode)}>
                    <SelectTrigger id={field.id}>
                      <SelectValue placeholder={t('reject.reasonPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {REJECTION_REASONS.map((reason) => (
                        <SelectItem key={reason.code} value={reason.code}>
                          {t(reason.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <FormField
                label={t('reject.detailsLabel')}
                required={code === 'OTHER'}
                optionalHint={code === 'OTHER' ? undefined : tCommon('optional')}
              >
                {(field) => (
                  <Textarea
                    id={field.id}
                    value={details}
                    textareaSize="sm"
                    placeholder={t('reject.detailsPlaceholder')}
                    onChange={(event) => setDetails(event.target.value)}
                  />
                )}
              </FormField>

              {/* Typed confirmation — §17 requires it of every destructive action. */}
              <FormField
                label={t('bulk.typeToConfirm', { word })}
                required
                requiredHint={tCommon('required')}
                error={error}
              >
                {(field) => (
                  <Input
                    id={field.id}
                    aria-describedby={field['aria-describedby']}
                    aria-invalid={field['aria-invalid']}
                    invalid={field['aria-invalid'] === true}
                    value={confirmation}
                    autoComplete="off"
                    inputSize="sm"
                    onChange={(event) => {
                      setConfirmation(event.target.value);
                      if (error !== null) setError(null);
                    }}
                  />
                )}
              </FormField>
            </ModalBody>
          ) : null}

          <ModalFooter>
            <Button variant="ghost" type="button" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            {mode === 'approve' ? (
              <Button
                variant="primary"
                type="button"
                loading={pending}
                onClick={onApprove}
                iconStart={<Check aria-hidden="true" />}
              >
                {t('bulk.approve')}
              </Button>
            ) : (
              <Button
                variant="danger"
                type="button"
                loading={pending}
                onClick={submitRejection}
                iconStart={<X aria-hidden="true" />}
              >
                {t('bulk.reject')}
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      )}
    </Modal>
  );
}
