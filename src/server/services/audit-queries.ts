/**
 * Read model for `/admin/journal` — the §17.13 audit viewer.
 *
 * ## Read-only by construction
 * There is no update and no delete in this module, and there is no action file
 * that offers one. `AuditLog` is append-only: a journal a suspect can edit
 * answers no question worth asking. The only write path to that table is
 * `recordAudit`, inside the transaction that performed the change it describes.
 *
 * ## Two capabilities, not one (§8 row 17)
 * `auditLog.view` is the ADMIN "read" cell: who did what, when, on which
 * entity, with the French summary the writer composed. `auditLog.viewFull` is
 * the SUPER_ADMIN "full" cell, and it is what unlocks the **diff** — a settings
 * change carries the old and the new bank account in its `before`/`after`, and
 * §8 says an ADMIN may not see those. So the rows come back either way; the
 * diff is replaced by a flag when the actor is not allowed to read it.
 *
 * ## Everything is paginated and filtered in SQL
 * The table grows forever by design. Filtering, ordering and slicing happen in
 * the database, the page size is capped, and the count is issued against the
 * same `WHERE` as the page so « 25 sur 4 812 » describes one snapshot.
 */

import { z } from 'zod';
import type { Prisma } from '@prisma/client';

import { db } from '@/server/db';
import { can, type PermissionUser } from '@/server/auth/permissions';

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

export type AuditQueryResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: 'FORBIDDEN' | 'INVALID' };

const FORBIDDEN = { ok: false, code: 'FORBIDDEN' } as const;
const INVALID = { ok: false, code: 'INVALID' } as const;

export const AUDIT_PAGE_SIZE_DEFAULT = 25;
export const AUDIT_PAGE_SIZE_MAX = 100;

