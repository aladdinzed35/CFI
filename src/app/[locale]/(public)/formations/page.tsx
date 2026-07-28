import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CatalogControls } from '@/components/public/catalog/catalog-controls';
import { CatalogSearch } from '@/components/public/catalog/catalog-search';
import { FilterGroups, FilterRail } from '@/components/public/catalog/filter-rail';
import { FilterSheet, FilterSheetProvider } from '@/components/public/catalog/filter-sheet';
import { ResultsGrid } from '@/components/public/catalog/results-grid';
import { getCatalog } from '@/server/services/catalog/queries';
import {
  CATALOG_SORTS,
  activeFilterCount,
  catalogHref,
  parseCatalogFilters,
  type CatalogFilters,
} from '@/server/services/catalog/filters';
import { buildMetadata } from '@/lib/seo';
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
  const [result, t] = await Promise.all([
    getCatalog(filters, locale),
    getTranslations({ locale, namespace: 'catalog' }),
  ]);

  const activeCount = activeFilterCount(filters);

  // Each chip's href is the CURRENT url minus that one filter, so removing a
  // filter is a plain link — it works with JavaScript disabled and the browser
  // gets a real history entry.
  const chips = buildChips(filters, t);

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
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-3 pb-8">
        <h1 className="text-title text-balance">{t('title')}</h1>
        <p className="max-w-2xl text-lead text-pretty text-ink-muted">{t('subtitle')}</p>
      </header>

      <FilterSheetProvider>
      <div className="grid gap-8 lg:grid-cols-[17rem_1fr] lg:items-start">
        <FilterRail
          filters={filters}
          facets={result.facets}
          locale={locale}
          idPrefix="rail"
          className="hidden lg:block"
        />

        <div className="flex flex-col gap-6">
          <CatalogSearch filters={filters} />

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
              viewGrid: t('view.grille'),
              viewList: t('view.liste'),
              openFilters: t('filters.open'),
              clearAll: t('filters.clearAll'),
              removeFilter: t('filters.remove'),
              activeChips: chips,
            }}
          />

          <ResultsGrid
            courses={result.courses}
            view={filters.view}
            locale={locale}
            isFirstPage={result.page === 1}
          />

          <Pagination
            page={result.page}
            pageCount={result.pageCount}
            filters={filters}
            previousLabel={t('pagination.previous')}
            nextLabel={t('pagination.next')}
            label={t('pagination.label')}
          />
        </div>
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

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </div>
  );
}

// Must match CATALOG_SORTS exactly — these values go into the URL.
const SORT_VALUES = CATALOG_SORTS;

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/** One removable chip per applied filter. The href is "this URL, without that". */
function buildChips(
  filters: CatalogFilters,
  t: Translator,
): ReadonlyArray<{ key: string; label: string; href: string }> {
  const chips: Array<{ key: string; label: string; href: string }> = [];

  // The search term's own chip lives under the field, in `CatalogSearch`.
  for (const slug of filters.categories) {
    chips.push({
      key: `category:${slug}`,
      label: slug,
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

  return chips;
}

/**
 * Real `?page=` links, not buttons. §12.3 requires the fallback to work for a
 * crawler and for the back button, which rules out a click handler.
 */
function Pagination({
  page,
  pageCount,
  filters,
  previousLabel,
  nextLabel,
  label,
}: {
  page: number;
  pageCount: number;
  filters: CatalogFilters;
  previousLabel: string;
  nextLabel: string;
  label: string;
}): React.JSX.Element | null {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label={label} className="flex items-center justify-between gap-4 pt-2">
      {page > 1 ? (
        <a
          href={catalogHref(filters, { page: page - 1 })}
          rel="prev"
          className="inline-flex h-11 items-center rounded-pill border border-hairline bg-surface px-5 text-sm text-ink hover:bg-raised"
        >
          {previousLabel}
        </a>
      ) : (
        <span />
      )}

      <p className="text-sm text-ink-muted">
        <span data-numeric>
          {page} / {pageCount}
        </span>
      </p>

      {page < pageCount ? (
        <a
          href={catalogHref(filters, { page: page + 1 })}
          rel="next"
          className="inline-flex h-11 items-center rounded-pill border border-hairline bg-surface px-5 text-sm text-ink hover:bg-raised"
        >
          {nextLabel}
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}
