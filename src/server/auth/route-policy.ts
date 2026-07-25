import type { AccountStatus, Role } from '@prisma/client';

import { ADMIN_ROLES } from './permissions';

/**
 * The route-access table (§9.1, §8, §20) — one declarative list, one pure
 * function, no framework.
 *
 * ## Why this file imports nothing from Next.js
 * The account-status gate is the rule that decides whether a student who has
 * paid can open their lesson and whether a stranger can open the administration
 * panel. It is worth testing exhaustively — every route × every status × every
 * role — and a test suite that has to boot a request context is a suite nobody
 * runs. {@link evaluate} is therefore total, synchronous and side-effect free:
 * it takes a **locale-less** pathname and the two facts about the visitor that
 * matter, and returns a decision. `src/middleware.ts` translates that decision
 * into a `NextResponse`; nothing else in the file knows that Next.js exists.
 *
 * ## What it is NOT
 * It is not the security boundary on its own. Middleware decides from a signed
 * cookie, which cannot know that an administrator revoked the session or
 * suspended the account four seconds ago. The `Session` table is the authority,
 * and it is consulted in the page/layout guards (`requirePageUser`,
 * `requirePageActiveUser`) and in `withAction`. This table is the *first* gate:
 * it keeps a whole area of the product coherent and cheap to reason about, and
 * it is what makes "a PENDING_APPROVAL account may reach exactly four things"
 * a statement you can read rather than a behaviour you have to reconstruct from
 * twelve `if` blocks.
 *
 * ## §9.1, transcribed
 * > `PENDING_APPROVAL` users can log in, but the only routes they may reach are
 * > the waiting screen, their profile, the public catalog, and the AI assistant
 * > in guest mode.
 *
 * Everything public is public by default (no rule = allowed), so the catalogue
 * and the guest assistant need no entry; the two entries that matter are the
 * carve-out for `/espace/profil` and the `active`-only rule on the rest of
 * `/espace`.
 */

/* -------------------------------------------------------------------------- */
/* The routes this policy names                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every path the policy can send someone to, without its locale prefix.
 *
 * Slugs are French in all four locales (§5). These mirror `AUTH_ROUTES` in
 * `./guards` and the `ACCOUNT_ROUTES` used by the e-mail templates: import the
 * constant, never retype the string.
 */
export const ROUTES = {
  signIn: '/connexion',
  register: '/inscription',
  /** Waiting for the confirmation link — status `PENDING_EMAIL` (§9.1). */
  verifyEmail: '/verification-email',
  /** Waiting for an administrator's decision — status `PENDING_APPROVAL` (§9.1). */
  pendingApproval: '/compte-en-attente',
  /** The account was refused; the screen carries the reason and a way back. */
  rejected: '/compte-refuse',
  /** The account is suspended; the screen explains how to have it reinstated. */
  suspended: '/compte-suspendu',
  /** The authenticated student app (§13). */
  student: '/espace',
  /** The one `/espace` page a not-yet-approved account may open (§9.1). */
  profile: '/espace/profil',
  /** The administration panel (§17). */
  admin: '/admin',
  /** The designed 403: a refusal that must be explained rather than hidden. */
  accessDenied: '/acces-refuse',
  home: '/',
} as const;

/**
 * Query parameter carrying the page to come back to after signing in.
 *
 * French, like every URL in this product, and identical to `RETURN_TO_PARAM` in
 * `./guards` — the two must never drift, because one writes it and the other
 * reads it.
 */
export const RETURN_TO_PARAM = 'suivant';

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Everything a routing decision needs to know about the visitor.
 *
 * Deliberately two fields: middleware resolves them from the encrypted JWT
 * without a database round trip, and anything richer would tempt a caller into
 * making an authorisation decision here that belongs in `can()`.
 */
export interface PolicySession {
  readonly role: Role;
  readonly status: AccountStatus;
}

/**
 * How much of an account a route requires.
 *
 * - `public` — anyone, signed in or not.
 * - `anonymous` — **only** visitors without a session. The sign-in and
 *   registration screens: sending an already-authenticated student back to a
 *   login form is a dead end, not a courtesy.
 * - `authenticated` — a session in good standing: `PENDING_EMAIL`,
 *   `PENDING_APPROVAL` or `ACTIVE`. `REJECTED` and `SUSPENDED` never clear this
 *   bar, exactly as in `permissions.ts`.
 * - `awaitingApproval` — the account has confirmed its address:
 *   `PENDING_APPROVAL` or `ACTIVE`.
 * - `active` — approved by an administrator.
 */
export type MinStatus = 'public' | 'anonymous' | 'authenticated' | 'awaitingApproval' | 'active';

