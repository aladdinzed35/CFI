import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ChevronLeft, ChevronRight, FilterX, GraduationCap, SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { CatalogControls } from '@/components/public/catalog/catalog-controls';
import { CatalogHero } from '@/components/public/catalog/catalog-hero';
import { CatalogSearch } from '@/components/public/catalog/catalog-search';
import { FilterGroups, FilterRail } from '@/components/public/catalog/filter-rail';
import { FilterSheet, FilterSheetProvider } from '@/components/public/catalog/filter-sheet';
import { ResultsGrid } from '@/components/public/catalog/results-grid';
import { getCatalog, type CatalogCategoryOption } from '@/server/services/catalog/queries';
import {
  CATALOG_SORTS,
  activeFilterCount,
  catalogHref,
  clearFilters,
  parseCatalogFilters,
  type CatalogFilters,
} from '@/server/services/catalog/filters';
import { getPublicChrome } from '@/server/services/public-chrome';
import { buildMetadata } from '@/lib/seo';
import { Link } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';

/**
 * `/[locale]/formations` — the catalogue (§12.3).
 *
 * Server-rendered and filtered entirely from the URL. Nothing here holds filter
 * state: `parseCatalogFilters` reads the query string, `getCatalog` answers it,
 * and the controls only push a new URL. That is what makes the page shareable,
 * back-button-safe and crawlable, which §12.3 asks for explicitly — a client
 * state machine would satisfy none of the three.
 *
 * Facet counts come back with the results so a filter that would return nothing
 * is greyed out rather than hidden. Hiding it makes the catalogue look smaller
 * than it is; disabling it tells the visitor the truth.
 */

type LocaleParams = { locale: string };
type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'seo.catalog' });
  return buildMetadata({
    locale,
    path: '/formations',
    title: t('title'),
    description: t('description'),
  });
}

