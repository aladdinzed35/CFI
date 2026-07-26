import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Hourglass, ShieldX } from 'lucide-react';

import { AUTH_ROUTES, requirePageUser } from '@/server/auth';
import { resolveBrandContext } from '@/server/mail';
import { StatusPill } from '@/components/ui/status-pill';
import { redirect } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';

import { StatusPoll } from './status-poll';

/**
 * `/[locale]/compte-en-attente` — the designed waiting screen of §9.1.
 *
 * §28.3 fixes the copy word for word, including the expected delay
 * (« généralement sous 24 heures ouvrées ») and the offer to speed things up on
 * WhatsApp; the message catalogue carries it verbatim and this page renders it
 * without paraphrasing.
 *
 * Everything else on the screen is there because a person waiting for a human
 * decision needs three things: to know that the wait is normal, to know how long
 * it should take, and to have a way to ask. The live poll then removes the
 * fourth need — reloading the page to find out — by flipping to the dashboard the
 * moment an administrator approves the account.
 *
 * The WhatsApp call to action is rendered **only** when a number is configured.
 * A button that opens a conversation with nobody is worse than no button, which
 * is the same reasoning `server/mail/send.ts` applies to the e-mail footer.
 */

type LocaleParams = { locale: string };

export function generateStaticParams(): LocaleParams[] {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'auth.pending' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function PendingApprovalPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  // Anonymous visitors are sent to sign in and brought back here afterwards.
  const user = await requirePageUser(locale, AUTH_ROUTES.pendingApproval);

  if (user.status === 'ACTIVE') redirect({ href: AUTH_ROUTES.home, locale });
  if (user.status === 'PENDING_EMAIL') redirect({ href: AUTH_ROUTES.pendingEmail, locale });

  const t = await getTranslations('auth.pending');
  const tRejected = await getTranslations('auth.rejected');
  const tSuspended = await getTranslations('auth.suspended');
  const brand = await resolveBrandContext();

  // This screen serves three statuses (see ROUTES.rejected / ROUTES.suspended),
  // so the header must follow the status. A fixed « votre compte est en cours de
  // validation » above a red refusal notice contradicts itself, and the person
  // reading it has just been told two different things about their account.
  const heading =
    user.status === 'REJECTED'
      ? { title: tRejected('title'), tone: 'danger' as const }
      : user.status === 'SUSPENDED'
        ? { title: tSuspended('title'), tone: 'danger' as const }
        : { title: t('title'), tone: 'warn' as const };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <span
          aria-hidden="true"
          className={
            heading.tone === 'danger'
              ? 'grid size-12 shrink-0 place-items-center rounded-md border border-danger/30 bg-danger-wash text-danger'
              : 'grid size-12 shrink-0 place-items-center rounded-md border border-warn/30 bg-warn-wash text-warn'
          }
        >
          {heading.tone === 'danger' ? <ShieldX className="size-6" /> : <Hourglass className="size-6" />}
        </span>

        <h1 className="font-display text-title text-balance text-ink">{heading.title}</h1>

        <StatusPill
          domain="account"
          status={user.status}
          label={heading.title}
          srPrefix={t('statusLabel')}
          className="self-start"
        />

        {/* §28.3, verbatim — including « généralement sous 24 heures ouvrées ».
            Only shown while the wait is real; StatusPoll owns the other two. */}
        {user.status === 'PENDING_APPROVAL' ? (
          <p className="text-body text-pretty text-ink-muted">{t('body')}</p>
        ) : null}
      </header>

      <StatusPoll
        initialStatus={user.status}
        dashboardHref={AUTH_ROUTES.home}
        whatsappUrl={brand.whatsappUrl}
      />
    </div>
  );
}
