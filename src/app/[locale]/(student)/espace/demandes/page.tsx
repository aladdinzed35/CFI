import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Receipt } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/navigation';
import { isLocale, type Locale } from '@/i18n/routing';
import { requirePageActiveUser } from '@/server/auth/guards';
import { receiptUploadConstraints } from '@/server/actions/enrollment';
import { getBankDetails } from '@/server/services/enrollment/bank-details';
import { listMyRequests } from '@/server/services/enrollment/queries';
import { getPublicChrome } from '@/server/services/public-chrome';

import { RequestCard } from './request-card';

/**
 * `/espace/demandes` — « Mes demandes » (§13.3).
 *
 * The §9.2 timeline widget, one card per request, newest first. Everything a
 * student needs to finish or follow a payment is here: the reference to quote
 * in the transfer, the amount, their own receipt through the authenticated
 * gateway, the administrator's message when one was asked for, and the invoice
 * once the access was activated.
 *
 * ## Guests and pending accounts never arrive
 * `route-policy.ts` already refuses everything under `/espace` except the
 * profile to an account that is not `ACTIVE`, and the middleware applies it
 * from the cookie. `requirePageActiveUser` is still called here because the
 * cookie cannot know that an administrator suspended this account four seconds
 * ago: this is the check that consults the `Session` table.
 *
 * ## Why the page reads three settings
 * A request in `AWAITING_RECEIPT` still has a transfer to make, so the bank
 * coordinates travel with it; the upload ceilings come from the server that
 * enforces them rather than from a constant that could drift; and WhatsApp is
 * the §9.2 way out of a refusal. All three are shared by every card and are
 * therefore resolved once, here, rather than per card.
 */

type LocaleParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const active: Locale = isLocale(locale) ? locale : 'fr';
  const t = await getTranslations({ locale: active, namespace: 'enrollment.status' });

  return {
    title: t('pageTitle'),
    // Private, like the whole student space.
    robots: { index: false, follow: false },
  };
}

export default async function RequestsPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  setRequestLocale(locale);

  const user = await requirePageActiveUser(locale, '/espace/demandes');
  const t = await getTranslations({ locale, namespace: 'enrollment.status' });

  const [requests, bank, chrome, constraints] = await Promise.all([
    listMyRequests(user.id),
    getBankDetails(),
    getPublicChrome(locale),
    receiptUploadConstraints(),
  ]);

  const whatsappUrl =
    chrome.contact.whatsappNumber === null
      ? null
      : `https://wa.me/${chrome.contact.whatsappNumber}`;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-title text-ink">{t('pageTitle')}</h1>
        <p className="text-body text-pretty text-ink-muted">{t('pageSubtitle')}</p>
      </header>

      {requests.length === 0 ? (
        <EmptyState
          illustration={<Receipt aria-hidden="true" />}
          title={t('empty.title')}
          description={t('empty.body')}
          action={
            <Button asChild>
              <Link href="/formations">{t('empty.cta')}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-5">
          {requests.map((request) => (
            <li key={request.id}>
              <RequestCard
                locale={locale}
                request={request}
                bank={bank}
                constraints={constraints}
                whatsappUrl={whatsappUrl}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
