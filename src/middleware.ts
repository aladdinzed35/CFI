import createMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';

/**
 * Locale routing middleware (§10.1).
 *
 * Runs on the **Node.js runtime**, never on the edge: the whole application is
 * deployed as a single long-lived Node 22 process on Hostinger (§2 C1), so an
 * edge-compiled middleware would be a second, unsupported runtime.
 *
 * Locale detection order, applied by `next-intl`:
 *   1. an explicit locale prefix already present in the path (`/ar/formations`)
 *   2. the `NEXT_LOCALE` cookie, written by the locale switcher
 *   3. the `Accept-Language` header, negotiated against the four locales
 *   4. `fr`, the default
 *
 * SECURITY — this middleware performs *routing only*. Route authorisation is a
 * separate layer added in M1 on top of it: `PENDING_APPROVAL` accounts may only
 * reach the waiting screen, their profile, the public catalogue and the guest
 * assistant (§9.1); `/espace/**` requires an authenticated `ACTIVE` student and
 * `/admin/**` requires an admin role plus the IP allow-list (§17, §20). Do not
 * implement authentication or authorisation here — and never treat the absence
 * of a check in this file as permission granted downstream.
 */
export const runtime = 'nodejs';

export default createMiddleware(routing);

export const config = {
  /**
   * Everything except:
   *   - `/api/**`      — route handlers are locale-agnostic
   *   - `/_next/**`    — build output
   *   - `/_vercel/**`  — reserved prefix, kept out even though we do not deploy there
   *   - any path containing a dot (`/favicon.ico`, `/robots.txt`, `/og/cover.png`)
   */
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
