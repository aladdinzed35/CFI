import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CheckCircle2, Clock, Info, Link2Off } from 'lucide-react';

import { cn } from '@/lib/cn';
import { AUTH_ROUTES, getCurrentUser, requestContext } from '@/server/auth';
import { verifyEmail } from '@/server/services/accounts/verify-email';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';

/**
 * `/[locale]/verifier/[token]` — the target of e-mail #1 (§9.1).
 *
 * The token is consumed **here, on the server, during the render**. That is
 * deliberate and it is what the flow asks for: the student clicks a link in
 * their mailbox and the address must be confirmed by that click, with no second
 * button to press. The service makes the operation safe to reach by `GET`:
 * claiming the token is a single conditional `UPDATE … WHERE usedAt IS NULL AND
 * expiresAt > now()`, so a mail scanner pre-fetching the URL, a refresh, or a
 * second click changes nothing and is reported as "already used" rather than as
 * a failure.
 *
 * Three outcomes, three designed states, one clear next action each:
 *
 * | Outcome | State | Action |
 * |---|---|---|
 * | claimed now | success | continue to the waiting screen (or sign in) |
 * | already claimed | information, not an error | the same continue |
 * | expired / unknown | dead link | ask for a new one |
 *
 * Never cached: the page performs a state transition, so `force-dynamic` is not
 * an optimisation detail, it is correctness.
 */

export const dynamic = 'force-dynamic';

type VerifyParams = { locale: string; token: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<VerifyParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'auth.verifyEmail' });
  // A one-shot token in a URL must never reach an index or a referrer log.
  return { title: t('title'), robots: { index: false, follow: false } };
}

type Outcome = 'verified' | 'already' | 'expired' | 'invalid';

const OUTCOME_TONE: Readonly<
  Record<Outcome, { readonly frame: string; readonly Icon: typeof CheckCircle2 }>
> = {
  verified: { frame: 'border-success/30 bg-success-wash text-success', Icon: CheckCircle2 },
  already: { frame: 'border-strait/30 bg-strait-wash text-strait', Icon: Info },
  expired: { frame: 'border-warn/30 bg-warn-wash text-warn', Icon: Clock },
  invalid: { frame: 'border-danger/30 bg-danger-wash text-danger', Icon: Link2Off },
};

export default async function VerifyTokenPage({
  params,
}: {
  params: Promise<VerifyParams>;
}): Promise<React.JSX.Element> {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const { ip, userAgent } = await requestContext();
  const result = await verifyEmail({ token: decodeURIComponent(token) }, { ip, userAgent });

  const outcome: Outcome = result.ok
    ? result.outcome === 'VERIFIED'
      ? 'verified'
      : 'already'
    : result.code === 'EXPIRED_TOKEN'
      ? 'expired'
      : 'invalid';

  const t = await getTranslations('auth.verifyEmail');
  const common = await getTranslations('common');
  const errors = await getTranslations('errors');

  // Where "continue" goes depends on whether the link was opened on the device
  // that is signed in — a student very often opens their mail somewhere else.
  const current = await getCurrentUser();
  const continueHref = current === null ? AUTH_ROUTES.signIn : AUTH_ROUTES.pendingApproval;

  const tone = OUTCOME_TONE[outcome];

  const copy: { title: string; body: string; actionLabel: string; actionHref: string } = (() => {
    switch (outcome) {
      case 'verified':
        return {
          title: t('success.title'),
          body: t('success.body'),
          actionLabel: t('success.action'),
          actionHref: continueHref,
        };
      case 'already':
        return {
          // The address *is* confirmed; the only thing that failed is the second
          // click. Saying « ce lien n'est pas valide » here would be a lie.
          title: t('success.title'),
          body: errors('tokenAlreadyUsed'),
          actionLabel: common('continue'),
          actionHref: continueHref,
        };
      case 'expired':
        return {
          title: t('expired.title'),
          body: t('expired.body'),
          actionLabel: t('expired.action'),
          actionHref: AUTH_ROUTES.pendingEmail,
        };
      case 'invalid':
        return {
          title: t('invalid.title'),
          body: t('invalid.body'),
          actionLabel: t('invalid.action'),
          actionHref: AUTH_ROUTES.pendingEmail,
        };
    }
  })();

  return (
    <div className="flex flex-col gap-6">
      <span
        aria-hidden="true"
        className={cn('grid size-12 shrink-0 place-items-center rounded-md border', tone.frame)}
      >
        <tone.Icon className="size-6" />
      </span>

      <div className="flex flex-col gap-2">
        <h1 className="font-display text-title text-balance text-ink">{copy.title}</h1>
        <p className="text-body text-pretty text-ink-muted">{copy.body}</p>
      </div>

      <Link
        href={copy.actionHref}
        className="inline-flex h-12 w-full items-center justify-center rounded-md bg-strait px-6 text-sm font-medium text-on-accent shadow-e2 transition-[box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)] hover:shadow-e3 active:translate-y-px"
      >
        {copy.actionLabel}
      </Link>
    </div>
  );
}
