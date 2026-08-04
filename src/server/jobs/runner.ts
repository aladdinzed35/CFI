/**
 * The job runner — the read side of the queue (§19.5).
 *
 * ## Claiming without `SKIP LOCKED`
 * The canonical recipe is `SELECT … FOR UPDATE SKIP LOCKED`. It is not
 * available on every MySQL-compatible server this app might be deployed
 * against, so claiming is done with a compare-and-set instead:
 *
 * 1. read up to `limit` candidate ids (`QUEUED`, due, unlocked);
 * 2. `UPDATE job SET lockedAt = <stamp>, status = 'RUNNING', attempts = attempts + 1
 *    WHERE id IN (…) AND status = 'QUEUED' AND lockedAt IS NULL`;
 * 3. re-read the rows that actually carry `<stamp>`.
 *
 * Step 2 is atomic per row: two concurrent drains racing for the same id both
 * try to update it, MySQL serialises them, and the loser matches zero rows.
 * Step 3 is exact because `<stamp>` is drawn from {@link nextLockStamp}, a
 * strictly increasing per-process clock — two drains in the same millisecond
 * still get different stamps, so neither can re-read the other's rows.
 *
 * `attempts` is incremented at *claim* time, not at completion. A process that
 * dies mid-job must not be able to retry it forever.
 *
 * ## Stale locks
 * A crash leaves a row `RUNNING` with a `lockedAt` nobody will ever clear. Each
 * drain first releases anything locked longer than {@link STALE_LOCK_MS} back
 * to `QUEUED`. This is why every handler must be idempotent: a reclaimed job
 * may well have already done its work.
 *
 * ## Budget
 * A drain runs inside an HTTP request from cron. It stops claiming new work
 * once {@link DRAIN_BUDGET_MS} is spent and releases anything it claimed but
 * never started — with the attempt refunded, since nothing was tried.
 */

import { Prisma } from '@prisma/client';
import { db } from '@/server/db';
import { backoffMs, isJobType, type JobHandler, type JobResult, type JobType } from './types';
import { sendEmailHandler } from './handlers/send-email';
import { generateInvoiceHandler } from './handlers/generate-invoice';

/* ────────────────────────────────────────────────────────────────────────────
 * Registry
 * ────────────────────────────────────────────────────────────────────────── */

/** One handler per job type. Exhaustive: a new `JobType` will not compile without one. */
const handlers: Record<JobType, JobHandler> = {
  SEND_EMAIL: sendEmailHandler,
  GENERATE_INVOICE: generateInvoiceHandler,
};

/* ────────────────────────────────────────────────────────────────────────────
 * Tuning
 * ────────────────────────────────────────────────────────────────────────── */

/** §19.5: `drain` claims up to 25 jobs per run, every 2 minutes. */
export const DEFAULT_DRAIN_LIMIT = 25;

/** A job still `RUNNING` after this long is assumed orphaned by a crash. */
export const STALE_LOCK_MS = 15 * 60_000;

/** Wall-clock budget for one drain, comfortably inside any proxy read timeout. */
export const DRAIN_BUDGET_MS = 45_000;

/** Jobs in flight at once. Matched to the SMTP pool so a batch of emails stays polite. */
export const DRAIN_CONCURRENCY = 3;

/* ────────────────────────────────────────────────────────────────────────────
 * Summary
 * ────────────────────────────────────────────────────────────────────────── */

export type JobOutcome = 'DONE' | 'RETRY' | 'FAILED';

export interface JobRunReport {
  readonly id: string;
  readonly type: string;
  readonly attempt: number;
  readonly outcome: JobOutcome;
  readonly durationMs: number;
  /** Handler-supplied detail on success — recipient counts, ids, … */
  readonly result: JobResult | null;
  /** Credential-free message on failure. */
  readonly error: string | null;
  /** When the next attempt becomes eligible, for `RETRY`. */
  readonly nextRunAt: string | null;
}

