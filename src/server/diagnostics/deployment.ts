import { constants as fsConstants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { env } from '@/lib/env';
import { db } from '@/server/db';

/**
 * Why a deployment's database or store fails — for the one caller allowed to
 * know.
 *
 * `GET /api/health` is public and answers `ok` / `fail`, by design and for
 * good reason: a monitor cannot authenticate and an attacker reads it too. But
 * a first deployment that says `db: fail` and nothing more leaves its operator
 * guessing between a wrong password, a `#` pasted into it, a host that resolves to
 * IPv6, a database that was never created and a schema that was never
 * migrated — five problems with five different fixes, and hPanel shows none of
 * them.
 *
 * So `?diagnose=1&key=<CRON_SECRET>` returns the answer. The gate is the same
 * one the SMTP probe already uses. It reports the connection TARGET — host,
 * port, database, user — and never the password, only facts about it that
 * explain a failure. Driver messages pass through only after the password has
 * been cut out of them, in case a driver ever echoes the URL back.
 */

/**
 * The literal strings the deployment template ships with. A value still equal
 * to one of these was never filled in — the most likely reason a first
 * deployment cannot reach its database.
 */
const TEMPLATE_PLACEHOLDERS = ['DB_PASSWORD', 'DB_USER', 'DB_NAME', 'TODO_MAILBOX_PASSWORD'];

export interface DeploymentDiagnosis {
  readonly builtAt: string | null;
  readonly commit: string | null;
  readonly node: string;
  readonly database: Record<string, unknown>;
  readonly storage: Record<string, unknown>;
}

export async function diagnoseDeployment(commit: string | null): Promise<DeploymentDiagnosis> {
  return {
    builtAt: process.env.CFI_BUILT_AT ?? null,
    commit,
    node: process.version,
    database: await diagnoseDatabase(),
    storage: await diagnoseStorage(),
  };
}

/* -------------------------------------------------------------------------- */
/* Database                                                                    */
/* -------------------------------------------------------------------------- */

async function diagnoseDatabase(): Promise<Record<string, unknown>> {
  const target = parseTarget(env.DATABASE_URL);
  const password = passwordOf(env.DATABASE_URL);

  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    const code = errorCode(error);
    return {
      target,
      reachable: false,
      code,
      kind: classify(code, error),
      message: redact(firstLine(error), password),
    };
  }

  const [tables] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()`;
  const tableCount = Number(tables?.n ?? 0);

  if (tableCount === 0) {
    return {
      target,
      reachable: true,
      tables: 0,
      verdict:
        'Connected, but the schema is empty: migrations never ran. Set the build command to `npm run db:deploy && npm run build`.',
    };
  }

  const count = (query: Promise<number>): Promise<number> => query.catch(() => -1);
  const rows = {
    users: await count(db.user.count()),
    courses: await count(db.course.count()),
    publishedCourses: await count(db.course.count({ where: { status: 'PUBLISHED' } })),
    categories: await count(db.category.count()),
    siteSettings: await count(db.siteSetting.count()),
  };

  return {
    target,
    reachable: true,
    tables: tableCount,
    rows,
    verdict:
      rows.publishedCourses === 0
        ? 'Connected and migrated, but no course is published: every catalogue section renders its empty state. Seed, or publish from /admin/formations.'
        : 'Connected, migrated and populated.',
  };
}

function parseTarget(raw: string): Record<string, unknown> {
  try {
    const url = new URL(raw);
    const password = decodeURIComponent(url.password);
    return {
      host: url.hostname,
      port: url.port || '3306',
      database: url.pathname.replace(/^\//u, ''),
      user: decodeURIComponent(url.username),
      passwordLength: password.length,
      passwordIsTemplatePlaceholder: TEMPLATE_PLACEHOLDERS.includes(password),
      passwordBreaksTheUrl: rawPasswordBreaksUrl(raw),
      hostIsLocalhostName: url.hostname === 'localhost',
    };
  } catch {
    return { unparseable: true };
  }
}

/**
 * Would this password, pasted as-is, change where the URL points?
 *
 * Read from the RAW string, because by the time `new URL()` has parsed it the
 * evidence is gone: the parser re-encodes what it can and splits on what it
 * cannot. Measured, not assumed — a bare `@` is harmless (both this parser and
 * Prisma's split credentials on the LAST `@`), but `#` starts a fragment, `?`
 * starts the query and `/` ends the authority, and any of the three silently
 * moves the host. A `%` not followed by two hex digits is a malformed escape.
 */
export function rawPasswordBreaksUrl(raw: string): boolean {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^:@]*):(.*)@([^@]*)$/iu.exec(raw.split(/[#?]/u)[0] ?? '');
  // If the regex cannot even find `user:password@host`, something in the
  // password has already cut the string short.
  if (authority === null) return /^[a-z][a-z0-9+.-]*:\/\/[^:@/]*:/iu.test(raw);
  const password = authority[2] ?? '';
  return /[#?/]/u.test(password) || /%(?![0-9a-f]{2})/iu.test(password);
}

function passwordOf(raw: string): string {
  try {
    return decodeURIComponent(new URL(raw).password);
  } catch {
    return '';
  }
}

/** Prisma puts the code on `.code` (request errors) or `.errorCode` (initialisation errors). */
function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, errorCode: initCode } = error as { code?: unknown; errorCode?: unknown };
  const candidate = code ?? initCode;
  return typeof candidate === 'string' ? candidate : null;
}

/**
 * The first-deployment failures, each named with its fix. Codes from Prisma's
 * error reference: P1000 authentication, P1001 unreachable, P1003 no such
 * database, P1017 connection closed by the server.
 */
function classify(code: string | null, error: unknown): string {
  const text = firstLine(error).toLowerCase();
  if (code === 'P1000' || text.includes('authentication failed') || text.includes('access denied')) {
    return 'auth: the user or the password is wrong, or the password needs percent-encoding';
  }
  if (code === 'P1003' || text.includes('does not exist')) {
    return 'unknown-database: the database name is wrong, or this user has no rights on it';
  }
  if (code === 'P1001' || text.includes("can't reach") || text.includes('econnrefused')) {
    return 'unreachable: wrong host or port. If the host is `localhost`, try `127.0.0.1`';
  }
  if (code === 'P1017') return 'closed: the server accepted the connection, then dropped it';
  return 'other';
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = message
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0 && !part.startsWith('Invalid `'));
  return (line ?? '').slice(0, 300);
}

function redact(text: string, secret: string): string {
  return secret.length >= 3 ? text.split(secret).join('***') : text;
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

interface PathProbe {
  readonly exists: boolean;
  readonly writable: boolean;
  readonly code?: string;
}

async function probe(target: string): Promise<PathProbe> {
  try {
    await stat(target);
  } catch (error) {
    return { exists: false, writable: false, code: errorCode(error) ?? 'unknown' };
  }
  try {
    await access(target, fsConstants.W_OK);
    return { exists: true, writable: true };
  } catch (error) {
    return { exists: true, writable: false, code: errorCode(error) ?? 'unknown' };
  }
}

async function diagnoseStorage(): Promise<Record<string, unknown>> {
  if (env.STORAGE_DRIVER !== 'local') {
    return { driver: env.STORAGE_DRIVER, endpointSet: (env.S3_ENDPOINT ?? '').length > 0 };
  }

  const path = env.LOCAL_STORAGE_PATH ?? '';
  return {
    driver: 'local',
    path,
    pathIsTemplatePlaceholder: path.includes('uXXXXXXX'),
    target: await probe(path),
    parent: await probe(dirname(path)),
    // Where the app actually runs: the storage path must sit outside it.
    cwd: process.cwd(),
  };
}
