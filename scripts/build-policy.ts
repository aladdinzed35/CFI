/**
 * The decisions `scripts/build.ts` makes, kept free of I/O so they can be
 * tested without a database or a child process.
 */

/**
 * What the build did to the database, stamped into the build as
 * CFI_BUILD_DATABASE and read back by the deployment diagnosis
 * (`src/server/diagnostics/deployment.ts` keeps its own copy of these words:
 * application code does not import from scripts/).
 *
 *   migrate  off · applied · unreachable · no-database-url
 *   seed     off · ran · failed · skipped (the database was not ready)
 *
 * `applied` includes "nothing pending"; `ran` includes "already seeded, left
 * alone" — both are the healthy outcome of running the step.
 */
export interface BuildDatabaseReport {
  migrate: 'off' | 'applied' | 'unreachable' | 'no-database-url';
  seed: 'off' | 'ran' | 'failed' | 'skipped';
}

/**
 * Whether an opt-in variable is switched on. Only an explicit yes counts: an
 * unset, empty or misspelled value leaves the database alone, which is the
 * safe reading for a flag that migrates a production schema.
 */
export function isEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

/**
 * Prisma's connection-level error codes — the database could not be reached or
 * would not let us in, so no migration ever started:
 *   P1000 authentication failed   P1001 server unreachable   P1002 timed out
 *   P1003 database does not exist P1010 access denied        P1011 TLS failure
 *   P1013 invalid connection URL  P1017 server closed the connection
 */
const CONNECTION_CODES = /\bP10(?:00|01|02|03|10|11|13|17)\b/u;

/** Wording some Prisma versions print without a code. */
const CONNECTION_WORDING = /can't reach database server|authentication failed|access denied for user/iu;

/**
 * Why `prisma migrate deploy` failed, read from its output.
 *
 *   'connection' — nothing was applied, because nothing could be. The live
 *                  site uses the same credentials, so it cannot reach the
 *                  database either: stopping the deploy protects nothing, and
 *                  finishing it ships /api/health?diagnose=1, which says why.
 *   'migration'  — the database answered and a migration went wrong (a failed
 *                  statement, a previously failed migration, drift). The
 *                  schema may be half-way; new code must not ship on top of it.
 *
 * Anything unrecognised counts as 'migration', the reading that stops.
 */
export function migrateFailureKind(output: string): 'connection' | 'migration' {
  return CONNECTION_CODES.test(output) || CONNECTION_WORDING.test(output) ? 'connection' : 'migration';
}
