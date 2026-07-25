/**
 * Audit trail (spec §17.13, §20).
 *
 * Every state change an administrator can be asked about later — who validated
 * this account, who refused that payment, who opened a receipt — lands here as
 * one immutable row.
 *
 * ## Atomic with the change it records
 * `recordAudit` accepts a transaction client. An audit row that commits when the
 * mutation rolled back is a lie, and a mutation that commits without its audit
 * row is an unexplained change. Passing the same `tx` makes both impossible:
 *
 * ```ts
 * await transaction(async (tx) => {
 *   await tx.user.update({ where: { id }, data: { status: 'ACTIVE' } });
 *   await recordAudit({ …, diff: buildDiff(before, after) }, tx);
 * });
 * ```
 *
 * ## What goes in `diff`
 * Changed fields only — `{ before: { status: 'PENDING_APPROVAL' }, after: { status: 'ACTIVE' } }`.
 * Never a whole row: it bloats the table, and it is how a password hash or a
 * phone number ends up in a log that a wider audience can read. Use
 * {@link buildDiff}, which drops unchanged keys and refuses the redacted ones.
 *
 * ## Never throws
 * A failed audit write must not roll back the business operation *when it is
 * fire-and-forget outside a transaction* — but inside one it is deliberately
 * allowed to propagate, because there the whole unit is supposed to fail
 * together. {@link recordAuditSafely} is the fire-and-forget variant.
 */

// A value import, not a type-only one: `Prisma.DbNull` is a runtime sentinel.
import { Prisma } from '@prisma/client';

import { db } from '@/server/db';

/**
 * A Prisma client or an interactive-transaction client.
 *
 * `Prisma.TransactionClient` is `PrismaClient` minus `$transaction`/`$connect`,
 * so the singleton is structurally assignable to it and one parameter type
 * covers both callers.
 */
export type AuditDbClient = Prisma.TransactionClient;

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/** JSON-safe scalar an audit diff may carry. */
export type AuditScalar = string | number | boolean | null;

/** Snapshot of the fields that changed, on one side of a change. */
export type AuditSnapshot = Readonly<Record<string, AuditScalar>>;

export interface AuditDiff {
  readonly before: AuditSnapshot;
  readonly after: AuditSnapshot;
}

export interface RecordAuditInput {
  /** The acting user, or `null` for a system action (cron, webhook, self-service signup). */
  readonly actorId?: string | null;
  /** Screaming-snake verb, e.g. `ACCOUNT_APPROVED`. Filterable in §17.13. */
  readonly action: string;
  /** Model name the action applies to, e.g. `User`, `EnrollmentRequest`. */
  readonly entityType: string;
  readonly entityId?: string | null;
  /**
   * One readable French sentence for the journal and the live activity feed
   * (§17.1): « Vous avez validé le compte de Salma R. ». Built by the caller,
   * which is the only layer that knows the names involved.
   */
  readonly summary?: string | null;
  /** Changed fields only. See {@link buildDiff}. */
  readonly diff?: AuditDiff | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  /** Injectable clock for tests; defaults to the database's `now()`. */
  readonly createdAt?: Date;
}

/* -------------------------------------------------------------------------- */
/* Redaction                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Field names that must never appear in a diff, whatever the caller passes
 * (§20 "Logging: … with a redaction list"). Matching is case-insensitive and
 * substring-based, so `passwordHash`, `twoFactorSecret` and `sessionToken` are
 * all caught.
 */
const REDACTED_FRAGMENTS: readonly string[] = [
  'password',
  'secret',
  'token',
  'cookie',
  'authorization',
  'apikey',
  'api_key',
];

/** Placeholder written in place of a redacted value, so the *fact* of the change survives. */
export const REDACTED = '[redacted]';

function isRedacted(field: string): boolean {
  const lower = field.toLowerCase();
  return REDACTED_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/* -------------------------------------------------------------------------- */
/* Diff building                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build a minimal diff: only keys whose value actually changed, with sensitive
 * ones reduced to {@link REDACTED} on both sides.
 *
 * `Date` values are serialised to ISO strings — the column is JSON, and a `Date`
 * would round-trip as an opaque object. `undefined` means "not part of this
 * change" and is skipped on both sides.
 *
 * @param fields Restrict the comparison to these keys. Omit to compare the union
 *               of the keys present in `before` and `after`.
 */
export function buildDiff(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  fields?: readonly string[],
): AuditDiff | null {
  const keys = fields ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];

  const beforeOut: Record<string, AuditScalar> = {};
  const afterOut: Record<string, AuditScalar> = {};
  let changed = false;

  for (const key of keys) {
    const previous = normalizeAuditValue(before[key]);
    const next = normalizeAuditValue(after[key]);
    if (previous === next) continue;

    changed = true;
    if (isRedacted(key)) {
      beforeOut[key] = REDACTED;
      afterOut[key] = REDACTED;
    } else {
      beforeOut[key] = previous;
      afterOut[key] = next;
    }
  }

  return changed ? { before: beforeOut, after: afterOut } : null;
}

/** Reduce any value to a JSON scalar the diff column can hold and compare by `===`. */
function normalizeAuditValue(value: unknown): AuditScalar {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  // Objects and arrays are summarised rather than embedded: a diff is a list of
  // changed fields, not a document store.
  return JSON.stringify(value);
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/** Longest summary we store. The column is TEXT; this keeps a runaway string out of it. */
const SUMMARY_MAX = 1_000;
/** User agents are attacker-controlled and can be arbitrarily long. */
const USER_AGENT_MAX = 512;

/**
 * Write one audit row.
 *
 * Pass `client` to commit it inside the transaction that performed the change.
 * Without it the row is written through the singleton, which is right for
 * read-only events (a receipt was viewed, an export was downloaded).
 */
export async function recordAudit(
  input: RecordAuditInput,
  client: AuditDbClient = db,
): Promise<void> {
  const diff = input.diff ?? null;

  await client.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: truncate(input.summary, SUMMARY_MAX),
      diff: diff === null ? Prisma.DbNull : toJsonObject(diff),
      ip: input.ip ?? null,
      userAgent: truncate(input.userAgent, USER_AGENT_MAX),
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    },
  });
}

/**
 * Fire-and-forget audit write for paths where losing the row is preferable to
 * failing the request — a file read, a page view, a diagnostics probe.
 *
 * Never use it for a state change: those must be atomic with their audit row,
 * which means {@link recordAudit} inside the transaction.
 */
export async function recordAuditSafely(
  input: RecordAuditInput,
  client: AuditDbClient = db,
): Promise<boolean> {
  try {
    await recordAudit(input, client);
    return true;
  } catch {
    return false;
  }
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Hand a typed diff to Prisma's `Json` column.
 *
 * The structural cast is unavoidable: `Prisma.InputJsonObject` is defined with
 * an index signature, which a precise interface is not assignable to even when
 * every value is JSON-safe. {@link normalizeAuditValue} is what guarantees that
 * it really is.
 */
function toJsonObject(diff: AuditDiff): Prisma.InputJsonObject {
  return { before: { ...diff.before }, after: { ...diff.after } } as Prisma.InputJsonObject;
}
