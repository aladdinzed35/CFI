/**
 * `npm run build` — the Prisma client, then (only where a host opts in) the
 * database, then `next build`.
 *
 * ## Why the database step lives in the build
 * Hostinger's build settings do not take a command line: the build command is
 * a drop-down of this repository's npm scripts. `prisma migrate deploy && next
 * build` cannot be entered there, and the platform has no separate release
 * step. So the script the panel can select has to do the whole job.
 *
 * It must also do it ONLY where asked. The same script builds CI and every
 * developer's machine, where reaching for a database would be a surprise, so
 * the database steps are off unless the host sets:
 *
 *   BUILD_MIGRATE=true     apply pending migrations (`prisma migrate deploy`)
 *   BUILD_SEED_DEMO=true   then seed the demonstration catalogue, ONCE
 *
 * With neither set this is exactly the old `prisma generate && next build`.
 *
 * ## Before `next build`, not after
 * The public pages are prerendered from the database. Migrating afterwards
 * would bake a first deploy's empty schema into the build and serve empty
 * pages until the first revalidation.
 *
 * ## Failure policy
 *   prisma generate fails     stop — nothing runs without the client
 *   database unreachable      continue, loudly — see `migrateFailureKind`
 *   a migration fails         stop — never ship code onto a half-migrated schema
 *   the seed fails            continue, loudly — demo content is optional
 *   next build fails          stop, with its exit code
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { parseEnv } from 'node:util';

import { isEnabled, migrateFailureKind, type BuildDatabaseReport } from './build-policy';

/**
 * DATABASE_URL as the Prisma CLI will see it: the environment first, then
 * `.env` (prisma.config.ts loads it the same way), so a host that writes a
 * .env file instead of injecting variables is read correctly too.
 *
 * Parsed, never loaded: `process.loadEnvFile` here would hand every child the
 * file's contents — including a developer's NODE_ENV=development, which
 * `next build` then warns about and builds under.
 */
function databaseUrl(): string {
  const injected = process.env.DATABASE_URL?.trim() ?? '';
  if (injected !== '' || !existsSync('.env')) return injected;
  return parseEnv(readFileSync('.env', 'utf8')).DATABASE_URL?.trim() ?? '';
}

/**
 * Commands run through the shell so the `node_modules/.bin` that `npm run`
 * puts on PATH resolves them on every platform (`prisma.cmd` on Windows). The
 * command strings are constants — nothing from the environment reaches them.
 */
function run(command: string, env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(command, { shell: true, stdio: 'inherit', env });
  return exitCode(result);
}

/** Like `run`, but keeps the output so a failure can be classified. */
function runCaptured(command: string): { code: number; output: string } {
  const result = spawnSync(command, {
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return { code: exitCode(result), output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

function exitCode(result: SpawnSyncReturns<unknown>): number {
  if (result.error !== undefined) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function banner(lines: readonly string[]): void {
  const rule = '='.repeat(78);
  console.log(`\n${rule}\n${lines.map((line) => `  ${line}`).join('\n')}\n${rule}\n`);
}

function main(): number {
  if (run('prisma generate') !== 0) return 1;

  const migrate = isEnabled(process.env.BUILD_MIGRATE);
  const seed = isEnabled(process.env.BUILD_SEED_DEMO);
  const report: BuildDatabaseReport = { migrate: migrate ? 'applied' : 'off', seed: seed ? 'ran' : 'off' };
  let databaseReady = true;

  if ((migrate || seed) && databaseUrl() === '') {
    banner([
      'BUILD_MIGRATE / BUILD_SEED_DEMO are set but DATABASE_URL is empty.',
      'Database steps skipped. Add DATABASE_URL to the environment variables.',
    ]);
    databaseReady = false;
    if (migrate) report.migrate = 'no-database-url';
  }

  if (migrate && databaseReady) {
    console.log('\n> prisma migrate deploy (BUILD_MIGRATE)\n');
    const { code, output } = runCaptured('prisma migrate deploy');

    if (code !== 0) {
      if (migrateFailureKind(output) === 'migration') {
        banner([
          'DATABASE MIGRATION FAILED — build stopped.',
          'The database answered but a migration did not apply. Shipping this',
          'build would run new code against a half-migrated schema. The error is',
          'printed above; fix it, then deploy again.',
        ]);
        return 1;
      }

      databaseReady = false;
      report.migrate = 'unreachable';
      banner([
        'DATABASE NOT REACHABLE — migrations skipped, build continues.',
        'The site will deploy but cannot show any content until this is fixed.',
        'Check DATABASE_URL: user, password (special characters must be',
        'percent-encoded), host `localhost`, port 3306, database name.',
        'Once deployed, /api/health?diagnose=1&key=<CRON_SECRET> names the cause.',
      ]);
    }
  }

  if (seed && !databaseReady) report.seed = 'skipped';

  if (seed && databaseReady) {
    // `--production-demo` with NODE_ENV forced to production: the passwords in
    // the seed file are public (this repository), and production mode is what
    // replaces them with random ones and seeds only once. A host that leaves
    // NODE_ENV unset during the build must not be able to plant the public ones.
    console.log('\n> seed — demonstration catalogue, once (BUILD_SEED_DEMO)\n');
    const code = run('tsx prisma/seed.ts --production-demo', { ...process.env, NODE_ENV: 'production' });
    if (code !== 0) {
      report.seed = 'failed';
      banner([
        'DEMO SEED FAILED — build continues without demonstration content.',
        'The error is printed above. A failed seed leaves no "done" marker, so',
        'the next deploy tries again and completes it safely.',
      ]);
    }
  }

  // Stamped into the build by next.config.ts, so /api/health?diagnose=1 can
  // say what this build did to the database instead of leaving it to be
  // inferred from a table count. Its absence is information too: a build
  // that did not go through this script.
  return run('next build', { ...process.env, CFI_BUILD_DATABASE: JSON.stringify(report) });
}

process.exitCode = main();
