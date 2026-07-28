import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight, Banknote, Building2, Check, Info, ShieldOff, Split } from 'lucide-react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { getFaqEntries, getPricingTable } from '@/server/services/public-pages';
import { getPublicChrome } from '@/server/services/public-chrome';
import { getHomeData } from '@/server/services/home';
import { buildMetadata } from '@/lib/seo';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/dates';
import { formatMoney, formatMoneyRange } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';

/**
 * `/[locale]/tarifs` — the price page (§12.5), the homepage band expanded.
 *
 * ## Not one number on this page is written in the source
 *
 * The comparison range is `MIN…MAX(priceCentimes)` over the published paid
 * catalogue; the table is one row per active category with the real observed
 * range and mean duration; the instalments card only appears when a published
 * course actually allows them. Hardcoding a price here would go stale the day
 * somebody edits a course in the admin — and a stale price on a price page is
 * the one lie a training centre cannot afford.
 *
 * The *market* range is the exception that proves the rule: it is a
 * `SiteSetting` an administrator fills in (§17.11), labelled as an observed
 * range for equivalent in-person training, naming nobody. Until it is entered,
 * the second panel is not rendered at all — §12.2 forbids invented competitors,
 * and a range this code made up would be exactly that, only anonymous.
 *
 * ## The 48-hour notice, calmly
 *
 * §12.5 asks for the transfer delay "explained calmly". It is an `Alert`, not a
 * warning banner: an instant transfer opens access the same day, a standard one
 * can take up to 48 working hours to arrive, and access follows the money. Said
 * plainly, before the enrolment, it stops being a complaint later.
 */

const INCLUDED = ['access', 'resources', 'certificate', 'coaching', 'live', 'updates'] as const;

/** The `FaqItem.category` values that belong on a price page. */
const PRICING_FAQ_CATEGORIES = ['PAIEMENT'] as const;

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

  const t = await getTranslations({ locale, namespace: 'seo.pricing' });
  return buildMetadata({
    locale,
    path: '/tarifs',
    title: t('title'),
    description: t('description'),
  });
}

