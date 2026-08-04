import type { AccountStatus } from '@prisma/client';

import type { ViewerCourseState } from '@/server/services/catalog/course-detail';

/**
 * Which call to action the course page shows, as ONE pure function.
 *
 * §12.4 specifies seven visitor states and a different CTA for each. Spread
 * across JSX conditionals they drift: someone adds an eighth case, a branch
 * stops being reachable, and a `PENDING_APPROVAL` visitor is quietly offered a
 * purchase button. Here the mapping is a single exhaustive expression that a
 * unit test can walk end to end without rendering anything.
 *
 * The order of the checks is the specification's order, and it matters. Account
 * status is resolved BEFORE enrolment, because an account that is suspended or
 * awaiting approval must be told that regardless of what it may already own.
 */

/**
 * Every CTA this resolver can emit, as a VALUE and not only a type.
 *
 * The course page renders `t(\`cta.${cta.kind}\`)` — a computed key, which the
 * i18n usage checker cannot follow and therefore skips. Four kinds shipped with
 * no label in any locale, so a suspended visitor read the literal string
 * `course.cta.blocked` where the button should be. A runtime list lets a unit
 * test walk the kinds against the message files, which is the only thing that
 * closes that gap: adding a kind without a label now fails the suite.
 */
export const ENROLL_CTA_KINDS = [
  /** Not signed in — register, and come back here afterwards. */
  'guest',
  /** Signed in, e-mail not confirmed. */
  'pendingEmail',
  /** Confirmed, waiting for an administrator. Disabled, with an explanation. */
  'pendingApproval',
  /** Refused or suspended: no purchase path, only a way to reach a human. */
  'blocked',
  /** Active, not enrolled, no request in flight — the buying state. */
  'active',
  /** A request exists and is being handled. */
  'requestPending',
  /** A request was refused; they may correct it and try again. */
  'requestRejected',
  /** Enrolled and in progress. */
  'enrolled',
  /** Finished — revisit, and collect the certificate. */
  'completed',
  /** Access lapsed or was revoked; re-requesting is open to them. */
  'accessEnded',
] as const;

export type EnrollCtaKind = (typeof ENROLL_CTA_KINDS)[number];

export interface EnrollCta {
  readonly kind: EnrollCtaKind;
  /** `false` renders the button disabled with an explanation beside it. */
  readonly actionable: boolean;
  /** Locale-relative target, or `null` when the CTA does not navigate. */
  readonly href: string | null;
  /**
   * The buying state, and the only one where the button opens the §9.2 modal
   * instead of going somewhere. It is a flag rather than an `href` because the
   * enrollment request is created in place, on this page, from data the page
   * already resolved — a route would mean a second page that only exists to
   * host a dialog, and a `kind === 'active'` test scattered across the JSX is
   * exactly the drift this module was written to prevent.
   */
  readonly opensRequestModal: boolean;
  /** Deep link for `Continuer la formation`, when one is known. */
  readonly lastLessonId: string | null;
  /** Present only in `completed`, and only when the certificate is valid. */
  readonly certificateCode: string | null;
  /** Present whenever a request exists, so the page can show its reference. */
  readonly requestReference: string | null;
}

export interface ResolveEnrollCtaInput {
  /** `null` for an anonymous visitor. */
  readonly accountStatus: AccountStatus | null;
  readonly courseSlug: string;
  /** `null` when the visitor is anonymous or has no history with this course. */
  readonly viewer: ViewerCourseState | null;
}

export function resolveEnrollCta({
  accountStatus,
  courseSlug,
  viewer,
}: ResolveEnrollCtaInput): EnrollCta {
  const base = {
    lastLessonId: null,
    certificateCode: null,
    requestReference: viewer?.request?.reference ?? null,
    opensRequestModal: false,
  } as const;

  // 1 — anonymous. `?suivant=` brings them back to this exact course, which is
  // the difference between a registration that converts and one that strands
  // the visitor on a dashboard wondering what they were doing.
  if (accountStatus === null) {
    return {
      ...base,
      kind: 'guest',
      actionable: true,
      href: `/inscription?suivant=${encodeURIComponent(`/formations/${courseSlug}`)}`,
    };
  }

  // 2-4 — account state outranks anything they own.
  if (accountStatus === 'PENDING_EMAIL') {
    return { ...base, kind: 'pendingEmail', actionable: true, href: '/verification-email' };
  }
  if (accountStatus === 'PENDING_APPROVAL') {
    return { ...base, kind: 'pendingApproval', actionable: false, href: null };
  }
  if (accountStatus === 'REJECTED' || accountStatus === 'SUSPENDED') {
    return { ...base, kind: 'blocked', actionable: false, href: null };
  }

  // 5 — enrolment, strongest first.
  const enrollment = viewer?.enrollment ?? null;
  if (enrollment !== null) {
    if (enrollment.status === 'COMPLETED') {
      return {
        ...base,
        kind: 'completed',
        actionable: true,
        // The player lives at `/espace/formations/[slug]`, an M4 route that does
        // not exist yet. Linking it anyway 404s the two commonest signed-in CTAs
        // on the conversion page, so until M4 lands this goes to the space the
        // student actually has. `check-routes` now covers this file, so the
        // one-line change back cannot be forgotten silently.
        href: '/espace',
        lastLessonId: enrollment.lastLessonId,
        // Already null for a revoked certificate — `getViewerCourseState`
        // resolves that, so a revoked one is never offered for download.
        certificateCode: enrollment.certificateCode,
      };
    }

    if (enrollment.status === 'ACTIVE') {
      return {
        ...base,
        kind: 'enrolled',
        actionable: true,
        // See `completed` above — M4 route, not built yet.
        href: '/espace',
        lastLessonId: enrollment.lastLessonId,
      };
    }

    // EXPIRED or REVOKED: they had access and no longer do. Saying so plainly
    // beats showing a buy button as though nothing had happened — but a dead
    // enabled button is worse than either. `createEnrollmentRequest` refuses
    // only an ACTIVE enrolment, so re-requesting is genuinely open to them:
    // this opens the same modal under a « Renouveler » label, which
    // acknowledges the earlier purchase instead of ignoring it.
    return { ...base, kind: 'accessEnded', actionable: true, href: null, opensRequestModal: true };
  }

  // 6 — a request in flight.
  const request = viewer?.request ?? null;
  if (request !== null) {
    if (request.status === 'REJECTED') {
      return { ...base, kind: 'requestRejected', actionable: true, href: '/espace/demandes' };
    }
    if (request.status !== 'CANCELLED' && request.status !== 'EXPIRED') {
      return { ...base, kind: 'requestPending', actionable: true, href: '/espace/demandes' };
    }
    // Cancelled or expired requests fall through: they may simply ask again.
  }

  // 7 — active, nothing in the way. The §9.2 modal opens here.
  return { ...base, kind: 'active', actionable: true, href: null, opensRequestModal: true };
}
