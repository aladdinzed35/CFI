'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ColumnDef, PaginationState, Row, SortingState } from '@tanstack/react-table';
import { ChevronDown, Search, SlidersHorizontal } from 'lucide-react';

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
  PARAM,
  SORT_COLUMN_ID,
  type AuditEntryView,
  type JournalFilterState,
  type JournalOptions,
} from './journal-view';

/**
 * The §17.13 audit table.
 *
 * Server-paginated like every other list in the panel: each control writes to
 * the URL and the server re-queries, so a filtered journal can be pasted into a
 * message and reopened exactly as it was.
 *
 * ## No row action, and that is the feature
 * There is no edit, no delete, no bulk anything. The only interaction a row
 * offers is *reading more of it*: a disclosure that reveals the before/after
 * diff. When §8 row 17 withholds the diff from this administrator the row says
 * so instead of rendering an empty panel.
 */

export interface JournalTableProps {
  readonly rows: readonly AuditEntryView[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly sortDir: 'asc' | 'desc';
  readonly search: string;
  readonly filters: JournalFilterState;
  readonly options: JournalOptions;
  readonly currentParams: Readonly<Record<string, string>>;
}

const ANY = 'tous';

export function JournalTable(props: JournalTableProps): React.JSX.Element {
  const { rows, total, page, pageSize, pageCount, sortDir, search, filters, options, currentParams } =
    props;

  const t = useTranslations('admin.audit');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  // Generic table chrome the audit namespace does not restate — the same
  // borrowing the payments ledger does.
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

  const columns = useMemo<ColumnDef<AuditEntryView>[]>(
    () => [
      {
        id: SORT_COLUMN_ID,
        header: t('security.when'),
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <time dateTime={row.original.whenIso} className="text-sm text-ink-muted">
            {row.original.whenLabel}
          </time>
        ),
      },
      {
        id: 'actor',
        header: t('filters.actor'),
        enableSorting: false,
        cell: ({ row }) => <ActorCell entry={row.original} />,
      },
      {
        id: 'action',
        header: t('filters.action'),
        enableSorting: false,
        cell: ({ row }) => <EventCell entry={row.original} />,
      },
      {
        id: 'entityType',
        header: t('filters.entityType'),
        enableSorting: false,
        cell: ({ row }) => (
          <Badge tone="neutral" variant="soft" size="sm">
            {row.original.entityType}
          </Badge>
        ),
      },
      {
        id: 'entityId',
        header: t('filters.entityId'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.entityId === null ? (
            <span className="text-sm text-ink-muted">—</span>
          ) : (
            <span
              title={row.original.entityId}
              dir="ltr"
              className="force-ltr block max-w-40 truncate font-mono text-xs text-ink-muted"
            >
              {row.original.entityId}
            </span>
          ),
      },
    ],
    [t],
  );

  const renderCard = useCallback(
    (row: Row<AuditEntryView>): React.JSX.Element => {
      const entry = row.original;
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <time dateTime={entry.whenIso} className="text-xs text-ink-muted">
              {entry.whenLabel}
            </time>
            <Badge tone="neutral" variant="soft" size="sm">
              {entry.entityType}
            </Badge>
          </div>
          <ActorCell entry={entry} />
          <EventCell entry={entry} />
        </div>
      );
    },
    [],
  );

  /* ── Table state ─────────────────────────────────────────────────────── */

  const sorting: SortingState = useMemo(
    () => [{ id: SORT_COLUMN_ID, desc: sortDir === 'desc' }],
    [sortDir],
  );

  const pagination: PaginationState = useMemo(
    () => ({ pageIndex: page - 1, pageSize }),
    [page, pageSize],
  );

