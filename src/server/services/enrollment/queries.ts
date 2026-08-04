/**
 * Read side of the §9.2 domain: the student timeline (§13.3), the admin
 * verification queue (§17.3), and the authorization oracle of the private
 * file gateway (§19.1) — route handlers may not touch Prisma (§5), so the
 * gateway asks here.
 */

import { z } from 'zod';
import type { Prisma, RequestStatus, TransferType } from '@prisma/client';

import { db } from '@/server/db';
import type { SessionUser } from '@/server/auth/session';
import { scopeOfKey, type StorageScope } from '@/server/storage';
import { recordAuditSafely } from '@/server/services/audit';
import { allowedEvents, isFinalRequestStatus, type RequestEvent } from './state-machine';
import { courseTitleFor, REQUEST_SUBJECT_SELECT } from './requests';

/* -------------------------------------------------------------------------- */
/* Student — « Mes demandes » (§13.3)                                          */
/* -------------------------------------------------------------------------- */

export interface RequestTimelineEntry {
  readonly id: string;
  readonly type: string;
  readonly message: string | null;
  readonly createdAt: Date;
}

export interface StudentRequestCard {
  readonly id: string;
  readonly reference: string;
  readonly status: RequestStatus;
  readonly isFinal: boolean;
  readonly courseSlug: string | null;
  readonly courseTitle: string;
  readonly priceCentimes: number;
  readonly discountCentimes: number;
  readonly amountDueCentimes: number;
  readonly transferType: TransferType;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly receiptUploadedAt: Date | null;
  /** Gateway path of their own receipt, or `null` before any upload. */
  readonly receiptPath: string | null;
  /** The admin's message when the request sits in `INFO_REQUESTED`. */
  readonly infoRequestedMessage: string | null;
  readonly rejectionReason: string | null;
  /** Gateway path of the invoice once approved and generated. */
  readonly invoicePath: string | null;
  readonly invoiceNumber: string | null;
  readonly events: readonly RequestTimelineEntry[];
}

/** Path served by `GET /api/files/[...key]` for a stored key. */
export function fileGatewayPath(storageKey: string): string {
  return `/api/files/${storageKey}`;
}

/**
 * Every request of one student, newest first — the §13.3 card list. Scoped by
 * the owner in the query itself; there is no admin variant of this shape.
 */
export async function listMyRequests(userId: string): Promise<readonly StudentRequestCard[]> {
  const rows = await db.enrollmentRequest.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      ...REQUEST_SUBJECT_SELECT,
      priceCentimes: true,
      discountCentimes: true,
      createdAt: true,
      receiptKey: true,
      receiptUploadedAt: true,
      infoRequestedMessage: true,
      rejectionReason: true,
      payment: { select: { invoiceKey: true, invoiceNumber: true } },
      events: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, type: true, message: true, createdAt: true },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    status: row.status,
    isFinal: isFinalRequestStatus(row.status),
    courseSlug: row.course?.slug ?? null,
    courseTitle: courseTitleFor(row, row.user.locale),
    priceCentimes: row.priceCentimes,
    discountCentimes: row.discountCentimes,
    amountDueCentimes: row.amountDueCentimes,
    transferType: row.transferType,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    receiptUploadedAt: row.receiptUploadedAt,
    receiptPath: row.receiptKey === null ? null : fileGatewayPath(row.receiptKey),
    infoRequestedMessage: row.status === 'INFO_REQUESTED' ? row.infoRequestedMessage : null,
    rejectionReason: row.status === 'REJECTED' ? row.rejectionReason : null,
    invoicePath:
      row.payment?.invoiceKey == null ? null : fileGatewayPath(row.payment.invoiceKey),
    invoiceNumber: row.payment?.invoiceNumber ?? null,
    events: row.events,
  }));
}

/* -------------------------------------------------------------------------- */
/* Admin — the §17.3 queue                                                     */
/* -------------------------------------------------------------------------- */

export const REQUEST_SORT_FIELDS = ['createdAt', 'expiresAt', 'amountDueCentimes'] as const;
export type RequestSortField = (typeof REQUEST_SORT_FIELDS)[number];

export const REQUEST_PAGE_SIZE_DEFAULT = 25;
export const REQUEST_PAGE_SIZE_MAX = 100;

