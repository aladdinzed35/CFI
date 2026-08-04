import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight, ClipboardCheck, FileCheck, Hourglass, Inbox, Percent, Users, Wallet } from 'lucide-react';

import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { requirePageAdmin } from '@/server/auth/guards';
import {
  DASHBOARD_PERIODS,
  DEFAULT_DASHBOARD_PERIOD,
  isDashboardPeriod,
  loadDashboard,
  type DashboardPeriod,
} from '@/server/services/dashboard';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard } from '@/components/ui/stat-card';

/**
 * `/admin` — the dashboard (§17.1).
 *
 * ## The action band comes first, because it is the job
 * Three queues, each counted in the database on this request, each a one-click
 * deep link into the *filtered* list rather than into the list: accounts
 * awaiting validation, transfers awaiting verification, and requests about to
 * expire on their own. The first two colour themselves by age — amber past
 * 24 h, red past 48 h — which is the whole point of an SLA column.
 *
 * ## Counters that are queries, and nothing else
 * The KPI row is revenue actually banked over the selected period (summed from
 * `Payment.receivedAt`, compared with the period immediately before it), the
 * enrolments that period produced, and the share of requests that converted.
 * §17.1's charts — watch-time heatmap, completion funnel, AI spend — read
 * columns this milestone does not produce, so they are absent rather than
 * approximated (rule 8).
 */

type LocaleParams = { locale: string };
type RawSearchParams = Record<string, string | string[] | undefined>;

/** French, like every URL in this application (§10.1). */
const PERIOD_PARAM = 'periode';

/** SLA colouring of the action band (§17.1). */
const SLA_WARN_HOURS = 24;
const SLA_DANGER_HOURS = 48;

type BandTone = 'calm' | 'warn' | 'danger';

function bandTone(pending: number, oldestHours: number | null): BandTone {
  if (pending === 0 || oldestHours === null) return 'calm';
  if (oldestHours >= SLA_DANGER_HOURS) return 'danger';
  if (oldestHours >= SLA_WARN_HOURS) return 'warn';
  return 'calm';
}

const BAND_SURFACE: Record<BandTone, string> = {
  calm: 'border-strait/40 bg-strait-wash',
  warn: 'border-warn/50 bg-warn-wash',
  danger: 'border-danger/50 bg-danger-wash',
};

const BAND_NUMBER: Record<BandTone, string> = {
  calm: 'text-strait',
  warn: 'text-warn',
  danger: 'text-danger',
};

