import { getTranslations } from 'next-intl/server';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
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

      <Accordion type="single" collapsible className="mt-10">
        {items.map((item) => (
          <AccordionItem key={item.id} value={item.id}>
            <AccordionTrigger>{item.question}</AccordionTrigger>
            <AccordionContent>
              <p className="text-pretty">{item.answer}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

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
