import { PrismaClient } from '@prisma/client';

/**
 * Prisma singleton.
 *
 * The app runs as ONE long-lived Node process on Hostinger (§2 C1) against a MySQL
 * instance with a low connection ceiling — `connection_limit=5` in DATABASE_URL. A
 * second client would double the pool, so this module is the only place allowed to
 * construct one.
 *
 * In development, Next.js hot-reload re-evaluates modules on every edit; without the
 * global cache each reload would leak a pool until MySQL refuses new connections.
 *
 * Layering rule (§5): only `src/server/services/*` imports this. Components, pages and
 * route handlers go through a service — ESLint enforces it.
 */

const createPrismaClient = () =>
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

declare global {
  var __cfiPrisma: ReturnType<typeof createPrismaClient> | undefined;
}

export const db = globalThis.__cfiPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__cfiPrisma = db;
}

export type Db = typeof db;

/**
 * Transaction helper. Every multi-write business operation goes through this so the
 * atomicity guarantees in §9.2 (approve a request → payment + enrollment + invoice +
 * counters commit together or not at all) are impossible to forget.
 */
export function transaction<T>(fn: (tx: Parameters<Parameters<Db['$transaction']>[0]>[0]) => Promise<T>): Promise<T> {
  return db.$transaction(fn, {
    maxWait: 5_000,
    timeout: 15_000,
  });
}
