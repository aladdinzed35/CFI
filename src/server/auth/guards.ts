import { headers } from 'next/headers';
import { z } from 'zod';

import { env } from '@/lib/env';
import { consumePolicy, type RateLimitPolicy } from '@/lib/rate-limit';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

import { auth } from './config';
import { can, type PermissionAction, type ResourceScope, type Role } from './permissions';
import { clientIpFrom, userAgentFrom, type SessionUser } from './session';

/**
 * Server-side guards and the shared server-action wrapper (§20).
 *
 * Two families live here, and the difference matters:
 *
 * - **Throwing guards** — `requireUser`, `requireActiveUser`, `requireRole`,
 *   `requireAdmin`, `assertCan`. They raise a typed error. Use them inside
 *   actions, route handlers and services, where a refusal is a *result* to be
 *   reported, not a navigation.
 * - **Redirecting guards** — the `requirePage…` family. They send the visitor
 *   somewhere sensible: an anonymous user to the login page with a `suivant`
 *   parameter, an unapproved account to its waiting screen. Use them at the top
 *   of a protected page or layout, where a thrown error would only produce an
 *   error boundary and a dead end.
 *
 * Both are backed by the same `auth()` call, which resolves the encrypted JWT
 * against the `Session` table on every request.
 */

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/** No session at all. Maps to `{ ok: false, error: 'unauthenticated' }`. */
export class AuthenticationError extends Error {
  readonly code = 'unauthenticated' as const;

  constructor(message = 'Authentification requise.') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/** A session exists but is not allowed to do this. */
export class AuthorizationError extends Error {
  readonly code = 'forbidden' as const;
  /** The capability that was refused, when the refusal came from `can()`. */
  readonly action: PermissionAction | undefined;

  constructor(message = 'Action non autorisée.', action?: PermissionAction) {
    super(message);
    this.name = 'AuthorizationError';
    this.action = action;
  }
}

/** The request did not come from this site. */
export class CsrfError extends Error {
  readonly code = 'csrf' as const;

  constructor(message = 'Origine de la requête non reconnue.') {
    super(message);
    this.name = 'CsrfError';
  }
}

/** A rate-limit budget was exhausted. */
export class RateLimitedError extends Error {
  readonly code = 'rate_limited' as const;
  readonly retryAfterSec: number;