export default async function PricingPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [t, tHome, tWhatsapp, table, home, faq, chrome] = await Promise.all([
    getTranslations({ locale, namespace: 'pages.pricing' }),
    // « Voir toutes les formations » already exists, written for exactly this
    // button on the homepage band. One string, one translation, one meaning.
    getTranslations({ locale, namespace: 'home.pricing' }),
    getTranslations({ locale, namespace: 'whatsapp' }),
    getPricingTable(locale),
    getHomeData(locale),
    getFaqEntries(locale, PRICING_FAQ_CATEGORIES),
    getPublicChrome(locale),
  ]);

  const { pricing } = home;

  const cfiRange =
    pricing.cfiMinCentimes === null || pricing.cfiMaxCentimes === null
      ? null
      : formatMoneyRange(pricing.cfiMinCentimes, pricing.cfiMaxCentimes, locale);

  const marketRange =
    pricing.marketMinCentimes === null || pricing.marketMaxCentimes === null
      ? null
      : formatMoneyRange(pricing.marketMinCentimes, pricing.marketMaxCentimes, locale);

  const facilities = [
    { key: 'facilityTransfer', Icon: Banknote, shown: true },
    { key: 'facilityInstallments', Icon: Split, shown: pricing.installmentsAvailable },
    { key: 'facilityCash', Icon: Building2, shown: true },
  ] as const;

  const whatsappHref =
    chrome.contact.whatsappNumber === null
      ? null
      : `https://wa.me/${chrome.contact.whatsappNumber}?text=${encodeURIComponent(
          tWhatsapp('prefillPricing'),
        )}`;

  return (
    <>
      {/* ------------------------------------------------------------ header */}
      <header className="mx-auto w-full max-w-6xl px-4 pb-4 pt-12 sm:px-6 sm:pb-8 sm:pt-20">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">{t('eyebrow')}</p>
        <h1 className="mt-4 max-w-[18ch] text-hero text-balance">{t('title')}</h1>
        <p className="mt-6 max-w-[62ch] text-lead text-pretty text-ink-muted">{t('lead')}</p>
      </header>

      {table.length === 0 ? (
        <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
          <EmptyState
            title={t('empty.title')}
            description={t('empty.body')}
            action={
              whatsappHref === null ? (
                <Link
                  href="/formations"
                  className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-strait px-5 text-sm font-medium text-on-accent"
                >
                  {tHome('cta')}
                </Link>
              ) : (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-strait px-5 text-sm font-medium text-on-accent"
                >
                  {t('empty.action')}
                </a>
              )
            }
          />
        </section>
      ) : (
        <>
          {/* ---------------------------------------------------- comparison */}
          {cfiRange === null ? null : (
            <section
              aria-labelledby="pricing-comparison"
              className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16"
            >
              <h2 id="pricing-comparison" className="max-w-[20ch] text-display text-balance">
                {t('comparisonTitle')}
              </h2>
              <p className="mt-5 max-w-[62ch] text-lead text-pretty text-ink-muted">
                {t('comparisonLead')}
              </p>

              <dl
                className={cn(
                  'mt-10 grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline',
                  // Two panels only when there is something honest to compare to.
                  marketRange === null ? null : 'sm:grid-cols-2',
                )}
              >
                <div className="bg-surface p-6 sm:p-8">
                  <dt className="text-sm font-medium uppercase tracking-wide text-brass">
                    {t('cfiLabel')}
                  </dt>
                  <dd className="mt-3 font-display text-title font-medium text-brass" data-numeric>
                    {/* Money stays left-to-right in every locale (§10.3). */}
                    <span className="force-ltr" dir="ltr">
                      {cfiRange}
                    </span>
                  </dd>
                  <dd className="mt-3 max-w-[46ch] text-sm text-pretty text-ink-muted">
                    {t('cfiNote')}
                  </dd>
                </div>

                {marketRange === null ? null : (
                  <div className="bg-surface p-6 sm:p-8">
                    <dt className="text-sm font-medium uppercase tracking-wide text-ink-muted">
                      {t('marketLabel')}
                    </dt>
                    <dd
                      className="mt-3 font-display text-title font-medium text-ink-muted"
                      data-numeric
                    >
                      <span className="force-ltr" dir="ltr">
                        {marketRange}
                      </span>
                    </dd>
                    <dd className="mt-3 max-w-[46ch] text-sm text-pretty text-ink-muted">
                      {t('marketNote')}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          {/* --------------------------------------------------------- table */}
          <section aria-labelledby="pricing-table" className="border-y border-hairline bg-surface">
            <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
              <h2 id="pricing-table" className="max-w-[20ch] text-display text-balance">
                {t('tableTitle')}
              </h2>
              <p className="mt-5 max-w-[62ch] text-lead text-pretty text-ink-muted">
                {t('tableLead')}
              </p>

              {/* The table scrolls inside its own box rather than pushing the
                  page sideways: at 360 px four columns of real data cannot fit,
                  and truncating a price is not an option. */}
              <div className="mt-10 overflow-x-auto rounded-lg border border-hairline">
                <table className="w-full min-w-[36rem] border-collapse text-start text-sm">
                  <caption className="sr-only">{t('tableCaption')}</caption>
                  <thead>
                    <tr className="border-b border-hairline bg-abyss">
                      <th scope="col" className="px-4 py-3.5 text-start font-medium text-ink">
                        {t('columnCategory')}
                      </th>
                      <th scope="col" className="px-4 py-3.5 text-start font-medium text-ink">
                        {t('columnCourses')}
                      </th>
                      <th scope="col" className="px-4 py-3.5 text-start font-medium text-ink">
                        {t('columnRange')}
                      </th>
                      <th scope="col" className="px-4 py-3.5 text-start font-medium text-ink">
                        {t('columnDuration')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.map((row) => {
                      const range =
                        row.minPriceCentimes === row.maxPriceCentimes
                          ? t('rangeSingle', {
                              price: formatMoney(row.minPriceCentimes, locale),
                            })
                          : t('rangeBetween', {
                              min: formatMoney(row.minPriceCentimes, locale),
                              max: formatMoney(row.maxPriceCentimes, locale),
                            });

                      return (
                        <tr key={row.categorySlug} className="border-b border-hairline last:border-b-0">
                          <th scope="row" className="px-4 py-4 text-start font-medium">
                            <Link
                              href={`/formations?categorie=${row.categorySlug}`}
                              aria-label={t('seeCategory', { category: row.categoryName })}
                              className="text-ink underline-offset-4 transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-strait hover:underline motion-reduce:transition-none"
                            >
                              {row.categoryName}
                            </Link>
                          </th>
                          <td className="px-4 py-4 text-ink-muted">
                            {t('courseCount', { count: row.courseCount })}
                          </td>
                          <td className="px-4 py-4 font-medium text-brass" data-numeric>
                            <span className="force-ltr" dir="ltr">
                              {range}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-ink-muted" data-numeric>
                            {row.averageDurationMinutes === 0 ? (
                              '—'
                            ) : (
                              <span className="force-ltr" dir="ltr">
                                {formatDuration(row.averageDurationMinutes, locale)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="mt-4 max-w-[62ch] text-sm text-pretty text-ink-muted">
                {t('tableNote')}
              </p>
            </div>
          </section>

          {/* ------------------------------------------ included & facilities */}
          <section
            aria-labelledby="pricing-included"
            className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20"
          >
            <div className="grid gap-12 lg:grid-cols-2">
              <div>
                <h2 id="pricing-included" className="text-display text-balance">
                  {t('includedTitle')}
                </h2>
                <ul role="list" className="mt-8 flex flex-col gap-4">
                  {INCLUDED.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-body text-ink-muted">
                      <span className="mt-1 inline-flex size-5 shrink-0 items-center justify-center rounded-pill bg-strait-wash">
                        <Check className="size-3.5 text-strait" aria-hidden="true" />
                      </span>
                      <span className="text-pretty">{t(`included.${item}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h2 className="text-display text-balance">{t('facilitiesTitle')}</h2>
                <ul role="list" className="mt-8 flex flex-col gap-4">
                  {facilities
                    .filter((facility) => facility.shown)
                    .map(({ key, Icon }) => (
                      <li
                        key={key}
                        className="flex items-start gap-4 rounded-lg border border-hairline bg-surface p-5"
                      >
                        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-brass-wash">
                          <Icon className="size-4 text-brass" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <h3 className="text-body font-medium text-ink">{t(`${key}.title`)}</h3>
                          <p className="mt-1.5 text-sm text-pretty text-ink-muted">
                            {t(`${key}.body`)}
                          </p>
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            </div>

            <div className="mt-12 grid gap-4 lg:grid-cols-2">
              <Alert variant="info" title={t('transferNoticeTitle')} icon={Info}>
                {t('transferNoticeBody')}
              </Alert>
              <Alert variant="info" title={t('noOnlinePaymentTitle')} icon={ShieldOff}>
                {t('noOnlinePaymentBody')}
              </Alert>
            </div>
          </section>

          {/* ----------------------------------------------------------- faq */}
          {faq.length === 0 ? null : (
            <section aria-labelledby="pricing-faq" className="border-y border-hairline bg-surface">
              <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
                <h2 id="pricing-faq" className="text-display text-balance">
                  {t('faqTitle')}
                </h2>
                <Accordion type="multiple" className="mt-8">
                  {faq.map((entry) => (
                    <AccordionItem key={entry.id} value={entry.id}>
                      <AccordionTrigger>{entry.question}</AccordionTrigger>
                      <AccordionContent>
                        <p className="text-body text-pretty text-ink-muted">{entry.answer}</p>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            </section>
          )}

          {/* ----------------------------------------------------------- cta */}
          <section aria-labelledby="pricing-cta" className="texture-bathymetric hairline-t">
            <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
              <h2 id="pricing-cta" className="max-w-2xl text-title text-balance">
                {t('ctaTitle')}
              </h2>
              <p className="max-w-xl text-lead text-pretty text-ink-muted">{t('ctaBody')}</p>

              <div className="mt-2 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                {whatsappHref === null ? null : (
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-strait px-6 text-body font-medium text-on-accent shadow-e1 transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-strait/90 motion-reduce:transition-none"
                  >
                    {t('ctaAction')}
                  </a>
                )}

                {/* Brass is money and achievement; a pricing page is the one
                    place a primary action genuinely is about money (§11.2). */}
                <Link
                  href="/formations"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-brass px-6 text-body font-medium text-on-brass shadow-e1 transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-brass/90 motion-reduce:transition-none"
                >
                  {tHome('cta')}
                  <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
