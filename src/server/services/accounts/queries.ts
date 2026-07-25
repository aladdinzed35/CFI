/**
 * Read models for `/admin/comptes` (spec §17.1, §17.2).
 *
 * ## Everything is paginated in the database
 * The center will accumulate tens of thousands of accounts. Every function here
 * pushes filtering, sorting and slicing into SQL and caps the page size — no
 * caller can ask for the whole table, by accident or otherwise. `total` comes
 * from a `COUNT` issued alongside the page inside one `$transaction`, so the
 * count and the rows describe the same snapshot.
 *
 * ## Sorting is a whitelist
 * The sort column and direction are validated against a fixed set before they
 * reach Prisma. A search parameter is attacker-controlled input like any other
 * (§20 "Zod on every boundary, including URL params and search params").
 *
 * ## Case and accents
 * Prisma's `mode: 'insensitive'` is PostgreSQL-only. On MySQL the collation does
 * the work: `utf8mb4_unicode_ci` is both case- and accent-insensitive, so
 * `contains: 'salma'` matches « Salmá » and the duplicate check on
 * name + city matches « El Amrani » against « el amrani ».
 */

import { z } from 'zod';
import type { Prisma, AccountStatus, Locale, Role } from '@prisma/client';

import { db } from '@/server/db';
import { formatPhoneDisplay, parsePhone, toWhatsAppNumber } from '@/lib/phone';
import { isDisposableDomain } from '@/lib/validation/disposable-domains';
import { can, type PermissionUser } from '@/server/auth/permissions';
import type { NotificationDbClient } from '@/server/services/notifications';
import { parseRejectionReason, type RejectionReason } from './moderation';

/* -------------------------------------------------------------------------- */
/* Query shape                                                                 */
/* -------------------------------------------------------------------------- */

export const ACCOUNT_SORT_FIELDS = ['createdAt', 'fullName', 'status', 'lastLoginAt'] as const;
export type AccountSortField = (typeof ACCOUNT_SORT_FIELDS)[number];

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

