import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight, Newspaper } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';
import { getBlogIndex, type BlogPostSummary } from '@/server/services/blog';
import { absoluteUrl, buildMetadata, jsonLdScript, type JsonLdNode } from '@/lib/seo';
import { formatDate, toDateTimeAttribute } from '@/lib/dates';
import { Link, redirect } from '@/i18n/navigation';
import { isLocale, locales, type Locale } from '@/i18n/routing';

/**
 * `/[locale]/blog` — the article index (§12.5).
 *
 * ## Today it is empty, and it says so
 * `BlogPost` has no published row. §11.5 forbids the « bientôt disponible »
 * placeholder and forbids inventing three fake articles to make the grid look
 * full, so the page states what is happening, says what to do next, and offers
 * exactly one way to do it: the catalogue. Everything else on this page — the
 * category facets, the pagination, the `Blog` structured data — is built and
 * wired, and appears the day an editor publishes. Nothing here is a stub.
 *
 * ## The filter is the URL
 * `?categorie=` and `?page=` are read on the server and rendered as plain
 * links, exactly as the catalogue does (§12.3): shareable, back-button-safe,
 * crawlable, and zero client JavaScript on a page whose Lighthouse budget is
 * mobile-first (§0.4). A `?categorie=` nobody publishes under is not a 404 —
 * the visitor is sent back to the unfiltered index, which is the page they were
 * looking for.
 */

type LocaleParams = { locale: string };
type SearchParams = Record<string, string | string[] | undefined>;

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

  const t = await getTranslations({ locale, namespace: 'seo' });
  return buildMetadata({
    locale,
    path: '/blog',
    title: t('blog.title'),
    description: t('blog.description'),
    image: { url: '/brand/og-default.png', alt: t('ogAlt.blog') },
  });
}

/* -------------------------------------------------------------------------- */
/* URL helpers                                                                 */
/* -------------------------------------------------------------------------- */

/** `?categorie=…&page=…`, with the defaults omitted so page 1 has a clean URL. */
function blogHref(category: string | null, page: number): string {
  const params = new URLSearchParams();
  if (category !== null) params.set('categorie', category);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query === '' ? '/blog' : `/blog?${query}`;
}