/** `.strict()` — consumed by the admin UI's server component and actions. */
export const requestListQuerySchema = z
  .object({
    status: z
      .enum(['AWAITING_RECEIPT', 'UNDER_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'])
      .optional(),
    courseId: z.string().min(1).max(64).optional(),
    /** Free-text over reference, student name and e-mail. */
    search: z.string().trim().max(120).optional(),
    /** Only requests whose receipt digest matches another request (§17.3 flag). */
    duplicatesOnly: z.boolean().optional(),
    sort: z.enum(REQUEST_SORT_FIELDS).default('createdAt'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(REQUEST_PAGE_SIZE_MAX).default(REQUEST_PAGE_SIZE_DEFAULT),
  })
  .strict();

export type RequestListQuery = z.output<typeof requestListQuerySchema>;

export interface AdminRequestRow {
  readonly id: string;
  readonly reference: string;
  readonly status: RequestStatus;
  readonly studentId: string;
  readonly studentName: string;
  readonly studentEmail: string;
  readonly courseSlug: string | null;
  readonly courseTitle: string;
  readonly amountDueCentimes: number;
  readonly transferType: TransferType;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly receiptUploadedAt: Date | null;
  /** §9.2 rule 6 — « Justificatif déjà utilisé », with the original to link to. */
  readonly duplicateOfRequestId: string | null;
}

export interface AdminRequestPage {
  readonly rows: readonly AdminRequestRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** Server-side pagination for the headless DataTable (§17.3). */
export async function listRequestsForAdmin(query: RequestListQuery): Promise<AdminRequestPage> {
  const where: Prisma.EnrollmentRequestWhereInput = {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.courseId === undefined ? {} : { courseId: query.courseId }),
    ...(query.search === undefined || query.search === ''
      ? {}
      : {
          OR: [
            { reference: { contains: query.search } },
            { user: { fullName: { contains: query.search } } },
            { user: { email: { contains: query.search } } },
          ],
        }),
  };

  const [total, rows] = await Promise.all([
    db.enrollmentRequest.count({ where }),
    db.enrollmentRequest.findMany({
      where,
      orderBy: { [query.sort]: query.direction },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        reference: true,
        status: true,
        amountDueCentimes: true,
        transferType: true,
        createdAt: true,
        expiresAt: true,
        receiptUploadedAt: true,
        receiptSha256: true,
        user: { select: { id: true, fullName: true, email: true } },
        course: {
          select: { slug: true, translations: { select: { locale: true, title: true } } },
        },
      },
    }),
  ]);

  const duplicates = await duplicateIndex(rows.map((row) => ({ id: row.id, sha256: row.receiptSha256 })));

  let mapped: AdminRequestRow[] = rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    status: row.status,
    studentId: row.user.id,
    studentName: row.user.fullName,
    studentEmail: row.user.email,
    courseSlug: row.course?.slug ?? null,
    courseTitle:
      row.course?.translations.find((t) => t.locale === 'fr')?.title ?? row.course?.slug ?? '—',
    amountDueCentimes: row.amountDueCentimes,
    transferType: row.transferType,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    receiptUploadedAt: row.receiptUploadedAt,
    duplicateOfRequestId: duplicates.get(row.id) ?? null,
  }));

  if (query.duplicatesOnly === true) {
    mapped = mapped.filter((row) => row.duplicateOfRequestId !== null);
  }

  return { rows: mapped, total, page: query.page, pageSize: query.pageSize };
}

/**
 * For each request, the id of the OLDEST other request sharing its receipt
 * digest — `null` when the digest is unique (§9.2 rule 6: flag, never reject).
 */
async function duplicateIndex(
  rows: readonly { readonly id: string; readonly sha256: string | null }[],
): Promise<ReadonlyMap<string, string>> {
  const digests = [...new Set(rows.map((row) => row.sha256).filter((v): v is string => v !== null))];
  if (digests.length === 0) return new Map();

  const matches = await db.enrollmentRequest.findMany({
    where: { receiptSha256: { in: digests } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, receiptSha256: true },
  });

  const byDigest = new Map<string, readonly string[]>();
  for (const match of matches) {
    if (match.receiptSha256 === null) continue;
    byDigest.set(match.receiptSha256, [...(byDigest.get(match.receiptSha256) ?? []), match.id]);
  }

  const result = new Map<string, string>();
  for (const row of rows) {
    if (row.sha256 === null) continue;
    const ids = byDigest.get(row.sha256) ?? [];
    const original = ids.find((id) => id !== row.id);
    if (original !== undefined && ids.length > 1) result.set(row.id, original);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Admin — one request, for the drawer                                         */
/* -------------------------------------------------------------------------- */

export interface AdminRequestDetail extends AdminRequestRow {
  readonly priceCentimes: number;
  readonly discountCentimes: number;
  readonly transferDate: Date | null;
  readonly transferBankRef: string | null;
  readonly studentMessage: string | null;
  readonly adminNote: string | null;
  readonly infoRequestedMessage: string | null;
  readonly rejectionReason: string | null;
  readonly receiptPath: string | null;
  readonly receiptMime: string | null;
  readonly receiptSizeBytes: number | null;
  readonly invoicePath: string | null;
  readonly invoiceNumber: string | null;
  readonly events: readonly RequestTimelineEntry[];
  /** What the machine allows from here — drives the drawer's buttons. */
  readonly allowedEvents: readonly RequestEvent[];
}

export async function getRequestForAdmin(requestId: string): Promise<AdminRequestDetail | null> {
  const row = await db.enrollmentRequest.findUnique({
    where: { id: requestId },
    select: {
      ...REQUEST_SUBJECT_SELECT,
      priceCentimes: true,
      discountCentimes: true,
      createdAt: true,
      receiptKey: true,
      receiptMime: true,
      receiptSizeBytes: true,
      receiptUploadedAt: true,
      transferDate: true,
      transferBankRef: true,
      studentMessage: true,
      adminNote: true,
      infoRequestedMessage: true,
      rejectionReason: true,
      payment: { select: { invoiceKey: true, invoiceNumber: true } },
      events: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, type: true, message: true, createdAt: true },
      },
    },
  });
  if (row === null) return null;

  const duplicates = await duplicateIndex([{ id: row.id, sha256: row.receiptSha256 }]);

  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    studentId: row.user.id,
    studentName: row.user.fullName,
    studentEmail: row.user.email,
    courseSlug: row.course?.slug ?? null,
    courseTitle: courseTitleFor(row, 'fr'),
    priceCentimes: row.priceCentimes,
    discountCentimes: row.discountCentimes,
    amountDueCentimes: row.amountDueCentimes,
    transferType: row.transferType,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    transferDate: row.transferDate,
    transferBankRef: row.transferBankRef,
    studentMessage: row.studentMessage,
    adminNote: row.adminNote,
    infoRequestedMessage: row.infoRequestedMessage,
    rejectionReason: row.rejectionReason,
    receiptUploadedAt: row.receiptUploadedAt,
    receiptPath: row.receiptKey === null ? null : fileGatewayPath(row.receiptKey),
    receiptMime: row.receiptMime,
    receiptSizeBytes: row.receiptSizeBytes,
    invoicePath:
      row.payment?.invoiceKey == null ? null : fileGatewayPath(row.payment.invoiceKey),
    invoiceNumber: row.payment?.invoiceNumber ?? null,
    events: row.events,
    duplicateOfRequestId: duplicates.get(row.id) ?? null,
    allowedEvents: allowedEvents(row.status),
  };
}

