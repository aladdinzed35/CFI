import { NextResponse, type NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { getToken } from 'next-auth/jwt';
import { routing, isLocale, type Locale } from '@/i18n/routing';
import { RETURN_TO_PARAM, evaluate, type PolicySession } from '@/server/auth/route-policy';

/**
 * Locale routing (§10.1) composed with the account-status gate (§9.1, §20).
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
 * ## Order: locale first, policy second
 * `next-intl` runs first and its answer wins whenever it is a redirect — a URL
 * with no locale prefix (`/espace`) is not a page, it is an address that has to
 * become `/fr/espace` before anything can be said about it. Only once the URL
 * is canonical does the policy run, and every target it produces is re-prefixed
 * with the locale the visitor is actually browsing in, so the prefix survives
 * a refusal exactly as it survives a link.
 *
 * ## SECURITY — what this file decides, and what it explicitly does not
 * The session is read by **decrypting the JWT in the cookie**. There is no
 * database call here, and that is deliberate: middleware runs on every asset-
 * adjacent request, and a query per request to answer "may you see this page?"
 * is a self-inflicted denial of service.
 *
 * The consequence is stated plainly: **a JWT is a snapshot, not the truth.** It
 * cannot know that an administrator revoked the session, suspended the account
 * or changed the role since it was issued. The `Session` table is the
 * revocation authority (`server/auth/session.ts`), and it is consulted on every
 * request in the layer that actually renders or mutates something — the page
 * guards (`requirePageUser`, `requirePageActiveUser`) and `withAction`. This
 * middleware is therefore a **coarse, cheap first gate**, never the last one.
 * Do not move an authorisation decision here, and never treat the absence of a
 * check in this file as permission granted downstream.
 *
 * The policy itself lives in `server/auth/route-policy.ts` — pure, exhaustively
 * unit-testable, and the single place where §9.1 is written down.
 */
export const runtime = 'nodejs';

const handleLocale = createMiddleware(routing);

/**
 * Session cookie name, mirroring `sessionCookieName()` in
 * `server/auth/session.ts`.
 *
 * That module cannot be imported here: it reaches the Prisma client, which has
 * no business in the middleware bundle. The name is a two-branch constant and
 * is repeated rather than shared — if the one in `session.ts` ever changes,
 * change it here in the same commit, or every visitor is silently anonymous to
 * the gate (and, being a *first* gate, nothing would visibly break: the page
 * guards would keep working while the redirects quietly stopped).
 */
function sessionCookieName(): string {
  return isProduction() ? '__Secure-cfi.session-token' : 'cfi.session-token';
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * `AUTH_SECRET`, read straight from the environment rather than through
 * `lib/env`: that module validates the *entire* configuration (SMTP, storage,
 * video, AI) and stops the process when something is missing, which is the
 * right behaviour at boot and the wrong behaviour inside a request handler.
 *
 * The development fallback is the same literal `lib/env` substitutes, and it
 * has to be — a token encrypted with one secret cannot be read with another,
 * so a mismatch would log every developer out on every request.
 */
function authSecret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured !== undefined && configured.length > 0) return configured;
  return 'dev-insecure-auth-secret-do-not-use-in-production';
}

/**
 * A path that matches no route, used to answer a cloaked refusal (§20).
 *
 * Rewriting to it produces exactly what any unknown address produces — same
 * body, same 404 status — which is the entire point: an unauthorised visitor
 * must not be able to tell « you may not enter » from « there is nothing here ».
 */
const CLOAKED_SEGMENT = '_introuvable';