/** One row of the table. */
export interface RouteRequirement {
  /**
   * Locale-less path prefix. Matches the path itself and everything under it,
   * on segment boundaries only: `/espace` matches `/espace/notes` but never
   * `/espaces-verts`.
   */
  readonly pattern: string;
  readonly minStatus: MinStatus;
  /**
   * Statuses allowed on a route that exists *for* one status — the three
   * waiting screens. Checked only when a session exists, so these screens stay
   * reachable by the visitor who was refused at the login door and therefore
   * has no session at all.
   */
  readonly onlyStatuses?: readonly AccountStatus[];
  /** Roles allowed. Checked after the status band. */
  readonly roles?: readonly Role[];
  /**
   * What a role refusal looks like. `notFound` cloaks the route: the visitor
   * cannot tell an area they may not enter from an address that does not exist
   * (§20, admin hardening). Defaults to `redirect`.
   */
  readonly onDeny?: 'redirect' | 'notFound';
  /** Where a role refusal goes. Defaults to {@link ROUTES.accessDenied}. */
  readonly redirectTo?: string;
}

/* -------------------------------------------------------------------------- */
/* Outputs                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Why the visitor was turned away. Carried out of the policy so the middleware
 * can log it and so the tests assert on the *reason*, not only on the target.
 */
export type DenialReason =
  /** No session at all on a route that needs one. */
  | 'unauthenticated'
  /** `PENDING_EMAIL`: the confirmation link has not been used yet. */
  | 'email-unverified'
  /** `PENDING_APPROVAL`: waiting for an administrator (§9.1). */
  | 'awaiting-approval'
  | 'account-rejected'
  | 'account-suspended'
  /** An approved account on a screen that only exists for a different status. */
  | 'wrong-status'
  /** Signed in, on a screen reserved for visitors without a session. */
  | 'already-authenticated'
  /** Status is fine, role is not (§8). */
  | 'insufficient-role';

export type PolicyDecision =
  | { readonly kind: 'allow' }
  | {
      readonly kind: 'redirect';
      /** Locale-less target. The caller prefixes the active locale. */
      readonly to: string;
      readonly reason: DenialReason;
      /**
       * Whether the caller should append `?suivant=` so the visitor lands back
       * where they were going. True only for an anonymous visitor: everyone
       * else is being sent somewhere they must deal with first.
       */
      readonly withReturnTo: boolean;
    }
  | { readonly kind: 'notFound'; readonly reason: DenialReason };

const ALLOW: PolicyDecision = { kind: 'allow' };

/* -------------------------------------------------------------------------- */
/* The table                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The whole route policy. Order is irrelevant — {@link evaluate} matches the
 * **longest** pattern, so a carve-out can never be shadowed by the area it sits
 * in, whatever order somebody adds a row in.
 *
 * Anything absent from this list is public. That is the right default for a
 * product whose catalogue, homepage, legal pages, certificate verification and
 * guest assistant are all meant to be readable by a stranger; the routes that
 * are not are enumerated here, and they are few.
 */
export const ROUTE_POLICY: readonly RouteRequirement[] = [
  /* ── The administration panel (§17, §20) ─────────────────────────────────
     Cloaked, not refused: a signed-in student who guesses the URL gets exactly
     what they would get for any other unknown address. Anonymous visitors are
     still sent to the login page — an administrator following a deep link out
     of e-mail #3 must be able to sign in and arrive where they were headed. */
  { pattern: ROUTES.admin, minStatus: 'active', roles: ADMIN_ROLES, onDeny: 'notFound' },

  /* ── The student app (§13) ───────────────────────────────────────────────
     The profile is the §9.1 carve-out: a student waiting for validation may
     correct their information while they wait. Everything else in /espace
     needs an approved account. */
  { pattern: ROUTES.profile, minStatus: 'awaitingApproval' },
  { pattern: ROUTES.student, minStatus: 'active' },

  /* ── The three status screens ────────────────────────────────────────────
     Each exists for one status, so an account that has moved on is moved on
     with it: an approved student who bookmarked the waiting screen lands on
     their dashboard instead of staring at « en cours de validation ».

     /verification-email is deliberately absent, i.e. public and unconditional:
     it is reached from an e-mail link, usually in a browser with no session,
     and it must keep rendering its success state *after* the status has moved
     to PENDING_APPROVAL. */
  {
    pattern: ROUTES.pendingApproval,
    minStatus: 'authenticated',
    onlyStatuses: ['PENDING_APPROVAL'],
  },
  { pattern: ROUTES.rejected, minStatus: 'public', onlyStatuses: ['REJECTED'] },
  { pattern: ROUTES.suspended, minStatus: 'public', onlyStatuses: ['SUSPENDED'] },

  /* ── The two screens that only make sense signed out ─────────────────────
     Password recovery is NOT here: a signed-in visitor following a reset link
     from their mailbox must be able to use it. */
  { pattern: ROUTES.signIn, minStatus: 'anonymous' },
  { pattern: ROUTES.register, minStatus: 'anonymous' },
];

/** Longest pattern first, computed once. Table order is therefore free. */
const ORDERED_POLICY: readonly RouteRequirement[] = [...ROUTE_POLICY].sort(
  (left, right) => right.pattern.length - left.pattern.length,
);

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where an account belongs when it is turned away from somewhere else.
 *
 * Every status has exactly one home, which is what makes the gate loop-free:
 * a redirect target is always a route the visitor is allowed to open.
 */
