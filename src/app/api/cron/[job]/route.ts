/**
 * `GET|POST /api/cron/[job]?key=…` — the scheduler's entry point (§19.5).
 *
 * Hostinger's hPanel cron calls this with
 * `curl -fsS "https://cfi.ma/api/cron/drain?key=…"`, so both a query parameter
 * and an `Authorization: Bearer` header are accepted.
 *
 * ## Why an unknown job is a 404 and a bad key is a 401
 * The secret is checked **first**, in constant time. Only a caller who already
 * holds `CRON_SECRET` ever learns whether a job name exists; everyone else gets
 * an identical 401 for `drain`, for `reindex` and for `does-not-exist`. The
 * order is the whole point — checking the registry first would turn this
 * endpoint into a free listing of the platform's internals.
 *
 * ## Registry
 * {@link CRON_JOBS} is a typed map keyed by the §19.5 job vocabulary. M1 wires
 * up `drain`; the other names are declared but unregistered, and answer 404
 * cleanly until the milestone that implements them fills them in. Declaring
 * them costs nothing and makes the gap explicit rather than silent.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { constantTimeEquals } from '@/lib/crypto';
import { env } from '@/lib/env';
import { drain, recordCronRun } from '@/server/jobs/runner';
import { expireOverdueRequests, sendReceiptReminders } from '@/server/services/enrollment/expiry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ────────────────────────────────────────────────────────────────────────────
 * Registry
 * ────────────────────────────────────────────────────────────────────────── */

/** The full §19.5 vocabulary. A name outside this list is not a job at all. */
export const CRON_JOB_NAMES = [
  'drain',
  'expire-requests',
  'reminders',
  'recompute',
  'ai-maintenance',
  'reindex',
  'digests',
  'cleanup',
  'backup-check',
] as const;

export type CronJobName = (typeof CRON_JOB_NAMES)[number];

/** A job returns a JSON-serialisable summary of what it did. */
type CronJobRunner = () => Promise<unknown>;

/**
 * Registered jobs. `Partial` on purpose: the milestones that own
 * `expire-requests`, `reminders`, … add their entry here, and until then the
 * endpoint answers 404 for those names instead of pretending to run something.
 */
const CRON_JOBS: Partial<Record<CronJobName, CronJobRunner>> = {
  drain: () => drain(),
  // M3 — the clock-driven side of §9.2 (§19.5 rows 2 and 3).
  'expire-requests': () => expireOverdueRequests(),
  reminders: () => sendReceiptReminders(),
};

/* ────────────────────────────────────────────────────────────────────────────
 * Validation
 * ────────────────────────────────────────────────────────────────────────── */

const paramsSchema = z.object({ job: z.string().min(1).max(64) }).strict();

const BEARER = /^Bearer\s+(.+)$/iu;

function presentedSecret(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header !== null) {
    const match = BEARER.exec(header.trim());
    const token = match?.[1]?.trim();
    if (token !== undefined && token.length > 0) return token;
  }

  const key = new URL(request.url).searchParams.get('key');
  return key !== null && key.length > 0 ? key : null;
}

/**
 * Constant-time comparison against `CRON_SECRET`.
 *
 * An unset secret denies everything. Production cannot reach that state — the
 * environment schema requires a 24-character `CRON_SECRET` there — but a
 * misconfigured staging box must fail closed, never open.
 */
function isAuthorized(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (secret.length === 0) return false;
  const presented = presentedSecret(request);
  if (presented === null) return false;
  return constantTimeEquals(presented, secret);
}

function isCronJobName(value: string): value is CronJobName {
  return (CRON_JOB_NAMES as readonly string[]).includes(value);
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/* ────────────────────────────────────────────────────────────────────────────
 * Handler
 * ────────────────────────────────────────────────────────────────────────── */

async function handle(
  request: Request,
  context: { params: Promise<{ job: string }> },
): Promise<NextResponse> {
  // §20: validate the boundary first, authorize second, work third.
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  const name = params.data.job;
  const runner = isCronJobName(name) ? CRON_JOBS[name] : undefined;
  if (runner === undefined) {
    return NextResponse.json(
      { error: 'not_found', job: name },
      { status: 404, headers: NO_STORE },
    );
  }

  const startedAt = Date.now();
  try {
    const summary = await runner();
    const durationMs = Date.now() - startedAt;
    await recordCronRun(name, { at: new Date().toISOString(), ok: true, durationMs });

    return NextResponse.json(
      { ok: true, job: name, durationMs, summary },
      { status: 200, headers: NO_STORE },
    );
  } catch (cause) {
    const durationMs = Date.now() - startedAt;
    const error = cause instanceof Error ? cause.message : String(cause);
    await recordCronRun(name, { at: new Date().toISOString(), ok: false, durationMs });

    console.error(`[cron] ${name} a échoué :`, error);

    // 500 so `curl -fsS` in hPanel reports a non-zero exit and the failure is
    // visible in the cron mail rather than buried in a 200.
    return NextResponse.json(
      { ok: false, job: name, durationMs, error: error.slice(0, 500) },
      { status: 500, headers: NO_STORE },
    );
  }
}

export function GET(
  request: Request,
  context: { params: Promise<{ job: string }> },
): Promise<NextResponse> {
  return handle(request, context);
}

export function POST(
  request: Request,
  context: { params: Promise<{ job: string }> },
): Promise<NextResponse> {
  return handle(request, context);
}