  constructor(retryAfterSec: number, message = 'Trop de tentatives.') {
    super(message);
    this.name = 'RateLimitedError';
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * A business rule refused the operation. Thrown by services; `withAction` turns
 * it into `{ ok: false, error, message }` where `message` is an **i18n key**,
 * never a sentence.
 */
export class ActionError extends Error {
  readonly code: ActionErrorCode;
  readonly fieldErrors: Readonly<Record<string, readonly string[]>> | undefined;

  constructor(
    code: ActionErrorCode,
    messageKey: string,
    fieldErrors?: Readonly<Record<string, readonly string[]>>,
  ) {
    super(messageKey);
    this.name = 'ActionError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

/* -------------------------------------------------------------------------- */
/* Reading the session                                                         */
/* -------------------------------------------------------------------------- */

/** The current user, or `null`. Never throws. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (user === undefined || user === null) return null;

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    status: user.status,
    locale: user.locale,
    avatarKey: user.avatarKey,
  };
}

/** The id of the `Session` row backing this request — for « Déconnecter cet appareil ». */
export async function getCurrentSessionId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.sessionId ?? null;
}

/* -------------------------------------------------------------------------- */
/* Throwing guards                                                             */
/* -------------------------------------------------------------------------- */

/** A logged-in user of any status. @throws AuthenticationError */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (user === null) throw new AuthenticationError();
  return user;
}

/**
 * A logged-in user whose account has been approved (§9.1).
 *
 * `PENDING_EMAIL` and `PENDING_APPROVAL` accounts are logged in but not yet
 * operational, so they are refused here rather than at the door.
 *
 * @throws AuthenticationError | AuthorizationError
 */
export async function requireActiveUser(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.status !== 'ACTIVE') {
    throw new AuthorizationError("Le compte n'est pas encore actif.");
  }
  return user;
}

/**
 * An approved user holding one of `roles`.
 *
 * @throws AuthenticationError | AuthorizationError
 */
export async function requireRole(...roles: readonly Role[]): Promise<SessionUser> {
  const user = await requireActiveUser();
  if (!roles.includes(user.role)) {
    throw new AuthorizationError('Rôle insuffisant pour cette action.');
  }
  return user;
}

/** ADMIN or SUPER_ADMIN. @throws AuthenticationError | AuthorizationError */
export async function requireAdmin(): Promise<SessionUser> {
  return requireRole('ADMIN', 'SUPER_ADMIN');
}

/** SUPER_ADMIN only — roles, secrets, impersonation, permanent deletion (§8). */
export async function requireSuperAdmin(): Promise<SessionUser> {
  return requireRole('SUPER_ADMIN');
}

/**
 * The capability check, in assertion form.
 *
 * `can()` is the decision; this is the enforcement. Every mutation that is not
 * already covered by a `withAction` `can` option must call it explicitly.
 *
 * @throws AuthorizationError
 */
export function assertCan(
  user: SessionUser | null,
  action: PermissionAction,
  resource?: ResourceScope,
): void {
  if (!can(user, action, resource)) {
    throw new AuthorizationError(`Capacité refusée : ${action}.`, action);
  }
}

/* -------------------------------------------------------------------------- */
/* Redirecting guards (pages and layouts)                                      */
/* -------------------------------------------------------------------------- */

/**
 * The authenticated routes referenced by the guards, without their locale
 * prefix. Exported so the pages that implement them cannot drift: import the
 * constant, do not retype the string.
 */
export const AUTH_ROUTES = {
  signIn: '/connexion',
  /** Waiting for the confirmation link (§9.1, status `PENDING_EMAIL`). */
  pendingEmail: '/verification-email',
  /** Waiting for an administrator's decision (§9.1, status `PENDING_APPROVAL`). */
  pendingApproval: '/compte-en-attente',
  /** Where an approved but under-privileged user is sent instead of a 403 page. */
  home: '/espace',
} as const;

/** Query parameter carrying the page to return to after signing in. French, like every URL. */
export const RETURN_TO_PARAM = 'suivant';

/**
 * Send an anonymous visitor to the login page, remembering where they were going.
 *
 * The `return` is load-bearing: `redirect()` never comes back, but TypeScript
 * only uses a call's `never` return for control-flow analysis when the callee
 * carries an explicit type annotation — and next-intl's `redirect` is inferred
 * from `createNavigation`. Returning it states the same thing in a form the
 * compiler accepts, which is what lets callers narrow after the call.
 */
export function redirectToSignIn(locale: Locale, returnTo?: string): never {
  const query = returnTo === undefined ? undefined : { [RETURN_TO_PARAM]: returnTo };
  return redirect({ href: { pathname: AUTH_ROUTES.signIn, query }, locale });
}

/** Send a logged-in but not-yet-approved account to the screen that explains why. */
export function redirectToWaitingScreen(locale: Locale, status: SessionUser['status']): never {
  return redirect({
    href: status === 'PENDING_EMAIL' ? AUTH_ROUTES.pendingEmail : AUTH_ROUTES.pendingApproval,
    locale,
  });
}

/** Page guard: any logged-in user, or off to the login page. */
export async function requirePageUser(locale: Locale, returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (user === null) redirectToSignIn(locale, returnTo);
  return user;
}

/** Page guard: an approved account, or off to the login page / the waiting screen. */
export async function requirePageActiveUser(
  locale: Locale,
  returnTo?: string,
): Promise<SessionUser> {
  const user = await requirePageUser(locale, returnTo);
  if (user.status !== 'ACTIVE') redirectToWaitingScreen(locale, user.status);
  return user;
}

/** Page guard: an approved account holding one of `roles`, or back to the dashboard. */
export async function requirePageRole(
  locale: Locale,
  ...roles: readonly Role[]
): Promise<SessionUser> {
  const user = await requirePageActiveUser(locale);
  if (!roles.includes(user.role)) redirect({ href: AUTH_ROUTES.home, locale });
  return user;
}

/** Page guard for `/admin/**`. */
export async function requirePageAdmin(locale: Locale): Promise<SessionUser> {
  return requirePageRole(locale, 'ADMIN', 'SUPER_ADMIN');
}

/* -------------------------------------------------------------------------- */
/* Request provenance                                                          */
/* -------------------------------------------------------------------------- */

/** IP and user agent of the current request, for rate limiting and audit rows. */
export async function requestContext(): Promise<{
  readonly ip: string | null;
  readonly userAgent: string | null;
}> {
  const list = await headers();
  return { ip: clientIpFrom(list), userAgent: userAgentFrom(list) };
}

/**
 * Explicit `Origin` / `Host` assertion, on top of what Server Actions already do
 * (§20).
 *
 * Next.js checks the origin of a Server Action itself, and `SameSite=Lax`
 * blocks the cross-site POST in the browser. This is the third layer, and the
 * only one this codebase controls end to end: it also covers mutating **route
 * handlers**, which get none of the Server Action machinery.
 *
 * A missing `Origin` is a failure, not a pass. Every browser sends it on a POST;
 * a request without one is either forged or not a browser, and neither should be
 * mutating data through this path.
 *
 * @throws CsrfError
 */
export async function assertSameOrigin(): Promise<void> {
  const list = await headers();
  const origin = list.get('origin');
  const host = list.get('x-forwarded-host') ?? list.get('host');

  if (origin === null || origin.length === 0) throw new CsrfError();
  if (host === null || host.length === 0) throw new CsrfError();

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new CsrfError();
  }

