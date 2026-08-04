import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { AccountStatus } from '@prisma/client';

import { ENROLL_CTA_KINDS, resolveEnrollCta } from '@/server/services/catalog/enroll-cta';
import type { ResolveEnrollCtaInput } from '@/server/services/catalog/enroll-cta';
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

const LOCALES = ['fr', 'ar', 'en', 'es'] as const;

const ACCOUNT_STATUSES: ReadonlyArray<AccountStatus | null> = [
  null,
  'PENDING_EMAIL',
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'SUSPENDED',
];

/**
 * Every viewer shape the page can hand the resolver: no history, each
 * enrolment status, each request status. Cross-multiplied with the account
 * statuses this walks the whole input space, so the copy assertions below can
 * discover which kinds are reachable rather than trusting a hand-written list
 * that goes stale the moment a branch is added.
 */
const VIEWERS: ReadonlyArray<ViewerCourseState | null> = [
  null,
  ...(['ACTIVE', 'COMPLETED', 'EXPIRED', 'REVOKED'] as const).map(
    (status): ViewerCourseState => ({
      enrollment: {
        status,
        lastLessonId: null,
        expiresAt: null,
        completedAt: null,
        certificateCode: null,
      },
      request: null,
    }),
  ),
  ...(
    [
      'AWAITING_RECEIPT',
      'UNDER_REVIEW',
      'INFO_REQUESTED',
      'APPROVED',
      'REJECTED',
      'EXPIRED',
      'CANCELLED',
    ] as const
  ).map(
    (status): ViewerCourseState => ({
      enrollment: null,
      request: { reference: 'CFI-2026-000123', status },
    }),
  ),
];

const EVERY_INPUT: ReadonlyArray<ResolveEnrollCtaInput> = ACCOUNT_STATUSES.flatMap(
  (accountStatus) => VIEWERS.map((v) => ({ accountStatus, courseSlug: SLUG, viewer: v })),
);

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

/**
 * The course page renders `t(\`cta.${cta.kind}\`)`. A computed key is invisible
 * to `check-i18n-usage`, which reports it among the "computed keys skipped" —
 * so `blocked`, `requestRejected`, `accessEnded` and `completed` shipped with
 * no label in any locale, and a suspended visitor read the literal string
 * `course.cta.blocked` where the button belongs. Static analysis could not see
 * it and the build was perfectly green. Walking the kinds at runtime can.
 */
describe('every CTA kind has copy to render', () => {
  const MESSAGES = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/messages', `${locale}.json`), 'utf8')),
    ]),
  ) as Record<(typeof LOCALES)[number], { course: { cta: Record<string, string> } }>;

  it.each(LOCALES)('%s has a label for all %i kinds', (locale) => {
    const cta = MESSAGES[locale].course.cta;
    const missing = ENROLL_CTA_KINDS.filter((kind) => typeof cta[kind] !== 'string');
    expect(missing, `${locale}.json is missing course.cta.<kind>`).toEqual([]);
  });

  /**
   * A disabled button with no explanation beside it is a dead end: the visitor
   * is told no, and not told why or what to do instead. `PurchaseCard` renders
   * `cta.${kind}Hint` whenever `actionable` is false, so every such kind owes
   * one. The kinds are discovered by exercising the resolver, not hard-coded,
   * so a newly non-actionable kind is caught the day it appears.
   */
  const nonActionable = [
    ...new Set(
      EVERY_INPUT.map(resolveEnrollCta)
        .filter((cta) => !cta.actionable)
        .map((cta) => cta.kind),
    ),
  ];

  it('found the non-actionable kinds by exercising the resolver', () => {
    expect(nonActionable.sort()).toEqual(['blocked', 'pendingApproval']);
  });

  it.each(LOCALES)('%s explains every disabled button', (locale) => {
    const cta = MESSAGES[locale].course.cta;
    const missing = nonActionable.filter((kind) => typeof cta[`${kind}Hint`] !== 'string');
    expect(missing, `${locale}.json is missing course.cta.<kind>Hint`).toEqual([]);
  });

  /**
   * Guards the third failure mode: a kind that is actionable, navigates
   * nowhere, and opens no dialog renders an ENABLED button that does nothing.
   * `accessEnded` shipped exactly like that.
   */
  it('never renders an enabled button that does nothing', () => {
    const dead = EVERY_INPUT.map(resolveEnrollCta).filter(
      (cta) => cta.actionable && cta.href === null && !cta.opensRequestModal,
    );
    expect(dead.map((c) => c.kind)).toEqual([]);
  });
});
