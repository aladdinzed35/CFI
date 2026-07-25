import type { AccountStatus, EnrollmentStatus, Role } from '@prisma/client';

/**
 * Re-exported so the rest of the auth layer has one place to import identity
 * types from and never reaches into the generated Prisma client for them.
 */
export type { AccountStatus, EnrollmentStatus, Role };

/**
 * The capability matrix (§8) — the single source of truth for "may this actor do
 * this thing?".
 *
 * Every server action, every route handler and every service calls {@link can}.
 * The UI hides what a user cannot do, but hiding is cosmetic: **the server is
 * the authority**, and a hidden button is never the security boundary.
 *
 * ## Why this file has no runtime dependencies
 * It imports types from Prisma and nothing else — no Next.js, no database, no
 * environment. That is deliberate: the whole §22 requirement of "`can()` for
 * every role × action" is a plain table-driven Vitest suite that runs in
 * milliseconds with no fixtures. If this file ever needs to query something,
 * the query belongs in the caller and its result belongs in the `resource`
 * argument.
 *
 * ## Two orthogonal axes
 * A user is gated by their **role** (what kind of actor they are) *and* by their
 * **account status** (§9.1: a `PENDING_APPROVAL` student is a real, logged-in
 * student who may browse the catalogue and edit their profile, but may not
 * consume a lesson or request an enrolment). Both are checked here, in that
 * order, so the two rules can never drift apart in two different call sites.
 */

/* -------------------------------------------------------------------------- */
/* Roles                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every role, weakest first. Kept as a local tuple so the permission tests can
 * iterate exhaustively without importing the generated Prisma client; the
 * `satisfies` clause makes the compiler fail if `schema.prisma` ever changes.
 */
export const ROLES = ['STUDENT', 'INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN'] as const satisfies readonly Role[];

/** Roles that reach the administration panel at all (§17). */
export const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const satisfies readonly Role[];

/** Roles that may author content. */
export const AUTHOR_ROLES = ['INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN'] as const satisfies readonly Role[];

/** The single role allowed near secrets, roles and destructive operations. */
export const OWNER_ROLES = ['SUPER_ADMIN'] as const satisfies readonly Role[];

