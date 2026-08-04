import { getTranslations } from 'next-intl/server';
import { ChevronDown } from 'lucide-react';

import { Link } from '@/i18n/navigation';
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

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 sm:py-24">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
        {t('sectionLabel')}
      </p>
      <h2 className="mt-4 text-title text-balance">{t('title')}</h2>
      <p className="mt-4 max-w-2xl text-lead text-pretty text-ink-muted">{t('subtitle')}</p>

      {/*
        Native <details>, not the Radix accordion — the same decision the /faq
        page records at length. Two reasons, and on the homepage the second is
        the one that pays: the answers work with zero JavaScript, and the Radix
        island was one of only a handful of hydration costs left on a page whose
        budget is Lighthouse ≥95 at 4× CPU throttle. The browser gives us
        open/close, keyboard operation and `group-open` styling for free.
      */}
      <div className="mt-10 border-t border-hairline">
        {items.map((item) => (
          <details key={item.id} className="group border-b border-hairline">
            <summary className="cursor-pointer list-none rounded-sm [&::-webkit-details-marker]:hidden">
              <h3 className="flex min-h-11 items-center justify-between gap-3 py-4 text-body font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] group-hover:text-strait motion-reduce:transition-none">
                <span className="min-w-0 flex-1 text-balance">{item.question}</span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-ink-muted transition-transform duration-200 ease-[var(--ease-out-strait)] group-open:rotate-180 motion-reduce:transition-none"
                />
              </h3>
            </summary>
            <p className="pb-5 text-body text-pretty text-ink-muted">{item.answer}</p>
          </details>
        ))}
      </div>

      <Link
        href="/faq"
        className="mt-8 inline-block text-sm text-strait underline-offset-4 hover:underline"
      >
        {t('seeAll')}
      </Link>

      <script
        type="application/ld+json"
        // Serialised from the rows rendered above, so the markup and the page
        // always agree. Not user input — these come from FaqItem.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </section>
  );
}
