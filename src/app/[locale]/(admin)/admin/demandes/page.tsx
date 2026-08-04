import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';

import {
  endOfCasablancaDay,
  formatDate,
  formatDateTime,
  formatRelative,
  startOfCasablancaDay,
  toDateTimeAttribute,
} from '@/lib/dates';
import { formatMoney, toCentimes } from '@/lib/money';
import { formatPhoneDisplay, toWhatsAppNumber } from '@/lib/phone';
import { isLocale, type Locale } from '@/i18n/routing';
import { requirePageAdmin } from '@/server/auth/guards';
import type { SessionUser } from '@/server/auth/session';
import {
  getRequestForVerification,
  listRequestQueue,
  listRequestedCourses,
  requestQueueCounts,
  type CourseOption,
  type RequestFlags,
  type RequestQueueRow,
  type RequestVerificationDetail,
} from '@/server/services/enrollment/admin-queries';

import { RequestsTable } from './requests-table';
import {
  PARAM,
  QUEUES,
  SORT_KEYS,
  TIMELINE_LABEL_KEY,
  TRANSFER_TYPE_FROM_PARAM,
  type AgeTone,
  type FlagView,
  type OtherRequestView,
  type QueueKey,
  type RequestReviewView,
  type RequestRowView,
  type RequestsFilterState,
  type SortParam,
} from './request-view';

/**
 * `/admin/demandes` — the payment-verification queue (§17.3), « the operational
 * heart of the business ».
 *
 * This file is the boundary, exactly as `/admin/comptes/page.tsx` is: it
 * validates the URL, asks the read model for one page, and turns database values
 * into strings the browser can render without a timezone database, a currency
 * table or a message catalogue. Nothing below it queries, nothing above it
 * formats.
 *
 * ## The URL is attacker-controlled input
 * Every parameter is validated against a closed set and falls back with
 * `.catch()` rather than throwing: a tracking parameter appended to a link
 * pasted into WhatsApp must not turn the queue into an error page. The object
 * handed to `listRequestQueue` is built field by field and that service's own
 * schema is `.strict()`.
 *
 * ## Which queue opens by default
 * « À vérifier », sorted oldest-first — §17.3 is explicit, and an administrator
 * clearing the evening's queue should land on the work. With nothing to verify
 * they land on « Toutes », because an empty screen tells them nothing.
 */

type LocaleParams = { locale: string };
type RawSearchParams = Record<string, string | string[] | undefined>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;
const AMOUNT = /^\d{1,7}(?:[.,]\d{1,2})?$/u;

const QUEUE_KEYS = QUEUES.map((entry) => entry.key) as [QueueKey, ...QueueKey[]];

const searchParamsSchema = z.object({
  [PARAM.queue]: z.enum(QUEUE_KEYS).optional().catch(undefined),
  [PARAM.search]: z.string().trim().min(1).max(120).optional().catch(undefined),
  [PARAM.page]: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  [PARAM.pageSize]: z.coerce.number().int().min(5).max(100).optional().catch(undefined),
  [PARAM.sortBy]: z.enum(['date', 'montant']).optional().catch(undefined),
  [PARAM.sortDir]: z.enum(['asc', 'desc']).optional().catch(undefined),
  [PARAM.course]: z.string().trim().min(1).max(64).optional().catch(undefined),
  [PARAM.transferType]: z.enum(['instantane', 'standard', 'especes']).optional().catch(undefined),
  [PARAM.amountMin]: z.string().regex(AMOUNT).optional().catch(undefined),
  [PARAM.amountMax]: z.string().regex(AMOUNT).optional().catch(undefined),
  [PARAM.from]: z.string().regex(ISO_DAY).optional().catch(undefined),
  [PARAM.to]: z.string().regex(ISO_DAY).optional().catch(undefined),
  [PARAM.flagged]: z.enum(['oui']).optional().catch(undefined),
  [PARAM.review]: z.string().trim().min(1).max(64).optional().catch(undefined),
});

type Query = z.output<typeof searchParamsSchema>;