export default async function middleware(request: NextRequest): Promise<NextResponse> {
  const localeResponse = handleLocale(request);

  // A locale redirect is not a page: re-run the policy once the URL is
  // canonical, on the next request.
  if (isRedirect(localeResponse)) return localeResponse;

  const segments = splitLocale(request.nextUrl.pathname);
  if (segments === null) return localeResponse;
  const { locale, pathname } = segments;

  const session = await readSession(request);
  const decision = evaluate(pathname, session);

  switch (decision.kind) {
    case 'allow':
      return withChromeHint(request, localeResponse, session);

    case 'redirect': {
      const target = request.nextUrl.clone();
      target.pathname = withLocale(locale, decision.to);
      target.search = '';
      if (decision.withReturnTo) {
        target.searchParams.set(RETURN_TO_PARAM, `${pathname}${request.nextUrl.search}`);
      }
      return withChromeHint(request, carryCookies(NextResponse.redirect(target), localeResponse), session);
    }

    case 'notFound': {
      const target = request.nextUrl.clone();
      target.pathname = withLocale(locale, `/${CLOAKED_SEGMENT}`);
      target.search = '';
      return withChromeHint(request, carryCookies(NextResponse.rewrite(target), localeResponse), session);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Chrome hint                                                                 */
/* -------------------------------------------------------------------------- */

/** Which account link the public header shows. Not a permission. */
const CHROME_COOKIE = 'cfi.chrome';

/**
 * Publish which of the three header variants to reveal, as a cookie the
 * pre-paint bootstrap script can read.
 *
 * ## Why this exists
 * `(public)/layout.tsx` used to call `getCurrentUser()` for one header link.
 * Reading cookies on the server makes the whole route dynamic, so every public
 * page was rendered per request and served `Cache-Control: no-store` — which is
 * also the reason both of Lighthouse's back/forward-cache blockers fired. The
 * marketing site could not be cached at an edge because of a link.
 *
 * Middleware already decrypts the token for the route policy, so the answer is
 * free here. The page stays static and identical for everyone; the browser
 * picks a variant from this cookie before the first paint.
 *
 * ## SECURITY — this is a display hint, never an authorisation
 * Deliberately **not** `httpOnly`: the bootstrap script has to read it. It
 * therefore carries no secret and no identifier — one of three fixed words,
 * derived from a token the browser already holds. Forging it reveals nothing
 * and grants nothing: `route-policy` still refuses the navigation and the page
 * guards still refuse the render, so the worst outcome is a link that bounces
 * its own author back to the login page.
 *
 * It is re-derived on every matched request rather than written once at
 * sign-in, so a sign-out, a role change or a hand-edited value corrects itself
 * on the next navigation instead of persisting until someone clears their
 * cookies.
 *
 * ## …but only WRITTEN when it changes
 * The public pages are prerendered and answer `s-maxage=31536000`. A response
 * that also carries `Set-Cookie` is a hazard in front of a shared cache: some
 * CDNs decline to store it, others store it and hand one visitor's header hint
 * to the next. Comparing against the REQUEST's cookie means the header appears
 * only on the handful of navigations where the answer actually changed — sign
 * in, sign out, a role change, a first visit — and every other response stays
 * plainly cacheable.
 *
 * The first version of this compared against `response.cookies`, which is the
 * set of cookies being *written* and is therefore always empty here. It looked
 * correct and re-sent the cookie on every single request.
 */
function withChromeHint(
  request: NextRequest,
  response: NextResponse,
  session: PolicySession | null,
): NextResponse {
  const value = session === null ? 'guest' : ADMIN_ROLES.has(session.role) ? 'admin' : 'student';

  if (request.cookies.get(CHROME_COOKIE)?.value === value) return response;

  response.cookies.set(CHROME_COOKIE, value, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    secure: isProduction(),
    // Outlives a browsing session so a returning visitor's header is right on
    // the very first paint. The session cookie remains the only thing that
    // decides whether they are actually signed in.
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

/**
 * Mirrors `isAdmin()` in `server/auth/permissions.ts`, which cannot be imported
 * here: it reaches the Prisma client, which has no business in the middleware
 * bundle — the same reason `sessionCookieName()` is repeated above. If the role
 * ladder changes, change it here in the same commit; the failure mode is
 * cosmetic (an administrator offered the student link, which still works).
 */
const ADMIN_ROLES: ReadonlySet<string> = new Set(['ADMIN', 'SUPER_ADMIN']);

/* -------------------------------------------------------------------------- */
/* Session                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Decrypt the session cookie into the two facts the policy needs.
 *
 * `salt` is the cookie name: that is how Auth.js derives the encryption key for
 * this specific cookie, so it must be the same string `server/auth/config.ts`
 * registered under `cookies.sessionToken`.
 *
 * Any failure — no cookie, a cookie signed with a rotated secret, a token from
 * before `role`/`status` existed — resolves to `null`, i.e. "anonymous". Failing
 * closed is the only safe direction: the worst case is an extra trip through
 * the login page, where the database-backed guards settle the question.
 */
async function readSession(request: NextRequest): Promise<PolicySession | null> {
  const cookieName = sessionCookieName();

  try {
    const token = await getToken({
      req: request,
      secret: authSecret(),
      salt: cookieName,
      cookieName,
      secureCookie: isProduction(),
    });

    if (token === null) return null;
    const { role, status } = token;
    if (role === undefined || status === undefined) return null;

    return { role, status };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* URL plumbing                                                                */
/* -------------------------------------------------------------------------- */

/** `/fr/espace/profil` → `{ locale: 'fr', pathname: '/espace/profil' }`. */
function splitLocale(pathname: string): { locale: Locale; pathname: string } | null {
  const [, first = '', ...rest] = pathname.split('/');
  if (!isLocale(first)) return null;
  return { locale: first, pathname: `/${rest.join('/')}` };
}

/** `('ar', '/espace')` → `/ar/espace`; `('ar', '/')` → `/ar`. */
function withLocale(locale: Locale, path: string): string {
  return path === '/' ? `/${locale}` : `/${locale}${path}`;
}

function isRedirect(response: NextResponse): boolean {
  return response.status >= 300 && response.status < 400 && response.headers.has('location');
}

/**
 * Keep the cookies `next-intl` set — it writes `NEXT_LOCALE` when the detected
 * locale differs from the stored one, and dropping it would make the visitor
 * re-negotiate their language on every refusal.
 */
function carryCookies(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}

export const config = {
  /**
   * Everything except:
   *   - `/api/**`      — route handlers are locale-agnostic, and they run their
   *                      own Zod + `can()` checks (§20); the guest assistant
   *                      lives there and must stay reachable without a session
   *   - `/_next/**`    — build output
   *   - `/_vercel/**`  — reserved prefix, kept out even though we do not deploy there
   *   - any path containing a dot (`/favicon.ico`, `/robots.txt`, `/og/cover.png`)
   */
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
