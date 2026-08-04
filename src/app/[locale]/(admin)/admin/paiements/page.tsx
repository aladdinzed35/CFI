import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';

import {
  endOfCasablancaDay,
  formatDateTime,
  startOfCasablancaDay,
  toDateTimeAttribute,
} from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { isLocale, type Locale } from '@/i18n/routing';
import { requirePageAdmin } from '@/server/auth/guards';
import {
  listPayments,
  listRequestedCourses,
  paymentTotals,
  type CourseOption,
  type PaymentRow,
  type PaymentTotals,
} from '@/server/services/enrollment/admin-queries';

import { PaymentsTable } from './payments-table';
import {
  METHOD_FROM_PARAM,
  PARAM,
  SORT_KEYS,
  type PaymentRowView,
  type PaymentTotalsView,
  type PaymentsFilterState,
  type SortParam,
} from './payment-view';

/**
 * `/admin/paiements` — the ledger of every confirmed `Payment` (§17.4).
 *
 * One row per payment, with the date the funds were recorded, the student, the
 * course, the amount, the method, the invoice number and **the administrator who
 * confirmed it** — that last column is the point: a payment nobody is named
 * against is a payment nobody is accountable for.
 *
 * ## The totals are a `SUM`, not a report
 * The panel above the table shows the count and the sum over exactly the rows
 * the current filters select, plus the same split by payment method. Nothing is
 * projected, averaged or extrapolated: §17.4's fuller revenue reporting needs
 * columns and a period model this milestone does not have, and an invented chart
 * is worse than no chart.
 */

type LocaleParams = { locale: string };
type RawSearchParams = Record<string, string | string[] | undefined>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;

const searchParamsSchema = z.object({
  [PARAM.search]: z.string().trim().min(1).max(120).optional().catch(undefined),
  [PARAM.page]: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  [PARAM.pageSize]: z.coerce.number().int().min(5).max(100).optional().catch(undefined),
  [PARAM.sortBy]: z.enum(['date', 'montant']).optional().catch(undefined),
  [PARAM.sortDir]: z.enum(['asc', 'desc']).optional().catch(undefined),
  [PARAM.course]: z.string().trim().min(1).max(64).optional().catch(undefined),
  [PARAM.method]: z.enum(['virement', 'especes', 'autre']).optional().catch(undefined),
  [PARAM.from]: z.string().regex(ISO_DAY).optional().catch(undefined),
  [PARAM.to]: z.string().regex(ISO_DAY).optional().catch(undefined),
});

type Query = z.output<typeof searchParamsSchema>;

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default async function PaymentsPage({
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

  const t = await getTranslations('admin.payments');

  const query = searchParamsSchema.parse(
    Object.fromEntries(Object.entries(rawSearch).map(([key, value]) => [key, firstValue(value)])),
  );

  const page = query[PARAM.page] ?? 1;
  const pageSize = query[PARAM.pageSize] ?? 25;
  const sortBy: SortParam = query[PARAM.sortBy] ?? 'date';
  const sortDir = query[PARAM.sortDir] ?? 'desc';

  const methodParam = query[PARAM.method];
  const method = methodParam === undefined ? undefined : METHOD_FROM_PARAM[methodParam];
  const from = startOfCasablancaDay(query[PARAM.from] ?? null);
  const rawTo = endOfCasablancaDay(query[PARAM.to] ?? null);
  const to = rawTo === null ? null : new Date(rawTo.getTime() - 1);

  /** One filter object, used by the page query and by the totals alike. */
  const filters = {
    ...(query[PARAM.course] === undefined ? {} : { courseId: query[PARAM.course] }),
    ...(method === undefined ? {} : { method }),
    ...(query[PARAM.search] === undefined ? {} : { search: query[PARAM.search] }),
    ...(from === null ? {} : { receivedFrom: from }),
    ...(to === null ? {} : { receivedTo: to }),
  };

  const [listResult, totalsResult, coursesResult] = await Promise.all([
    listPayments({ ...filters, page, pageSize, sortBy: SORT_KEYS[sortBy], sortDir }, user, locale),
    paymentTotals(filters, user),
    listRequestedCourses(user, locale),
  ]);

  const listing = listResult.ok
    ? listResult.data
    : { rows: [] as readonly PaymentRow[], total: 0, page: 1, pageSize, pageCount: 1 };

  const totals: PaymentTotals = totalsResult.ok
    ? totalsResult.data
    : { count: 0, totalCentimes: 0, byMethod: [] };

  const courses: readonly CourseOption[] = coursesResult.ok ? coursesResult.data : [];

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

      <PaymentsTable
        rows={listing.rows.map((row) => toRowView(row, locale))}
        totals={toTotalsView(totals, locale)}
        total={listing.total}
        page={listing.page}
        pageSize={listing.pageSize}
        pageCount={listing.pageCount}
        sortBy={sortBy}
        sortDir={sortDir}
        search={query[PARAM.search] ?? ''}
        filters={filterState(query)}
        courses={courses}
        currentParams={currentParams}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* View-model builders                                                         */
/* -------------------------------------------------------------------------- */

function filterState(query: Query): PaymentsFilterState {
  return {
    course: query[PARAM.course] ?? null,
    method: query[PARAM.method] ?? null,
    from: query[PARAM.from] ?? null,
    to: query[PARAM.to] ?? null,
  };
}

function toRowView(row: PaymentRow, locale: Locale): PaymentRowView {
  // `receivedAt` is set by the approval transaction; a payment row that somehow
  // predates it falls back to its creation date rather than rendering blank.
  const received = row.receivedAt ?? row.createdAt;

  return {
    id: row.id,
    requestId: row.requestId,
    reference: row.reference,
    receivedAtLabel: formatDateTime(received, locale),
    receivedAtIso: toDateTimeAttribute(received),
    studentId: row.studentId,
    studentName: row.studentName,
    studentEmail: row.studentEmail,
    courseTitle: row.courseTitle,
    amountLabel: formatMoney(row.amountCentimes, locale),
    method: row.method,
    invoiceNumber: row.invoiceNumber,
    invoicePath: row.invoicePath,
    confirmedByName: row.confirmedByName,
  };
}

function toTotalsView(totals: PaymentTotals, locale: Locale): PaymentTotalsView {
  return {
    count: totals.count,
    totalLabel: formatMoney(totals.totalCentimes, locale, { decimals: 'always' }),
    byMethod: totals.byMethod.map((entry) => ({
      method: entry.method,
      count: entry.count,
      totalLabel: formatMoney(entry.totalCentimes, locale, { decimals: 'always' }),
    })),
  };
}
