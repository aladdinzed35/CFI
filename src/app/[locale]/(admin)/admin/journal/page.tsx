import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';

import {
  endOfCasablancaDay,
  formatDateTime,
  startOfCasablancaDay,
  toDateTimeAttribute,
} from '@/lib/dates';
import { isLocale, type Locale } from '@/i18n/routing';
import { requirePageAdmin } from '@/server/auth/guards';
import {
  auditFilterOptions,
  listAuditEntries,
  type AuditEntryRow,
  type AuditFilterOptions,
} from '@/server/services/audit-queries';

import { JournalTable } from './journal-table';
import { PARAM, type AuditEntryView, type JournalFilterState } from './journal-view';

/**
 * `/admin/journal` — the audit viewer (§17.13).
 *
 * The screen an owner opens when a client says « rien ne marche », and the one
 * that answers « qui a changé ça ? ». It is a **read**: no action file backs
 * this route, and `AuditLog` has no update or delete path anywhere in the
 * codebase. A row is written by `recordAudit`, inside the transaction that
 * performed the change, and is never touched again.
 *
 * §17.13 also lists the job queue, the e-mail log, the security events, the
 * cron history and a diagnostics page. Those are separate read models over
 * separate tables; this route is the audit trail, which is the part every other
 * milestone already writes into.
 */

type LocaleParams = { locale: string };
type RawSearchParams = Record<string, string | string[] | undefined>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * URL parameters are attacker-controlled input like any other (§20). `.catch()`
 * on each field so a hand-edited query degrades to the default view instead of
 * throwing an error boundary at an administrator mid-investigation.
 */
const searchParamsSchema = z.object({
  [PARAM.actor]: z.string().trim().min(1).max(64).optional().catch(undefined),
  [PARAM.action]: z.string().trim().min(1).max(80).optional().catch(undefined),
  [PARAM.entityType]: z.string().trim().min(1).max(80).optional().catch(undefined),
  [PARAM.entityId]: z.string().trim().min(1).max(64).optional().catch(undefined),
  [PARAM.search]: z.string().trim().min(1).max(120).optional().catch(undefined),
  [PARAM.from]: z.string().regex(ISO_DAY).optional().catch(undefined),
  [PARAM.to]: z.string().regex(ISO_DAY).optional().catch(undefined),
  [PARAM.page]: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  [PARAM.pageSize]: z.coerce.number().int().min(5).max(100).optional().catch(undefined),
  [PARAM.sortDir]: z.enum(['asc', 'desc']).optional().catch(undefined),
});

type Query = z.output<typeof searchParamsSchema>;

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function AdminJournalPage({
  params,
  searchParams,
}: {
  params: Promise<LocaleParams>;
  searchParams: Promise<RawSearchParams>;
}): Promise<React.JSX.Element> {
  const [{ locale }, rawSearch] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  const user = await requirePageAdmin(locale);

  const t = await getTranslations('admin.audit');

  const query = searchParamsSchema.parse(
    Object.fromEntries(Object.entries(rawSearch).map(([key, value]) => [key, firstValue(value)])),
  );

  const page = query[PARAM.page] ?? 1;
  const pageSize = query[PARAM.pageSize] ?? 25;
  const sortDir = query[PARAM.sortDir] ?? 'desc';

  const from = startOfCasablancaDay(query[PARAM.from] ?? null);
  const rawTo = endOfCasablancaDay(query[PARAM.to] ?? null);
  // `endOfCasablancaDay` returns the first instant of the next day; a `lte`
  // bound must stop one millisecond earlier or « au 12 mars » swallows the 13th.
  const to = rawTo === null ? null : new Date(rawTo.getTime() - 1);

  const [listResult, optionsResult] = await Promise.all([
    listAuditEntries(
      {
        ...(query[PARAM.actor] === undefined ? {} : { actorId: query[PARAM.actor] }),
        ...(query[PARAM.action] === undefined ? {} : { action: query[PARAM.action] }),
        ...(query[PARAM.entityType] === undefined ? {} : { entityType: query[PARAM.entityType] }),
        ...(query[PARAM.entityId] === undefined ? {} : { entityId: query[PARAM.entityId] }),
        ...(query[PARAM.search] === undefined ? {} : { search: query[PARAM.search] }),
        ...(from === null ? {} : { from }),
        ...(to === null ? {} : { to }),
        page,
        pageSize,
        sortDir,
      },
      user,
    ),
    auditFilterOptions(user),
  ]);

  // An administrator who reached `/admin` but holds no `auditLog.view` has no
  // journal to be shown — 404 rather than an empty table implying there is
  // simply nothing recorded.
  if (!listResult.ok) notFound();

  const options: AuditFilterOptions = optionsResult.ok
    ? optionsResult.data
    : { actions: [], entityTypes: [], actors: [] };

  const currentParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) currentParams[key] = String(value);
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1 pb-4">
        <h1 className="font-display text-title text-ink">{t('title')}</h1>
        <p className="max-w-prose text-sm text-ink-muted">{t('subtitle')}</p>
      </header>

      <JournalTable
        rows={listResult.data.rows.map((row) => toEntryView(row, locale))}
        total={listResult.data.total}
        page={listResult.data.page}
        pageSize={listResult.data.pageSize}
        pageCount={listResult.data.pageCount}
        sortDir={sortDir}
        search={query[PARAM.search] ?? ''}
        filters={filterState(query)}
        options={options}
        currentParams={currentParams}
      />
    </div>
  );
}

function filterState(query: Query): JournalFilterState {
  return {
    actor: query[PARAM.actor] ?? null,
    action: query[PARAM.action] ?? null,
    entityType: query[PARAM.entityType] ?? null,
    entityId: query[PARAM.entityId] ?? null,
    from: query[PARAM.from] ?? null,
    to: query[PARAM.to] ?? null,
  };
}

function toEntryView(row: AuditEntryRow, locale: Locale): AuditEntryView {
  return {
    id: row.id,
    whenLabel: formatDateTime(row.createdAt, locale),
    whenIso: toDateTimeAttribute(row.createdAt),
    actorId: row.actorId,
    actorName: row.actorName,
    action: row.action,
    summary: row.summary,
    entityType: row.entityType,
    entityId: row.entityId,
    ip: row.ip,
    diff: row.diff.map((field) => ({
      field: field.field,
      before: field.before,
      after: field.after,
    })),
  };
}