export function homeFor(status: AccountStatus): string {
  switch (status) {
    case 'PENDING_EMAIL':
      return ROUTES.verifyEmail;
    case 'PENDING_APPROVAL':
      return ROUTES.pendingApproval;
    case 'ACTIVE':
      return ROUTES.student;
    case 'REJECTED':
      return ROUTES.rejected;
    case 'SUSPENDED':
      return ROUTES.suspended;
  }
}

/**
 * May this visitor open this path?
 *
 * `pathname` is **locale-less** and absolute (`/espace/profil`), with the
 * `/fr` prefix already stripped by the caller — the policy is written once and
 * applies identically to the four locales.
 *
 * Total: every branch returns, nothing throws, nothing awaits.
 */
export function evaluate(pathname: string, session: PolicySession | null): PolicyDecision {
  const path = normalizePath(pathname);
  const rule = ORDERED_POLICY.find((candidate) => isWithin(path, candidate.pattern));

  // Not enumerated → public. See the note on ROUTE_POLICY.
  if (rule === undefined) return ALLOW;

  if (rule.minStatus === 'anonymous') {
    if (session === null) return ALLOW;
    return redirectHome(path, session.status, 'already-authenticated');
  }

  if (session === null) {
    if (rule.minStatus === 'public') return ALLOW;
    return { kind: 'redirect', to: ROUTES.signIn, reason: 'unauthenticated', withReturnTo: true };
  }

  if (!statusSatisfies(session.status, rule.minStatus)) {
    return redirectHome(path, session.status, reasonForStatus(session.status));
  }

  if (rule.onlyStatuses !== undefined && !rule.onlyStatuses.includes(session.status)) {
    return redirectHome(path, session.status, reasonForStatus(session.status));
  }

  if (rule.roles !== undefined && !rule.roles.includes(session.role)) {
    if (rule.onDeny === 'notFound') return { kind: 'notFound', reason: 'insufficient-role' };
    return {
      kind: 'redirect',
      to: rule.redirectTo ?? ROUTES.accessDenied,
      reason: 'insufficient-role',
      withReturnTo: false,
    };
  }

  return ALLOW;
}

/* -------------------------------------------------------------------------- */
/* Return-to                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Validate a `?suivant=` value before navigating to it.
 *
 * An open redirect is a phishing primitive: `?suivant=https://evil.example` on
 * a page the user trusts is how a credential harvester borrows a brand. Only a
 * same-site absolute path survives — one leading slash, no scheme, no
 * protocol-relative `//host`, no backslash (which several browsers normalise to
 * `/`), no control characters.
 *
 * Returns the safe path, or `null`. The value is locale-less, exactly as
 * middleware wrote it: the caller re-prefixes the locale that is active *now*,
 * so switching language on the login screen does not send the visitor back into
 * the language they came from.
 */
export function parseReturnTo(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return null;
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return null;
  if (trimmed.includes('\\')) return null;
  // Control characters, including the CR/LF that would let a value smuggle a
  // second header line into a redirect.
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) return null;

  return trimmed;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A redirect to the visitor's own home — unless they are already inside it, in
 * which case there is nothing to protect them from and bouncing them would be
 * a loop. This is the only place a decision can be downgraded to `allow`.
 */
function redirectHome(path: string, status: AccountStatus, reason: DenialReason): PolicyDecision {
  const target = homeFor(status);
  if (isWithin(path, target)) return ALLOW;
  return { kind: 'redirect', to: target, reason, withReturnTo: false };
}

function statusSatisfies(status: AccountStatus, minStatus: MinStatus): boolean {
  switch (minStatus) {
    case 'public':
    case 'anonymous':
      return true;
    case 'authenticated':
      return status === 'PENDING_EMAIL' || status === 'PENDING_APPROVAL' || status === 'ACTIVE';
    case 'awaitingApproval':
      return status === 'PENDING_APPROVAL' || status === 'ACTIVE';
    case 'active':
      return status === 'ACTIVE';
  }
}

/** The refusal seen from the visitor's side, so the UI can say something true. */
function reasonForStatus(status: AccountStatus): DenialReason {
  switch (status) {
    case 'PENDING_EMAIL':
      return 'email-unverified';
    case 'PENDING_APPROVAL':
      return 'awaiting-approval';
    case 'REJECTED':
      return 'account-rejected';
    case 'SUSPENDED':
      return 'account-suspended';
    case 'ACTIVE':
      return 'wrong-status';
  }
}

/** Prefix match on segment boundaries: `/espace` covers `/espace/notes`, not `/espaces`. */
function isWithin(path: string, prefix: string): boolean {
  if (prefix === '/') return path === '/';
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * `/Espace/Profil/` → `/espace/profil`.
 *
 * Case folding matters: without it `/ADMIN` walks straight past the rule that
 * protects `/admin`, and Next.js would happily route it.
 */
function normalizePath(pathname: string): string {
  const raw = typeof pathname === 'string' && pathname.length > 0 ? pathname : '/';
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutQuery = withLeadingSlash.split('?')[0] ?? '/';
  const withoutHash = withoutQuery.split('#')[0] ?? '/';
  const trimmed =
    withoutHash.length > 1 && withoutHash.endsWith('/') ? withoutHash.slice(0, -1) : withoutHash;
  return trimmed.toLowerCase();
}
