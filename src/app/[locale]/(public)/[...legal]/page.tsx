import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowUp, FileText } from 'lucide-react';

import { Markdown } from '@/components/public/course/markdown';
import { Button } from '@/components/ui/button';
import { getPublicChrome } from '@/server/services/public-chrome';
import { getEditorialPage, getSitemapIndex } from '@/server/services/public-pages';
import { buildMetadata, jsonLdScript, webPageJsonLd } from '@/lib/seo';
import { formatDate, toDateTimeAttribute } from '@/lib/dates';
import { dirFor, isLocale, locales } from '@/i18n/routing';

/**
 * `/[locale]/legal/[slug]` — the editable legal documents (§12.5, §20, §27).
 *
 * ## Why a catch-all
 * The route is `[...legal]`, matched against `['legal', slug]`. Anything else
 * under the public group that resolves to nothing else falls here and is refused
 * with `notFound()`, so this file is also the reason an unknown public URL gets
 * the designed 404 rather than a framework default.
 *
 * ## The fallback is a compliance decision, not a nicety
 * Law 09-08 requires that the privacy notice be *available*. `getEditorialPage`
 * resolves the requested locale and falls back to French per document — body and
 * title together, never one in each language — and the page says plainly, above
 * the text, that it is showing the French original. A blank privacy policy for
 * an Arabic-speaking visitor would be a worse outcome than a French one they can
 * still read, print, or hand to a lawyer. The article carries the `lang` and
 * `dir` of the language it is actually written in, so an Arabic page rendering a
 * French document does not render French text right-to-left.
 *
 * ## Stored content never becomes markup
 * The body is authored in the admin and rendered through `Markdown`, which
 * builds React elements rather than HTML. There is no `dangerouslySetInnerHTML`
 * anywhere near it: an administrator who pastes `<script>` gets the literal text
 * on screen (§20). The document's own `##` headings are lifted out here so they
 * can be real `<h2>`s under the page's `<h1>` — the heading order is a hard
 * accessibility gate (§21), and `Markdown` deliberately starts at `h3`.
 *
 * ## A known document that is not published yet
 * The four §12.5 slugs render a designed panel instead of a 404, marked
 * `noindex`. « Ce document n'est pas encore publié » with a way to ask is honest;
 * a 404 on a URL the footer links to looks like a broken site.
 */

/* -------------------------------------------------------------------------- */
/* Routing                                                                     */
/* -------------------------------------------------------------------------- */

type LegalParams = { locale: string; legal: string[] };

/** The URL segment this catch-all serves. Every other first segment is a 404. */
const LEGAL_PREFIX = 'legal';

/**
 * The documents §12.5 names. Membership decides one thing only: whether an
 * absent document is a 404 or the « pas encore publié » panel. A page an editor
 * adds under another slug still renders — it simply has no localised lead.
 */
const KNOWN_SLUGS = ['cgu', 'confidentialite', 'mentions-legales', 'cookies'] as const;

type KnownSlug = (typeof KNOWN_SLUGS)[number];

function isKnownSlug(value: string): value is KnownSlug {
  return (KNOWN_SLUGS as readonly string[]).includes(value);
}

/** `['legal', 'cgu']` → `'cgu'`. Anything else → `null`. */
function slugFromSegments(segments: readonly string[] | undefined): string | null {
  if (segments === undefined || segments.length !== 2) return null;
  const [prefix, slug] = segments;
  if (prefix !== LEGAL_PREFIX) return null;
  if (slug === undefined || slug === '') return null;
  return slug;
}

export async function generateStaticParams(): Promise<LegalParams[]> {
  const { legalPages } = await getSitemapIndex();
  const params: LegalParams[] = [];

  for (const page of legalPages) {
    const slug = page.path.startsWith(`/${LEGAL_PREFIX}/`)
      ? page.path.slice(LEGAL_PREFIX.length + 2)
      : '';
    if (slug === '' || slug.includes('/')) continue;
    for (const locale of locales) {
      params.push({ locale, legal: [LEGAL_PREFIX, slug] });
    }
  }

  return params;
}

/* -------------------------------------------------------------------------- */
/* Metadata                                                                    */
/* -------------------------------------------------------------------------- */

