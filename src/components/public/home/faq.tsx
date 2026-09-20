import { getTranslations } from 'next-intl/server';
import { ArrowRight, ChevronDown } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import type { HomeFaq } from '@/server/services/home';
import type { Locale } from '@/i18n/routing';

/**
 * §12.2 #10 — the FAQ, plus its `FAQPage` structured data.
 *
 * The JSON-LD is emitted from the SAME rows the accordion renders, in the same
 * component, so the two can never drift. Google penalises structured data that
 * does not match the visible page, and a separate builder reading the database
 * a second time is exactly how that happens.
 */

/*
  Plain sections that follow one another would stack their paddings into a
  190 px hole. When the next section is also plain, this one keeps less below
  it; when the previous one is plain, a hairline at the content edge replaces
  the top padding. Same classes in proofs, instructors and centre.
*/
const PLAIN_BAND =
  '[&:has(+[data-home-band=plain])]:pb-12 sm:[&:has(+[data-home-band=plain])]:pb-16 [[data-home-band=plain]+&]:pt-0 [[data-home-band=plain]+&]:before:mb-12 [[data-home-band=plain]+&]:before:block [[data-home-band=plain]+&]:before:h-px [[data-home-band=plain]+&]:before:bg-hairline sm:[[data-home-band=plain]+&]:before:mb-16';

export interface HomeFaqProps {
  locale: Locale;
  items: readonly HomeFaq[];
}

export async function HomeFaqSection({
  locale,
  items,
}: HomeFaqProps): Promise<React.JSX.Element | null> {
  if (items.length === 0) return null;

  const t = await getTranslations({ locale, namespace: 'home.faq' });

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };

  /*
    The same content edge as every other section. This one used to be a
    narrower `max-w-4xl` column centred on its own, so at 1280 px its heading
    started 128 px to the inline end of the logo and of every heading above
    it. Now it uses the full container: on a desktop the heading and the link
    to the full FAQ hold the start column while the questions take the end;
    on a phone it reads heading → questions → link, in that order.
  */
  return (
    <section
      aria-labelledby="home-faq-title"
      data-home-band="plain"
      className={cn('mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24', PLAIN_BAND)}
    >
      <div className="grid gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr] lg:gap-x-16 lg:[grid-template-areas:'head_list'_'cta_list']">
        <div className="lg:[grid-area:head]">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait rtl:font-arabic rtl:text-sm rtl:tracking-normal">
            {t('sectionLabel')}
          </p>
          <h2 id="home-faq-title" className="mt-4 max-w-[18ch] text-display text-balance">
            {t('title')}
          </h2>
          <p className="mt-5 max-w-[48ch] text-lead text-pretty text-ink-muted">{t('subtitle')}</p>
        </div>

        {/*
          Native <details>, not the Radix accordion — the same decision the /faq
          page records at length. Two reasons, and on the homepage the second is
          the one that pays: the answers work with zero JavaScript, and the Radix
          island was one of only a handful of hydration costs left on a page whose
          budget is Lighthouse ≥95 at 4× CPU throttle. The browser gives us
          open/close, keyboard operation and `group-open` styling for free.
        */}
        <div className="border-t border-hairline lg:[grid-area:list]">
          {items.map((item) => (
            <details key={item.id} className="group border-b border-hairline">
              <summary className="cursor-pointer list-none rounded-sm [&::-webkit-details-marker]:hidden">
                <h3 className="flex min-h-14 items-center justify-between gap-4 py-4 text-body font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] group-hover:text-strait motion-reduce:transition-none sm:py-5">
                  <span className="min-w-0 flex-1 text-pretty">{item.question}</span>
                  <span
                    aria-hidden="true"
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-pill border border-hairline text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] group-open:border-strait group-open:bg-strait-wash group-open:text-strait motion-reduce:transition-none"
                  >
                    <ChevronDown className="size-4 transition-transform duration-200 ease-[var(--ease-out-strait)] group-open:rotate-180 motion-reduce:transition-none" />
                  </span>
                </h3>
              </summary>
              <p className="max-w-[65ch] pb-6 text-body sm:pe-12 text-pretty text-ink-muted">
                {item.answer}
              </p>
            </details>
          ))}
        </div>

        <div className="lg:[grid-area:cta]">
          <Link
            href="/faq"
            className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-hairline px-5 text-sm font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none"
          >
            {t('seeAll')}
            <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <script
        type="application/ld+json"
        // Serialised from the rows rendered above, so the markup and the page
        // always agree. Not user input — these come from FaqItem.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </section>
  );
}
