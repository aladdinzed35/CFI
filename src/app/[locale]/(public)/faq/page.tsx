import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ChevronDown, MessageCircle } from 'lucide-react';

import { FaqBrowser } from '@/components/public/faq/faq-browser';
import { buildMetadata, faqPageJsonLd, jsonLdScript } from '@/lib/seo';
import { getPublicChrome } from '@/server/services/public-chrome';
import {
  countFaqQuestions,
  isFaqGroupKey,
  getFaqGroups,
  type FaqGroup,
  type FaqGroupKey,
} from '@/server/services/faq';
import { dirFor, isLocale, locales } from '@/i18n/routing';

/**
 * `/[locale]/faq` — the grouped, searchable FAQ (§12.5).
 *
 * ## Native disclosures, not the Radix accordion
 * Every answer is inside a `<details>` element rendered on the server. That is
 * not a stylistic preference: the requirement is that the answers exist in the
 * HTML document, readable, for a crawler and for a visitor whose JavaScript
 * never arrives. A Radix accordion unmounts its closed panels, and even forced
 * to stay mounted it needs script to open — which would leave a no-script
 * visitor looking at ten questions and no answers. `<details>` opens with zero
 * JavaScript, is keyboard-operable by the browser itself, and `<summary>` is
 * one of the two elements HTML allows a heading inside, so the page keeps a
 * clean h1 → h2 → h3 outline.
 *
 * ## What the client actually costs
 * One small component (`FaqBrowser`) holding the search field. The groups it
 * wraps are server components passed through as `children`, so nothing below
 * this file's `<details>` markup is serialised into the RSC payload twice or
 * shipped to the browser as JSON.
 *
 * ## Structured data comes from the rows on screen
 * `faqPageJsonLd` is fed the exact `FaqQuestion` objects the page renders — not
 * a second query, not a hand-written list. `FAQPage` requires every marked-up
 * answer to be visible on the page; sharing one source is the only way that
 * stays true after someone edits an answer in the admin.
 *
 * ## Copy and rows are kept apart
 * The questions are `FaqItem` rows (four locales, French fallback in the
 * service). The chrome around them — the heading, the search labels, the group
 * names — is `pages.faq` in the message catalogue, because none of it has a row
 * in the schema and all of it must exist in four languages.
 */

type LocaleParams = { locale: string };

/** `pages.faq.groups.*` — one label per category, plus a tail for the rest. */
const GROUP_LABEL: Record<FaqGroupKey, string> = {
  INSCRIPTION: 'groups.inscription',
  PAIEMENT: 'groups.paiement',
  FORMATIONS: 'groups.formations',
  CERTIFICAT: 'groups.certificat',
  TECHNIQUE: 'groups.technique',
};

/** Stable anchor for a group — what the rubric nav links to. */
function anchorFor(category: string): string {
  return `faq-${category.toLowerCase()}`;
}

function labelKeyFor(group: FaqGroup): string {
  return isFaqGroupKey(group.category) ? GROUP_LABEL[group.category] : 'groups.other';
}

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

  const t = await getTranslations({ locale, namespace: 'seo.faq' });
  return buildMetadata({
    locale,
    path: '/faq',
    title: t('title'),
    description: t('description'),
  });
}

export default async function FaqPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [t, tWhatsapp, groups, chrome] = await Promise.all([
    getTranslations({ locale, namespace: 'pages.faq' }),
    getTranslations({ locale, namespace: 'whatsapp' }),
    getFaqGroups(locale),
    getPublicChrome(locale),
  ]);

  const total = countFaqQuestions(groups);

  const whatsappHref =
    chrome.contact.whatsappNumber === null
      ? null
      : `https://wa.me/${chrome.contact.whatsappNumber}?text=${encodeURIComponent(
          tWhatsapp('prefillGeneric'),
        )}`;

  // The same rows the accordions below render, so the markup cannot outlive the
  // page. `jsonLdScript` returns null when there is nothing valid to emit.
  const structuredData = jsonLdScript(
    faqPageJsonLd(
      groups.flatMap((group) =>
        group.items.map((item) => ({ question: item.question, answer: item.answer })),
      ),
    ),
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-3">
        <h1 className="text-title text-balance">{t('title')}</h1>
        <p className="max-w-2xl text-lead text-pretty text-ink-muted">{t('lead')}</p>
      </header>

      {total === 0 ? null : (
        <div className="mt-10">
          <FaqBrowser total={total} whatsappHref={whatsappHref}>
            {/* Five rubrics on a phone are a long scroll; these are the shortcut.
                Plain anchors, so they work before hydration like everything else. */}
            <nav aria-label={t('allGroups')}>
              <ul role="list" className="flex flex-wrap gap-2">
                {groups.map((group) => (
                  <li key={group.category} data-faq-nav={group.category}>
                    <a
                      href={`#${anchorFor(group.category)}`}
                      className="inline-flex min-h-11 items-center rounded-pill border border-hairline bg-surface px-4 text-sm text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-ink motion-reduce:transition-none"
                    >
                      {t(labelKeyFor(group))}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            {groups.map((group) => {
              const anchor = anchorFor(group.category);

              return (
                <section
                  key={group.category}
                  id={anchor}
                  data-faq-group={group.category}
                  aria-labelledby={`${anchor}-title`}
                  className="scroll-mt-24"
                >
                  <h2 id={`${anchor}-title`} className="text-heading font-medium text-ink">
                    {t(labelKeyFor(group))}
                  </h2>

                  <div className="mt-4 border-t border-hairline">
                    {group.items.map((item) => {
                      // An item we could only serve in French inside an Arabic
                      // page is announced and typeset as French, not mislabelled.
                      const served = item.resolvedLocale;

                      return (
                        <details
                          key={item.id}
                          data-faq-id={item.id}
                          data-faq-category={group.category}
                          lang={served === locale ? undefined : served}
                          dir={served === locale ? undefined : dirFor(served)}
                          className="group border-b border-hairline"
                        >
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
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </FaqBrowser>
        </div>
      )}

      {/* Whatever the list did not cover goes to a human, on the channel the
          centre actually watches (§12.5). */}
      <section
        aria-labelledby="faq-contact"
        className="mt-14 flex flex-col gap-4 rounded-lg border border-strait/30 bg-strait-wash p-6 sm:p-8"
      >
        <div className="flex items-start gap-3">
          <MessageCircle className="mt-1 size-6 shrink-0 text-strait" aria-hidden="true" />
          <div className="flex flex-col gap-2">
            <h2 id="faq-contact" className="text-heading text-balance">
              {t('stillHaveQuestions')}
            </h2>
            <p className="max-w-2xl text-body text-pretty text-ink-muted">
              {t('stillHaveQuestionsBody')}
            </p>
          </div>
        </div>

        {whatsappHref === null ? null : (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-md bg-strait px-6 text-body font-medium text-on-accent shadow-e1 transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-strait/90 motion-reduce:transition-none"
          >
            {t('whatsappCta')}
          </a>
        )}
      </section>

      {structuredData === null ? null : (
        <script
          type="application/ld+json"
          // Serialised from the rows rendered above, so the markup and the page
          // always agree. Not user input — these come from FaqItem.
          dangerouslySetInnerHTML={{ __html: structuredData }}
        />
      )}
    </div>
  );
}