  if (originHost === host) return;
  if (originHost === canonicalHost()) return;

  throw new CsrfError();
}

let canonicalHostCache: string | null = null;

/** Host of `APP_URL` — accepted in addition to the forwarded host, for proxy rewrites. */
function canonicalHost(): string {
  if (canonicalHostCache === null) {
    try {
      canonicalHostCache = new URL(env.APP_URL).host;
    } catch {
      canonicalHostCache = '';
    }
  }
  return canonicalHostCache;
}

/* -------------------------------------------------------------------------- */
/* withAction — the shared server-action wrapper                               */
/* -------------------------------------------------------------------------- */

/**
 * Why an action failed. The client maps these to a translated message; the
 * server never composes a user-facing sentence (rule 5).
 */
export type ActionErrorCode =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'csrf'
  | 'rate_limited'
  | 'not_found'
  | 'conflict'
  | 'server_error';

/**
 * The one shape every server action returns. Discriminated on `ok`, so a caller
 * that forgets to handle the failure branch does not compile.
 */
export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error: ActionErrorCode;
      /** i18n key, never a sentence. Absent when `error` alone says enough. */
      readonly message?: string;
      /** Field name → Zod messages, ready for `setError` in react-hook-form. */
      readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
      /** Seconds to wait, on `rate_limited`. */
      readonly retryAfterSec?: number;
    };