export async function generateMetadata({
  params,
}: {
  params: Promise<LegalParams>;
}): Promise<Metadata> {
  const { locale, legal } = await params;
  if (!isLocale(locale)) return {};

  const slug = slugFromSegments(legal);
  if (slug === null) return {};

  const [page, t] = await Promise.all([
    getEditorialPage(slug, locale),
    getTranslations({ locale, namespace: 'legal' }),
  ]);

  if (page === null) {
    if (!isKnownSlug(slug)) return {};
    return buildMetadata({
      locale,
      path: `/${LEGAL_PREFIX}/${slug}`,
      title: t('notFound.title'),
      description: t('notFound.body'),
      noIndex: true,
    });
  }

  // `page.seoTitle` is authored with the brand already appended (« … — CFI »),
  // and `buildMetadata` applies the « {title} · CFI » template on top. The
  // document's own title is the one that composes correctly.
  return buildMetadata({
    locale,
    path: `/${LEGAL_PREFIX}/${slug}`,
    title: page.title,
    description: page.seoDescription ?? leadFor(slug, t) ?? page.title,
    modifiedTime: toDateTimeAttribute(page.updatedAt),
  });
}

/* -------------------------------------------------------------------------- */
/* Body sections                                                               */
/* -------------------------------------------------------------------------- */

interface LegalSection {
  readonly id: string;
  /** `null` for the preamble that precedes the document's first `##`. */
  readonly heading: string | null;
  readonly body: string;
}

const TOP_LEVEL_HEADING = /^##\s+(.+?)\s*$/;

/**
 * Split the stored Markdown on its top-level `##` headings.
 *
 * `Markdown` maps `##` to `h3` at the shallowest, which is correct inside a card
 * whose own title is an `h2` but wrong for a document that *is* the page: it
 * would jump `h1 → h3`. Lifting the headings out here gives real `h2`s, leaves
 * every nested `###` to `Markdown` (which renders it as the `h3` that follows),
 * and produces the anchors the table of contents needs.
 *
 * Ids are positional rather than derived from the heading text: a heading in
 * Arabic slugifies to nothing, and an anchor that only works in French is worse
 * than one that is not readable.
 */
function splitSections(source: string): readonly LegalSection[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const sections: LegalSection[] = [];

  let heading: string | null = null;
  let buffer: string[] = [];
  let index = 0;

  const flush = (): void => {
    const body = buffer.join('\n').trim();
    if (heading === null && body === '') return;
    sections.push({ id: `section-${index}`, heading, body });
    index += 1;
  };

  for (const line of lines) {
    const match = TOP_LEVEL_HEADING.exec(line);
    if (match === null) {
      buffer.push(line);
      continue;
    }
    flush();
    heading = match[1] ?? null;
    buffer = [];
  }
  flush();

  return sections;
}

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/**
 * The one-line summary shown under the title. Written as an exhaustive switch
 * over literal keys so the i18n guard can resolve every one of them.
 */
function leadFor(slug: string, t: Translator): string | null {
  if (!isKnownSlug(slug)) return null;
  switch (slug) {
    case 'cgu':
      return t('terms.lead');
    case 'confidentialite':
      return t('privacy.lead');
    case 'mentions-legales':
      return t('notices.lead');
    case 'cookies':
      return t('cookies.lead');
  }
}

