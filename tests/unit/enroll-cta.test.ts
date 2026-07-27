import { describe, expect, it } from 'vitest';

import { resolveEnrollCta } from '@/server/services/catalog/enroll-cta';
import type { ViewerCourseState } from '@/server/services/catalog/course-detail';

/**
 * §12.4's seven visitor states. These are conversion-critical AND
 * authorisation-adjacent: offering « Demander l'accès » to an account that is
 * suspended, or a purchase button to someone already enrolled, is the kind of
 * defect that reaches a paying student before anyone notices.
 */

const SLUG = 'marketing-digital-fondations';

function viewer(partial: Partial<ViewerCourseState>): ViewerCourseState {
  return { enrollment: null, request: null, ...partial };
}

function enrollment(
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'REVOKED',
  extra: { certificateCode?: string | null; lastLessonId?: string | null } = {},
): ViewerCourseState {
  return viewer({
    enrollment: {
      status,
      lastLessonId: extra.lastLessonId ?? null,
      expiresAt: null,
      completedAt: null,
      certificateCode: extra.certificateCode ?? null,
    },
  });
}

describe('resolveEnrollCta — account status outranks everything', () => {
  it('sends an anonymous visitor to register, and back to this course after', () => {
    const cta = resolveEnrollCta({ accountStatus: null, courseSlug: SLUG, viewer: null });

    expect(cta.kind).toBe('guest');
    expect(cta.actionable).toBe(true);
    // Losing the return path is the difference between a registration that
    // converts and one that strands the visitor on a dashboard.
    expect(cta.href).toContain(encodeURIComponent(`/formations/${SLUG}`));
  });

  it('sends an unconfirmed account to the verification screen', () => {
    const cta = resolveEnrollCta({
      accountStatus: 'PENDING_EMAIL',
      courseSlug: SLUG,
      viewer: null,
    });
    expect(cta.kind).toBe('pendingEmail');
    expect(cta.href).toBe('/verification-email');
  });

  it('disables the CTA while an account waits for approval', () => {
    const cta = resolveEnrollCta({
      accountStatus: 'PENDING_APPROVAL',
      courseSlug: SLUG,
      viewer: null,
    });
    expect(cta.kind).toBe('pendingApproval');
    expect(cta.actionable).toBe(false);
    expect(cta.href).toBeNull();
  });

  it.each(['REJECTED', 'SUSPENDED'] as const)('blocks a %s account', (status) => {
    const cta = resolveEnrollCta({ accountStatus: status, courseSlug: SLUG, viewer: null });
    expect(cta.kind).toBe('blocked');
    expect(cta.actionable).toBe(false);
  });

  it('NEVER offers a purchase path to a suspended account, even one already enrolled', () => {
    const cta = resolveEnrollCta({
      accountStatus: 'SUSPENDED',
      courseSlug: SLUG,
      viewer: enrollment('ACTIVE'),
    });
    expect(cta.kind).toBe('blocked');
    expect(cta.actionable).toBe(false);
  });
});

describe('resolveEnrollCta — enrolment', () => {
  it('offers to continue when enrolled, carrying the last lesson', () => {
    const cta = resolveEnrollCta({
      accountStatus: 'ACTIVE',
      courseSlug: SLUG,
      viewer: enrollment('ACTIVE', { lastLessonId: 'lesson-7' }),
    });
    expect(cta.kind).toBe('enrolled');
    expect(cta.lastLessonId).toBe('lesson-7');
  });

  it('offers the certificate once completed', () => {
    const cta = resolveEnrollCta({
      accountStatus: 'ACTIVE',
      courseSlug: SLUG,
      viewer: enrollment('COMPLETED', { certificateCode: 'CFI-CERT-2026-000042' }),
    });
    expect(cta.kind).toBe('completed');
    expect(cta.certificateCode).toBe('CFI-CERT-2026-000042');
  });

  it('offers no certificate when the service withheld one', () => {
    const cta = resolveEnrollCta({
      accountStatus: 'ACTIVE',
      courseSlug: SLUG,
      viewer: enrollment('COMPLETED', { certificateCode: null }),
    });
    expect(cta.kind).toBe('completed');
    expect(cta.certificateCode).toBeNull();
  });

  it.each(['EXPIRED', 'REVOKED'] as const)('says access ended for a %s enrolment', (status) => {
    const cta = resolveEnrollCta({
      accountStatus: 'ACTIVE',
      courseSlug: SLUG,
      viewer: enrollment(status),
    });
    // Showing a buy button as though nothing had happened would be a lie about
    // what they previously paid for.
    expect(cta.kind).toBe('accessEnded');
  });
});

describe('resolveEnrollCta — requests in flight', () => {
  it.each(['AWAITING_RECEIPT', 'UNDER_REVIEW', 'APPROVED'] as const)(
    'reports a %s request as pending',
    (status) => {
      const cta = resolveEnrollCta({
        accountStatus: 'ACTIVE',
        courseSlug: SLUG,
        viewer: viewer({ request: { reference: 'CFI-2026-000123', status } }),
      });
      expect(cta.kind).toBe('requestPending');
      expect(cta.requestReference).toBe('CFI-2026-000123');
    },
  );

  it('lets a refused request be corrected', () => {
    const cta = resolveEnrollCta({
      accountStatus: 'ACTIVE',
      courseSlug: SLUG,
      viewer: viewer({ request: { reference: 'CFI-2026-000123', status: 'REJECTED' } }),
    });
    expect(cta.kind).toBe('requestRejected');
    expect(cta.actionable).toBe(true);
  });

  it.each(['CANCELLED', 'EXPIRED'] as const)(
    'lets an active account ask again after a %s request',
    (status) => {
      const cta = resolveEnrollCta({
        accountStatus: 'ACTIVE',
        courseSlug: SLUG,
        viewer: viewer({ request: { reference: 'CFI-2026-000123', status } }),
      });
      expect(cta.kind).toBe('active');
    },
  );

  it('offers the purchase path to an active account with no history', () => {
    const cta = resolveEnrollCta({ accountStatus: 'ACTIVE', courseSlug: SLUG, viewer: null });
    expect(cta.kind).toBe('active');
    expect(cta.actionable).toBe(true);
  });
});
