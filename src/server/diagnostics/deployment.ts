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
  readonly build: BuildFacts;
  readonly database: Record<string, unknown>;
  readonly storage: Record<string, unknown>;
}

export async function diagnoseDeployment(commit: string | null): Promise<DeploymentDiagnosis> {
  const build = buildFacts();
  return {
    builtAt: process.env.CFI_BUILT_AT ?? null,
    commit,
    node: process.version,
    build,
    database: await diagnoseDatabase(build),
    storage: await diagnoseStorage(),
  };
}

/* -------------------------------------------------------------------------- */
/* Build                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What `scripts/build.ts` did to the database before this build, as it
 * stamped it (see `BuildDatabaseReport` there — the words are repeated here
 * because application code does not import from scripts/). `null` when the
 * build did not go through that script: an older checkout, or a build command
 * other than `npm run build`.
 */
export interface BuildDatabaseSteps {
  readonly migrate: string;
  readonly seed: string;
}

export interface BuildFacts {
  readonly databaseSteps: BuildDatabaseSteps | null;
  /** The opt-ins as the RUNNING process sees them — set after the build, they have not acted yet. */
  readonly optInsNow: { readonly BUILD_MIGRATE: string | null; readonly BUILD_SEED_DEMO: string | null };
}

function buildFacts(): BuildFacts {
  return {
    databaseSteps: parseDatabaseSteps(process.env.CFI_BUILD_DATABASE),
    optInsNow: {
      BUILD_MIGRATE: process.env.BUILD_MIGRATE ?? null,
      BUILD_SEED_DEMO: process.env.BUILD_SEED_DEMO ?? null,
    },
  };
}

export function parseDatabaseSteps(raw: string | undefined): BuildDatabaseSteps | null {
  if (raw === undefined || raw.trim() === '') return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { migrate, seed } = value as { migrate?: unknown; seed?: unknown };
    return typeof migrate === 'string' && typeof seed === 'string' ? { migrate, seed } : null;
  } catch {
    return null;
  }
}

/**
 * Why a database the site CAN reach has no tables — each cause with its fix.
 *
 * The first version said "set the build command to `npm run db:deploy &&
 * npm run build`", which Hostinger's build-command drop-down cannot express.
 * Every cause below was a real state of a real deployment.
 */
export function emptySchemaVerdict(steps: BuildDatabaseSteps | null): string {
  const base = 'Connected, but the schema is empty: migrations never ran on this database.';
  if (steps === null) {
    return (
      `${base} This build did not go through scripts/build.ts — the deployed code predates it, or the build ` +
      'command is not `npm run build`. Deploy the current repository with the build command `npm run build`.'
    );
  }
  switch (steps.migrate) {
    case 'off':
      return `${base} BUILD_MIGRATE was not set during the build: add BUILD_MIGRATE=true (and BUILD_SEED_DEMO=true) to the environment variables, then redeploy.`;
    case 'unreachable':
      return `${base} The build could not reach the database that the running site reaches: the build ran where DATABASE_URL does not lead here. Redeploy; if it repeats, migrate over SSH with \`npm run db:deploy\`.`;
    case 'no-database-url':
      return `${base} DATABASE_URL was empty during the build: it was added afterwards. Redeploy.`;
    case 'applied':
      return `${base} The build applied migrations to a DIFFERENT database: DATABASE_URL changed after the build. Redeploy.`;
    default:
      return `${base} Unrecognised build report: ${steps.migrate}.`;
  }
}

/* -------------------------------------------------------------------------- */
/* Database                                                                    */
/* -------------------------------------------------------------------------- */

async function diagnoseDatabase(build: BuildFacts): Promise<Record<string, unknown>> {
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
      verdict: emptySchemaVerdict(build.databaseSteps),
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