export interface DrainSummary {
  readonly job: 'drain';
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  /** Stale locks released back to `QUEUED` before claiming. */
  readonly reclaimed: number;
  readonly claimed: number;
  readonly succeeded: number;
  readonly retried: number;
  readonly failed: number;
  /** Claimed but not started before the budget ran out; released, attempt refunded. */
  readonly released: number;
  /** `true` when the drain stopped on its time budget rather than on an empty queue. */
  readonly budgetExhausted: boolean;
  /** Jobs still `QUEUED` and due right now — a persistent backlog is a signal. */
  readonly remaining: number;
  readonly runs: readonly JobRunReport[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Lock stamps
 * ────────────────────────────────────────────────────────────────────────── */

let lastStamp = 0;

/**
 * A `lockedAt` value unique to this claim.
 *
 * Strictly increasing, and never behind the wall clock by more than the number
 * of claims made inside a single millisecond — so it still reads as a real
 * timestamp for staleness purposes, while being unique enough to identify
 * exactly the rows one drain claimed.
 */
function nextLockStamp(): Date {
  const now = Date.now();
  lastStamp = now > lastStamp ? now : lastStamp + 1;
  return new Date(lastStamp);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Drain
 * ────────────────────────────────────────────────────────────────────────── */

export interface DrainOptions {
  readonly limit?: number;
  readonly budgetMs?: number;
  readonly concurrency?: number;
}

/**
 * Claim due jobs, run them, and report what happened.
 *
 * Never throws for a job-level failure — a single broken handler must not abort
 * the batch or make the cron endpoint look down. It only propagates if the
 * database itself is unreachable.
 */
export async function drain(
  limitOrOptions: number | DrainOptions = DEFAULT_DRAIN_LIMIT,
): Promise<DrainSummary> {
  const options: DrainOptions =
    typeof limitOrOptions === 'number' ? { limit: limitOrOptions } : limitOrOptions;

  const limit = clamp(options.limit ?? DEFAULT_DRAIN_LIMIT, 1, 200);
  const budgetMs = clamp(options.budgetMs ?? DRAIN_BUDGET_MS, 1_000, 300_000);
  const concurrency = clamp(options.concurrency ?? DRAIN_CONCURRENCY, 1, 10);

  const startedAt = new Date();
  const deadline = startedAt.getTime() + budgetMs;

  const reclaimed = await reclaimStaleLocks();
  const claimed = await claimJobs(limit);

  const runs: JobRunReport[] = [];
  const released: string[] = [];
  let cursor = 0;
  let budgetExhausted = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const job = claimed[index];
      if (job === undefined) return;

      if (Date.now() >= deadline) {
        budgetExhausted = true;
        released.push(job.id);
        continue;
      }

      runs.push(await runClaimedJob(job));
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, claimed.length) }, worker));

  if (released.length > 0) await releaseUnstarted(released);

  const finishedAt = new Date();
  const summary: DrainSummary = {
    job: 'drain',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    reclaimed,
    claimed: claimed.length,
    succeeded: runs.filter((run) => run.outcome === 'DONE').length,
    retried: runs.filter((run) => run.outcome === 'RETRY').length,
    failed: runs.filter((run) => run.outcome === 'FAILED').length,
    released: released.length,
    budgetExhausted,
    remaining: await countDueJobs(),
    runs,
  };

  logSummary(summary);
  return summary;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Cron bookkeeping
 *
 * §19.5: "records its last run so the diagnostics page can flag staleness", and
 * §24.4 puts `lastCronAt` in the health payload. There is no dedicated table
 * for it, so the timestamps live in `SiteSetting` under the `system` group —
 * durable, already backed up, and visible in the admin settings screen. The
 * route handler cannot reach Prisma itself (§5), so it comes through here.
 * ────────────────────────────────────────────────────────────────────────── */

/** Last successful cron invocation of any job. */
export const CRON_LAST_RUN_KEY = 'system.cron.lastRunAt';

/** Per-job record, e.g. `system.cron.lastRun.drain`. */
export function cronLastRunKey(job: string): string {
  return `system.cron.lastRun.${job}`;
}

export interface CronRunRecord {
  readonly at: string;
  readonly ok: boolean;
  readonly durationMs: number;
}

/**
 * Stamps a cron invocation. Best-effort: bookkeeping that fails must not turn a
 * cron run that actually did its work into an error the scheduler retries.
 */
export async function recordCronRun(job: string, record: CronRunRecord): Promise<void> {
  const value: Prisma.InputJsonObject = {
    at: record.at,
    ok: record.ok,
    durationMs: record.durationMs,
  };
  try {
    await Promise.all([
      db.siteSetting.upsert({
        where: { key: cronLastRunKey(job) },
        create: { key: cronLastRunKey(job), value, group: 'system' },
        update: { value },
      }),
      db.siteSetting.upsert({
        where: { key: CRON_LAST_RUN_KEY },
        create: { key: CRON_LAST_RUN_KEY, value: record.at, group: 'system' },
        update: { value: record.at },
      }),
    ]);
  } catch (cause) {
    console.error('[cron] horodatage non enregistré :', describeError(cause));
  }
}

/** The `lastCronAt` field of `/api/health` (§24.4). `null` when cron has never run. */
export async function readLastCronRunAt(): Promise<string | null> {
  try {
    const row = await db.siteSetting.findUnique({
      where: { key: CRON_LAST_RUN_KEY },
      select: { value: true },
    });
    return typeof row?.value === 'string' ? row.value : null;
  } catch {
    return null;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Claiming
 * ────────────────────────────────────────────────────────────────────────── */

interface ClaimedJob {
  readonly id: string;
  readonly type: string;
  readonly payload: Prisma.JsonValue;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/** Releases jobs whose lock is older than {@link STALE_LOCK_MS}. Returns how many. */
async function reclaimStaleLocks(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LOCK_MS);
  const { count } = await db.job.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
    data: { lockedAt: null, status: 'QUEUED' },
  });
  return count;
}