/** Only the first value of a repeated parameter is considered. */
function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Requests still waiting on somebody — the only ones an SLA colour applies to. */
const OPEN_STATUSES: readonly string[] = ['AWAITING_RECEIPT', 'UNDER_REVIEW', 'INFO_REQUESTED'];

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default async function RequestsPage({
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

  const t = await getTranslations('admin.requests');

  const query = searchParamsSchema.parse(
    Object.fromEntries(Object.entries(rawSearch).map(([key, value]) => [key, firstValue(value)])),
  );

  const now = new Date();

  const [countsResult, coursesResult] = await Promise.all([
    requestQueueCounts(user, now),
    listRequestedCourses(user, locale),
  ]);

  const counts = countsResult.ok
    ? countsResult.data
    : {
        AWAITING_RECEIPT: 0,
        UNDER_REVIEW: 0,
        INFO_REQUESTED: 0,
        APPROVED: 0,
        REJECTED: 0,
        EXPIRED: 0,
        CANCELLED: 0,
        total: 0,
        oldestUnderReviewHours: null,
      };
  const courses: readonly CourseOption[] = coursesResult.ok ? coursesResult.data : [];

  const queue: QueueKey = query[PARAM.queue] ?? (counts.UNDER_REVIEW > 0 ? 'a-verifier' : 'toutes');
  const statuses = QUEUES.find((entry) => entry.key === queue)?.statuses ?? [];

  const page = query[PARAM.page] ?? 1;
  const pageSize = query[PARAM.pageSize] ?? 25;
  // §17.3: the verification queue lands oldest-first. Every other tab is a
  // history, and a history reads newest-first.
  const defaultDir = queue === 'a-verifier' ? 'asc' : 'desc';
  const sortBy: SortParam = query[PARAM.sortBy] ?? 'date';
  const sortDir = query[PARAM.sortDir] ?? defaultDir;

  const transferParam = query[PARAM.transferType];
  const transferType = transferParam === undefined ? undefined : TRANSFER_TYPE_FROM_PARAM[transferParam];
  const amountMin = toCentimesOrUndefined(query[PARAM.amountMin]);
  const amountMax = toCentimesOrUndefined(query[PARAM.amountMax]);
  const from = startOfCasablancaDay(query[PARAM.from] ?? null);
  const rawTo = endOfCasablancaDay(query[PARAM.to] ?? null);
  // `endOfCasablancaDay` is exclusive; the read model compares with `lte`.
  const to = rawTo === null ? null : new Date(rawTo.getTime() - 1);

  const listResult = await listRequestQueue(
    {
      ...(statuses.length === 0 ? {} : { status: [...statuses] }),
      ...(query[PARAM.course] === undefined ? {} : { courseId: query[PARAM.course] }),
      ...(transferType === undefined ? {} : { transferType }),
      ...(query[PARAM.search] === undefined ? {} : { search: query[PARAM.search] }),
      ...(amountMin === undefined ? {} : { amountMinCentimes: amountMin }),
      ...(amountMax === undefined ? {} : { amountMaxCentimes: amountMax }),
      ...(from === null ? {} : { submittedFrom: from }),
      ...(to === null ? {} : { submittedTo: to }),
      ...(query[PARAM.flagged] === undefined ? {} : { flaggedOnly: true }),
      page,
      pageSize,
      sortBy: SORT_KEYS[sortBy],
      sortDir,
    },
    user,
    locale,
  );

  const listing = listResult.ok
    ? listResult.data
    : { rows: [] as readonly RequestQueueRow[], total: 0, page: 1, pageSize, pageCount: 1 };

  const rows = listing.rows.map((row) => toRowView(row, locale, now, t));

  const reviewId = query[PARAM.review];
  const review = reviewId === undefined ? null : await loadReview(reviewId, user, locale, now, t);

  /** Re-serialised from the validated values: a junk parameter never survives. */
  const currentParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) currentParams[key] = String(value);
  }
  currentParams[PARAM.queue] = queue;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1 pb-4">
        <h1 className="font-display text-title text-ink">{t('title')}</h1>
        <p className="max-w-prose text-sm text-ink-muted">{t('subtitle')}</p>
      </header>

      <RequestsTable
        rows={rows}
        total={listing.total}
        page={listing.page}
        pageSize={listing.pageSize}
        pageCount={listing.pageCount}
        sortBy={sortBy}
        sortDir={sortDir}
        queue={queue}
        counts={{
          'a-verifier': counts.UNDER_REVIEW,
          informations: counts.INFO_REQUESTED,
          'attente-justificatif': counts.AWAITING_RECEIPT,
          approuvees: counts.APPROVED,
          refusees: counts.REJECTED,
          expirees: counts.EXPIRED,
          toutes: counts.total,
        }}
        search={query[PARAM.search] ?? ''}
        filters={filterState(query)}
        courses={courses}
        currentParams={currentParams}
        review={review}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* View-model builders                                                         */
