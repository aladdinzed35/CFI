'use client';

import * as React from 'react';
import useSWR from 'swr';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, RefreshCw } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatTime } from '@/lib/dates';
import { useRouter } from '@/i18n/navigation';
import { isLocale, type Locale } from '@/i18n/routing';
import { accountStatusAction, signOutAction } from '@/server/actions/auth';
import type { AccountStatus } from '@/components/ui/status-pill';

/**
 * The live status poll of §9.1: "shows a live status poll so it flips to the
 * dashboard automatically once approved".
 *
 * ## Only while the tab is being looked at
 * The SWR key is `null` whenever `document.visibilityState` is not `visible`, so
 * a page left open in a background tab stops polling entirely — no interval, no
 * request, no battery. It resumes, and revalidates immediately, when the tab
 * comes back. Someone who registers, switches to their mailbox and comes back an
 * hour later gets a fresh answer on their first glance rather than up to fifteen
 * seconds of stale one.
 *
 * ## Fifteen seconds, not one
 * The decision on the other side is a human reading a form. A tighter interval
 * would multiply requests without shortening the wait by anything a person could
 * perceive, and « Actualiser le statut » is there for the impatient.
 *
 * ## What it may learn
 * The action behind it is scoped to the caller's own account and returns nothing
 * but the status and, when the decision was a refusal, the reason that was
 * already e-mailed to them. There is no parameter to point it elsewhere.
 */

const POLL_INTERVAL_MS = 15_000;

/** Rejection codes from `services/accounts/moderation` → their labels. */
const REJECTION_LABEL_KEYS: Readonly<Record<string, string>> = {
  INCOMPLETE_INFO: 'admin.accounts.rejectReasons.incompleteInfo',
  DUPLICATE: 'admin.accounts.rejectReasons.duplicate',
  INVALID_PHONE: 'admin.accounts.rejectReasons.invalidPhone',
  OTHER: 'admin.accounts.rejectReasons.other',
};

export interface StatusPollProps {
  /** The status the page was rendered with — what is shown until the first poll. */
  initialStatus: AccountStatus;
  /** Locale-agnostic path of the student dashboard. */
  dashboardHref: string;
  /** `https://wa.me/…`, or `null` when the centre has no number configured. */
  whatsappUrl: string | null;
}