/* -------------------------------------------------------------------------- */
/* File-gateway authorization (§19.1, §9.2 rule 5)                             */
/* -------------------------------------------------------------------------- */

export type FileDecision =
  | {
      readonly allowed: true;
      readonly scope: StorageScope;
      /** Explicit `Content-Disposition` — §19.1 forbids guessing it later. */
      readonly disposition: string;
    }
  /** Deny reads as 404, never 403 — a foreign key must not be confirmable. */
  | { readonly allowed: false };

const DENIED: FileDecision = { allowed: false };

/**
 * May `user` read `key`?
 *
 * - `public/*` — anyone, session or not.
 * - `private/receipts/*` — the owning student, or ADMIN+. Admin reads are
 *   written to the audit log (§9.2 rule 5) — fire-and-forget, a read must not
 *   fail because auditing hiccuped.
 * - `private/invoices/*` — the student who paid, or ADMIN+ (also audited).
 * - Every other private scope belongs to a later milestone: denied until the
 *   milestone that serves it teaches this oracle its ownership rule.
 */
export async function authorizeFileRead(
  user: SessionUser | null,
  key: string,
  audit?: { readonly ip?: string | null; readonly userAgent?: string | null },
): Promise<FileDecision> {
  const scope = scopeOfKey(key);
  if (scope === null) return DENIED;

  if (scope.startsWith('public/')) {
    return { allowed: true, scope, disposition: 'inline' };
  }

  if (user === null) return DENIED;
  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

  if (scope === 'private/receipts') {
    const request = await db.enrollmentRequest.findFirst({
      where: { receiptKey: key },
      select: { id: true, reference: true, userId: true },
    });
    if (request === null) return DENIED;
    if (request.userId !== user.id && !isAdmin) return DENIED;

    if (isAdmin && request.userId !== user.id) {
      await recordAuditSafely({
        actorId: user.id,
        action: 'RECEIPT_VIEWED',
        entityType: 'EnrollmentRequest',
        entityId: request.id,
        summary: `Justificatif de la demande ${request.reference} consulté.`,
        ip: audit?.ip ?? null,
        userAgent: audit?.userAgent ?? null,
      });
    }
    return { allowed: true, scope, disposition: 'inline' };
  }

  if (scope === 'private/invoices') {
    const payment = await db.payment.findFirst({
      where: { invoiceKey: key },
      select: {
        id: true,
        invoiceNumber: true,
        request: { select: { userId: true } },
      },
    });
    if (payment === null) return DENIED;
    if (payment.request.userId !== user.id && !isAdmin) return DENIED;

    if (isAdmin && payment.request.userId !== user.id) {
      await recordAuditSafely({
        actorId: user.id,
        action: 'INVOICE_VIEWED',
        entityType: 'Payment',
        entityId: payment.id,
        summary: `Facture ${payment.invoiceNumber ?? payment.id} consultée.`,
        ip: audit?.ip ?? null,
        userAgent: audit?.userAgent ?? null,
      });
    }
    return {
      allowed: true,
      scope,
      disposition: `attachment; filename="${payment.invoiceNumber ?? 'facture'}.pdf"`,
    };
  }

  return DENIED;
}