async function claimJobs(limit: number): Promise<readonly ClaimedJob[]> {
  const now = new Date();

  const candidates = await db.job.findMany({
    where: { status: 'QUEUED', lockedAt: null, runAfter: { lte: now } },
    orderBy: [{ runAfter: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: { id: true },
  });

  if (candidates.length === 0) return [];

  const stamp = nextLockStamp();
  const ids = candidates.map((candidate) => candidate.id);

  // Compare-and-set. The `status`/`lockedAt` conditions are what make this
  // safe: a row another drain took between the read and this update simply
  // does not match.
  const { count } = await db.job.updateMany({
    where: { id: { in: ids }, status: 'QUEUED', lockedAt: null },
    data: { status: 'RUNNING', lockedAt: stamp, attempts: { increment: 1 } },
  });

  if (count === 0) return [];

  // Re-read the rows that actually carry this drain's stamp.
  return db.job.findMany({
    where: { id: { in: ids }, lockedAt: stamp, status: 'RUNNING' },
    select: { id: true, type: true, payload: true, attempts: true, maxAttempts: true },
  });
}

/** Hands back jobs that were claimed but never started. The attempt is refunded. */
async function releaseUnstarted(ids: readonly string[]): Promise<void> {
  await db.job.updateMany({
    where: { id: { in: [...ids] }, status: 'RUNNING' },
    data: { status: 'QUEUED', lockedAt: null, attempts: { decrement: 1 } },
  });
}

function countDueJobs(): Promise<number> {
  return db.job.count({ where: { status: 'QUEUED', runAfter: { lte: new Date() } } });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Running one job
 * ────────────────────────────────────────────────────────────────────────── */

async function runClaimedJob(job: ClaimedJob): Promise<JobRunReport> {
  const startedAt = Date.now();

  if (!isJobType(job.type)) {
    // Retrying will not teach the process a handler it does not have. This is
    // terminal, and loud: it means a job outlived the code that understood it.
    const error = `Type de tâche inconnu : « ${job.type} ». Aucun gestionnaire enregistré.`;
    await markFailed(job.id, error);
    return report(job, 'FAILED', startedAt, null, error, null);
  }

  const handler = handlers[job.type];

  try {
    const result = await handler(job.payload, {
      jobId: job.id,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
    });

    await db.job.update({
      where: { id: job.id },
      data: { status: 'DONE', lockedAt: null, finishedAt: new Date(), lastError: null },
    });

    return report(job, 'DONE', startedAt, result, null, null);
  } catch (cause) {
    const error = describeError(cause);

    if (job.attempts >= job.maxAttempts) {
      await markFailed(job.id, error);
      return report(job, 'FAILED', startedAt, null, error, null);
    }

    const nextRunAt = new Date(Date.now() + backoffMs(job.attempts));
    await db.job.update({
      where: { id: job.id },
      data: { status: 'QUEUED', lockedAt: null, runAfter: nextRunAt, lastError: error },
    });

    return report(job, 'RETRY', startedAt, null, error, nextRunAt);
  }
}

async function markFailed(id: string, error: string): Promise<void> {
  await db.job.update({
    where: { id },
    data: { status: 'FAILED', lockedAt: null, finishedAt: new Date(), lastError: error },
  });
}

function report(
  job: ClaimedJob,
  outcome: JobOutcome,
  startedAt: number,
  result: JobResult | null,
  error: string | null,
  nextRunAt: Date | null,
): JobRunReport {
  return {
    id: job.id,
    type: job.type,
    attempt: job.attempts,
    outcome,
    durationMs: Date.now() - startedAt,
    result,
    error,
    nextRunAt: nextRunAt === null ? null : nextRunAt.toISOString(),
  };
}

/**
 * A single-line, credential-free description of a failure.
 *
 * A `ZodError` gets its issues flattened into `path: message` pairs — that is
 * the difference between "payload invalide" and knowing that `props.verifyUrl`
 * was not a URL.
 */
function describeError(cause: unknown): string {
  if (cause instanceof Prisma.PrismaClientKnownRequestError) {
    return `Prisma ${cause.code}: ${cause.message.split('\n').slice(-1)[0] ?? cause.code}`.slice(
      0,
      1000,
    );
  }
  if (isZodError(cause)) {
    const issues = cause.issues
      .map((issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join(' · ');
    return `Payload invalide — ${issues}`.slice(0, 1000);
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(/\s+/gu, ' ').trim().slice(0, 1000);
}

interface ZodLikeIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

function isZodError(cause: unknown): cause is { readonly issues: readonly ZodLikeIssue[] } {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'issues' in cause &&
    Array.isArray((cause as { issues: unknown }).issues)
  );
}

function logSummary(summary: DrainSummary): void {
  const line = {
    event: 'jobs.drain',
    reclaimed: summary.reclaimed,
    claimed: summary.claimed,
    succeeded: summary.succeeded,
    retried: summary.retried,
    failed: summary.failed,
    released: summary.released,
    remaining: summary.remaining,
    durationMs: summary.durationMs,
  };
  if (summary.failed > 0) console.error('[jobs]', JSON.stringify(line));
  else if (summary.claimed > 0) console.info('[jobs]', JSON.stringify(line));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
