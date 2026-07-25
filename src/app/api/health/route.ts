/**
 * `GET /api/health` — §24.4, exactly.
 *
 * `{ status, version, commit, db, storage, smtp, lastCronAt, queuedJobs }`.
 * **200 only when the database is reachable**; anything else is 503, because
 * this endpoint is what uptime monitoring pages a human on, and a site that
 * cannot read its own database is down no matter how well it serves HTML.
 *
 * ## What it deliberately does not say
 * No connection string, no bucket name, no mailbox, no credential, and no
 * exception text from a driver — every probe collapses to `ok` / `fail`. The
 * endpoint is public by necessity (a monitor cannot authenticate), so its
 * output is written as if an attacker were reading it, because one will be.
 *
 * ## SMTP is skipped by default
 * §24.4 types this field `ok|skipped` for a reason: verifying SMTP opens an
 * authenticated connection to Hostinger's mail server, and doing that on every
 * monitor poll would be both slow and abusive — and would hand an anonymous
 * caller a way to make us hammer our own provider. The probe therefore runs
 * only for a caller holding `CRON_SECRET` (`?smtp=1&key=…`), which is the
 * admin diagnostics page and nothing else.
 */

import { constants as fsConstants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { constantTimeEquals } from '@/lib/crypto';
import { env } from '@/lib/env';
import { countQueuedJobs, pingDatabase } from '@/server/jobs/queue';
import { readLastCronRunAt } from '@/server/jobs/runner';
// Only the transport is needed here — importing the mail barrel would pull the
// whole template set into a route that never renders one.
import { verifyTransport } from '@/server/mail/transport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProbeStatus = 'ok' | 'fail';
type SmtpStatus = ProbeStatus | 'skipped';

interface HealthPayload {
  /** `ok` when everything probed is healthy, `degraded` when a non-fatal probe failed, `fail` when the database is unreachable. */
  readonly status: 'ok' | 'degraded' | 'fail';
  readonly version: string;
  readonly commit: string | null;
  readonly db: ProbeStatus;
  readonly storage: ProbeStatus;
  readonly smtp: SmtpStatus;
  /** ISO 8601 of the last cron invocation, or `null` if cron has never run. */
  readonly lastCronAt: string | null;
  /** `-1` when the count could not be taken because the database is unreachable — never a misleading `0`. */
  readonly queuedJobs: number;
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** A storage probe must never be the reason a health check times out. */
const STORAGE_TIMEOUT_MS = 3_000;

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const wantsSmtp = url.searchParams.get('smtp') === '1' && isTrustedCaller(url);

  const [db, storage, smtp, lastCronAt] = await Promise.all([
    pingDatabase(),
    checkStorage(),
    wantsSmtp ? checkSmtp() : Promise.resolve<SmtpStatus>('skipped'),
    readLastCronRunAt(),
  ]);

  // Counting jobs requires the database; if that is already down, don't ask.
  const queuedJobs = db ? await countQueuedJobs().catch(() => -1) : -1;

  const payload: HealthPayload = {
    status: !db ? 'fail' : storage && smtp !== 'fail' ? 'ok' : 'degraded',
    version: await readVersion(),
    commit: readCommit(),
    db: db ? 'ok' : 'fail',
    storage: storage ? 'ok' : 'fail',
    smtp,
    lastCronAt,
    queuedJobs,
  };

  return NextResponse.json(payload, { status: db ? 200 : 503, headers: NO_STORE });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Probes
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Storage reachability.
 *
 * The storage driver itself lands in M3; until then this checks the thing that
 * actually breaks in practice for each driver — a local path that is not
 * writable, or an S3 endpoint that does not answer. For S3 any HTTP response
 * counts as reachable, including 403: an unauthenticated probe *should* be
 * refused, and being refused proves the host is there. No credentials are sent.
 */
async function checkStorage(): Promise<boolean> {
  if (env.STORAGE_DRIVER === 'local') {
    const path = env.LOCAL_STORAGE_PATH;
    if (path === undefined || path.length === 0) return false;
    try {
      await access(path, fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  const endpoint = env.S3_ENDPOINT;
  if (endpoint === undefined || endpoint.length === 0) return false;

  try {
    const response = await fetch(endpoint, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

async function checkSmtp(): Promise<SmtpStatus> {
  const verification = await verifyTransport();
  return verification.ok ? 'ok' : 'fail';
}

/** The SMTP probe is gated on `CRON_SECRET`, compared in constant time. */
function isTrustedCaller(url: URL): boolean {
  const secret = env.CRON_SECRET;
  if (secret.length === 0) return false;
  const key = url.searchParams.get('key');
  if (key === null || key.length === 0) return false;
  return constantTimeEquals(key, secret);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Build identity
 * ────────────────────────────────────────────────────────────────────────── */

let cachedVersion: string | null = null;

/**
 * Read from `package.json` at runtime rather than imported, so the value cannot
 * be baked into a bundle and go stale after a deploy that only bumped it.
 */
async function readVersion(): Promise<string> {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const raw = await readFile(join(process.cwd(), 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const version =
      typeof parsed === 'object' && parsed !== null && 'version' in parsed
        ? (parsed as { version: unknown }).version
        : null;
    cachedVersion = typeof version === 'string' ? version : 'unknown';
  } catch {
    cachedVersion = 'unknown';
  }
  return cachedVersion;
}

/**
 * The deployed commit, short form.
 *
 * `docs/DEPLOYMENT.md` sets `GIT_COMMIT` from the deploy script; the other two
 * names cover a build run by a generic CI image. `null` — not a fake sha —
 * when nothing published it.
 */
function readCommit(): string | null {
  const raw =
    process.env.GIT_COMMIT ?? process.env.SOURCE_COMMIT ?? process.env.GITHUB_SHA ?? null;
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 12);
}
