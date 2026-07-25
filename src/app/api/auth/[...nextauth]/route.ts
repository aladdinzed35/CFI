import { handlers } from '@/server/auth';

/**
 * Auth.js endpoint — `/api/auth/*` (§5).
 *
 * The **Node.js** runtime is mandatory, not a preference: `authorize()` hashes
 * with a native Argon2 addon and reads MySQL through Prisma, and neither exists
 * on the edge. The whole application is one long-lived Node 22 process on
 * Hostinger (§2 C1); an edge-compiled route here would be a second, unsupported
 * runtime.
 *
 * `force-dynamic` because every response depends on cookies and headers. Without
 * it Next.js could try to prerender the route at build time, where there is no
 * request to authenticate and no database to reach.
 *
 * The route is outside `[locale]` on purpose — it is a machine endpoint with no
 * user-visible copy, and the middleware matcher already excludes `/api`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST } = handlers;