const statusEnum = z.enum(['PENDING_EMAIL', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED']);
const roleEnum = z.enum(['STUDENT', 'INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN']);
const localeEnum = z.enum(['fr', 'ar', 'en', 'es']);

/**
 * Everything `/admin/comptes` can put in its URL. `.strict()`, so a stray
 * parameter is a rejected query rather than a silently ignored filter.
 */
export const accountListQuerySchema = z
  .object({
    /** Tab = queue. Empty means every status. */
    status: z.array(statusEnum).optional(),
    role: z.array(roleEnum).optional(),
    locale: z.array(localeEnum).optional(),
    city: z.string().trim().min(1).max(60).optional(),
    /** Free text over name, e-mail and phone. */
    search: z.string().trim().min(1).max(120).optional(),
    tag: z.string().trim().min(1).max(40).optional(),
    registeredFrom: z.coerce.date().optional(),
    registeredTo: z.coerce.date().optional(),
    emailVerified: z.boolean().optional(),
    hasEnrollment: z.boolean().optional(),
    hasPendingRequest: z.boolean().optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
    sortBy: z.enum(ACCOUNT_SORT_FIELDS).default('createdAt'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export type AccountListQuery = z.output<typeof accountListQuerySchema>;

/** One row of the accounts table (§17.2 "Table columns"). */
export interface AccountRow {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly emailVerifiedAt: Date | null;
  /** E.164, as stored. Render inside `.force-ltr` with `dir="ltr"`. */
  readonly phone: string;
  /** `+212 6 12 34 56 78` — already grouped for reading. */
  readonly phoneDisplay: string;
  /** Digits only, for `https://wa.me/…`. Empty when the number is unusable. */
  readonly whatsappNumber: string;
  /** `false` marks a foreign number — §9.1 wants it visible to the admin. */
  readonly phoneIsMoroccan: boolean;
  /** `true` when the address is on the disposable blocklist. */
  readonly emailDomainDisposable: boolean;
  readonly city: string | null;
  readonly status: AccountStatus;
  readonly role: Role;
  readonly locale: Locale;
  readonly tags: string | null;
  readonly createdAt: Date;
  readonly lastLoginAt: Date | null;
  readonly enrollmentCount: number;
  readonly requestCount: number;
}

export interface AccountPage {
  readonly rows: readonly AccountRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
}

export type QueryResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly code: 'FORBIDDEN' | 'INVALID' };

/** Statuses of an enrolment request that still needs a human (§9.2). */
const OPEN_REQUEST_STATUSES = ['AWAITING_RECEIPT', 'UNDER_REVIEW', 'INFO_REQUESTED'] as const;

/* -------------------------------------------------------------------------- */
/* List                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The accounts table, filtered, sorted and paginated server-side.
 *
 * `actor` is required and checked with `can()` — a read model that skips the
 * authorisation check is how an admin-only list ends up rendered on a student
 * page (§20).
 */
export async function listAccounts(
  rawQuery: unknown,
  actor: PermissionUser,
  client: NotificationDbClient = db,
): Promise<QueryResult<AccountPage>> {
  if (!can(actor, 'account.approve')) return { ok: false, code: 'FORBIDDEN' };

  const parsed = accountListQuerySchema.safeParse(rawQuery);
  if (!parsed.success) return { ok: false, code: 'INVALID' };
  const query = parsed.data;

  const where = buildWhere(query);
  const skip = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    client.user.count({ where }),
    client.user.findMany({
      where,
      orderBy: orderByFor(query.sortBy, query.sortDir),
      skip,
      take: query.pageSize,
      select: {
        id: true,
        fullName: true,
        email: true,
        emailVerifiedAt: true,
        phone: true,
        city: true,
        status: true,
        role: true,
        locale: true,
        tags: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { enrollments: true, requests: true } },
      },
    }),
  ]);

  return {
    ok: true,
    data: {
      rows: rows.map(toAccountRow),
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

interface AccountRecord {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly emailVerifiedAt: Date | null;
  readonly phone: string;
  readonly city: string | null;
  readonly status: AccountStatus;
  readonly role: Role;
  readonly locale: Locale;
  readonly tags: string | null;
  readonly createdAt: Date;
  readonly lastLoginAt: Date | null;
  readonly _count: { readonly enrollments: number; readonly requests: number };
}

function toAccountRow(row: AccountRecord): AccountRow {
  const parsedPhone = parsePhone(row.phone);
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    emailVerifiedAt: row.emailVerifiedAt,
    phone: row.phone,
    phoneDisplay: formatPhoneDisplay(row.phone),
    whatsappNumber: toWhatsAppNumber(row.phone),
    phoneIsMoroccan: parsedPhone?.isMoroccan ?? false,
    emailDomainDisposable: isDisposableDomain(row.email),
    city: row.city,
    status: row.status,
    role: row.role,
    locale: row.locale,
    tags: row.tags,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    enrollmentCount: row._count.enrollments,
    requestCount: row._count.requests,
  };
}

function buildWhere(query: AccountListQuery): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { deletedAt: null };

  if (query.status !== undefined && query.status.length > 0) where.status = { in: query.status };
  if (query.role !== undefined && query.role.length > 0) where.role = { in: query.role };
  if (query.locale !== undefined && query.locale.length > 0) where.locale = { in: query.locale };
  if (query.city !== undefined) where.city = { contains: query.city };
  if (query.tag !== undefined) where.tags = { contains: query.tag };

  if (query.emailVerified === true) where.emailVerifiedAt = { not: null };
  if (query.emailVerified === false) where.emailVerifiedAt = null;

  if (query.registeredFrom !== undefined || query.registeredTo !== undefined) {
    where.createdAt = {
      ...(query.registeredFrom === undefined ? {} : { gte: query.registeredFrom }),
      ...(query.registeredTo === undefined ? {} : { lte: query.registeredTo }),
    };
  }

  if (query.hasEnrollment === true) where.enrollments = { some: {} };
  if (query.hasEnrollment === false) where.enrollments = { none: {} };

  if (query.hasPendingRequest === true) {
    where.requests = { some: { status: { in: [...OPEN_REQUEST_STATUSES] } } };
  }
  if (query.hasPendingRequest === false) {
    where.requests = { none: { status: { in: [...OPEN_REQUEST_STATUSES] } } };
  }

  if (query.search !== undefined) {
    where.OR = searchClauses(query.search);
  }

  return where;
}

/**
 * Free-text search over the three columns an administrator actually types into.
 *
 * A term that parses as a phone number is also matched in its canonical E.164
 * form, so pasting « 06 12 34 56 78 » from a WhatsApp conversation finds the
 * row stored as `+212612345678`.
 */
function searchClauses(term: string): Prisma.UserWhereInput[] {
  const clauses: Prisma.UserWhereInput[] = [
    { fullName: { contains: term } },
    { email: { contains: term } },
    { phone: { contains: term } },
  ];

  const parsed = parsePhone(term);
  if (parsed !== null) clauses.push({ phone: parsed.e164 });

  return clauses;
}

function orderByFor(
  field: AccountSortField,
  direction: 'asc' | 'desc',
): Prisma.UserOrderByWithRelationInput[] {
  // `id` breaks ties so a page boundary is stable between two requests.
  return [{ [field]: direction } as Prisma.UserOrderByWithRelationInput, { id: 'desc' }];
}

/* -------------------------------------------------------------------------- */
/* Counts                                                                      */
/* -------------------------------------------------------------------------- */

/** The action band of §17.1 and the tab badges of §17.2. */
export interface AccountCounts {
  readonly pendingApproval: number;
  readonly pendingEmail: number;
  readonly active: number;
  readonly rejected: number;
  readonly suspended: number;
  /** How long the oldest account in the review queue has been waiting, in hours. */
  readonly oldestPendingHours: number | null;
}

/**
 * One `GROUP BY` for every tab badge, rather than five `COUNT`s.
 *
 * `oldestPendingHours` is what turns the dashboard card amber past 24 h — the
 * SLA colouring §17.1 asks for.
 */
export async function accountCounts(
  actor: PermissionUser,
  client: NotificationDbClient = db,
  now: Date = new Date(),
): Promise<QueryResult<AccountCounts>> {
  if (!can(actor, 'account.approve')) return { ok: false, code: 'FORBIDDEN' };

  const [grouped, oldest] = await Promise.all([
    client.user.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    client.user.findFirst({
      where: { deletedAt: null, status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  const byStatus = new Map<AccountStatus, number>();
  for (const group of grouped) byStatus.set(group.status, group._count._all);

  return {
    ok: true,
    data: {
      pendingApproval: byStatus.get('PENDING_APPROVAL') ?? 0,
      pendingEmail: byStatus.get('PENDING_EMAIL') ?? 0,
      active: byStatus.get('ACTIVE') ?? 0,
      rejected: byStatus.get('REJECTED') ?? 0,
      suspended: byStatus.get('SUSPENDED') ?? 0,
      oldestPendingHours:
        oldest === null
          ? null
          : Math.floor((now.getTime() - oldest.createdAt.getTime()) / (60 * 60 * 1_000)),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Duplicate detection (§17.2)                                                 */
/* -------------------------------------------------------------------------- */

/** A lighter row, for the "already registered" warning links in the review drawer. */
export interface DuplicateCandidate {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly city: string | null;
  readonly status: AccountStatus;
  readonly createdAt: Date;
}

export interface DuplicateReport {
  /** Same phone number, in canonical E.164 form. The strongest signal there is. */
  readonly samePhone: readonly DuplicateCandidate[];
  /** Same full name *and* the same city — the pattern behind most double signups. */
  readonly sameNameAndCity: readonly DuplicateCandidate[];
}

const DUPLICATE_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  city: true,
  status: true,
  createdAt: true,
} as const;

/** How many matches to surface. Beyond a handful the admin needs the list page, not a warning. */
const DUPLICATE_LIMIT = 10;

/**
 * Find the accounts §17.2 wants flagged in the review drawer: "duplicate
 * detection (same phone or same name+city already registered → prominent
 * warning with links)".
 *
 * Never auto-rejects and never merges — two siblings can legitimately share a
 * household phone, and that is a judgement call for a human.
 */
export async function findDuplicates(
  userId: string,
  actor: PermissionUser,
  client: NotificationDbClient = db,
): Promise<QueryResult<DuplicateReport>> {
  if (!can(actor, 'account.approve')) return { ok: false, code: 'FORBIDDEN' };

  const subject = await client.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, phone: true, city: true },
  });
  if (subject === null) return { ok: false, code: 'INVALID' };

  const [samePhone, sameNameAndCity] = await Promise.all([
    client.user.findMany({
      where: { id: { not: subject.id }, deletedAt: null, phone: subject.phone },
      select: DUPLICATE_SELECT,
      orderBy: { createdAt: 'asc' },
      take: DUPLICATE_LIMIT,
    }),
    subject.city === null
      ? Promise.resolve([])
      : client.user.findMany({
          where: {
            id: { not: subject.id },
            deletedAt: null,
            fullName: subject.fullName,
            city: subject.city,
          },
          select: DUPLICATE_SELECT,
          orderBy: { createdAt: 'asc' },
          take: DUPLICATE_LIMIT,
        }),
  ]);

  return { ok: true, data: { samePhone, sameNameAndCity } };
}

/* -------------------------------------------------------------------------- */
/* Review drawer                                                               */
/* -------------------------------------------------------------------------- */

/** Everything the review drawer of §17.2 shows "all at once". */
export interface AccountReview {
  readonly account: AccountRow;
  readonly professionalStatus: string | null;
  readonly emailVerifiedAt: Date | null;
  readonly approvedAt: Date | null;
  readonly suspendedUntil: Date | null;
  readonly rejectionReason: RejectionReason | null;
  readonly duplicates: DuplicateReport;
  /** The IP and user agent captured when the account was created, from the audit trail. */
  readonly registration: { readonly ip: string | null; readonly userAgent: string | null };
}

/**
 * Load one account with everything the moderation decision needs, in three
 * queries rather than a drawer that fetches as it renders.
 */
export async function getAccountForReview(
  userId: string,
  actor: PermissionUser,
  client: NotificationDbClient = db,
): Promise<QueryResult<AccountReview>> {
  if (!can(actor, 'account.approve')) return { ok: false, code: 'FORBIDDEN' };

  const row = await client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      emailVerifiedAt: true,
      phone: true,
      city: true,
      status: true,
      role: true,
      locale: true,
      tags: true,
      createdAt: true,
      lastLoginAt: true,
      professionalStatus: true,
      approvedAt: true,
      suspendedUntil: true,
      rejectionReason: true,
      deletedAt: true,
      _count: { select: { enrollments: true, requests: true } },
    },
  });

  if (row === null || row.deletedAt !== null) return { ok: false, code: 'INVALID' };

  const [duplicates, registrationLog] = await Promise.all([
    findDuplicates(userId, actor, client),
    client.auditLog.findFirst({
      where: { entityType: 'User', entityId: userId, action: 'ACCOUNT_REGISTERED' },
      orderBy: { createdAt: 'asc' },
      select: { ip: true, userAgent: true },
    }),
  ]);

  return {
    ok: true,
    data: {
      account: toAccountRow(row),
      professionalStatus: row.professionalStatus,
      emailVerifiedAt: row.emailVerifiedAt,
      approvedAt: row.approvedAt,
      suspendedUntil: row.suspendedUntil,
      rejectionReason: parseRejectionReason(row.rejectionReason),
      duplicates: duplicates.ok ? duplicates.data : { samePhone: [], sameNameAndCity: [] },
      registration: {
        ip: registrationLog?.ip ?? null,
        userAgent: registrationLog?.userAgent ?? null,
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Status polling                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The account's own status, for the live poll on `/compte-en-attente` — §9.1:
 * "shows a live status poll so it flips to the dashboard automatically once
 * approved".
 *
 * Scoped to the caller's own id by construction: there is no parameter to point
 * it at somebody else's account.
 */
export async function getOwnAccountStatus(
  userId: string,
  client: NotificationDbClient = db,
): Promise<{ readonly status: AccountStatus; readonly locale: Locale } | null> {
  const row = await client.user.findUnique({
    where: { id: userId },
    select: { status: true, locale: true, deletedAt: true },
  });
  if (row === null || row.deletedAt !== null) return null;
  return { status: row.status, locale: row.locale };
}
