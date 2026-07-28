import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowLeft, ArrowRight, MessageCircle } from 'lucide-react';

import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Markdown } from '@/components/public/course/markdown';
import {
  getPostBySlug,
  getRelatedCourses,
  getRelatedPosts,
  listPublishedPostSlugs,
  type BlogPostDetail,
} from '@/server/services/blog';
import {
  absoluteUrl,
  breadcrumbListJsonLd,
  buildMetadata,
  jsonLdScript,
  siteOrigin,
  type JsonLdNode,
} from '@/lib/seo';
import { formatDate, isSameCasablancaDay, toDateTimeAttribute } from '@/lib/dates';
import { Link } from '@/i18n/navigation';
import { dirFor, isLocale, locales, type Locale } from '@/i18n/routing';

/**
 * `/[locale]/blog/[slug]` — one article (§12.5).
 *
 * ## Stored content never becomes markup
 * The body is Markdown written in the admin and rendered through the same
 * `Markdown` component the course and legal pages use: it builds React elements,
 * so there is no `dangerouslySetInnerHTML` anywhere near editorial text and an
 * author who pastes `<script>` gets the literal characters on screen (§20). The
 * only `dangerouslySetInnerHTML` on this page is the JSON-LD block, whose
 * content `jsonLdScript` escapes.
 *
 * ## Heading order
 * `Markdown` starts at `h3`, which is right inside a card whose own title is an
 * `h2` and wrong for a document that *is* the page — it would jump `h1 → h3`.
 * The body's top-level `##` headings are lifted out here so they become real
 * `h2`s under the article title, and every deeper level follows from there (§21).
 *
 * ## Reading time
 * Counted from the body actually being rendered, not read from
 * `BlogPost.readMinutes`: one stored integer cannot describe four translations
 * of four different lengths.
 *
 * ## An empty blog must not break the build
 * `generateStaticParams` returns `[]` while no post is published. That is a
 * legal answer for a dynamic segment — Next pre-renders nothing and serves the
 * route on demand — so `next build` succeeds today and pre-renders every article
 * the moment there is one.
 */

type RouteParams = { locale: string; slug: string };