/** Everything `/admin/journal` may put in its URL. `.strict()` (§20). */
export const auditQuerySchema = z
  .object({
    actorId: z.string().min(1).max(64).optional(),
    action: z.string().min(1).max(80).optional(),
    entityType: z.string().min(1).max(80).optional(),
    entityId: z.string().min(1).max(64).optional(),
    /** Free text over the French summary. */
    search: z.string().trim().min(1).max(120).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(AUDIT_PAGE_SIZE_MAX)
      .default(AUDIT_PAGE_SIZE_DEFAULT),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export type AuditQuery = z.output<typeof auditQuerySchema>;

/** One changed field, already reduced to two strings the table can print. */
export interface AuditDiffField {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface AuditEntryRow {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  /** The French sentence the writer composed. `null` for older rows. */
  readonly summary: string | null;
  readonly createdAt: Date;
  readonly actorId: string | null;
  /** `null` for a system action — cron, webhook, self-service signup. */
  readonly actorName: string | null;
  readonly ip: string | null;
  /** Empty when the row carries no diff *or* when this actor may not read it. */
  readonly diff: readonly AuditDiffField[];
  /** `true` when a diff exists but `auditLog.viewFull` was not granted. */
  readonly diffRestricted: boolean;
}

export interface AuditPage {
  readonly rows: readonly AuditEntryRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  /** Mirrors `auditLog.viewFull`, so the page can say why diffs are hidden. */
  readonly canReadDiffs: boolean;
}

/* -------------------------------------------------------------------------- */
/* Diff decoding                                                               */
/* -------------------------------------------------------------------------- */

function scalarToText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '—' : value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(value);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/**
 * `AuditLog.diff` is a JSON column written by `buildDiff`, but it is data on
 * disk: a row written by an older shape, or by hand, must not crash the page.
 * Anything that is not `{ before, after }` decodes to no fields at all.
 */
function decodeDiff(raw: unknown): readonly AuditDiffField[] {
  const root = asRecord(raw);
  const before = asRecord(root['before']);
  const after = asRecord(root['after']);

  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return fields.map((field) => ({
    field,
    before: scalarToText(before[field]),
    after: scalarToText(after[field]),
  }));
}

/* -------------------------------------------------------------------------- */
/* List                                                                        */
/* -------------------------------------------------------------------------- */

function buildWhere(query: AuditQuery): Prisma.AuditLogWhereInput {
  const clauses: Prisma.AuditLogWhereInput[] = [];

  if (query.actorId !== undefined) clauses.push({ actorId: query.actorId });
  if (query.action !== undefined) clauses.push({ action: query.action });
  if (query.entityType !== undefined) clauses.push({ entityType: query.entityType });
  if (query.entityId !== undefined) clauses.push({ entityId: query.entityId });
  if (query.search !== undefined) clauses.push({ summary: { contains: query.search } });

  if (query.from !== undefined || query.to !== undefined) {
    clauses.push({
      createdAt: {
        ...(query.from === undefined ? {} : { gte: query.from }),
        ...(query.to === undefined ? {} : { lte: query.to }),
      },
    });
  }

  return clauses.length === 0 ? {} : { AND: clauses };
}

export async function listAuditEntries(
  rawQuery: unknown,
  actor: PermissionUser,
): Promise<AuditQueryResult<AuditPage>> {
  if (!can(actor, 'auditLog.view')) return FORBIDDEN;

  const parsed = auditQuerySchema.safeParse(rawQuery);
  if (!parsed.success) return INVALID;
  const query = parsed.data;

  const canReadDiffs = can(actor, 'auditLog.viewFull');
  const where = buildWhere(query);

  const [total, records] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      // `id` breaks ties: two rows written inside the same transaction share a
      // timestamp, and a page boundary that reshuffles between two requests
      // shows one of them twice and the other never.
      orderBy: [{ createdAt: query.sortDir }, { id: query.sortDir }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        createdAt: true,
        actorId: true,
        ip: true,
        diff: true,
        actor: { select: { fullName: true } },
      },
    }),
  ]);

  return {
    ok: true,
    data: {
      rows: records.map((record) => {
        const hasDiff = record.diff !== null && record.diff !== undefined;
        return {
          id: record.id,
          action: record.action,
          entityType: record.entityType,
          entityId: record.entityId,
          summary: record.summary,
          createdAt: record.createdAt,
          actorId: record.actorId,
          actorName: record.actor?.fullName ?? null,
          ip: record.ip,
          diff: canReadDiffs && hasDiff ? decodeDiff(record.diff) : [],
          diffRestricted: hasDiff && !canReadDiffs,
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
      canReadDiffs,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Filter options                                                              */
/* -------------------------------------------------------------------------- */

export interface AuditFilterOptions {
  readonly actions: readonly string[];
  readonly entityTypes: readonly string[];
  readonly actors: readonly { readonly id: string; readonly fullName: string }[];
}

/** How many distinct values a filter select may offer before it stops being one. */
const FACET_LIMIT = 100;

/**
 * The values the three selects offer, taken from the table itself.
 *
 * A hardcoded list of verbs would go stale the moment a milestone adds one, and
 * an action nobody has ever performed is a filter that can only ever return
 * nothing.
 */
export async function auditFilterOptions(
  actor: PermissionUser,
): Promise<AuditQueryResult<AuditFilterOptions>> {
  if (!can(actor, 'auditLog.view')) return FORBIDDEN;

  const [actions, entityTypes, actorRows] = await Promise.all([
    db.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' }, take: FACET_LIMIT }),
    db.auditLog.groupBy({ by: ['entityType'], orderBy: { entityType: 'asc' }, take: FACET_LIMIT }),
    db.user.findMany({
      where: { auditLogs: { some: {} } },
      orderBy: { fullName: 'asc' },
      take: FACET_LIMIT,
      select: { id: true, fullName: true },
    }),
  ]);

  return {
    ok: true,
    data: {
      actions: actions.map((entry) => entry.action),
      entityTypes: entityTypes.map((entry) => entry.entityType),
      actors: actorRows,
    },
  };
}