/** First value of a repeated query parameter, trimmed. */
function firstParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parsePage(raw: string | string[] | undefined): number {
  const value = firstParam(raw);
  if (value === null) return 1;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default async function BlogIndexPage({
  params,
  searchParams,
}: {
  params: Promise<LocaleParams>;
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const [{ locale }, rawSearch] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [index, t, tCatalog] = await Promise.all([
    getBlogIndex({
      locale,
      page: parsePage(rawSearch.page),
      category: firstParam(rawSearch.categorie),
    }),
    getTranslations({ locale, namespace: 'pages.blog' }),
    getTranslations({ locale, namespace: 'catalog' }),
  ]);

  // A category that no published post carries names nothing. Rather than a 404
  // on a page that exists, drop the filter and show the index.
  if (index.unknownCategory) redirect({ href: '/blog', locale });

  const structuredData =
    index.posts.length === 0
      ? null
      : jsonLdScript(blogJsonLd(locale, t('title'), t('lead'), index.posts));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-3 pb-8">
        <h1 className="text-title text-balance">{t('title')}</h1>
        <p className="max-w-2xl text-lead text-pretty text-ink-muted">{t('lead')}</p>
      </header>

      {index.totalPublished === 0 ? (
        <EmptyState
          illustration={<Newspaper aria-hidden="true" />}
          title={t('empty.title')}
          description={t('empty.body')}
          className="rounded-lg border border-hairline bg-surface"
          action={
            <Link
              href="/formations"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-strait px-6 text-body font-medium text-on-accent shadow-e1 transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-strait/90 motion-reduce:transition-none"
            >
              {t('empty.action')}
              <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {index.categories.length === 0 ? null : (
            <nav aria-label={t('categoriesLabel')}>
              <ul role="list" className="flex flex-wrap items-center gap-2">
                <li>
                  <CategoryLink
                    href={blogHref(null, 1)}
                    label={t('allCategories')}
                    active={index.category === null}
                  />
                </li>
                {index.categories.map((category) => (
                  <li key={category.slug}>
                    <CategoryLink
                      href={blogHref(category.slug, 1)}
                      label={category.label}
                      count={category.count}
                      active={index.category?.slug === category.slug}
                    />
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <p className="text-sm text-ink-muted">{t('postCount', { count: index.total })}</p>

          <ul role="list" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {index.posts.map((post, position) => (
              <li key={post.id} className="flex">
                <PostCard
                  post={post}
                  coverAlt={t('coverAlt', { title: post.title })}
                  dateLabel={t('publishedOn', { date: formatDate(post.publishedAt, locale) })}
                  readingLabel={t('readingTime', { minutes: post.readMinutes })}
                  authorLabel={
                    post.authorName === null ? null : t('author', { name: post.authorName })
                  }
                  priority={position === 0}
                />
              </li>
            ))}
          </ul>

          {index.pageCount <= 1 ? null : (
            <nav
              aria-label={tCatalog('pagination.label')}
              className="flex items-center justify-between gap-4 pt-2"
            >
              {index.page > 1 ? (
                <Link
                  href={blogHref(index.category?.slug ?? null, index.page - 1)}
                  rel="prev"
                  className="inline-flex min-h-11 items-center rounded-pill border border-hairline bg-surface px-5 text-sm text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised motion-reduce:transition-none"
                >
                  {tCatalog('pagination.previous')}
                </Link>
              ) : (
                <span />
              )}

              <p className="text-sm text-ink-muted">
                {tCatalog('pagination.summary', { page: index.page, total: index.pageCount })}
              </p>

              {index.page < index.pageCount ? (
                <Link
                  href={blogHref(index.category?.slug ?? null, index.page + 1)}
                  rel="next"
                  className="inline-flex min-h-11 items-center rounded-pill border border-hairline bg-surface px-5 text-sm text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised motion-reduce:transition-none"
                >
                  {tCatalog('pagination.next')}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
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
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One facet. The count is part of the label rather than a coloured dot, because
 * a filter that promises results must say how many (§21: never colour alone).
 */
function CategoryLink({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count?: number;
  active: boolean;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={[
        'inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-sm font-medium transition-colors duration-[120ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none',
        active
          ? 'border-strait bg-strait-wash text-ink'
          : 'border-hairline bg-surface text-ink-muted hover:border-strait/45 hover:text-ink',
      ].join(' ')}
    >
      {label}
      {count === undefined ? null : (
        <span className="force-ltr font-mono text-xs text-ink-muted" dir="ltr" data-numeric>
          {count}
        </span>
      )}
    </Link>
  );
}

function PostCard({
  post,
  coverAlt,
  dateLabel,
  readingLabel,
  authorLabel,
  priority,
}: {
  post: BlogPostSummary;
  coverAlt: string;
  dateLabel: string;
  readingLabel: string;
  authorLabel: string | null;
  priority: boolean;
}): React.JSX.Element {
  return (
    <article className="group relative flex w-full flex-col overflow-hidden rounded-lg border border-hairline bg-surface transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait/45 motion-reduce:transition-none">
      {post.coverUrl === null ? null : (
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-raised">
          <Image
            src={post.coverUrl}
            alt={coverAlt}
            fill
            priority={priority}
            sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 380px"
            className="object-cover"
          />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 p-5 sm:p-6">
        {post.tags.length === 0 ? null : (
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-strait">
            {post.tags[0]?.label}
          </p>
        )}

        <h2 className="text-heading font-medium text-balance text-ink">
          {/* The whole card is the target: the link stretches over it, so the
              hit area is the card while the accessible name stays the title. */}
          <Link
            href={`/blog/${post.slug}`}
            className="rounded-sm after:absolute after:inset-0 after:content-['']"
          >
            {post.title}
          </Link>
        </h2>

        {post.excerpt === null ? null : (
          <p className="line-clamp-3 text-body text-pretty text-ink-muted">{post.excerpt}</p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-sm text-ink-muted">
          <time dateTime={toDateTimeAttribute(post.publishedAt)} lang={post.resolvedLocale}>
            {dateLabel}
          </time>
          <span aria-hidden="true">·</span>
          <span>{readingLabel}</span>
          {authorLabel === null ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span>{authorLabel}</span>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Structured data                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `Blog` with the posts on this page, emitted only when there are posts.
 *
 * Every value is one the page renders. An empty blog emits no tag at all —
 * structured data that describes nothing is worse than none (§21).
 */
function blogJsonLd(
  locale: Locale,
  name: string,
  description: string,
  posts: readonly BlogPostSummary[],
): JsonLdNode {
  const url = absoluteUrl(locale, '/blog');

  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': `${url}#blog`,
    name,
    description,
    url,
    inLanguage: locale,
    blogPost: posts.map((post) => ({
      '@type': 'BlogPosting',
      headline: post.title,
      url: absoluteUrl(locale, `/blog/${post.slug}`),
      datePublished: toDateTimeAttribute(post.publishedAt),
      dateModified: toDateTimeAttribute(post.updatedAt),
      inLanguage: post.resolvedLocale,
      ...(post.excerpt === null ? {} : { description: post.excerpt }),
      ...(post.authorName === null
        ? {}
        : { author: { '@type': 'Person', name: post.authorName } }),
    })),
  };
}
