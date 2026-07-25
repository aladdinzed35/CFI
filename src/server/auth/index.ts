/**
 * The authentication layer's public surface.
 *
 * Import from `@/server/auth`, not from the individual modules — the split
 * between `config`, `guards`, `permissions`, `password` and `session` is an
 * internal one and may move.
 *
 * The one exception is `@/server/auth/permissions`: it is deliberately free of
 * Next.js, Prisma and environment imports so the §22 capability-matrix suite can
 * load it on its own, and importing it directly keeps that property visible.
 *
 * Layering (§5): pages and components never import this file's database-backed
 * helpers directly for *data* — they go through a service. What they do import
 * is the guards, because "who is asking" is a cross-cutting concern that every
 * layer needs.
 */

/* ── Auth.js handles ─────────────────────────────────────────────────────── */
export { auth, authConfig, handlers, signIn, signOut } from './config';
export { AUTH_ERROR_CODES, LoginError, authErrorCode, type AuthErrorCode } from './config';

/* ── Guards, and the wrapper every server action goes through ────────────── */
export {
  ActionError,
  AUTH_ROUTES,
  AuthenticationError,
  AuthorizationError,
  CsrfError,
  RETURN_TO_PARAM,
  RateLimitedError,
  assertCan,
  assertSameOrigin,
  getCurrentSessionId,
  getCurrentUser,
  redirectToSignIn,
  redirectToWaitingScreen,
  requestContext,
  requireActiveUser,
  requireAdmin,
  requirePageActiveUser,
  requirePageAdmin,
  requirePageRole,
  requirePageUser,
  requireRole,
  requireSuperAdmin,
  requireUser,
  toActionResult,
  withAction,
  type ActionContext,
  type ActionErrorCode,
  type ActionResult,
  type AuthenticatedActionContext,
  type WithActionOptions,
} from './guards';

/* ── The §8 capability matrix ────────────────────────────────────────────── */
export {
  ADMIN_ROLES,
  AUTHOR_ROLES,
  OWNER_ROLES,
  PERMISSION_ACTIONS,
  ROLES,
  allowedActions,
  can,
  canAccessLesson,
  isAdmin,
  lessonAccess,
  moduleUnlocksAt,
  roleAtLeast,
  type AccountStatus,
  type LessonAccessContext,
  type LessonAccessDenial,
  type LessonAccessResult,
  type PermissionAction,
  type PermissionUser,
  type ResourceScope,
  type Role,
} from './permissions';

/* ── Password hashing ────────────────────────────────────────────────────── */
export {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PARAMS,
  dummyVerify,
  hashPassword,
  needsRehash,
  parsePhc,
  verifyPassword,
  type PhcParameters,
} from './password';

/* ── Sessions ────────────────────────────────────────────────────────────── */
export {
  SESSION_ABSOLUTE_MAX_DAYS,
  clientIpFrom,
  createSession,
  listSessions,
  parseDeviceLabel,
  purgeDeadSessions,
  revokeAllForUser,
  revokeSession,
  revokeSessionByToken,
  sessionCookieDescriptor,
  sessionCookieName,
  sessionTtlDays,
  sessionTtlSeconds,
  touchLastSeen,
  userAgentFrom,
  validateSession,
  type CreateSessionInput,
  type CreatedSession,
  type RevokeAllOptions,
  type SessionSummary,
  type SessionUser,
  type ValidatedSession,
} from './session';
