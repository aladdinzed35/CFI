import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight, ClipboardCheck, Inbox } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { requirePageAdmin } from '@/server/auth/guards';
import { accountCounts, type AccountCounts } from '@/server/services/accounts/queries';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * `/admin` — the dashboard, Milestone 1 scope (§17.1).
 *
 * §17.1 also describes a KPI row, five charts and a health strip. Every one of
 * them reads data this milestone does not produce yet: revenue, enrolments,
 * watch time, jobs. Rendering them from invented numbers would make the panel
 * lie about the business on its very first screen, so they are simply absent
 * until the milestone that fills them lands.
 *
 * What is here is real, and it is the part §17.1 puts first: the action band,
 * counted in the database on every request, deep-linking into the filtered
 * queue — plus the same count broken down by status so the administrator can
 * see the shape of the account base rather than a single number.
 */

type LocaleParams = { locale: string };

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

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  const user = await requirePageAdmin(locale);

  const [t, tAccounts] = await Promise.all([
    getTranslations('admin.dashboard'),
    getTranslations('admin.accounts'),
  ]);

  const result = await accountCounts(user);
  const counts: AccountCounts = result.ok
    ? result.data
    : {
        pendingApproval: 0,
        pendingEmail: 0,
        active: 0,
        rejected: 0,
        suspended: 0,
        oldestPendingHours: null,
      };

  const tone = bandTone(counts.pendingApproval, counts.oldestPendingHours);

  const breakdown = [
    {
      key: 'active',
      href: '/admin/comptes?onglet=actifs',
      label: tAccounts('status.active'),
      value: counts.active,
    },
    {
      key: 'pendingEmail',
      href: '/admin/comptes?onglet=attente-email',
      label: tAccounts('status.pendingEmail'),
      value: counts.pendingEmail,
    },
    {
      key: 'rejected',
      href: '/admin/comptes?onglet=refuses',
      label: tAccounts('status.rejected'),
      value: counts.rejected,
    },
    {
      key: 'suspended',
      href: '/admin/comptes?onglet=suspendus',
      label: tAccounts('status.suspended'),
      value: counts.suspended,
    },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-title text-ink">{t('title')}</h1>
        <p className="text-sm text-ink-muted">{t('subtitle')}</p>
      </header>

      <section aria-labelledby="bande-action" className="mt-6">
        <h2
          id="bande-action"
          className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted"
        >
          {t('bandLabel')}
        </h2>

        {counts.pendingApproval === 0 ? (
          <EmptyState
            className="mt-3"
            size="sm"
            illustration={<Inbox aria-hidden="true" />}
            title={t('clearTitle')}
            description={t('clearBody')}
          />
        ) : (
          <Card className={cn('mt-3 border', BAND_SURFACE[tone])} elevation={1} padding="none">
            <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-4 p-5">
              <ClipboardCheck className={cn('size-8 shrink-0', BAND_NUMBER[tone])} aria-hidden="true" />

              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-3">
                  <span
                    data-numeric
                    className={cn('force-ltr font-display text-title leading-none', BAND_NUMBER[tone])}
                    dir="ltr"
                  >
                    {counts.pendingApproval}
                  </span>
                  <span className="text-lead text-ink">
                    {t('accountsToReview', { count: counts.pendingApproval })}
                  </span>
                </p>
                {counts.oldestPendingHours === null ? null : (
                  <p className="mt-1 text-sm text-ink-muted">
                    {t('oldestWaiting', { hours: counts.oldestPendingHours })}
                  </p>
                )}
              </div>

              <Link
                href="/admin/comptes?onglet=a-valider"
                className={cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-pill bg-strait px-5 text-sm font-medium text-on-accent',
                  'transition-[box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)]',
                  'shadow-e1 hover:shadow-e2 active:translate-y-px',
                )}
              >
                {t('accountsCta')}
                <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>
        )}
      </section>

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
    </div>
  );
}