/* -------------------------------------------------------------------------- */

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function toCentimesOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const centimes = toCentimes(value.replace(',', '.'));
  return centimes === null ? undefined : centimes;
}

function filterState(query: Query): RequestsFilterState {
  return {
    course: query[PARAM.course] ?? null,
    transferType: query[PARAM.transferType] ?? null,
    amountMin: query[PARAM.amountMin] ?? null,
    amountMax: query[PARAM.amountMax] ?? null,
    from: query[PARAM.from] ?? null,
    to: query[PARAM.to] ?? null,
    flagged: query[PARAM.flagged] !== undefined,
  };
}

/** `https://wa.me/…` with the reference already typed — the fastest check (§17.3). */
function whatsappHref(
  phone: string,
  name: string,
  reference: string,
  t: Translator,
): string | null {
  const digits = toWhatsAppNumber(phone);
  if (digits === '') return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(
    t('whatsappMessage', { name, reference }),
  )}`;
}

/**
 * « il y a 3 heures » in the SLA column, plus the tone the cell paints itself
 * with. A closed request is never late: the tone applies to open states only,
 * and the number is always spelled out so colour is never the only signal (§21).
 */
function age(
  createdAt: Date,
  status: string,
  now: Date,
  t: Translator,
): { label: string; tone: AgeTone } {
  const hours = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 3_600_000));
  const label = hours < 48 ? t('ageHours', { hours }) : t('ageDays', { days: Math.floor(hours / 24) });

  if (!OPEN_STATUSES.includes(status)) return { label, tone: 'calm' };
  if (hours >= 48) return { label, tone: 'late' };
  if (hours >= 24) return { label, tone: 'warn' };
  return { label, tone: 'calm' };
}

/** The §2066 signals, already decided by the service — mapped to what a badge needs. */
function toFlagViews(flags: RequestFlags): readonly FlagView[] {
  const views: FlagView[] = [];

  if (flags.duplicateReceipt) {
    views.push({
      key: 'duplicateReceipt',
      labelKey: 'flags.duplicateReceipt',
      tone: 'danger',
      relatedRequestId: flags.duplicateOfRequestId,
    });
  }
  if (flags.amountMismatch) {
    views.push({
      key: 'amountMismatch',
      labelKey: 'flags.amountMismatch',
      tone: 'warn',
      relatedRequestId: null,
    });
  }
  if (flags.accountNotValidated) {
    views.push({
      key: 'accountNotValidated',
      labelKey: 'flags.accountNotValidated',
      tone: 'warn',
      relatedRequestId: null,
    });
  }
  if (flags.secondRequest) {
    views.push({
      key: 'secondRequest',
      labelKey: 'flags.secondRequest',
      tone: 'warn',
      relatedRequestId: null,
    });
  }

  return views;
}

function isImage(mime: string | null): boolean {
  return mime !== null && mime.startsWith('image/');
}

function toRowView(
  row: RequestQueueRow,
  locale: Locale,
  now: Date,
  t: Translator,
): RequestRowView {
  const { label: ageLabel, tone: ageTone } = age(row.createdAt, row.status, now, t);

  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    studentId: row.studentId,
    studentName: row.studentName,
    studentEmail: row.studentEmail,
    studentPhoneDisplay: formatPhoneDisplay(row.studentPhone),
    whatsappHref: whatsappHref(row.studentPhone, row.studentName, row.reference, t),
    courseTitle: row.courseTitle,
    amountLabel: formatMoney(row.amountDueCentimes, locale),
    transferType: row.transferType,
    transferDateLabel: row.transferDate === null ? null : formatDate(row.transferDate, locale),
    submittedAtRelative: formatRelative(row.createdAt, locale, now),
    submittedAtAbsolute: formatDateTime(row.createdAt, locale),
    submittedAtIso: toDateTimeAttribute(row.createdAt),
    ageLabel,
    ageTone,
    receiptPath: row.receiptPath,
    receiptIsImage: isImage(row.receiptMime),
    flags: toFlagViews(row.flags),
  };
}

function toOtherRequestView(
  request: RequestVerificationDetail['student']['otherRequests'][number],
  locale: Locale,
): OtherRequestView {
  return {
    id: request.id,
    reference: request.reference,
    status: request.status,
    courseTitle: request.courseTitle,
    amountLabel: formatMoney(request.amountDueCentimes, locale),
    createdAtLabel: formatDate(request.createdAt, locale),
  };
}

/** Everything the verification drawer shows, in one server round trip. */
async function loadReview(
  requestId: string,
  user: SessionUser,
  locale: Locale,
  now: Date,
  t: Translator,
): Promise<RequestReviewView | null> {
  const result = await getRequestForVerification(requestId, user, locale);
  if (!result.ok) return null;

  const detail = result.data;
  const { label: ageLabel, tone: ageTone } = age(detail.createdAt, detail.status, now, t);
  const allowed = detail.allowedEvents;

  return {
    id: detail.id,
    reference: detail.reference,
    status: detail.status,
    courseTitle: detail.courseTitle,
    courseSlug: detail.courseSlug,

    receiptPath: detail.receiptPath,
    receiptIsImage: isImage(detail.receiptMime),
    receiptIsPdf: detail.receiptMime === 'application/pdf',
    receiptUploadedAtLabel:
      detail.receiptUploadedAt === null ? null : formatDateTime(detail.receiptUploadedAt, locale),
    transferDateLabel:
      detail.transferDate === null ? null : formatDate(detail.transferDate, locale),
    transferBankRef: detail.transferBankRef,
    studentMessage: detail.studentMessage,

    priceLabel: formatMoney(detail.priceCentimes, locale),
    discountLabel:
      detail.discountCentimes === 0 ? null : formatMoney(detail.discountCentimes, locale),
    dueLabel: formatMoney(detail.amountDueCentimes, locale),
    coursePriceLabel:
      detail.flags.amountMismatch && detail.coursePriceCentimes !== null
        ? formatMoney(detail.coursePriceCentimes, locale)
        : null,
    amountMismatch: detail.flags.amountMismatch,
    transferType: detail.transferType,

    submittedAtLabel: formatDateTime(detail.createdAt, locale),
    ageLabel,
    ageTone,
    reviewedAtLabel: detail.reviewedAt === null ? null : formatDateTime(detail.reviewedAt, locale),
    reviewedByName: detail.reviewedByName,

    studentId: detail.studentId,
    studentName: detail.studentName,
    studentEmail: detail.studentEmail,
    studentPhoneDisplay: formatPhoneDisplay(detail.studentPhone),
    whatsappHref: whatsappHref(detail.studentPhone, detail.studentName, detail.reference, t),
    studentCity: detail.student.city,
    accountStatus: detail.student.status,
    activeEnrollments: detail.student.activeEnrollments,
    previousPayments: detail.student.previousPayments,
    previousPaidLabel: formatMoney(detail.student.previousPaidCentimes, locale),
    everRejected: detail.student.everRejected,
    otherRequests: detail.student.otherRequests.map((request) =>
      toOtherRequestView(request, locale),
    ),

    events: detail.events.map((event) => ({
      id: event.id,
      type: event.type,
      labelKey: TIMELINE_LABEL_KEY[event.type] ?? 'admin.requests.drawer.title',
      message: event.message,
      timestamp: formatDateTime(event.createdAt, locale),
      actorName: event.actorName,
    })),
    infoRequestedMessage: detail.infoRequestedMessage,
    rejectionReason: detail.rejectionReason,
    adminNote: detail.adminNote ?? '',
    invoiceNumber: detail.invoiceNumber,
    invoicePath: detail.invoicePath,

    flags: toFlagViews(detail.flags),

    canApprove: allowed.includes('ADMIN_APPROVED'),
    canRequestInfo: allowed.includes('ADMIN_INFO_REQUESTED'),
    canReject: allowed.includes('ADMIN_REJECTED'),
  };
}
