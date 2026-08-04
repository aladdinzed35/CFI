/**
 * Read models for the §17.3 verification queue and the §17.4 payments ledger.
 *
 * ## Why this file exists next to `queries.ts`
 * `queries.ts` owns the student's own view of their requests and the file
 * gateway's authorisation oracle. This one owns the two administration screens:
 * a much wider row (the §2066 column list), the four decision flags, the
 * verification drawer's context panes, and the payment ledger. Keeping them
 * apart means the student read model can never grow an admin-only column by
 * accident.
 *
 * ## Authorisation happens before the first column is read
 * Every exported function takes the actor and checks `can(actor, 'payment.verify')`
 * before touching Prisma (§20). A read model that trusts its caller is how an
 * admin-only list ends up rendered on a student page.
 *
 * ## The four flags are computed here, never in a row renderer
 * §2066 asks for « Justificatif déjà utilisé », « Montant différent du prix »,
 * « Compte non validé » and « Deuxième demande » on every row. Two of them fall
 * out of columns the page query already selects (`user.status`,
 * `course.priceCentimes`); the other two are **set-based** — one grouped query
 * for the shared receipt digests, one for the per-student-per-course request
 * counts — so a page of 100 rows costs four queries, not four hundred.
 *
 * `flaggedOnly` is a real `WHERE` clause rather than a filter applied after
 * pagination: a table whose « 3 sur 3 » is computed before its own filter runs
 * is a table that lies.
 */

import { z } from 'zod';
import type {
  AccountStatus,
  PaymentMethod,
  Prisma,
  RequestStatus,
  TransferType,
} from '@prisma/client';

import { db } from '@/server/db';
import { can, type PermissionUser } from '@/server/auth/permissions';
import type { Locale } from '@/i18n/routing';
import { allowedEvents, type RequestEvent } from './state-machine';
import { fileGatewayPath } from './queries';

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                               */
/* -------------------------------------------------------------------------- */

export type QueryResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: 'FORBIDDEN' | 'INVALID' | 'NOT_FOUND' };

const FORBIDDEN = { ok: false, code: 'FORBIDDEN' } as const;
const INVALID = { ok: false, code: 'INVALID' } as const;
const NOT_FOUND = { ok: false, code: 'NOT_FOUND' } as const;