/** Sub-key of `admin.dashboard.periods` for each period. */
const PERIOD_LABEL_KEY: Record<DashboardPeriod, string> = {
  '7j': 'periods.d7',
  '30j': 'periods.d30',
  '90j': 'periods.d90',
  '12m': 'periods.m12',
};

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function AdminDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<LocaleParams>;
  searchParams: Promise<RawSearchParams>;
}): Promise<React.JSX.Element> {
  const [{ locale }, rawSearch] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  const user = await requirePageAdmin(locale);

  const [t, tAccounts, tRequests, tEnrollment] = await Promise.all([
    getTranslations('admin.dashboard'),
    getTranslations('admin.accounts'),
    getTranslations('admin.requests'),
    getTranslations('enrollment'),
  ]);

  const rawPeriod = firstValue(rawSearch[PERIOD_PARAM]);
  const period: DashboardPeriod = isDashboardPeriod(rawPeriod) ? rawPeriod : DEFAULT_DASHBOARD_PERIOD;

  const { band, kpis, accounts, accountsVisible } = await loadDashboard(user, period);

  const accountsTone = bandTone(band.accounts.pending, band.accounts.oldestHours);
  const requestsTone = bandTone(band.requests.toVerify, band.requests.oldestHours);

  const nothingWaiting =
    band.accounts.pending === 0 && band.requests.toVerify === 0 && band.expiring.count === 0;

  const breakdown = [
    {
      key: 'active',
      href: '/admin/comptes?onglet=actifs',
      label: tAccounts('status.active'),
      value: accounts.active,
    },
    {
      key: 'pendingEmail',
      href: '/admin/comptes?onglet=attente-email',
      label: tAccounts('status.pendingEmail'),
      value: accounts.pendingEmail,
    },
    {
      key: 'rejected',
      href: '/admin/comptes?onglet=refuses',
      label: tAccounts('status.rejected'),
      value: accounts.rejected,
    },
    {
      key: 'suspended',
      href: '/admin/comptes?onglet=suspendus',
      label: tAccounts('status.suspended'),
      value: accounts.suspended,
    },
  ] as const;

  const revenueTrendLabel =
    kpis.revenueChangePercent === null
      ? null
      : t('vsPrevious', {
          percent: `${kpis.revenueChangePercent > 0 ? '+' : ''}${kpis.revenueChangePercent}`,
        });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-title text-ink">{t('title')}</h1>
        <p className="text-sm text-ink-muted">{t('subtitle')}</p>
      </header>

      {/* ── The action band ─────────────────────────────────────────────── */}
      <section aria-labelledby="bande-action" className="mt-6">
        <h2 id="bande-action" className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
          {t('bandLabel')}
        </h2>

        {nothingWaiting ? (
          <EmptyState
            className="mt-3"
            size="sm"
            illustration={<Inbox aria-hidden="true" />}
            title={t('clearTitle')}
            description={band.requests.visible ? t('requestsClear') : t('clearBody')}
          />
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {band.accounts.visible && band.accounts.pending > 0 ? (
              <BandCard
                tone={accountsTone}
                icon={<ClipboardCheck className="size-8 shrink-0" aria-hidden="true" />}
                count={band.accounts.pending}
                headline={t('accountsToReview', { count: band.accounts.pending })}
                detail={
                  band.accounts.oldestHours === null
                    ? null
                    : t('oldestWaiting', { hours: band.accounts.oldestHours })
                }
                href="/admin/comptes?onglet=a-valider"
                cta={t('accountsCta')}
              />
            ) : null}

            {band.requests.visible && band.requests.toVerify > 0 ? (
              <BandCard
                tone={requestsTone}
                icon={<FileCheck className="size-8 shrink-0" aria-hidden="true" />}
                count={band.requests.toVerify}
                headline={t('requestsToVerify', { count: band.requests.toVerify })}
                detail={
                  band.requests.oldestHours === null
                    ? null
                    : t('requestsOldestWaiting', { hours: band.requests.oldestHours })
                }
                href="/admin/demandes?onglet=a-verifier"
                cta={t('requestsCta')}
              />
            ) : null}

            {band.expiring.visible && band.expiring.count > 0 ? (
              <BandCard
                tone="warn"
                icon={<Hourglass className="size-8 shrink-0" aria-hidden="true" />}
                count={band.expiring.count}
                headline={tRequests('tabs.awaitingReceipt')}
                detail={
                  band.expiring.soonestAt === null
                    ? null
                    : tEnrollment('status.card.expiresOn', {
                        date: formatDate(band.expiring.soonestAt, locale),
                      })
                }
                href="/admin/demandes?onglet=attente-justificatif"
                cta={t('requestsCta')}
              />
            ) : null}
          </div>
        )}
      </section>

      {/* ── Period + KPI row ────────────────────────────────────────────── */}
      {kpis.visible ? (
        <section aria-labelledby="periode" className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="periode" className="font-display text-heading text-ink">
              {t('revenueTitle')}
            </h2>

            <nav aria-label={t('periodLabel')} className="flex flex-wrap items-center gap-1">
              {DASHBOARD_PERIODS.map((entry) => {
                const active = entry === period;
                return (
                  <Link
                    key={entry}
                    href={
                      entry === DEFAULT_DASHBOARD_PERIOD
                        ? '/admin'
                        : `/admin?${PERIOD_PARAM}=${entry}`
                    }
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-11 items-center rounded-pill border px-3 text-sm',
                      'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                      active
                        ? 'border-strait bg-strait-wash text-ink'
                        : 'border-hairline bg-surface text-ink-muted hover:bg-raised hover:text-ink',
                    )}
                  >
                    {t(PERIOD_LABEL_KEY[entry])}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label={t('revenueTitle')}
              value={formatMoney(kpis.revenueCentimes, locale)}
              tone="brass"
              icon={<Wallet aria-hidden="true" />}
              hint={kpis.revenueCentimes === 0 ? t('revenueEmpty') : t('revenueHint')}
              {...(revenueTrendLabel === null
                ? {}
                : {
                    trend: {
                      direction:
                        kpis.revenueChangePercent === null || kpis.revenueChangePercent === 0
                          ? ('flat' as const)
                          : kpis.revenueChangePercent > 0
                            ? ('up' as const)
                            : ('down' as const),
                      label: revenueTrendLabel,
                      intent:
                        kpis.revenueChangePercent === null || kpis.revenueChangePercent === 0
                          ? ('neutral' as const)
                          : kpis.revenueChangePercent > 0
                            ? ('positive' as const)
                            : ('negative' as const),
                    },
                  })}
            />

            <StatCard
              label={t('paidEnrollments', { count: kpis.paidEnrollments })}
              value={String(kpis.paidEnrollments)}
              icon={<Users aria-hidden="true" />}
            />

            <StatCard
              label={t('conversionRate')}
              value={kpis.conversionPercent === null ? '—' : `${kpis.conversionPercent} %`}
              icon={<Percent aria-hidden="true" />}
              hint={tRequests('resultCount', { count: kpis.requestsCreated })}
            />
          </div>
        </section>
      ) : null}

      {/* ── Account breakdown ───────────────────────────────────────────── */}
      {accountsVisible ? (
        <section aria-labelledby="repartition" className="mt-10">
          <h2 id="repartition" className="font-display text-heading text-ink">
            {t('breakdownTitle')}
          </h2>

          <ul role="list" className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {breakdown.map((entry) => (
              <li key={entry.key}>
                <Link
                  href={entry.href}
                  aria-label={t('openQueue', { queue: entry.label })}
                  className={cn(
                    'flex h-full flex-col gap-1 rounded-lg border border-hairline bg-surface p-4',
                    'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait/50 hover:bg-raised',
                  )}
                >
                  <span className="text-sm text-ink-muted">{entry.label}</span>
                  <span
                    data-numeric
                    className="force-ltr font-display text-title leading-none text-ink"
                    dir="ltr"
                  >
                    {entry.value}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Band card                                                                   */
/* -------------------------------------------------------------------------- */

function BandCard({
  tone,
  icon,
  count,
  headline,
  detail,
  href,
  cta,
}: {
  tone: BandTone;
  icon: React.ReactNode;
  count: number;
  headline: string;
  detail: string | null;
  href: string;
  cta: string;
}): React.JSX.Element {
  return (
    <Card className={cn('border', BAND_SURFACE[tone])} elevation={1} padding="none">
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-4 p-5">
        <span className={BAND_NUMBER[tone]}>{icon}</span>

        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-3">
            <span
              data-numeric
              className={cn('force-ltr font-display text-title leading-none', BAND_NUMBER[tone])}
              dir="ltr"
            >
              {count}
            </span>
            <span className="text-lead text-ink">{headline}</span>
          </p>
          {detail === null ? null : <p className="mt-1 text-sm text-ink-muted">{detail}</p>}
        </div>

        <Link
          href={href}
          className={cn(
            'inline-flex min-h-11 items-center gap-2 rounded-pill bg-strait px-5 text-sm font-medium text-on-accent',
            'transition-[box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)]',
            'shadow-e1 hover:shadow-e2 active:translate-y-px',
          )}
        >
          {cta}
          <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}
