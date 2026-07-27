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

export type EnrollCtaKind =
  /** Not signed in — register, and come back here afterwards. */
  | 'guest'
  /** Signed in, e-mail not confirmed. */
  | 'pendingEmail'
  /** Confirmed, waiting for an administrator. Disabled, with an explanation. */
  | 'pendingApproval'
  /** Refused or suspended: no purchase path, only a way to reach a human. */
  | 'blocked'
  /** Active, not enrolled, no request in flight — the buying state. */
  | 'active'
  /** A request exists and is being handled. */
  | 'requestPending'
  /** A request was refused; they may correct it and try again. */
  | 'requestRejected'
  /** Enrolled and in progress. */
  | 'enrolled'
  /** Finished — revisit, and collect the certificate. */
  | 'completed'
  /** Access lapsed or was revoked. */
  | 'accessEnded';

export interface EnrollCta {
  readonly kind: EnrollCtaKind;
  /** `false` renders the button disabled with an explanation beside it. */
  readonly actionable: boolean;
  /** Locale-relative target, or `null` when the CTA does not navigate. */
  readonly href: string | null;
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
        href: `/espace/formations/${courseSlug}`,
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
        href: `/espace/formations/${courseSlug}`,
        lastLessonId: enrollment.lastLessonId,
      };
    }

    // EXPIRED or REVOKED: they had access and no longer do. Saying so plainly
    // beats showing a buy button as though nothing had happened.
    return { ...base, kind: 'accessEnded', actionable: true, href: null };
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

  // 7 — active, nothing in the way.
  return { ...base, kind: 'active', actionable: true, href: null };
}
