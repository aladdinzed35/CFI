import { getTranslations } from 'next-intl/server';
import { ArrowRight, Banknote, Building2, Check, Split } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { formatMoneyRange } from '@/lib/money';
import type { HomePricing } from '@/server/services/home';
import type { Locale } from '@/i18n/routing';

/**
 * §12.2 §6 — « Tarifs / valeur ».
 *
 * The brief wants this section to say "the best prices". It says it the only
 * way that survives contact with a sceptical buyer: with two real numbers and a
 * label on each.
 *
 * ## Where each number comes from
 *
 * - **Au CFI** is not copy. It is `MIN(priceCentimes)…MAX(priceCentimes)` over
 *   the published, paid catalogue, read at request time. Publish a cheaper
 *   course and this band moves on its own.
 * - **La fourchette du marché** is a `SiteSetting` an administrator fills in
 *   (§17.11). It is labelled as an observed range for an equivalent in-person
 *   course, it carries the caveat that no establishment is named, and — this is
 *   the important part — **when it has not been entered, the comparison is not
 *   rendered at all**. §12.2 forbids invented competitors; a range this code
 *   made up would be exactly that, only anonymous.
 *
 * ## Facilities are declared, not implied
 *
 * The instalments line only appears when at least one published course actually
 * has `installmentsAllowed`. Bank transfer and cash at the centre are the two
 * payment routes the whole product is built around (§9.2), so they are always
 * true and always shown.
 *
 * The closing call to action is the one `brass` button on the page: brass is
 * money and achievement, and a pricing section is the one place a primary
 * action *is* about money (§11.2).
 */

const INCLUDED = ['access', 'resources', 'certificate', 'coaching', 'live', 'updates'] as const;

export interface HomePricingBandProps {
  locale: Locale;
  pricing: HomePricing;
}

export async function HomePricingBand({
  locale,
  pricing,
}: HomePricingBandProps): Promise<React.JSX.Element> {
  const t = await getTranslations('home.pricing');

  const cfiRange =
    pricing.cfiMinCentimes === null || pricing.cfiMaxCentimes === null
      ? null
      : formatMoneyRange(pricing.cfiMinCentimes, pricing.cfiMaxCentimes, locale);

  const marketRange =
    pricing.marketMinCentimes === null || pricing.marketMaxCentimes === null
      ? null
      : formatMoneyRange(pricing.marketMinCentimes, pricing.marketMaxCentimes, locale);

  const facilities = [
    { key: 'transfer', Icon: Banknote, shown: true },
    { key: 'installments', Icon: Split, shown: pricing.installmentsAvailable },
    { key: 'cash', Icon: Building2, shown: true },
  ] as const;

  return (
    <section
      aria-labelledby="home-pricing-title"
      className="border-y border-hairline bg-surface"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
          {t('sectionLabel')}
        </p>
        <h2 id="home-pricing-title" className="mt-4 max-w-[18ch] text-display">
          {t('title')}
        </h2>
        <p className="mt-5 max-w-[62ch] text-lead text-ink-muted">{t('subtitle')}</p>

        {cfiRange === null ? null : (
          <dl
            className={cn(
              'mt-12 grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline',
              // Two panels only when there is something to compare against.
              marketRange === null ? null : 'sm:grid-cols-2',
            )}
          >
            <div className="bg-abyss p-6 sm:p-8">
              <dt className="text-sm font-medium uppercase tracking-wide text-brass">
                {t('cfiLabel')}
              </dt>
              <dd className="mt-3 font-display text-title font-medium text-brass" data-numeric>
                <span className="force-ltr" dir="ltr">
                  {cfiRange}
                </span>
              </dd>
              <dd className="mt-3 text-sm text-ink-muted">{t('disclaimer')}</dd>
            </div>

            {marketRange === null ? null : (
              <div className="bg-abyss p-6 sm:p-8">
                <dt className="text-sm font-medium uppercase tracking-wide text-ink-muted">
                  {t('marketLabel')}
                </dt>
                <dd className="mt-3 font-display text-title font-medium text-ink-muted" data-numeric>
                  <span className="force-ltr" dir="ltr">
                    {marketRange}
                  </span>
                </dd>
                <dd className="mt-3 text-sm text-ink-muted">{t('marketNote')}</dd>
              </div>
            )}
          </dl>
        )}

        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          <div>
            <h3 className="text-heading font-medium text-ink">{t('includedTitle')}</h3>
            <ul role="list" className="mt-5 flex flex-col gap-3">
              {INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-3 text-body text-ink-muted">
                  <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-pill bg-strait-wash">
                    <Check className="size-3.5 text-strait" aria-hidden="true" />
                  </span>
                  <span>{t(`included.${item}`)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-heading font-medium text-ink">{t('facilitiesTitle')}</h3>
            <ul role="list" className="mt-5 flex flex-col gap-3">
              {facilities
                .filter((facility) => facility.shown)
                .map(({ key, Icon }) => (
                  <li key={key} className="flex items-start gap-3 text-body text-ink-muted">
                    <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-pill bg-brass-wash">
                      <Icon className="size-3.5 text-brass" aria-hidden="true" />
                    </span>
                    <span>{t(`facilities.${key}`)}</span>
                  </li>
                ))}
            </ul>
          </div>
        </div>

        <div className="mt-12">
          <Link
            href="/formations"
            className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-brass px-6 text-body font-medium text-on-brass shadow-e2 transition-[box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)] hover:shadow-e3 active:translate-y-px motion-reduce:transition-none"
          >
            {t('cta')}
            <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