export function generateStaticParams(): LocaleParams[] {
  return locales.map((locale) => ({ locale }));
}

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<LocaleParams>;
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const [{ locale }, rawSearch] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const filters = parseCatalogFilters(rawSearch);
  const [result, t, tHero, tNav, tWhatsapp, chrome] = await Promise.all([
    getCatalog(filters, locale),
    getTranslations({ locale, namespace: 'catalog' }),
    getTranslations({ locale, namespace: 'home.hero' }),
    getTranslations({ locale, namespace: 'publicNav' }),
    getTranslations({ locale, namespace: 'whatsapp' }),
    getPublicChrome(locale),
  ]);

  const activeCount = activeFilterCount(filters);

  // Nothing published at all — not "nothing matches". There is nothing to
  // filter, sort or search, so the page says so once, in the middle, instead
  // of drawing a rail of greyed-out zeros around a hole.
  const catalogueIsEmpty = result.total === 0 && activeCount === 0;

  // Each chip's href is the CURRENT url minus that one filter, so removing a
  // filter is a plain link — it works with JavaScript disabled and the browser
  // gets a real history entry.
  const chips = buildChips(filters, result.facets.categories, t);

  const whatsappHref =
    chrome.contact.whatsappNumber === null
      ? null
      : `https://wa.me/${chrome.contact.whatsappNumber}?text=${encodeURIComponent(
          tWhatsapp('prefillGeneric'),
        )}`;

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: result.total,
    itemListElement: result.courses.map((course, index) => ({
      '@type': 'ListItem',
      position: (result.page - 1) * result.courses.length + index + 1,
      url: `/${locale}/formations/${course.slug}`,
      name: course.title,
    })),
  };

  return (
    <>
      <CatalogHero eyebrow={tHero('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
        {catalogueIsEmpty ? undefined : <CatalogSearch filters={filters} />}
      </CatalogHero>

      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:py-12">
        {catalogueIsEmpty ? (
          <div className="mx-auto max-w-2xl rounded-lg border border-hairline bg-surface shadow-e1">
            <EmptyState
              tone="strait"
              illustration={<GraduationCap />}
              title={t('emptyCatalog.title')}
              description={t('emptyCatalog.body')}
              action={
                whatsappHref === null ? (
                  <Button asChild variant="secondary">
                    <Link href="/contact">{tNav('contact')}</Link>
                  </Button>
                ) : (
                  <Button asChild>
                    <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                      {t('emptyCatalog.action')}
                    </a>
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <FilterSheetProvider>
            <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-10 xl:grid-cols-[16rem_minmax(0,1fr)]">
              <FilterRail
                filters={filters}
                facets={result.facets}
                locale={locale}
                idPrefix="rail"
                className="hidden lg:block"
              />

              <section aria-labelledby="catalogue-resultats" className="flex min-w-0 flex-col gap-6">
                <h2 id="catalogue-resultats" className="sr-only">
                  {t('resultsRegion')}
                </h2>

                <CatalogControls
                  filters={filters}
                  activeCount={activeCount}
                  labels={{
                    resultCount: t('resultCount', { count: result.total }),
                    sortLabel: t('sort.label'),
                    sortOptions: SORT_VALUES.map((value) => ({
                      value,
                      label: t(`sort.${value}`),
                    })),
                    viewLabel: t('view.label'),
                    viewGrid: t('view.grille'),
                    viewList: t('view.liste'),
                    openFilters: t('filters.open'),
                    clearAll: t('filters.clearAll'),
                    activeChips: chips,
                  }}
                />

                {result.courses.length === 0 ? (
                  <NoMatch filters={filters} t={t} />
                ) : (
                  <ResultsGrid
                    courses={result.courses}
                    view={filters.view}
                    locale={locale}
                    isFirstPage={result.page === 1}
                  />
                )}

                <Pagination
                  page={result.page}
                  pageCount={result.pageCount}
                  filters={filters}
                  previousLabel={t('pagination.previous')}
                  nextLabel={t('pagination.next')}
                  label={t('pagination.label')}
                  summary={t('pagination.summary', { page: result.page, total: result.pageCount })}
                />
              </section>
            </div>

            <FilterSheet filters={filters} resultCount={result.total}>
              <FilterGroups
                filters={filters}
                facets={result.facets}
                locale={locale}
                idPrefix="sheet"
              />
            </FilterSheet>
          </FilterSheetProvider>
        )}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </>
  );
}

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/**
 * Filters (or a search) that match nothing. The way out is the one thing that
 * got the visitor here: the search term when there is one, otherwise the
 * filters — each a real link, so it works before hydration too.
 */
function NoMatch({ filters, t }: { filters: CatalogFilters; t: Translator }): React.JSX.Element {
  const searching = filters.query !== null;

  return (
    <div className="rounded-lg border border-dashed border-hairline bg-surface">
      <EmptyState
        illustration={searching ? <SearchX /> : <FilterX />}
        title={
          searching ? t('emptySearch.title', { query: filters.query ?? '' }) : t('empty.title')
        }
        description={searching ? t('emptySearch.body') : t('empty.body')}
        action={
          <Button asChild variant="secondary">
            <Link
              href={
                searching ? catalogHref(filters, { query: null }) : catalogHref(clearFilters(filters))
              }
            >
              {searching ? t('emptySearch.action') : t('empty.action')}
            </Link>
          </Button>
        }
        className="break-words"
      />
    </div>
  );
}

// Must match CATALOG_SORTS exactly — these values go into the URL.
const SORT_VALUES = CATALOG_SORTS;

/** One removable chip per applied filter. The href is "this URL, without that". */
function buildChips(
  filters: CatalogFilters,
  categories: readonly CatalogCategoryOption[],
  t: Translator,
): ReadonlyArray<{ key: string; label: string; href: string; removeLabel: string }> {
  const chips: Array<{ key: string; label: string; href: string }> = [];

  // The search term's own chip lives under the field, in `CatalogSearch`.
  // A category chip reads « Bureautique & IA », not its URL slug.
  for (const slug of filters.categories) {
    chips.push({
      key: `category:${slug}`,
      label: categories.find((option) => option.value === slug)?.name ?? slug,
      href: catalogHref(filters, {
        categories: filters.categories.filter((entry) => entry !== slug),
      }),
    });
  }

  for (const level of filters.levels) {
    chips.push({
      key: `level:${level}`,
      label: t(`filters.level.${level}`),
      href: catalogHref(filters, { levels: filters.levels.filter((entry) => entry !== level) }),
    });
  }

  for (const delivery of filters.deliveries) {
    chips.push({
      key: `delivery:${delivery}`,
      label: t(`filters.delivery.${delivery}`),
      href: catalogHref(filters, {
        deliveries: filters.deliveries.filter((entry) => entry !== delivery),
      }),
    });
  }

  // Language and options are rail filters too; without a chip, applying one
  // left no visible trace above the results and no one-tap way back.
  for (const language of filters.languages) {
    chips.push({
      key: `language:${language}`,
      label: t(`filters.language.${language}`),
      href: catalogHref(filters, {
        languages: filters.languages.filter((entry) => entry !== language),
      }),
    });
  }

  for (const feature of filters.features) {
    chips.push({
      key: `feature:${feature}`,
      label: t(`filters.features.${feature}`),
      href: catalogHref(filters, {
        features: filters.features.filter((entry) => entry !== feature),
      }),
    });
  }

  if (filters.price !== null) {
    chips.push({
      key: 'price',
      label: t(`filters.price.${filters.price}`),
      href: catalogHref(filters, { price: null }),
    });
  }

  if (filters.duration !== null) {
    chips.push({
      key: 'duration',
      label: t(`filters.duration.${filters.duration}`),
      href: catalogHref(filters, { duration: null }),
    });
  }

  if (filters.rating !== null) {
    chips.push({
      key: 'rating',
      label: t('filters.rating.chip', { rating: filters.rating }),
      href: catalogHref(filters, { rating: null }),
    });
  }

  // 'filters.remove' is an ICU message requiring {label}. Calling it without one
  // makes next-intl fail and render the key path as visible text — which is
  // exactly what the E2E suite caught on the filtered catalogue. Deriving it
  // here, from the label each chip already has, cannot miss a chip type.
  return chips.map((chip) => ({ ...chip, removeLabel: t('filters.remove', { label: chip.label }) }));
}

/**
 * Real `?page=` links, not buttons. §12.3 requires the fallback to work for a
 * crawler and for the back button, which rules out a click handler.
 *
 * Locale-aware `Link`s: a bare `/formations?page=2` sent an Arabic reader
 * through a redirect and, without the locale cookie, into French.
 */
const PAGE_LINK =
  'inline-flex h-11 items-center gap-1.5 rounded-pill border border-hairline bg-surface px-4 text-sm text-ink transition-colors duration-[120ms] hover:border-strait hover:bg-raised sm:px-5';

function Pagination({
  page,
  pageCount,
  filters,
  previousLabel,
  nextLabel,
  label,
  summary,
}: {
  page: number;
  pageCount: number;
  filters: CatalogFilters;
  previousLabel: string;
  nextLabel: string;
  label: string;
  summary: string;
}): React.JSX.Element | null {
  if (pageCount <= 1) return null;

  return (
    <nav
      aria-label={label}
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-hairline pt-6"
    >
      <span className="justify-self-start">
        {page > 1 ? (
          <Link href={catalogHref(filters, { page: page - 1 })} rel="prev" className={PAGE_LINK}>
            <ChevronLeft className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
            <span className="max-sm:sr-only">{previousLabel}</span>
          </Link>
        ) : null}
      </span>

      <p className="text-sm text-ink-muted">
        <span data-numeric>{summary}</span>
      </p>

      <span className="justify-self-end">
        {page < pageCount ? (
          <Link href={catalogHref(filters, { page: page + 1 })} rel="next" className={PAGE_LINK}>
            <span className="max-sm:sr-only">{nextLabel}</span>
            <ChevronRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