/** What the wrapper hands the handler alongside the validated input. */
export interface ActionContext {
  readonly user: SessionUser | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** The same, once authentication has been enforced. */
export interface AuthenticatedActionContext extends ActionContext {
  readonly user: SessionUser;
}

export interface WithActionOptions<TInput> {
  /**
   * - `'user'` (default) — a session is required, any status.
   * - `'active'` — the account must be approved (§9.1).
   * - `'public'` — no session; `ctx.user` may be `null`.
   */
  readonly auth?: 'public' | 'user' | 'active';
  /** Additional role restriction, checked after `auth`. */
  readonly roles?: readonly Role[];
  /** Capability from the §8 matrix, checked with `can()`. */
  readonly can?: PermissionAction;
  /**
   * Resolve the resource the capability applies to — the "own courses" rows.
   * Runs after validation, so it may query with the parsed input.
   */
  readonly resource?: (
    input: TInput,
    ctx: ActionContext,
  ) => ResourceScope | undefined | Promise<ResourceScope | undefined>;
  /** In-process rate limit. Return `null` from `identify` to skip. */
  readonly rateLimit?: {
    readonly policy: RateLimitPolicy;
    readonly identify: (input: TInput, ctx: ActionContext) => string | null;
  };
  /**
   * Skip the explicit Origin check. Only for actions invoked outside a browser
   * request — a cron runner, a job worker — where there is no `Origin` to check.
   * Never for anything a form can reach.
   */
  readonly skipOriginCheck?: boolean;
}

type ContextFor<TOptions> = TOptions extends { auth: 'public' }
  ? ActionContext
  : AuthenticatedActionContext;

/**
 * Wrap a server action.
 *
 * ```ts
 * 'use server';
 * export const approveAccount = withAction(
 *   z.object({ userId: z.string().cuid(), note: z.string().max(500).optional() }).strict(),
 *   async (input, ctx) => accounts.approve(input.userId, ctx.user),
 *   { auth: 'active', can: 'account.approve' },
 * );
 * ```
 *
 * The order is fixed and is the order §20 requires:
 *
 * 1. **Origin/Host** assertion — before a single byte of input is trusted.
 * 2. **Zod `.strict()`** validation — the wrapper *refuses to run* if the schema
 *    is a non-strict object, because "reject unknown keys" is not something a
 *    hundred future actions can be trusted to remember.
 * 3. **Session** resolution and the `auth` / `roles` gate.
 * 4. **Capability** check through `can()`, with the resource resolved from the
 *    now-validated input.
 * 5. **Rate limit**.
 * 6. The handler — the first line that is allowed to touch the database.
 *
 * `ctx.user` is typed non-nullable unless `auth: 'public'`, so a handler cannot
 * accidentally treat an anonymous caller as a user.
 *
 * Accepts either a plain object or `FormData`, so the same action works with
 * `react-hook-form` and with a progressively-enhanced `<form action={…}>`.
 * Nothing throws out of the returned function: every failure, including an
 * unexpected one, comes back as `{ ok: false }`.
 */
export function withAction<
  TSchema extends z.ZodTypeAny,
  TResult,
  TOptions extends WithActionOptions<z.output<TSchema>> = WithActionOptions<z.output<TSchema>>,
>(
  schema: TSchema,
  handler: (input: z.output<TSchema>, ctx: ContextFor<TOptions>) => Promise<TResult>,
  options?: TOptions,
): (input: unknown) => Promise<ActionResult<TResult>> {
  assertStrictSchema(schema);
  const config: WithActionOptions<z.output<TSchema>> = options ?? {};
  const authMode = config.auth ?? 'user';

  return async (input: unknown): Promise<ActionResult<TResult>> => {
    try {
      // 1 — CSRF.
      if (config.skipOriginCheck !== true) await assertSameOrigin();

      // 2 — Validation, before authorization and before the database (§20).
      const parsed = schema.safeParse(normalizeInput(input));
      if (!parsed.success) {
        return {
          ok: false,
          error: 'validation',
          fieldErrors: flattenFieldErrors(parsed.error),
        };
      }
      const data: z.output<TSchema> = parsed.data;

      // 3 — Session.
      const { ip, userAgent } = await requestContext();
      const user = await getCurrentUser();
      const ctx: ActionContext = { user, ip, userAgent };

      if (authMode !== 'public') {
        if (user === null) return { ok: false, error: 'unauthenticated' };
        if (authMode === 'active' && user.status !== 'ACTIVE') {
          return { ok: false, error: 'forbidden', message: 'auth.accountNotActive' };
        }
        if (config.roles !== undefined && !config.roles.includes(user.role)) {
          return { ok: false, error: 'forbidden' };
        }
      }

      // 4 — Capability.
      if (config.can !== undefined) {
        const resource = config.resource === undefined ? undefined : await config.resource(data, ctx);
        if (!can(user, config.can, resource)) {
          return { ok: false, error: 'forbidden' };
        }
      }

      // 5 — Rate limit.
      if (config.rateLimit !== undefined) {
        const identifier = config.rateLimit.identify(data, ctx);
        if (identifier !== null) {
          const verdict = consumePolicy(config.rateLimit.policy, identifier);
          if (!verdict.allowed) {
            return {
              ok: false,
              error: 'rate_limited',
              retryAfterSec: verdict.retryAfterSec,
            };
          }
        }
      }

      // 6 — The handler. `ctx` is narrowed by construction: `authMode !== 'public'`
      //     has already returned when `user` is null.
      const result = await handler(data, ctx as ContextFor<TOptions>);
      return { ok: true, data: result };
    } catch (error) {
      return toActionResult(error);
    }
  };
}

/**
 * Translate a thrown error into the failure branch.
 *
 * `redirect()` and `notFound()` work by throwing a control-flow signal that
 * Next.js catches upstream; swallowing it here would turn a redirect into a
 * silent no-op, so those are re-thrown untouched.
 */
export function toActionResult<T>(error: unknown): ActionResult<T> {
  if (isNextControlFlow(error)) throw error;

  if (error instanceof ActionError) {
    return {
      ok: false,
      error: error.code,
      message: error.message,
      ...(error.fieldErrors === undefined ? {} : { fieldErrors: error.fieldErrors }),
    };
  }
  if (error instanceof AuthenticationError) return { ok: false, error: 'unauthenticated' };
  if (error instanceof AuthorizationError) return { ok: false, error: 'forbidden' };
  if (error instanceof CsrfError) return { ok: false, error: 'csrf' };
  if (error instanceof RateLimitedError) {
    return { ok: false, error: 'rate_limited', retryAfterSec: error.retryAfterSec };
  }
  if (error instanceof z.ZodError) {
    return { ok: false, error: 'validation', fieldErrors: flattenFieldErrors(error) };
  }

  // Unknown failures are logged server-side and reduced to a generic code: a
  // stack trace or a Prisma message must never reach the browser.
  console.error('[withAction] erreur non gérée', error);
  return { ok: false, error: 'server_error' };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Next.js signals `redirect()` and `notFound()` by throwing an error carrying a
 * `digest` string. Detected structurally because the marker is not exported.
 */
function isNextControlFlow(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const digest: unknown = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND');
}

/**
 * §20 requires `.strict()` on every boundary schema. Checked once, when the
 * action module is loaded — so a forgetful `z.object({…})` fails at boot in
 * development rather than silently accepting an extra field in production.
 */
function assertStrictSchema(schema: z.ZodTypeAny): void {
  const unwrapped = unwrapEffects(schema);
  if (unwrapped instanceof z.ZodObject) {
    const unknownKeys: unknown = unwrapped._def.unknownKeys;
    if (unknownKeys !== 'strict') {
      throw new Error(
        "withAction : le schéma doit être déclaré avec .strict() — les clés inconnues doivent être rejetées (§20). Ajoutez .strict() à l'objet Zod.",
      );
    }
  }
}

/** Look through `.refine()`, `.transform()` and friends to find the underlying object. */
function unwrapEffects(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = schema;
  for (let depth = 0; depth < 10; depth += 1) {
    if (current instanceof z.ZodEffects) {
      current = current.innerType();
      continue;
    }
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap();
      continue;
    }
    if (current instanceof z.ZodDefault) {
      current = current.removeDefault();
      continue;
    }
    return current;
  }
  return current;
}

/**
 * Accept `FormData` as well as a plain object.
 *
 * Repeated keys become arrays, which is what a multi-select or a checkbox group
 * posts; `File` values are passed through untouched for the receipt upload.
 */
function normalizeInput(input: unknown): unknown {
  if (!(input instanceof FormData)) return input;

  const result: Record<string, unknown> = {};
  for (const [key, value] of input.entries()) {
    const existing = result[key];
    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  }
  return result;
}

/** Zod's `fieldErrors`, plus the form-level issues under the `_form` key. */
function flattenFieldErrors(error: z.ZodError): Readonly<Record<string, readonly string[]>> {
  const flattened = error.flatten();
  const fields: Record<string, readonly string[]> = {};

  for (const [key, messages] of Object.entries(flattened.fieldErrors)) {
    if (messages !== undefined && messages.length > 0) fields[key] = messages;
  }
  if (flattened.formErrors.length > 0) fields._form = flattened.formErrors;

  return fields;
}