/** Below this a table of contents is noise rather than navigation. */
const MIN_SECTIONS_FOR_TOC = 4;

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default async function LegalPage({
  params,
}: {
  params: Promise<LegalParams>;
}): Promise<React.JSX.Element> {
  const { locale, legal } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const slug = slugFromSegments(legal);
  if (slug === null) notFound();

  const [page, chrome, t, tRoot] = await Promise.all([
    getEditorialPage(slug, locale),
    getPublicChrome(locale),
    getTranslations({ locale, namespace: 'legal' }),
    getTranslations({ locale }),
  ]);

  const whatsappHref =
    chrome.contact.whatsappNumber === null
      ? null
      : `https://wa.me/${chrome.contact.whatsappNumber}?text=${encodeURIComponent(
          tRoot('whatsapp.prefillGeneric'),
        )}`;

  if (page === null) {
    // An unknown slug is a wrong URL; a document §12.5 promises but that has not
    // been published yet is a state the visitor deserves an explanation for.
    if (!isKnownSlug(slug)) notFound();
    return <UnpublishedDocument t={t} whatsappHref={whatsappHref} />;
  }

  const sections = splitSections(page.body);
  const headings = sections.filter(
    (section): section is LegalSection & { heading: string } => section.heading !== null,
  );
  const lead = leadFor(slug, t);
  const servedInFrench = page.resolvedLocale !== locale;

  const structuredData = jsonLdScript(
    webPageJsonLd({
      locale,
      path: `/${LEGAL_PREFIX}/${slug}`,
      name: page.title,
      description: page.seoDescription ?? lead,
      dateModified: toDateTimeAttribute(page.updatedAt),
    }),
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <header id="haut-de-page" className="flex flex-col gap-3 scroll-mt-24">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
          {t('sectionLabel')}
        </p>
        <h1 className="text-title text-balance">{page.title}</h1>
        {lead === null ? null : (
          <p className="text-lead text-pretty text-ink-muted">{lead}</p>
        )}
        <p className="text-sm text-ink-muted">
          <time dateTime={toDateTimeAttribute(page.updatedAt)}>
            {t('lastUpdated', { date: formatDate(page.updatedAt, locale) })}
          </time>
        </p>
      </header>

      {/* Saying which language the text is actually in is not decoration: it
          tells the reader why the document does not match the interface, and it
          carries the `lang` an assistive technology needs to pronounce it. */}
      {!servedInFrench ? null : (
        <p
          className="mt-6 rounded-md border border-hairline bg-raised px-4 py-3 text-sm text-pretty text-ink-muted"
          lang={locale}
        >
          {t('frenchFallback')}
        </p>
      )}

      {headings.length < MIN_SECTIONS_FOR_TOC ? null : (
        <nav
          aria-labelledby="legal-toc"
          className="mt-8 rounded-md border border-hairline bg-surface p-5"
          lang={page.resolvedLocale}
          dir={dirFor(page.resolvedLocale)}
        >
          <h2 id="legal-toc" className="text-sm font-medium text-ink">
            {t('tocTitle')}
          </h2>
          <ol className="mt-3 flex list-decimal flex-col gap-2 ps-5 text-sm marker:text-ink-muted">
            {headings.map((section) => (
              <li key={section.id} className="ps-1">
                <a
                  href={`#${section.id}`}
                  className="text-ink-muted underline-offset-4 hover:text-ink hover:underline"
                >
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <article
        className="mt-10 flex flex-col gap-10"
        lang={page.resolvedLocale}
        dir={dirFor(page.resolvedLocale)}
      >
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="flex scroll-mt-24 flex-col gap-4">
            {section.heading === null ? null : (
              <h2 className="font-display text-heading font-medium text-balance text-ink">
                {section.heading}
              </h2>
            )}
            <Markdown source={section.body} headingLevel="h3" />
          </section>
        ))}
      </article>

      <div className="mt-12 flex flex-col gap-6 border-t border-hairline pt-8">
        <a
          href="#haut-de-page"
          className="inline-flex items-center gap-2 self-start text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          <ArrowUp aria-hidden="true" className="size-4" />
          {t('backToTop')}
        </a>

        {whatsappHref === null ? null : (
          <div className="flex flex-col gap-3">
            <p className="text-body text-pretty text-ink-muted">{t('contactPrompt')}</p>
            <Button asChild variant="secondary" className="self-start">
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                {t('contactCta')}
              </a>
            </Button>
          </div>
        )}
      </div>

      {structuredData === null ? null : (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The document that exists in §12.5 but not yet in the database               */
/* -------------------------------------------------------------------------- */

function UnpublishedDocument({
  t,
  whatsappHref,
}: {
  t: Translator;
  whatsappHref: string | null;
}): React.JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-5 px-4 py-20 text-center sm:px-6 sm:py-28">
      <span
        aria-hidden="true"
        className="grid size-14 place-items-center rounded-md border border-hairline bg-raised text-ink-muted"
      >
        <FileText className="size-6" />
      </span>

      <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
        {t('sectionLabel')}
      </p>
      <h1 className="text-heading text-balance">{t('notFound.title')}</h1>
      <p className="max-w-prose text-body text-pretty text-ink-muted">{t('notFound.body')}</p>

      {whatsappHref === null ? null : (
        <Button asChild>
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
            {t('notFound.action')}
          </a>
        </Button>
      )}
    </div>
  );
}