const ROLE_RANK: Record<Role, number> = {
  STUDENT: 0,
  INSTRUCTOR: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

/** `true` when `role` is at least as privileged as `minimum`. */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** `true` for ADMIN and SUPER_ADMIN. */
export function isAdmin(role: Role): boolean {
  return roleAtLeast(role, 'ADMIN');
}

/* -------------------------------------------------------------------------- */
/* The actor                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The minimum an authorisation decision needs to know about the actor.
 *
 * Anything wider (the full `User` row, the Auth.js session) is structurally
 * assignable to it, so callers pass what they already hold.
 */
export interface PermissionUser {
  readonly id: string;
  readonly role: Role;
  readonly status: AccountStatus;
}

/**
 * The thing being acted upon, reduced to the only two facts the matrix cares
 * about: who teaches the course it belongs to, and who owns it.
 *
 * An `INSTRUCTOR` may edit *their own* courses and grade *their own* students —
 * the row in §8 says "own courses", and this is how "own" is expressed. Resolve
 * `instructorId` from the course the resource hangs off before calling.
 */
export interface ResourceScope {
  /** `Course.instructorId` of the course this resource belongs to. */
  readonly instructorId?: string | null;
  /** The user who created or is the subject of the resource. */
  readonly ownerId?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every capability in §8, one identifier per table row, plus the handful of
 * "act on your own account" capabilities every authenticated user has.
 *
 * Naming is `domain.verb`. Adding one here forces a matrix entry below, and the
 * exhaustiveness of `Record<PermissionAction, …>` is what makes that impossible
 * to forget.
 */
export const PERMISSION_ACTIONS = [
  // ── Row 1: browse the catalogue, request access ────────────────────────────
  'browse.catalog',
  'course.view',
  'enrollment.request',
  // ── Row 2: consume enrolled course content ─────────────────────────────────
  'lesson.consume',
  'discussion.participate',
  'review.write',
  // ── Row 3: author / edit own courses ───────────────────────────────────────
  'course.author',
  // ── Row 4: publish a course ────────────────────────────────────────────────
  'course.publish',
  // ── Row 5: grade assignments in own courses ────────────────────────────────
  'assignment.grade',
  // ── Row 6: moderate discussions in own courses ─────────────────────────────
  'discussion.moderate',
  // ── Row 7: approve / reject accounts ───────────────────────────────────────
  'account.approve',
  // ── Row 8: verify payments, activate enrolments ────────────────────────────
  'payment.verify',
  // ── Row 9: issue refunds / revoke enrolment ────────────────────────────────
  'enrollment.revoke',
  // ── Row 10: manage coupons & pricing ───────────────────────────────────────
  'coupon.manage',
  'pricing.manage',
  // ── Row 11: edit homepage / CMS / settings ─────────────────────────────────
  'cms.edit',
  'settings.edit',
  // ── Row 12: send broadcast e-mails ─────────────────────────────────────────
  'email.broadcast',
  // ── Row 13: AI console, curate answers ─────────────────────────────────────
  'ai.curate',
  // ── Row 14: manage users' roles ────────────────────────────────────────────
  'user.manageRoles',
  // ── Row 15: edit bank details, SMTP, storage, API keys ─────────────────────
  'settings.editSecrets',
  // ── Row 16: impersonate a student (audited, 30 min max) ────────────────────
  'user.impersonate',
  // ── Row 17: view audit log — ADMIN "read", SUPER_ADMIN "full" ──────────────
  'auditLog.view',
  'auditLog.viewFull',
  // ── Row 18: delete data permanently ────────────────────────────────────────
  'data.delete',
  // ── Panel entry points ─────────────────────────────────────────────────────
  'admin.access',
  'instructor.access',
  // ── The AI assistant (§16) ─────────────────────────────────────────────────
  'ai.chatGuest',
  'ai.chat',
  // ── Your own account ───────────────────────────────────────────────────────
  'profile.viewOwn',
  'profile.editOwn',
  'session.manageOwn',
  'account.exportOwn',
  'account.requestDeletionOwn',
] as const;

/** Union of every capability. Exhaustively switchable, exhaustively testable. */
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/* -------------------------------------------------------------------------- */
/* The matrix                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How much of an account must exist before a capability unlocks.
 *
 * - `guest`         — no session required; a visitor may do this.
 * - `authenticated` — a session is required, any status except the two that are
 *                     refused at the door (§9.1: `REJECTED`, `SUSPENDED`). This
 *                     is the band `PENDING_EMAIL` and `PENDING_APPROVAL` live
 *                     in: the waiting screen, the profile, the catalogue.
 * - `active`        — the account has been approved by an administrator.
 */
type StatusRequirement = 'guest' | 'authenticated' | 'active';

interface Rule {
  /** Roles allowed outright, on any resource. */
  readonly roles: readonly Role[];
  /**
   * Roles allowed only on a resource they own — the §8 rows worded "own
   * courses". Ownership is decided by {@link owns} against {@link ResourceScope}.
   */
  readonly ownRoles?: readonly Role[];
  readonly status: StatusRequirement;
}

const ALL_ROLES = ROLES;

/**
 * §8, transcribed. One entry per action; `Record` keyed by the action union, so
 * the compiler rejects a missing row and an unknown one alike.
 */
const MATRIX: Record<PermissionAction, Rule> = {
  /* Row 1 — Browse catalog, request access · STUDENT ✅ INSTRUCTOR ✅ ADMIN ✅ SUPER_ADMIN ✅ */
  'browse.catalog': { roles: ALL_ROLES, status: 'guest' },
  'course.view': { roles: ALL_ROLES, status: 'guest' },
  // Requesting access commits the centre to an operation; an account still
  // waiting for approval cannot start one (§9.1).
  'enrollment.request': { roles: ALL_ROLES, status: 'active' },

  /* Row 2 — Consume enrolled course content · ✅ ✅ ✅ ✅
     The *entitlement* on a specific lesson is `canAccessLesson` below; this row
     only says the role is allowed to be a learner at all. */
  'lesson.consume': { roles: ALL_ROLES, status: 'active' },
  'discussion.participate': { roles: ALL_ROLES, status: 'active' },
  'review.write': { roles: ALL_ROLES, status: 'active' },

  /* Row 3 — Author / edit own courses · — ✅ ✅ ✅ */
  'course.author': { roles: ADMIN_ROLES, ownRoles: ['INSTRUCTOR'], status: 'active' },

  /* Row 4 — Publish a course · — — ✅ ✅ */
  'course.publish': { roles: ADMIN_ROLES, status: 'active' },

  /* Row 5 — Grade assignments in own courses · — ✅ ✅ ✅ */
  'assignment.grade': { roles: ADMIN_ROLES, ownRoles: ['INSTRUCTOR'], status: 'active' },

  /* Row 6 — Moderate discussions in own courses · — ✅ ✅ ✅ */
  'discussion.moderate': { roles: ADMIN_ROLES, ownRoles: ['INSTRUCTOR'], status: 'active' },

  /* Row 7 — Approve / reject accounts · — — ✅ ✅ */
  'account.approve': { roles: ADMIN_ROLES, status: 'active' },

  /* Row 8 — Verify payments, activate enrollments · — — ✅ ✅ */
  'payment.verify': { roles: ADMIN_ROLES, status: 'active' },

  /* Row 9 — Issue refunds / revoke enrollment · — — ✅ ✅ */
  'enrollment.revoke': { roles: ADMIN_ROLES, status: 'active' },

  /* Row 10 — Manage coupons & pricing · — — ✅ ✅ */
  'coupon.manage': { roles: ADMIN_ROLES, status: 'active' },
  'pricing.manage': { roles: ADMIN_ROLES, status: 'active' },

  /* Row 11 — Edit homepage / CMS / settings · — — ✅ ✅
     Secrets are carved out of this row by `settings.editSecrets` (row 15). */
  'cms.edit': { roles: ADMIN_ROLES, status: 'active' },
  'settings.edit': { roles: ADMIN_ROLES, status: 'active' },

  /* Row 12 — Send broadcast emails · — — ✅ ✅ */
  'email.broadcast': { roles: ADMIN_ROLES, status: 'active' },

  /* Row 13 — AI console: curate answers · — — ✅ ✅ */
  'ai.curate': { roles: ADMIN_ROLES, status: 'active' },

  /* Row 14 — Manage users' roles · — — — ✅ */
  'user.manageRoles': { roles: OWNER_ROLES, status: 'active' },

  /* Row 15 — Edit bank details, SMTP, storage, API keys · — — — ✅ */
  'settings.editSecrets': { roles: OWNER_ROLES, status: 'active' },

  /* Row 16 — Impersonate a student (audited, 30 min max) · — — — ✅ */
  'user.impersonate': { roles: OWNER_ROLES, status: 'active' },

  /* Row 17 — View audit log · — — read full
     `auditLog.view` is the "read" cell an ADMIN gets: the timeline, filtered.
     `auditLog.viewFull` is the SUPER_ADMIN "full" cell: raw diffs, which can
     contain settings values an ADMIN is not allowed to see (row 15), plus
     export and retention operations. */
  'auditLog.view': { roles: ADMIN_ROLES, status: 'active' },
  'auditLog.viewFull': { roles: OWNER_ROLES, status: 'active' },

  /* Row 18 — Delete data permanently · — — — ✅ */
  'data.delete': { roles: OWNER_ROLES, status: 'active' },

  /* Panel entry points — derived from the rows above, named so a layout can ask
     one question instead of twelve. */
  'admin.access': { roles: ADMIN_ROLES, status: 'active' },
  'instructor.access': { roles: AUTHOR_ROLES, status: 'active' },

  /* AI assistant (§16). Guest mode is public and answers only from public
     chunks; the tutor needs an approved account, and retrieval is additionally
     entitlement-filtered by `canAccessLesson`. */
  'ai.chatGuest': { roles: ALL_ROLES, status: 'guest' },
  'ai.chat': { roles: ALL_ROLES, status: 'active' },

  /* Your own account. Available while waiting for e-mail confirmation or for an
     administrator's decision — that is exactly the band §9.1 describes. */
  'profile.viewOwn': { roles: ALL_ROLES, status: 'authenticated' },
  'profile.editOwn': { roles: ALL_ROLES, status: 'authenticated' },
  'session.manageOwn': { roles: ALL_ROLES, status: 'authenticated' },
  'account.exportOwn': { roles: ALL_ROLES, status: 'authenticated' },
  'account.requestDeletionOwn': { roles: ALL_ROLES, status: 'authenticated' },
};

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

/**
 * May `user` perform `action`, optionally on `resource`?
 *
 * `user` is `null` for a visitor with no session. Pass `resource` whenever the
 * action has an "own …" cell in §8 — omitting it there means "no ownership
 * claim", and an `INSTRUCTOR` is correctly refused.
 *
 * Total and synchronous: it never throws, never queries, never awaits. Use
 * `assertCan` from `./guards` when a refusal should abort the operation.
 */
export function can(
  user: PermissionUser | null | undefined,
  action: PermissionAction,
  resource?: ResourceScope,
): boolean {
  const rule = MATRIX[action];

  if (rule.status === 'guest' && (user === null || user === undefined)) return true;
  if (user === null || user === undefined) return false;

  if (!statusSatisfies(user.status, rule.status)) return false;

  if (rule.roles.includes(user.role)) return true;
  if (rule.ownRoles !== undefined && rule.ownRoles.includes(user.role)) {
    return owns(user, resource);
  }

  return false;
}

/** Every action `user` may perform with no resource in hand — for building a menu. */
export function allowedActions(user: PermissionUser | null): readonly PermissionAction[] {
  return PERMISSION_ACTIONS.filter((action) => can(user, action));
}

/**
 * Does the account status clear the bar the rule sets?
 *
 * `REJECTED` and `SUSPENDED` clear nothing above `guest`: they are refused at
 * login (§20) and this is the second line of defence, for a session minted
 * before the status changed.
 */
function statusSatisfies(status: AccountStatus, requirement: StatusRequirement): boolean {
  switch (requirement) {
    case 'guest':
      return true;
    case 'authenticated':
      return status === 'PENDING_EMAIL' || status === 'PENDING_APPROVAL' || status === 'ACTIVE';
    case 'active':
      return status === 'ACTIVE';
  }
}

/** Ownership for the "own courses" rows: instructor of the course, or creator. */
function owns(user: PermissionUser, resource: ResourceScope | undefined): boolean {
  if (resource === undefined) return false;
  if (resource.instructorId !== undefined && resource.instructorId !== null) {
    return resource.instructorId === user.id;
  }
  if (resource.ownerId !== undefined && resource.ownerId !== null) {
    return resource.ownerId === user.id;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Lesson entitlement (§8, the six call sites)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Everything the entitlement decision needs, gathered by the caller.
 *
 * The caller does the queries — `prerequisitesMet` in particular is a join the
 * course service already performs — and this function does the reasoning. That
 * split is what lets the §22 access-gate suite enumerate every combination of
 * role × enrolment state without a database.
 */
export interface LessonAccessContext {
  readonly lesson: {
    readonly isPreview: boolean;
    readonly isPublished: boolean;
  };
  readonly module: {
    readonly isPublished: boolean;
    /** Drip: days after activation before the module opens. `null` = immediate. */
    readonly unlockAfterDays: number | null;
  };
  readonly course: {
    readonly instructorId: string | null;
  };
  /** The actor's enrolment in this course, or `null` when there is none. */
  readonly enrollment: {
    readonly status: EnrollmentStatus;
    readonly activatedAt: Date;
    readonly expiresAt: Date | null;
  } | null;
  /** Strict prerequisites (§7) satisfied. Pass `true` when the course has none. */
  readonly prerequisitesMet: boolean;
  /** Injectable clock, so drip windows are testable. Defaults to now. */
  readonly now?: Date;
}

/** Why access was refused — one code per branch, so the UI can say something useful. */
export type LessonAccessDenial =
  | 'lesson-unpublished'
  | 'not-authenticated'
  | 'account-not-active'
  | 'not-enrolled'
  | 'enrollment-revoked'
  | 'enrollment-expired'
  | 'module-locked'
  | 'prerequisites-unmet';

export interface LessonAccessResult {
  readonly allowed: boolean;
  /** `null` when allowed. */
  readonly reason: LessonAccessDenial | null;
}

/**
 * The §8 predicate, with the refusal reason kept:
 *
 * ```
 * canAccessLesson(user, lesson) =
 *   lesson.isPreview
 *   || user.role in [ADMIN, SUPER_ADMIN]
 *   || (user.role === INSTRUCTOR && ownsCourse(user, lesson))
 *   || (hasActiveEnrollment(user, lesson.course)
 *       && enrollmentNotExpired
 *       && moduleDripUnlocked(user, lesson.module)
 *       && prerequisitesMet(user, lesson))
 * ```
 *
 * Staff are evaluated **before** the publication check rather than after,
 * because an administrator and the owning instructor must be able to open an
 * unpublished draft — that is the whole point of a draft. Everyone else,
 * preview lesson or not, needs the lesson and its module published.
 *
 * The same result gates all six call sites in §8: the lesson page, the video
 * playback token endpoint, the private file proxy, resource downloads, quiz
 * start, and AI retrieval scope. One function, six callers, one test suite.
 */
export function lessonAccess(
  user: PermissionUser | null | undefined,
  context: LessonAccessContext,
): LessonAccessResult {
  const now = context.now ?? new Date();

  // Staff and the owning instructor see everything in their scope, drafts
  // included — but only while their own account is in good standing.
  if (user !== null && user !== undefined && statusSatisfies(user.status, 'active')) {
    if (isAdmin(user.role)) return ALLOWED;
    if (
      user.role === 'INSTRUCTOR' &&
      context.course.instructorId !== null &&
      context.course.instructorId === user.id
    ) {
      return ALLOWED;
    }
  }

  if (!context.lesson.isPublished || !context.module.isPublished) {
    return denied('lesson-unpublished');
  }

  // A preview lesson is the marketing sample: open to guests and to
  // non-enrolled visitors alike (§12.4).
  if (context.lesson.isPreview) return ALLOWED;

  if (user === null || user === undefined) return denied('not-authenticated');
  if (!statusSatisfies(user.status, 'active')) return denied('account-not-active');

  const enrollment = context.enrollment;
  if (enrollment === null) return denied('not-enrolled');

  switch (enrollment.status) {
    case 'REVOKED':
      return denied('enrollment-revoked');
    case 'EXPIRED':
      return denied('enrollment-expired');
    case 'ACTIVE':
    case 'COMPLETED':
      break;
  }

  if (enrollment.expiresAt !== null && enrollment.expiresAt.getTime() <= now.getTime()) {
    return denied('enrollment-expired');
  }

  if (!dripUnlocked(context.module.unlockAfterDays, enrollment.activatedAt, now)) {
    return denied('module-locked');
  }

  if (!context.prerequisitesMet) return denied('prerequisites-unmet');

  return ALLOWED;
}

/** The boolean form of {@link lessonAccess}, for call sites that only branch. */
export function canAccessLesson(
  user: PermissionUser | null | undefined,
  context: LessonAccessContext,
): boolean {
  return lessonAccess(user, context).allowed;
}

/**
 * The moment a dripped module opens: `activatedAt + unlockAfterDays`.
 *
 * Returns `null` when the module has no drip delay. Exported so the player can
 * render « Disponible le 12 mars » instead of an anonymous padlock.
 */
export function moduleUnlocksAt(unlockAfterDays: number | null, activatedAt: Date): Date | null {
  if (unlockAfterDays === null || !Number.isFinite(unlockAfterDays) || unlockAfterDays <= 0) {
    return null;
  }
  return new Date(activatedAt.getTime() + unlockAfterDays * DAY_MS);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED: LessonAccessResult = { allowed: true, reason: null };

function denied(reason: LessonAccessDenial): LessonAccessResult {
  return { allowed: false, reason };
}

function dripUnlocked(unlockAfterDays: number | null, activatedAt: Date, now: Date): boolean {
  const unlocksAt = moduleUnlocksAt(unlockAfterDays, activatedAt);
  return unlocksAt === null || unlocksAt.getTime() <= now.getTime();
}
