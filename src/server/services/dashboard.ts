/**
 * Read model for `/admin` — the §17.1 dashboard.
 *
 * ## Every number here is a query, and only numbers that are queries appear
 * §17.1 also describes a watch-time heatmap, a completion funnel and an AI
 * spend line. Those read columns this milestone does not produce, and a chart
 * drawn from invented data would make the panel lie about the business on its
 * first screen — so they are absent rather than approximated (rule 8).
 *
 * What is here is the part §17.1 puts first and the owner opens the panel for:
 * the action band (what is waiting for a decision, with its age), and the
 * revenue actually banked over a period, counted from `Payment.receivedAt`,
 * next to the same figure for the period immediately before it.
 *
 * ## A missing capability yields no number, never an error
 * The dashboard is one screen composed of several queues, each behind its own
 * §8 capability. An administrator without `payment.verify` must still get their
 * accounts band, so every block resolves independently and a refusal degrades
 * to `visible: false` rather than failing the page.
 */

import type { Prisma } from '@prisma/client';

import { db } from '@/server/db';
import { can, type PermissionUser } from '@/server/auth/permissions';
import { accountCounts, type AccountCounts } from '@/server/services/accounts/queries';
import { requestQueueCounts } from '@/server/services/enrollment/admin-queries';

/* -------------------------------------------------------------------------- */
/* Period                                                                      */
/* -------------------------------------------------------------------------- */

/** The §17.1 period selector, in the URL's own vocabulary. */
export const DASHBOARD_PERIODS = ['7j', '30j', '90j', '12m'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriod = '30j';

export function isDashboardPeriod(value: unknown): value is DashboardPeriod {
  return typeof value === 'string' && (DASHBOARD_PERIODS as readonly string[]).includes(value);
}

const DAY_MS = 24 * 60 * 60 * 1_000;

const PERIOD_DAYS: Record<DashboardPeriod, number> = {
  '7j': 7,
  '30j': 30,
  '90j': 90,
  '12m': 365,
};

export interface PeriodWindow {
  readonly from: Date;
  readonly to: Date;
  /** The window of the same length immediately before `from`, for the delta. */
  readonly previousFrom: Date;
  readonly previousTo: Date;
}

export function periodWindow(period: DashboardPeriod, now: Date = new Date()): PeriodWindow {
  const span = PERIOD_DAYS[period] * DAY_MS;
  const from = new Date(now.getTime() - span);
  return {
    from,
    to: now,
    previousFrom: new Date(from.getTime() - span),
    previousTo: from,
  };
}

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/** « À traiter maintenant » — one entry per queue that has a decision waiting. */
export interface DashboardBand {
  readonly accounts: {
    readonly visible: boolean;
    readonly pending: number;
    /** Hours the oldest waiting account has been there; drives the SLA colour. */
    readonly oldestHours: number | null;
  };
  readonly requests: {
    readonly visible: boolean;
    readonly toVerify: number;
    readonly oldestHours: number | null;
  };
  /**
   * Requests that will expire on their own within {@link EXPIRING_WINDOW_DAYS}
   * unless somebody acts — the queue that goes quiet precisely because nobody
   * is looking at it.
   */
  readonly expiring: {
    readonly visible: boolean;
    readonly count: number;
    readonly soonestAt: Date | null;
  };
}

export interface DashboardKpis {
  readonly visible: boolean;
  readonly period: DashboardPeriod;
  readonly window: PeriodWindow;
  /** Sum of `Payment.amountCentimes` received inside the window. Integer centimes. */
  readonly revenueCentimes: number;
  readonly previousRevenueCentimes: number;
  /** Rounded percentage change, or `null` when the previous period banked nothing. */
  readonly revenueChangePercent: number | null;
  /** Enrolments activated in the window that came from a paid request. */
  readonly paidEnrollments: number;
  readonly requestsCreated: number;
  readonly requestsApproved: number;
  /** Approved ÷ created over the window, or `null` when nothing was requested. */
  readonly conversionPercent: number | null;
}

export interface DashboardData {
  readonly band: DashboardBand;
  readonly kpis: DashboardKpis;
  readonly accounts: AccountCounts;
  /** `false` when the actor may not read the account counters at all. */
  readonly accountsVisible: boolean;
}

/** How far ahead the « expire bientôt » card looks. */
export const EXPIRING_WINDOW_DAYS = 3;

/** Request states that still need a human before they lapse (§9.2). */
const OPEN_REQUEST_STATUSES = ['AWAITING_RECEIPT', 'UNDER_REVIEW', 'INFO_REQUESTED'] as const;

const EMPTY_ACCOUNTS: AccountCounts = {
  pendingApproval: 0,
  pendingEmail: 0,
  active: 0,
  rejected: 0,
  suspended: 0,
  oldestPendingHours: null,
};

/* -------------------------------------------------------------------------- */
/* Load                                                                        */
/* -------------------------------------------------------------------------- */

export async function loadDashboard(
  actor: PermissionUser,
  period: DashboardPeriod = DEFAULT_DASHBOARD_PERIOD,
  now: Date = new Date(),
): Promise<DashboardData> {
  const window = periodWindow(period, now);
  const seesAccounts = can(actor, 'account.approve');
  const seesPayments = can(actor, 'payment.verify');

  const [accountsResult, requestsResult, expiring, kpis] = await Promise.all([
    seesAccounts ? accountCounts(actor, db, now) : Promise.resolve(null),
    seesPayments ? requestQueueCounts(actor, now) : Promise.resolve(null),
    seesPayments ? loadExpiring(now) : Promise.resolve(null),
    seesPayments ? loadKpis(window) : Promise.resolve(null),
  ]);

  const accounts = accountsResult !== null && accountsResult.ok ? accountsResult.data : EMPTY_ACCOUNTS;
  const requests = requestsResult !== null && requestsResult.ok ? requestsResult.data : null;

  return {
    accountsVisible: seesAccounts && accountsResult !== null && accountsResult.ok,
    accounts,
    band: {
      accounts: {
        visible: seesAccounts,
        pending: accounts.pendingApproval,
        oldestHours: accounts.oldestPendingHours,
      },
      requests: {
        visible: seesPayments,
        toVerify: requests?.UNDER_REVIEW ?? 0,
        oldestHours: requests?.oldestUnderReviewHours ?? null,
      },
      expiring: {
        visible: seesPayments,
        count: expiring?.count ?? 0,
        soonestAt: expiring?.soonestAt ?? null,
      },
    },
    kpis: {
      visible: seesPayments,
      period,
      window,
      revenueCentimes: kpis?.revenueCentimes ?? 0,
      previousRevenueCentimes: kpis?.previousRevenueCentimes ?? 0,
      revenueChangePercent: kpis?.revenueChangePercent ?? null,
      paidEnrollments: kpis?.paidEnrollments ?? 0,
      requestsCreated: kpis?.requestsCreated ?? 0,
      requestsApproved: kpis?.requestsApproved ?? 0,
      conversionPercent: kpis?.conversionPercent ?? null,
    },
  };
}

async function loadExpiring(
  now: Date,
): Promise<{ readonly count: number; readonly soonestAt: Date | null }> {
  const horizon = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * DAY_MS);
  const where: Prisma.EnrollmentRequestWhereInput = {
    status: { in: [...OPEN_REQUEST_STATUSES] },
    expiresAt: { gt: now, lte: horizon },
  };

  const [count, soonest] = await Promise.all([
    db.enrollmentRequest.count({ where }),
    db.enrollmentRequest.findFirst({
      where,
      orderBy: { expiresAt: 'asc' },
      select: { expiresAt: true },
    }),
  ]);

  return { count, soonestAt: soonest?.expiresAt ?? null };
}