  const onSortingChange = useCallback(
    (next: SortingState): void => {
      const first = next[0];
      if (first === undefined) {
        navigate({ [PARAM.sortDir]: null });
        return;
      }
      navigate({ [PARAM.sortDir]: first.desc ? 'desc' : 'asc' });
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
    <DataTable<AuditEntryView>
      className="mt-4"
      data={rows as AuditEntryView[]}
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
          options={options}
          buildHref={buildHref}
          navigate={navigate}
        />
      }
      labels={{
        caption: t('tabs.audit'),
        columnsMenu: tTable('table.columnsMenu'),
        // The journal is not selectable. `DataTableLabels` requires the strings
        // all the same, so they are real words rather than placeholders.
        selectAll: tTable('bulk.selectAll'),
        selectRow: tTable('table.selectRow'),
        selectionSummary: tTable('bulk.selected', { count: 0 }),
        clearSelection: tTable('bulk.clear'),
        previousPage: tTable('table.previousPage'),
        nextPage: tTable('table.nextPage'),
        pageSummary: tTable('table.pageSummary', { from, to, total }),
        loading: tCommon('loading'),
        emptyTitle: t('entry.empty'),
        errorTitle: tErrors('serverError.title'),
        errorDescription: tErrors('serverError.body'),
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Cells                                                                       */
/* -------------------------------------------------------------------------- */

function ActorCell({ entry }: { entry: AuditEntryView }): React.JSX.Element {
  const t = useTranslations('admin.audit');

  if (entry.actorId === null || entry.actorName === null) {
    return <span className="text-sm text-ink-muted">{t('entry.system')}</span>;
  }

  return (
    <Link
      href={`/admin/comptes/${entry.actorId}`}
      className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-ink"
    >
      {entry.actorName}
    </Link>
  );
}

/**
 * The event itself: the French sentence the writer composed, the raw verb
 * underneath it for filtering, and the disclosure that opens the diff.
 */
function EventCell({ entry }: { entry: AuditEntryView }): React.JSX.Element {
  const t = useTranslations('admin.audit');
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // The panel is worth opening when there is a before/after to read, and also
  // when the only extra fact is where the request came from.
  const hasDetail = entry.diff.length > 0 || entry.ip !== null;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {entry.summary === null ? null : (
        <p className="text-sm text-ink">{entry.summary}</p>
      )}
      <p dir="ltr" className="force-ltr font-mono text-xs text-ink-muted">
        {entry.action}
      </p>

      {/* No diff disclosure when §8 row 17 withholds it: an administrator who
          may not read the before/after is offered nothing to open, rather than
          a control that would refuse them. */}
      {hasDetail ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((previous) => !previous)}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 self-start rounded-md text-xs text-strait',
              'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:underline',
            )}
          >
            <ChevronDown
              className={cn('size-4 shrink-0 transition-transform duration-[120ms]', open ? 'rotate-180' : null)}
              aria-hidden="true"
            />
            <span>{open ? t('entry.collapse') : t('entry.expand')}</span>
          </button>

          <div id={panelId} hidden={!open} className="mt-1">
            <div className="flex flex-col gap-2 rounded-md border border-hairline bg-raised p-3">
              {entry.diff.length === 0 ? null : (
                <ul role="list" className="flex flex-col gap-2">
                  {entry.diff.map((field) => (
                    <li key={field.field} className="flex flex-col gap-0.5">
                      <span className="font-mono text-xs text-ink-muted" dir="ltr">
                        {field.field}
                      </span>
                      <span className="text-xs text-ink-muted">
                        <span className="text-danger">{t('entry.before')}</span>{' '}
                        <span className="text-ink">{field.before}</span>
                      </span>
                      <span className="text-xs text-ink-muted">
                        <span className="text-success">{t('entry.after')}</span>{' '}
                        <span className="text-ink">{field.after}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {entry.ip === null ? null : (
                <p className="text-xs text-ink-muted">
                  {t('security.ip')}{' '}
                  <span dir="ltr" className="force-ltr font-mono text-ink">
                    {entry.ip}
                  </span>
                </p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                     */
/* -------------------------------------------------------------------------- */

function Toolbar({
  search,
  onSearch,
  filters,
  options,
  buildHref,
  navigate,
}: {
  search: string;
  onSearch: (value: string) => void;
  filters: JournalFilterState;
  options: JournalOptions;
  buildHref: (patch: Readonly<Record<string, string | null>>, resetPage?: boolean) => string;
  navigate: (patch: Readonly<Record<string, string | null>>, resetPage?: boolean) => void;
}): React.JSX.Element {
  const t = useTranslations('admin.audit');
  const tCommon = useTranslations('common');

  const activeFilters = [
    filters.actor,
    filters.action,
    filters.entityType,
    filters.entityId,
    filters.from,
    filters.to,
  ].filter((value) => value !== null).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="min-w-0 sm:max-w-md">
        <label className="sr-only" htmlFor="recherche-journal">
          {tCommon('search')}
        </label>
        <Input
          id="recherche-journal"
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={tCommon('search')}
          iconStart={<Search aria-hidden="true" />}
          inputSize="sm"
        />
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
          <span>{tCommon('filter')}</span>
          <span className="text-xs" data-numeric dir="ltr">
            {activeFilters}
          </span>
        </summary>

        <div className="grid grid-cols-1 gap-3 border-t border-hairline p-3 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label={t('filters.actor')}>
            {(field) => (
              <Select
                value={filters.actor ?? ANY}
                onValueChange={(value) => navigate({ [PARAM.actor]: value === ANY ? null : value })}
              >
                <SelectTrigger id={field.id} selectSize="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{tCommon('seeAll')}</SelectItem>
                  {options.actors.map((actor) => (
                    <SelectItem key={actor.id} value={actor.id}>
                      {actor.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label={t('filters.action')}>
            {(field) => (
              <Select
                value={filters.action ?? ANY}
                onValueChange={(value) => navigate({ [PARAM.action]: value === ANY ? null : value })}
              >
                <SelectTrigger id={field.id} selectSize="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{tCommon('seeAll')}</SelectItem>
                  {options.actions.map((action) => (
                    <SelectItem key={action} value={action}>
                      {action}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label={t('filters.entityType')}>
            {(field) => (
              <Select
                value={filters.entityType ?? ANY}
                onValueChange={(value) =>
                  navigate({ [PARAM.entityType]: value === ANY ? null : value })
                }
              >
                <SelectTrigger id={field.id} selectSize="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{tCommon('seeAll')}</SelectItem>
                  {options.entityTypes.map((entityType) => (
                    <SelectItem key={entityType} value={entityType}>
                      {entityType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label={t('filters.entityId')}>
            {(field) => (
              <Input
                id={field.id}
                type="search"
                defaultValue={filters.entityId ?? ''}
                inputSize="sm"
                dir="ltr"
                className="force-ltr"
                onChange={(event) => navigate({ [PARAM.entityId]: event.target.value.trim() })}
              />
            )}
          </FormField>

          <FormField label={t('filters.from')}>
            {(field) => (
              <Input
                id={field.id}
                type="date"
                defaultValue={filters.from ?? ''}
                inputSize="sm"
                dir="ltr"
                className="force-ltr"
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
                dir="ltr"
                className="force-ltr"
                onChange={(event) => navigate({ [PARAM.to]: event.target.value })}
              />
            )}
          </FormField>

          <div className="sm:col-span-2 lg:col-span-3">
            <Link
              href={buildHref({
                [PARAM.actor]: null,
                [PARAM.action]: null,
                [PARAM.entityType]: null,
                [PARAM.entityId]: null,
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
