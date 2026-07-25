/**
 * The durable queue (§19.5).
 *
 * Backed by the `Job` table and nothing else: no Redis, no second process, no
 * broker. CFI runs as one long-lived Node process against one MySQL database
 * (§2 C1), so the database *is* the queue — and a job that survives a restart
 * is worth far more here than a job that dispatches a millisecond faster.
 *
 * This module is the write side: put work in, ask how much is waiting. Claiming
 * and running live in `runner.ts`.
 */

import type { Prisma } from '@prisma/client';
import { db } from '@/server/db';
import { assertJobPayload, DEFAULT_MAX_ATTEMPTS, type JobPayloads, type JobType } from './types';

export interface EnqueueOptions {
  /**
   * Earliest moment the job may run. A past date (the default) means "as soon
   * as the next `drain` comes round".
   */
  readonly runAfter?: Date;
  /** Attempts before the job is marked `FAILED`. Defaults to {@link DEFAULT_MAX_ATTEMPTS}. */
  readonly maxAttempts?: number;
}

export interface EnqueuedJob {
  readonly id: string;
  readonly type: JobType;
  readonly runAfter: Date;
  readonly maxAttempts: number;
}

const MAX_ATTEMPTS_CEILING = 10;

/**
 * Put a job on the queue.
 *
 * The payload is validated **here**, against the schema for its type, so a
 * malformed notification fails inside the request that created it — with a
 * stack trace pointing at the real culprit — instead of failing three times
 * inside a cron run at four in the morning.
 *
 * ```ts
 * await enqueue('SEND_EMAIL', {
 *   to: user.email,
 *   template: 'account-approved',
 *   props: { fullName: user.fullName, loginUrl, catalogUrl },
 *   locale: user.locale,
 *   relatedType: 'User',
 *   relatedId: user.id,
 * });
 * ```
 *
 * Enqueue inside the same `transaction()` as the business write whenever the
 * two must agree — a job that announces an approval that was rolled back is
 * worse than no job at all. Pass the transaction client through `client`.
 */
export async function enqueue<K extends JobType>(
  type: K,
  payload: JobPayloads[K],
  options: EnqueueOptions = {},
  client: Pick<typeof db, 'job'> = db,
): Promise<EnqueuedJob> {
  assertJobPayload(type, payload);

  const runAfter = options.runAfter ?? new Date();
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);

  const job = await client.job.create({
    data: {
      type,
      // Prisma's `Json` input rejects `undefined` inside the value; a payload
      // that round-trips through `JSON.parse(JSON.stringify(…))` is exactly
      // what the runner will read back, so store precisely that.
      payload: toJsonValue(payload),
      runAfter,
      maxAttempts,
    },
    select: { id: true, runAfter: true, maxAttempts: true },
  });

  return { id: job.id, type, runAfter: job.runAfter, maxAttempts: job.maxAttempts };
}

/**
 * Enqueue several jobs of the same type in one round trip. Every payload is
 * validated before anything is written, so a bad one in the middle does not
 * leave half a batch behind.
 */
export async function enqueueMany<K extends JobType>(
  type: K,
  payloads: readonly JobPayloads[K][],
  options: EnqueueOptions = {},
  client: Pick<typeof db, 'job'> = db,
): Promise<number> {
  if (payloads.length === 0) return 0;
  for (const payload of payloads) assertJobPayload(type, payload);

  const runAfter = options.runAfter ?? new Date();
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);

  const created = await client.job.createMany({
    data: payloads.map((payload) => ({
      type,
      payload: toJsonValue(payload),
      runAfter,
      maxAttempts,
    })),
  });

  return created.count;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Diagnostics
 *
 * `/api/health` and the admin diagnostics page need these numbers, and §5
 * forbids a route handler from importing Prisma directly — so the queue, which
 * already owns the `Job` table, exposes them.
 * ────────────────────────────────────────────────────────────────────────── */

/** Jobs waiting to run — the `queuedJobs` field of `/api/health` (§24.4). */
export function countQueuedJobs(): Promise<number> {
  return db.job.count({ where: { status: 'QUEUED' } });
}

/** Jobs that exhausted their attempts within `windowMs`. Feeds the §18 alert #26. */
export function countFailedJobs(windowMs: number): Promise<number> {
  return db.job.count({
    where: { status: 'FAILED', updatedAt: { gte: new Date(Date.now() - windowMs) } },
  });
}

/**
 * Cheapest possible reachability probe for the database.
 *
 * `SELECT 1` touches no table, so it stays honest even while a migration is
 * running. Never throws: `/api/health` reports `db: 'fail'` and answers 503
 * rather than crashing on the way to saying the database is down.
 */
export async function pingDatabase(): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Internals
 * ────────────────────────────────────────────────────────────────────────── */

function normalizeMaxAttempts(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value)) return DEFAULT_MAX_ATTEMPTS;
  return Math.min(Math.max(1, value), MAX_ATTEMPTS_CEILING);
}

/**
 * Narrows a validated payload to what Prisma accepts in a `Json` column.
 *
 * The round trip is deliberate rather than a cast: it drops `undefined`
 * properties (which Prisma rejects) and guarantees the runner reads back
 * exactly the value that was stored.
 */
function toJsonValue(payload: unknown): Prisma.InputJsonValue {
  const serialized: unknown = JSON.parse(JSON.stringify(payload));
  if (serialized === null || typeof serialized !== 'object') {
    throw new Error('Un payload de tâche doit être un objet JSON.');
  }
  return serialized as Prisma.InputJsonObject;
}