interface KpiTotals {
  readonly revenueCentimes: number;
  readonly previousRevenueCentimes: number;
  readonly revenueChangePercent: number | null;
  readonly paidEnrollments: number;
  readonly requestsCreated: number;
  readonly requestsApproved: number;
  readonly conversionPercent: number | null;
}

async function loadKpis(window: PeriodWindow): Promise<KpiTotals> {
  const [revenue, previousRevenue, paidEnrollments, requestsCreated, requestsApproved] =
    await Promise.all([
      db.payment.aggregate({
        where: { receivedAt: { gte: window.from, lte: window.to } },
        _sum: { amountCentimes: true },
      }),
      db.payment.aggregate({
        where: { receivedAt: { gte: window.previousFrom, lt: window.previousTo } },
        _sum: { amountCentimes: true },
      }),
      db.enrollment.count({
        where: { source: 'PAID_REQUEST', activatedAt: { gte: window.from, lte: window.to } },
      }),
      db.enrollmentRequest.count({ where: { createdAt: { gte: window.from, lte: window.to } } }),
      db.enrollmentRequest.count({
        where: { createdAt: { gte: window.from, lte: window.to }, status: 'APPROVED' },
      }),
    ]);

  const revenueCentimes = revenue._sum.amountCentimes ?? 0;
  const previousRevenueCentimes = previousRevenue._sum.amountCentimes ?? 0;

  return {
    revenueCentimes,
    previousRevenueCentimes,
    // A percentage against zero is not "+100 %", it is undefined — the screen
    // says nothing rather than inventing a baseline.
    revenueChangePercent:
      previousRevenueCentimes === 0
        ? null
        : Math.round(((revenueCentimes - previousRevenueCentimes) / previousRevenueCentimes) * 100),
    paidEnrollments,
    requestsCreated,
    requestsApproved,
    conversionPercent:
      requestsCreated === 0 ? null : Math.round((requestsApproved / requestsCreated) * 100),
  };
}