export function StatusPoll({
  initialStatus,
  dashboardHref,
  whatsappUrl,
}: StatusPollProps): React.JSX.Element {
  const t = useTranslations();
  const router = useRouter();
  const rawLocale = useLocale();
  const locale: Locale = isLocale(rawLocale) ? rawLocale : 'fr';

  const [visible, setVisible] = React.useState(true);
  const [checkedAt, setCheckedAt] = React.useState<Date | null>(null);
  const [signingOut, setSigningOut] = React.useState(false);

  React.useEffect(() => {
    const read = (): void => {
      setVisible(document.visibilityState === 'visible');
    };
    read();
    document.addEventListener('visibilitychange', read);
    return () => {
      document.removeEventListener('visibilitychange', read);
    };
  }, []);

  const { data, isValidating, mutate } = useSWR(
    // `null` disables the request entirely — including the interval.
    visible ? 'cfi:own-account-status' : null,
    async () => {
      const result = await accountStatusAction({});
      setCheckedAt(new Date());
      return result;
    },
    {
      refreshInterval: POLL_INTERVAL_MS,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      // A transient failure must not empty the screen; the last known status
      // stays on display and the next tick tries again.
      keepPreviousData: true,
      shouldRetryOnError: true,
    },
  );

  const polled = data !== undefined && data.ok ? data.data : null;
  const status: AccountStatus = polled?.status ?? initialStatus;

  // The moment an administrator approves, the page leaves. `refresh()` is what
  // makes the destination render against the new session state rather than a
  // cached tree that still believes the account is pending.
  React.useEffect(() => {
    if (status !== 'ACTIVE') return;
    router.replace(dashboardHref);
    router.refresh();
  }, [status, dashboardHref, router]);

  const onSignOut = React.useCallback(async (): Promise<void> => {
    setSigningOut(true);
    await signOutAction({});
    router.replace('/connexion');
    router.refresh();
  }, [router]);

  const reasonLabelKey =
    polled?.rejectionCode === null || polled?.rejectionCode === undefined
      ? null
      : (REJECTION_LABEL_KEYS[polled.rejectionCode] ?? null);

  /* ── Approved ────────────────────────────────────────────────────────── */
  if (status === 'ACTIVE') {
    return (
      <Alert variant="success" title={t('auth.pending.approved.title')}>
        {t('auth.pending.approved.body')}
      </Alert>
    );
  }

  /* ── Refused ─────────────────────────────────────────────────────────── */
  if (status === 'REJECTED') {
    return (
      <div className="flex flex-col gap-5">
        <Alert variant="error" title={t('auth.rejected.title')}>
          {t('auth.rejected.body')}
        </Alert>

        <Card padding="md">
          <p className="text-sm font-medium text-ink">{t('auth.rejected.reasonLabel')}</p>
          <p className="mt-1.5 text-sm text-pretty text-ink-muted">
            {reasonLabelKey === null ? t('auth.rejected.noReason') : t(reasonLabelKey)}
          </p>
          {polled?.rejectionDetails === null || polled?.rejectionDetails === undefined ? null : (
            <p className="mt-2 text-sm text-pretty text-ink-muted">{polled.rejectionDetails}</p>
          )}
        </Card>

        {whatsappUrl === null ? null : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-pretty text-ink-muted">{t('auth.rejected.whatsappPrompt')}</p>
            <Button asChild variant="secondary" size="lg" fullWidth>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                {t('auth.rejected.whatsappCta')}
                <span className="sr-only"> {t('a11y.newWindow')}</span>
              </a>
            </Button>
          </div>
        )}

        <Button variant="ghost" onClick={() => { void onSignOut(); }} loading={signingOut} className="self-start">
          {t('auth.rejected.signOut')}
        </Button>
      </div>
    );
  }

  /* ── Suspended ───────────────────────────────────────────────────────── */
  if (status === 'SUSPENDED') {
    return (
      <div className="flex flex-col gap-5">
        <Alert variant="error" title={t('auth.suspended.title')}>
          {t('auth.suspended.body')}
        </Alert>

        {whatsappUrl === null ? null : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-pretty text-ink-muted">
              {t('auth.suspended.whatsappPrompt')}
            </p>
            <Button asChild variant="secondary" size="lg" fullWidth>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                {t('auth.suspended.whatsappCta')}
                <span className="sr-only"> {t('a11y.newWindow')}</span>
              </a>
            </Button>
          </div>
        )}

        <Button variant="ghost" onClick={() => { void onSignOut(); }} loading={signingOut} className="self-start">
          {t('auth.suspended.signOut')}
        </Button>
      </div>
    );
  }

  /* ── Waiting ─────────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-5">
      {whatsappUrl === null ? null : (
        <Card padding="md">
          <p className="text-sm text-pretty text-ink-muted">{t('auth.pending.whatsappPrompt')}</p>
          <Button asChild variant="secondary" size="lg" fullWidth className="mt-3">
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              {t('auth.pending.whatsappCta')}
              <span className="sr-only"> {t('a11y.newWindow')}</span>
            </a>
          </Button>
        </Card>
      )}

      <Card padding="none">
        <CardContent className="flex flex-col gap-3">
          {/* One polite live region for the whole poll: it announces a change of
              status, not every tick. */}
          <p aria-live="polite" className="flex items-center gap-2 text-sm text-ink">
            <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-strait" />
            {isValidating ? t('auth.pending.statusChecking') : t('auth.pending.statusPending')}
          </p>

          <p className="text-sm text-pretty text-ink-muted">{t('auth.pending.autoRefresh')}</p>

          {checkedAt === null ? null : (
            <p className="text-xs text-ink-muted">
              {t('auth.pending.lastChecked', { time: formatTime(checkedAt, locale) })}
            </p>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            loading={isValidating}
            iconStart={<RefreshCw aria-hidden="true" className="size-4" />}
            onClick={() => {
              void mutate();
            }}
          >
            {t('auth.pending.refresh')}
          </Button>
        </CardContent>
      </Card>

      <Button variant="ghost" onClick={() => { void onSignOut(); }} loading={signingOut} className="self-start">
        {t('auth.pending.signOut')}
      </Button>
    </div>
  );
}