export const REQUEST_STATUS_VALUES = [
  'AWAITING_RECEIPT',
  'UNDER_REVIEW',
  'INFO_REQUESTED',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const satisfies readonly RequestStatus[];

export const TRANSFER_TYPE_VALUES = [
  'INSTANT',
  'STANDARD_48H',
  'CASH_AT_CENTER',
] as const satisfies readonly TransferType[];

export const PAYMENT_METHOD_VALUES = [
  'BANK_TRANSFER',
  'CASH_AT_CENTER',
  'OTHER',
] as const satisfies readonly PaymentMethod[];

const requestStatusEnum = z.enum(REQUEST_STATUS_VALUES);
const transferTypeEnum = z.enum(TRANSFER_TYPE_VALUES);
const paymentMethodEnum = z.enum(PAYMENT_METHOD_VALUES);

/** Ten million dirhams in centimes — far above any real course, far below overflow. */
const AMOUNT_MAX_CENTIMES = 1_000_000_000;

export const REQUEST_QUEUE_PAGE_SIZE_DEFAULT = 25;
export const REQUEST_QUEUE_PAGE_SIZE_MAX = 100;

export const REQUEST_QUEUE_SORT_FIELDS = [
  'createdAt',
  'amountDueCentimes',
  'expiresAt',
] as const;
export type RequestQueueSortField = (typeof REQUEST_QUEUE_SORT_FIELDS)[number];

/**
 * How many rows a bounded pre-pass may pull when building the `flaggedOnly`
 * clause. Duplicated digests and repeat requests are, by construction, rare;
 * the cap keeps a pathological catalogue from turning one filter into a scan.
 */
const FLAG_SCAN_MAX = 500;

/* -------------------------------------------------------------------------- */
/* Queue query                                                                 */
/* -------------------------------------------------------------------------- */

/** Everything `/admin/demandes` can put in its URL. `.strict()` (§20). */
export const requestQueueQuerySchema = z
  .object({
    /** Tab = one or more states. Empty means every state. */
    status: z.array(requestStatusEnum).optional(),
    courseId: z.string().min(1).max(64).optional(),
    transferType: transferTypeEnum.optional(),
    /** Free text over the reference, the student's name and their e-mail. */
    search: z.string().trim().min(1).max(120).optional(),
    amountMinCentimes: z.number().int().min(0).max(AMOUNT_MAX_CENTIMES).optional(),
    amountMaxCentimes: z.number().int().min(0).max(AMOUNT_MAX_CENTIMES).optional(),
    submittedFrom: z.coerce.date().optional(),
    submittedTo: z.coerce.date().optional(),
    /** Only rows carrying at least one of the four §2066 flags. */
    flaggedOnly: z.boolean().optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(REQUEST_QUEUE_PAGE_SIZE_MAX)
      .default(REQUEST_QUEUE_PAGE_SIZE_DEFAULT),
    sortBy: z.enum(REQUEST_QUEUE_SORT_FIELDS).default('createdAt'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export type RequestQueueQuery = z.output<typeof requestQueueQuerySchema>;

/** The four §2066 signals. Every one is decided here, never by a cell renderer. */
export interface RequestFlags {
  /** §9.2 rule 6 — the same receipt digest appears on another request. */
  readonly duplicateReceipt: boolean;
  /** The oldest other request sharing the digest, to link to. */
  readonly duplicateOfRequestId: string | null;
  /** The snapshot price no longer matches the course's current price. */
  readonly amountMismatch: boolean;
  /** The student's account has not been approved (§9.1). */
  readonly accountNotValidated: boolean;
  /** This student has more than one request for this course. */
  readonly secondRequest: boolean;
}

export function hasAnyFlag(flags: RequestFlags): boolean {
  return (
    flags.duplicateReceipt ||
    flags.amountMismatch ||
    flags.accountNotValidated ||
    flags.secondRequest
  );
}

/** One row of the §2066 table. */
export interface RequestQueueRow {
  readonly id: string;
  readonly reference: string;
  readonly status: RequestStatus;
  readonly studentId: string;
  readonly studentName: string;
  readonly studentEmail: string;
  readonly studentPhone: string;
  readonly studentStatus: AccountStatus;
  readonly courseId: string | null;
  readonly courseSlug: string | null;
  readonly courseTitle: string;
  readonly priceCentimes: number;
  readonly discountCentimes: number;
  readonly amountDueCentimes: number;
  /** The course's price today — the other half of « montant différent du prix ». */
  readonly coursePriceCentimes: number | null;
  readonly transferType: TransferType;
  readonly transferDate: Date | null;
  readonly transferBankRef: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly receiptUploadedAt: Date | null;
  /** Gateway path of the justificatif, or `null` before any upload. */
  readonly receiptPath: string | null;
  readonly receiptMime: string | null;
  readonly flags: RequestFlags;
}

export interface RequestQueuePage {
  readonly rows: readonly RequestQueueRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
}

const QUEUE_ROW_SELECT = {
  id: true,
  reference: true,
  status: true,
  priceCentimes: true,
  discountCentimes: true,
  amountDueCentimes: true,
  transferType: true,
  transferDate: true,
  transferBankRef: true,
  createdAt: true,
  expiresAt: true,
  receiptKey: true,
  receiptMime: true,
  receiptSha256: true,
  receiptUploadedAt: true,
  user: { select: { id: true, fullName: true, email: true, phone: true, status: true } },
  course: {
    select: {
      id: true,
      slug: true,
      priceCentimes: true,
      translations: { select: { locale: true, title: true } },
    },
  },
} as const;

type QueueRecord = Prisma.EnrollmentRequestGetPayload<{ select: typeof QUEUE_ROW_SELECT }>;

/** The minimum a course must expose to be named — any richer select satisfies it. */
interface TitledCourse {
  readonly slug: string;
  readonly translations: readonly { readonly locale: string; readonly title: string }[];
}

function titleOf(course: TitledCourse | null, locale: Locale): string {
  if (course === null) return '—';
  const exact = course.translations.find((entry) => entry.locale === locale);
  const french = course.translations.find((entry) => entry.locale === 'fr');
  return exact?.title ?? french?.title ?? course.slug;
}

/**
 * The verification queue: filtered, sorted and sliced in SQL, with the four
 * flags resolved by two set-based lookups over the page that came back.
 */
export async function listRequestQueue(
  rawQuery: unknown,
  actor: PermissionUser,
  locale: Locale = 'fr',
): Promise<QueryResult<RequestQueuePage>> {
  if (!can(actor, 'payment.verify')) return FORBIDDEN;

  const parsed = requestQueueQuerySchema.safeParse(rawQuery);
  if (!parsed.success) return INVALID;
  const query = parsed.data;

  const where = await buildQueueWhere(query);

  const [total, records] = await Promise.all([
    db.enrollmentRequest.count({ where }),
    db.enrollmentRequest.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortDir },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: QUEUE_ROW_SELECT,
    }),
  ]);

  const flags = await resolveFlags(records);

  return {
    ok: true,
    data: {
      rows: records.map((record) => toQueueRow(record, locale, flags)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

function toQueueRow(record: QueueRecord, locale: Locale, flags: ResolvedFlags): RequestQueueRow {
  return {
    id: record.id,
    reference: record.reference,
    status: record.status,
    studentId: record.user.id,
    studentName: record.user.fullName,
    studentEmail: record.user.email,
    studentPhone: record.user.phone,
    studentStatus: record.user.status,
    courseId: record.course?.id ?? null,
    courseSlug: record.course?.slug ?? null,
    courseTitle: titleOf(record.course, locale),
    priceCentimes: record.priceCentimes,
    discountCentimes: record.discountCentimes,
    amountDueCentimes: record.amountDueCentimes,
    coursePriceCentimes: record.course?.priceCentimes ?? null,
    transferType: record.transferType,
    transferDate: record.transferDate,
    transferBankRef: record.transferBankRef,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    receiptUploadedAt: record.receiptUploadedAt,
    receiptPath: record.receiptKey === null ? null : fileGatewayPath(record.receiptKey),
    receiptMime: record.receiptMime,
    flags: flagsFor(record, flags),
  };
}

/* -------------------------------------------------------------------------- */
/* Flags                                                                       */
/* -------------------------------------------------------------------------- */

interface ResolvedFlags {
  /** request id → the oldest OTHER request sharing its receipt digest. */
  readonly duplicateOf: ReadonlyMap<string, string>;
  /** `userId|courseId` → how many requests that student filed for that course. */
  readonly perStudentCourse: ReadonlyMap<string, number>;
}

function pairKey(userId: string, courseId: string | null): string {
  return `${userId}|${courseId ?? ''}`;
}

/** Two grouped queries for a whole page — never one query per row. */
async function resolveFlags(records: readonly QueueRecord[]): Promise<ResolvedFlags> {
  if (records.length === 0) {
    return { duplicateOf: new Map(), perStudentCourse: new Map() };
  }

  const digests = [
    ...new Set(
      records
        .map((record) => record.receiptSha256)
        .filter((value): value is string => value !== null),
    ),
  ];
  const userIds = [...new Set(records.map((record) => record.user.id))];

  const [siblings, grouped] = await Promise.all([
    digests.length === 0
      ? Promise.resolve([])
      : db.enrollmentRequest.findMany({
          where: { receiptSha256: { in: digests } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, receiptSha256: true },
        }),
    db.enrollmentRequest.groupBy({
      by: ['userId', 'courseId'],
      where: { userId: { in: userIds } },
      _count: { _all: true },
    }),
  ]);

  const byDigest = new Map<string, string[]>();
  for (const sibling of siblings) {
    if (sibling.receiptSha256 === null) continue;
    const list = byDigest.get(sibling.receiptSha256);
    if (list === undefined) byDigest.set(sibling.receiptSha256, [sibling.id]);
    else list.push(sibling.id);
  }

  const duplicateOf = new Map<string, string>();
  for (const record of records) {
    if (record.receiptSha256 === null) continue;
    const ids = byDigest.get(record.receiptSha256) ?? [];
    if (ids.length < 2) continue;
    const original = ids.find((id) => id !== record.id);
    if (original !== undefined) duplicateOf.set(record.id, original);
  }

  const perStudentCourse = new Map<string, number>();
  for (const group of grouped) {
    perStudentCourse.set(pairKey(group.userId, group.courseId), group._count._all);
  }

  return { duplicateOf, perStudentCourse };
}

function flagsFor(record: QueueRecord, resolved: ResolvedFlags): RequestFlags {
  const duplicateOfRequestId = resolved.duplicateOf.get(record.id) ?? null;
  const siblings = resolved.perStudentCourse.get(pairKey(record.user.id, record.course?.id ?? null)) ?? 1;

  return {
    duplicateReceipt: duplicateOfRequestId !== null,
    duplicateOfRequestId,
    amountMismatch:
      record.course !== null && record.priceCentimes !== record.course.priceCentimes,
    accountNotValidated: record.user.status !== 'ACTIVE',
    secondRequest: siblings > 1,
  };
}

/* -------------------------------------------------------------------------- */
/* WHERE construction                                                          */
/* -------------------------------------------------------------------------- */

async function buildQueueWhere(
  query: RequestQueueQuery,
): Promise<Prisma.EnrollmentRequestWhereInput> {
  const clauses: Prisma.EnrollmentRequestWhereInput[] = [];

  if (query.status !== undefined && query.status.length > 0) {
    clauses.push({ status: { in: query.status } });
  }
  if (query.courseId !== undefined) clauses.push({ courseId: query.courseId });
  if (query.transferType !== undefined) clauses.push({ transferType: query.transferType });

  if (query.search !== undefined) {
    clauses.push({
      OR: [
        { reference: { contains: query.search } },
        { user: { fullName: { contains: query.search } } },
        { user: { email: { contains: query.search } } },
      ],
    });
  }

  if (query.amountMinCentimes !== undefined || query.amountMaxCentimes !== undefined) {
    clauses.push({
      amountDueCentimes: {
        ...(query.amountMinCentimes === undefined ? {} : { gte: query.amountMinCentimes }),
        ...(query.amountMaxCentimes === undefined ? {} : { lte: query.amountMaxCentimes }),
      },
    });
  }

  if (query.submittedFrom !== undefined || query.submittedTo !== undefined) {
    clauses.push({
      createdAt: {
        ...(query.submittedFrom === undefined ? {} : { gte: query.submittedFrom }),
        ...(query.submittedTo === undefined ? {} : { lte: query.submittedTo }),
      },
    });
  }

  if (query.flaggedOnly === true) clauses.push(await flaggedClause());

  return clauses.length === 0 ? {} : { AND: clauses };
}

/**
 * « Avec signaux uniquement », as SQL.
 *
 * Each of the four flags becomes a disjunct. Two are plain column predicates;
 * the other two are built from bounded pre-passes — the set of duplicated
 * receipt digests, and the set of (student, course) pairs with more than one
 * request. Both are rare by construction and capped at {@link FLAG_SCAN_MAX}.
 */
async function flaggedClause(): Promise<Prisma.EnrollmentRequestWhereInput> {
  const [duplicated, repeated, courses] = await Promise.all([
    db.enrollmentRequest.groupBy({
      by: ['receiptSha256'],
      where: { receiptSha256: { not: null } },
      _count: { _all: true },
      orderBy: { receiptSha256: 'asc' },
      take: FLAG_SCAN_MAX,
    }),
    db.enrollmentRequest.groupBy({
      by: ['userId', 'courseId'],
      _count: { _all: true },
      orderBy: [{ userId: 'asc' }, { courseId: 'asc' }],
      take: FLAG_SCAN_MAX,
    }),
    db.course.findMany({
      where: { deletedAt: null },
      select: { id: true, priceCentimes: true },
      take: FLAG_SCAN_MAX,
    }),
  ]);

  const digests = duplicated
    .filter((group) => group._count._all > 1)
    .map((group) => group.receiptSha256)
    .filter((value): value is string => value !== null);

  const pairs = repeated.filter((group) => group._count._all > 1);

  const or: Prisma.EnrollmentRequestWhereInput[] = [
    // « Compte non validé ».
    { user: { status: { not: 'ACTIVE' } } },
  ];

  if (digests.length > 0) or.push({ receiptSha256: { in: digests } });

  for (const pair of pairs) {
    or.push({ userId: pair.userId, courseId: pair.courseId });
  }

  // « Montant différent du prix » — the snapshot against today's catalogue.
  for (const course of courses) {
    or.push({ courseId: course.id, priceCentimes: { not: course.priceCentimes } });
  }

  return { OR: or };
}

/* -------------------------------------------------------------------------- */
/* Tab counters                                                                */
/* -------------------------------------------------------------------------- */

export type RequestStatusCounts = Readonly<Record<RequestStatus, number>> & {
  readonly total: number;
  /** Hours the oldest `UNDER_REVIEW` request has been waiting — the SLA age. */
  readonly oldestUnderReviewHours: number | null;
};

export async function requestQueueCounts(
  actor: PermissionUser,
  now: Date = new Date(),
): Promise<QueryResult<RequestStatusCounts>> {
  if (!can(actor, 'payment.verify')) return FORBIDDEN;

  const [grouped, oldest] = await Promise.all([
    db.enrollmentRequest.groupBy({ by: ['status'], _count: { _all: true } }),
    db.enrollmentRequest.findFirst({
      where: { status: 'UNDER_REVIEW' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  const byStatus = new Map<RequestStatus, number>();
  let total = 0;
  for (const group of grouped) {
    byStatus.set(group.status, group._count._all);
    total += group._count._all;
  }

  const counts = {} as Record<RequestStatus, number>;
  for (const status of REQUEST_STATUS_VALUES) counts[status] = byStatus.get(status) ?? 0;

  return {
    ok: true,
    data: {
      ...counts,
      total,
      oldestUnderReviewHours:
        oldest === null
          ? null
          : Math.floor((now.getTime() - oldest.createdAt.getTime()) / (60 * 60 * 1_000)),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Course options, for the filter select                                       */
/* -------------------------------------------------------------------------- */

export interface CourseOption {
  readonly id: string;
  readonly title: string;
}

/** Only courses that have ever been requested — an empty filter option is noise. */
export async function listRequestedCourses(
  actor: PermissionUser,
  locale: Locale = 'fr',
): Promise<QueryResult<readonly CourseOption[]>> {
  if (!can(actor, 'payment.verify')) return FORBIDDEN;

  const courses = await db.course.findMany({
    where: { deletedAt: null, requests: { some: {} } },
    select: { id: true, slug: true, translations: { select: { locale: true, title: true } } },
    take: 200,
  });

  const options = courses
    .map((course) => ({
      id: course.id,
      title:
        course.translations.find((entry) => entry.locale === locale)?.title ??
        course.translations.find((entry) => entry.locale === 'fr')?.title ??
        course.slug,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, locale));

  return { ok: true, data: options };
}

/* -------------------------------------------------------------------------- */
/* One request, for the verification drawer                                    */
/* -------------------------------------------------------------------------- */

export interface RequestTimelineRow {
  readonly id: string;
  readonly type: string;
  readonly message: string | null;
  readonly createdAt: Date;
  readonly actorName: string | null;
}

/** One of the student's other requests, for the « autres demandes » pane. */
export interface StudentRequestSummary {
  readonly id: string;
  readonly reference: string;
  readonly status: RequestStatus;
  readonly courseTitle: string;
  readonly amountDueCentimes: number;
  readonly createdAt: Date;
}

export interface StudentContext {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly status: AccountStatus;
  readonly city: string | null;
  readonly activeEnrollments: number;
  readonly previousPayments: number;
  readonly previousPaidCentimes: number;
  readonly everRejected: boolean;
  readonly otherRequests: readonly StudentRequestSummary[];
}

export interface RequestVerificationDetail extends RequestQueueRow {
  readonly studentMessage: string | null;
  readonly adminNote: string | null;
  readonly infoRequestedMessage: string | null;
  readonly rejectionReason: string | null;
  readonly receiptSizeBytes: number | null;
  readonly reviewedAt: Date | null;
  readonly reviewedByName: string | null;
  readonly invoiceNumber: string | null;
  readonly invoicePath: string | null;
  readonly paymentReceivedAt: Date | null;
  readonly events: readonly RequestTimelineRow[];
  readonly student: StudentContext;
  /** What the state machine allows from here — the drawer's buttons, not a guess. */
  readonly allowedEvents: readonly RequestEvent[];
}

export async function getRequestForVerification(
  requestId: unknown,
  actor: PermissionUser,
  locale: Locale = 'fr',
): Promise<QueryResult<RequestVerificationDetail>> {
  if (!can(actor, 'payment.verify')) return FORBIDDEN;

  const parsedId = z.string().min(1).max(64).safeParse(requestId);
  if (!parsedId.success) return INVALID;

  const record = await db.enrollmentRequest.findUnique({
    where: { id: parsedId.data },
    select: {
      ...QUEUE_ROW_SELECT,
      receiptSizeBytes: true,
      studentMessage: true,
      adminNote: true,
      infoRequestedMessage: true,
      rejectionReason: true,
      reviewedAt: true,
      reviewedById: true,
      payment: { select: { invoiceNumber: true, invoiceKey: true, receivedAt: true } },
      events: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          message: true,
          createdAt: true,
          actorId: true,
        },
      },
    },
  });
  if (record === null) return NOT_FOUND;

  const [flags, student, actorNames] = await Promise.all([
    resolveFlags([record]),
    loadStudentContext(record.user.id, record.id, locale),
    // `reviewedById` and `RequestEvent.actorId` are plain columns — the schema
    // declares no relation for either — so the names are resolved in one lookup.
    actorNamesFor([...record.events.map((event) => event.actorId), record.reviewedById]),
  ]);

  const base = toQueueRow(record, locale, flags);

  return {
    ok: true,
    data: {
      ...base,
      receiptSizeBytes: record.receiptSizeBytes,
      studentMessage: record.studentMessage,
      adminNote: record.adminNote,
      infoRequestedMessage: record.infoRequestedMessage,
      rejectionReason: record.rejectionReason,
      reviewedAt: record.reviewedAt,
      reviewedByName:
        record.reviewedById === null ? null : (actorNames.get(record.reviewedById) ?? null),
      invoiceNumber: record.payment?.invoiceNumber ?? null,
      invoicePath:
        record.payment?.invoiceKey == null ? null : fileGatewayPath(record.payment.invoiceKey),
      paymentReceivedAt: record.payment?.receivedAt ?? null,
      events: record.events.map((event) => ({
        id: event.id,
        type: event.type,
        message: event.message,
        createdAt: event.createdAt,
        actorName: event.actorId === null ? null : (actorNames.get(event.actorId) ?? null),
      })),
      student,
      allowedEvents: allowedEvents(record.status),
    },
  };
}

async function actorNamesFor(
  ids: readonly (string | null)[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();

  const users = await db.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, fullName: true },
  });
  return new Map(users.map((user) => [user.id, user.fullName]));
}

/** The « contexte étudiant » pane: history, not a guess about it. */
async function loadStudentContext(
  userId: string,
  currentRequestId: string,
  locale: Locale,
): Promise<StudentContext> {
  const [user, activeEnrollments, payments, others] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, email: true, phone: true, status: true, city: true },
    }),
    db.enrollment.count({ where: { userId, status: 'ACTIVE' } }),
    db.payment.findMany({
      where: { request: { userId }, receivedAt: { not: null } },
      select: { amountCentimes: true },
    }),
    db.enrollmentRequest.findMany({
      where: { userId, id: { not: currentRequestId } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        reference: true,
        status: true,
        amountDueCentimes: true,
        createdAt: true,
        course: { select: { slug: true, translations: { select: { locale: true, title: true } } } },
      },
    }),
  ]);

  const previousPaidCentimes = payments.reduce((sum, payment) => sum + payment.amountCentimes, 0);

  return {
    id: userId,
    fullName: user?.fullName ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    status: user?.status ?? 'PENDING_APPROVAL',
    city: user?.city ?? null,
    activeEnrollments,
    previousPayments: payments.length,
    previousPaidCentimes,
    everRejected: others.some((request) => request.status === 'REJECTED'),
    otherRequests: others.map((request) => ({
      id: request.id,
      reference: request.reference,
      status: request.status,
      courseTitle: titleOf(request.course, locale),
      amountDueCentimes: request.amountDueCentimes,
      createdAt: request.createdAt,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* §17.4 — the payments ledger                                                 */
/* -------------------------------------------------------------------------- */

export const PAYMENT_PAGE_SIZE_DEFAULT = 25;
export const PAYMENT_PAGE_SIZE_MAX = 100;

export const PAYMENT_SORT_FIELDS = ['receivedAt', 'amountCentimes'] as const;
export type PaymentSortField = (typeof PAYMENT_SORT_FIELDS)[number];

export const paymentLedgerQuerySchema = z
  .object({
    courseId: z.string().min(1).max(64).optional(),
    method: paymentMethodEnum.optional(),
    /** Free text over the invoice number, the student's name and their e-mail. */
    search: z.string().trim().min(1).max(120).optional(),
    receivedFrom: z.coerce.date().optional(),
    receivedTo: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(PAYMENT_PAGE_SIZE_MAX)
      .default(PAYMENT_PAGE_SIZE_DEFAULT),
    sortBy: z.enum(PAYMENT_SORT_FIELDS).default('receivedAt'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export type PaymentLedgerQuery = z.output<typeof paymentLedgerQuerySchema>;

export interface PaymentRow {
  readonly id: string;
  readonly receivedAt: Date | null;
  readonly createdAt: Date;
  readonly requestId: string;
  readonly reference: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly studentEmail: string;
  readonly courseTitle: string;
  readonly amountCentimes: number;
  readonly method: PaymentMethod;
  readonly invoiceNumber: string | null;
  /** Gateway path of the PDF; `null` until the `GENERATE_INVOICE` job has run. */
  readonly invoicePath: string | null;
  readonly bankReference: string | null;
  readonly confirmedByName: string | null;
}

export interface PaymentPage {
  readonly rows: readonly PaymentRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
}

export async function listPayments(
  rawQuery: unknown,
  actor: PermissionUser,
  locale: Locale = 'fr',
): Promise<QueryResult<PaymentPage>> {
  if (!can(actor, 'payment.verify')) return FORBIDDEN;

  const parsed = paymentLedgerQuerySchema.safeParse(rawQuery);
  if (!parsed.success) return INVALID;
  const query = parsed.data;

  const where = buildPaymentWhere(query);

  const [total, records] = await Promise.all([
    db.payment.count({ where }),
    db.payment.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortDir },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        receivedAt: true,
        createdAt: true,
        amountCentimes: true,
        method: true,
        invoiceNumber: true,
        invoiceKey: true,
        bankReference: true,
        confirmedById: true,
        request: {
          select: {
            id: true,
            reference: true,
            user: { select: { id: true, fullName: true, email: true } },
            course: {
              select: { slug: true, translations: { select: { locale: true, title: true } } },
            },
          },
        },
      },
    }),
  ]);

  // `Payment.confirmedById` is a plain column — the schema declares no relation
  // — so the administrators' names are resolved in one extra lookup, never one
  // per row.
  const confirmerNames = await actorNamesFor(records.map((record) => record.confirmedById));

  return {
    ok: true,
    data: {
      rows: records.map((record) => ({
        id: record.id,
        receivedAt: record.receivedAt,
        createdAt: record.createdAt,
        requestId: record.request.id,
        reference: record.request.reference,
        studentId: record.request.user.id,
        studentName: record.request.user.fullName,
        studentEmail: record.request.user.email,
        courseTitle: titleOf(record.request.course, locale),
        amountCentimes: record.amountCentimes,
        method: record.method,
        invoiceNumber: record.invoiceNumber,
        invoicePath: record.invoiceKey === null ? null : fileGatewayPath(record.invoiceKey),
        bankReference: record.bankReference,
        confirmedByName:
          record.confirmedById === null ? null : (confirmerNames.get(record.confirmedById) ?? null),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

function buildPaymentWhere(query: PaymentLedgerQuery): Prisma.PaymentWhereInput {
  const clauses: Prisma.PaymentWhereInput[] = [];

  if (query.method !== undefined) clauses.push({ method: query.method });
  if (query.courseId !== undefined) clauses.push({ request: { courseId: query.courseId } });

  if (query.search !== undefined) {
    clauses.push({
      OR: [
        { invoiceNumber: { contains: query.search } },
        { request: { reference: { contains: query.search } } },
        { request: { user: { fullName: { contains: query.search } } } },
        { request: { user: { email: { contains: query.search } } } },
      ],
    });
  }

  if (query.receivedFrom !== undefined || query.receivedTo !== undefined) {
    clauses.push({
      receivedAt: {
        ...(query.receivedFrom === undefined ? {} : { gte: query.receivedFrom }),
        ...(query.receivedTo === undefined ? {} : { lte: query.receivedTo }),
      },
    });
  }

  return clauses.length === 0 ? {} : { AND: clauses };
}

/**
 * Period totals — a `SUM` and a `COUNT` over the very same `WHERE` the table
 * uses, plus the same split by payment method. Nothing is extrapolated,
 * projected or averaged: §17.4's revenue reports beyond this need columns this
 * milestone does not have.
 */
export interface PaymentTotals {
  readonly count: number;
  readonly totalCentimes: number;
  readonly byMethod: readonly {
    readonly method: PaymentMethod;
    readonly count: number;
    readonly totalCentimes: number;
  }[];
}

export async function paymentTotals(
  rawQuery: unknown,
  actor: PermissionUser,
): Promise<QueryResult<PaymentTotals>> {
  if (!can(actor, 'payment.verify')) return FORBIDDEN;

  const parsed = paymentLedgerQuerySchema.safeParse(rawQuery);
  if (!parsed.success) return INVALID;

  const where = buildPaymentWhere(parsed.data);

  const [overall, grouped] = await Promise.all([
    db.payment.aggregate({ where, _count: { _all: true }, _sum: { amountCentimes: true } }),
    db.payment.groupBy({
      by: ['method'],
      where,
      _count: { _all: true },
      _sum: { amountCentimes: true },
    }),
  ]);

  return {
    ok: true,
    data: {
      count: overall._count._all,
      totalCentimes: overall._sum.amountCentimes ?? 0,
      byMethod: PAYMENT_METHOD_VALUES.map((method) => {
        const group = grouped.find((entry) => entry.method === method);
        return {
          method,
          count: group?._count._all ?? 0,
          totalCentimes: group?._sum.amountCentimes ?? 0,
        };
      }).filter((entry) => entry.count > 0),
    },
  };
}