export async function generateStaticParams(): Promise<RouteParams[]> {
  const slugs = await listPublishedPostSlugs();
  return locales.flatMap((locale) => slugs.map((slug) => ({ locale, slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};

  const [post, t] = await Promise.all([
    getPostBySlug(slug, locale),
    getTranslations({ locale, namespace: 'seo' }),
  ]);

  if (post === null) return {};

  return buildMetadata({
    locale,
    path: `/blog/${post.slug}`,
    title: t('blogPost.title', { title: post.title }),
    description:
      post.excerpt === null
        ? t('blogPost.descriptionFallback', { title: post.title })
        : t('blogPost.description', { summary: post.excerpt }),
    image:
      post.coverUrl === null
        ? { url: '/brand/og-default.png', alt: t('ogAlt.blogPost', { title: post.title }) }
        : { url: post.coverUrl, alt: t('ogAlt.blogPost', { title: post.title }) },
    type: 'article',
    publishedTime: toDateTimeAttribute(post.publishedAt),
    modifiedTime: toDateTimeAttribute(post.updatedAt),
  });
}

/* -------------------------------------------------------------------------- */
/* Body sections                                                               */
/* -------------------------------------------------------------------------- */

interface ArticleSection {
  readonly id: string;
  /** `null` for the lede that precedes the article's first `##`. */
  readonly heading: string | null;
  readonly body: string;
}

const TOP_LEVEL_HEADING = /^##\s+(.+?)\s*$/;

/** Split the stored Markdown on its top-level `##` headings. */
function splitSections(source: string): readonly ArticleSection[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const sections: ArticleSection[] = [];

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

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default async function BlogPostPage({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<React.JSX.Element> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [post, t, tA11y] = await Promise.all([
    getPostBySlug(slug, locale),
    getTranslations({ locale, namespace: 'pages.blog' }),
    getTranslations({ locale, namespace: 'a11y' }),
  ]);

  // A withdrawn or misspelled article is a real 404, not a page that returns
  // 200 with an apology: the blog exists for search engines (§12.5).
  if (post === null) notFound();

  const [relatedCourses, relatedPosts] = await Promise.all([
    getRelatedCourses(post.tags, locale),
    getRelatedPosts(post, locale),
  ]);

  const sections = splitSections(post.body);
  const url = absoluteUrl(locale, `/blog/${post.slug}`);
  const shareHref = `https://wa.me/?text=${encodeURIComponent(`${post.title} ${url}`)}`;
  const wasUpdated = !isSameCasablancaDay(post.publishedAt, post.updatedAt);

  const structuredData = jsonLdScript(
    articleJsonLd(locale, post, url),
    breadcrumbListJsonLd(locale, [
      { name: t('title'), path: '/blog' },
      { name: post.title },
    ]),
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Breadcrumbs
        label={tA11y('breadcrumb')}
        items={[{ label: t('title'), href: '/blog' }, { label: post.title }]}
        className="pb-6"
      />

      {/* The article carries the language it is actually written in, so an
          Arabic interface serving the French original does not render French
          prose right-to-left, and a screen reader pronounces it correctly. */}
      <article lang={post.resolvedLocale} dir={dirFor(post.resolvedLocale)}>
        <header className="flex flex-col gap-4">
          {post.tags.length === 0 ? null : (
            <ul role="list" className="flex flex-wrap items-center gap-2">
              {post.tags.map((tag) => (
                <li key={tag.slug}>
                  <Link
                    href={`/blog?categorie=${encodeURIComponent(tag.slug)}`}
                    className="inline-flex min-h-11 items-center rounded-pill border border-hairline bg-surface px-4 text-sm font-medium text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait/45 hover:text-ink motion-reduce:transition-none"
                  >
                    {tag.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <h1 className="text-title text-balance">{post.title}</h1>

          {post.excerpt === null ? null : (
            <p className="text-lead text-pretty text-ink-muted">{post.excerpt}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
            {post.authorName === null ? null : (
              <>
                <span>{t('author', { name: post.authorName })}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <time dateTime={toDateTimeAttribute(post.publishedAt)}>
              {t('publishedOn', { date: formatDate(post.publishedAt, locale) })}
            </time>
            <span aria-hidden="true">·</span>
            <span>{t('readingTime', { minutes: post.readMinutes })}</span>
          </div>

          {!wasUpdated ? null : (
            <p className="text-sm text-ink-muted">
              <time dateTime={toDateTimeAttribute(post.updatedAt)}>
                {t('updatedOn', { date: formatDate(post.updatedAt, locale) })}
              </time>
            </p>
          )}
        </header>

        {post.coverUrl === null ? null : (
          <div className="relative mt-8 aspect-[16/9] w-full overflow-hidden rounded-lg border border-hairline bg-raised">
            <Image
              src={post.coverUrl}
              alt={t('coverAlt', { title: post.title })}
              fill
              priority
              sizes="(max-width: 767px) 100vw, 768px"
              className="object-cover"
            />
          </div>
        )}

        <div className="mt-10 flex flex-col gap-8">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              {section.heading === null ? null : (
                <h2 className="text-display text-balance">{section.heading}</h2>
              )}
              {section.body === '' ? null : (
                <Markdown
                  source={section.body}
                  headingLevel="h3"
                  className={section.heading === null ? undefined : 'mt-4'}
                />
              )}
            </section>
          ))}
        </div>
      </article>

      <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-hairline pt-6">
        <a
          href={shareHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-hairline bg-surface px-5 text-sm font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none"
        >
          <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
          {t('shareLabel')}
        </a>

        <Link
          href="/blog"
          className="inline-flex min-h-11 items-center gap-2 rounded-pill px-4 text-sm font-medium text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-ink motion-reduce:transition-none"
        >
          <ArrowLeft className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
          {t('backToBlog')}
        </Link>
      </div>

      {relatedCourses.length === 0 ? null : (
        <section aria-labelledby="blog-related-courses" className="mt-12">
          <h2 id="blog-related-courses" className="text-heading font-medium text-ink">
            {t('relatedCourses')}
          </h2>
          <ul role="list" className="mt-4 grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline">
            {relatedCourses.map((course) => (
              <li key={course.slug} className="bg-surface">
                <Link
                  href={`/formations/${course.slug}`}
                  className="flex min-h-14 items-center justify-between gap-4 px-5 py-4 text-body text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised motion-reduce:transition-none"
                >
                  <span className="text-pretty">{course.title}</span>
                  <ArrowRight
                    className="size-4 shrink-0 text-ink-muted rtl:-scale-x-100"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {relatedPosts.length === 0 ? null : (
        <section aria-labelledby="blog-related-posts" className="mt-12">
          <h2 id="blog-related-posts" className="text-heading font-medium text-ink">
            {t('relatedPosts')}
          </h2>
          <ul role="list" className="mt-4 grid gap-4 sm:grid-cols-3">
            {relatedPosts.map((related) => (
              <li key={related.id}>
                <Link
                  href={`/blog/${related.slug}`}
                  className="flex h-full flex-col gap-2 rounded-lg border border-hairline bg-surface p-5 transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait/45 motion-reduce:transition-none"
                >
                  <span className="text-body font-medium text-balance text-ink">
                    {related.title}
                  </span>
                  <span className="mt-auto text-sm text-ink-muted">
                    {t('readingTime', { minutes: related.readMinutes })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {structuredData === null ? null : (
        <script
          type="application/ld+json"
          // `jsonLdScript` escapes `<`; the content is editorial, never visitor input.
          dangerouslySetInnerHTML={{ __html: structuredData }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Structured data                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `Article` for one post. Every field is one the page renders — the headline is
 * the `<h1>`, the dates are the `<time>` elements, the author is the byline —
 * so the graph cannot drift from the document (§21).
 */
function articleJsonLd(locale: Locale, post: BlogPostDetail, url: string): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: post.title,
    url,
    mainEntityOfPage: url,
    inLanguage: post.resolvedLocale,
    datePublished: toDateTimeAttribute(post.publishedAt),
    dateModified: toDateTimeAttribute(post.updatedAt),
    isPartOf: { '@id': `${absoluteUrl(locale, '/blog')}#blog` },
    publisher: { '@id': `${siteOrigin()}/#organization` },
    ...(post.excerpt === null ? {} : { description: post.excerpt }),
    ...(post.coverUrl === null ? {} : { image: post.coverUrl }),
    ...(post.authorName === null
      ? {}
      : { author: { '@type': 'Person', name: post.authorName } }),
    ...(post.tags.length === 0 ? {} : { keywords: post.tags.map((tag) => tag.label).join(', ') }),
  };
}
