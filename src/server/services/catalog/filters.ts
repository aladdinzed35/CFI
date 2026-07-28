import { z } from 'zod';

import { locales, type Locale } from '@/i18n/routing';

/**
 * The catalogue's URL contract (§12.3).
 *
 * ## Why this module has no dependency on Prisma, React or next-intl
 * Three different runtimes have to agree on what `?niveau=debutant&prix=0-1000`
 * means: the Server Component that reads the database, the links the filter rail
 * renders, and the crawler that walks `?page=2`. If any of them held its own
 * idea of the query string, a shared link would resolve to different results
 * than the page that produced it. So the grammar lives here, once, as pure
 * functions over plain data — importable from a Server Component, a Client
 * Component or a test, with nothing server-only in the module graph.
 *
 * ## The URL *is* the state
 * There is no client-side filter state anywhere in the catalogue. Toggling a
 * facet is a navigation to the URL that {@link toggleFilter} +
 * {@link serializeFilters} produce, which is what makes the catalogue
 * shareable, back-button-safe and indexable. `page` is deliberately dropped by
 * every filter mutation: page 7 of one filter set is meaningless in another.
 *
 * ## Nothing here throws, ever
 * A public URL is attacker-controlled and link-rot-prone. Every value is
 * validated against a closed list and anything unrecognised degrades to
 * "unset" rather than to a 404 — `?niveau=hunter2` shows the whole catalogue,
 * it does not break the page. Unknown parameters (`utm_source`, `fbclid`) are
 * ignored and dropped from any URL we regenerate.
 */

/* -------------------------------------------------------------------------- */
/* Parameter names                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The query-string keys, in French because French is the source language (§10)
 * and these appear in shared links. Read them from here — never inline the
 * literal, or the day one changes only half the app follows.
 */
export const CATALOG_PARAM = {
  query: 'q',
  category: 'categorie',
  level: 'niveau',
  delivery: 'format',
  language: 'langue',
  feature: 'options',
  price: 'prix',
  duration: 'duree',
  rating: 'note',
  sort: 'tri',
  view: 'vue',
  page: 'page',
} as const;

/** Route the catalogue lives at, locale-relative (`@/i18n/navigation` adds the prefix). */
export const CATALOG_PATH = '/formations';

/** Courses per page. Divisible by 2, 3 and 4 so no grid breakpoint ends ragged. */
export const CATALOG_PAGE_SIZE = 12;

/* -------------------------------------------------------------------------- */
/* Value vocabularies                                                          */
/* -------------------------------------------------------------------------- */

export const CATALOG_LEVELS = ['debutant', 'intermediaire', 'avance', 'tous-niveaux'] as const;
export type CatalogLevel = (typeof CATALOG_LEVELS)[number];

export const CATALOG_DELIVERIES = ['en-ligne', 'presentiel', 'hybride'] as const;
export type CatalogDelivery = (typeof CATALOG_DELIVERIES)[number];

export type CatalogLanguage = Locale;

export const CATALOG_FEATURES = ['certificat', 'tranches', 'direct', 'essai'] as const;
export type CatalogFeature = (typeof CATALOG_FEATURES)[number];

export const CATALOG_SORTS = [
  'pertinence',
  'nouveautes',
  'prix-asc',
  'prix-desc',
  'populaire',
  'mieux-notees',
] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export const CATALOG_VIEWS = ['grille', 'liste'] as const;
export type CatalogView = (typeof CATALOG_VIEWS)[number];

export const DEFAULT_SORT: CatalogSort = 'pertinence';
export const DEFAULT_VIEW: CatalogView = 'grille';

/**
 * Price bands, in whole dirhams, ordered. `max: null` means "and above".
 * The ids are the URL values, so they are human-readable in a shared link.
 */
export const CATALOG_PRICE_BANDS = [
  { id: 'gratuit', minMad: 0, maxMad: 0 },
  { id: '0-1000', minMad: 0, maxMad: 1000 },
  { id: '1000-3000', minMad: 1000, maxMad: 3000 },
  { id: '3000-6000', minMad: 3000, maxMad: 6000 },
  { id: '6000+', minMad: 6000, maxMad: null },
] as const;

export type CatalogPriceBandId = (typeof CATALOG_PRICE_BANDS)[number]['id'];

export interface CatalogPriceBand {
  readonly id: string;
  readonly minMad: number;
  readonly maxMad: number | null;
}

/** Duration bands, in whole hours, ordered. `max: null` means "and above". */
export const CATALOG_DURATION_BANDS = [
  { id: '0-2', minHours: 0, maxHours: 2 },
  { id: '2-6', minHours: 2, maxHours: 6 },
  { id: '6-20', minHours: 6, maxHours: 20 },
  { id: '20+', minHours: 20, maxHours: null },
] as const;

export type CatalogDurationBandId = (typeof CATALOG_DURATION_BANDS)[number]['id'];

export interface CatalogDurationBand {
  readonly id: string;
  readonly minHours: number;
  readonly maxHours: number | null;
}

/** Minimum-rating thresholds, ordered from the most permissive. */
export const CATALOG_RATINGS = [3, 4, 4.5] as const;
export type CatalogRating = (typeof CATALOG_RATINGS)[number];

/** The longest a search term may be before we stop taking it seriously. */
const MAX_QUERY_LENGTH = 120;
/** Guard rail: a crawler following a broken link must not ask for page 90 000. */
const MAX_PAGE = 500;

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A fully resolved catalogue request. Every field is normalised: arrays are
 * de-duplicated and ordered like their vocabulary, so two URLs that mean the
 * same thing serialise identically and hit the same cache entry.
 */
export interface CatalogFilters {
  readonly query: string | null;
  /** Category slugs. Validated for shape here, for existence by the query. */
  readonly categories: readonly string[];
  readonly levels: readonly CatalogLevel[];
  readonly deliveries: readonly CatalogDelivery[];
  readonly languages: readonly CatalogLanguage[];
  readonly features: readonly CatalogFeature[];
  readonly price: CatalogPriceBandId | null;
  readonly duration: CatalogDurationBandId | null;
  readonly rating: CatalogRating | null;
  readonly sort: CatalogSort;
  readonly view: CatalogView;
  /** 1-based, clamped into `[1, MAX_PAGE]`. */
  readonly page: number;
}

/** The multi-valued dimensions — the ones {@link toggleFilter} adds to or removes from. */
export type CatalogMultiDimension = 'categories' | 'levels' | 'deliveries' | 'languages' | 'features';

/** The single-valued dimensions — toggling re-selects, or clears when already selected. */
export type CatalogSingleDimension = 'price' | 'duration' | 'rating';

export type CatalogDimension = CatalogMultiDimension | CatalogSingleDimension;

/** Every dimension a chip can be built from, plus the free-text query. */
export const CATALOG_DIMENSIONS: readonly CatalogDimension[] = [
  'categories',
  'levels',
  'deliveries',
  'languages',
  'features',
  'price',
  'duration',
  'rating',
];

export const EMPTY_FILTERS: CatalogFilters = {
  query: null,
  categories: [],
  levels: [],
  deliveries: [],
  languages: [],
  features: [],
  price: null,
  duration: null,
  rating: null,
  sort: DEFAULT_SORT,
  view: DEFAULT_VIEW,
  page: 1,
};

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/** What Next hands a page as `searchParams`. */
export type RawSearchParams = Readonly<Record<string, string | string[] | undefined>>;

function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => entry.split(','));
  return value.split(',');
}

function asSingle(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return value;
  return value[0];
}

/**
 * A slug we are willing to send to the database. Not a claim that the category
 * exists — only that the string cannot be anything but a slug, so a hostile
 * value never reaches a query as a wildcard or an operator.
 */
const categorySlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * The picked, known parameters. `.strict()` (§6) applies to *this* object — the
 * one we build ourselves from the keys we recognise — rather than to the raw
 * query string, because rejecting a URL for carrying `utm_source` would break
 * every campaign link pointing at the catalogue.
 */
const catalogParamsSchema = z
  .object({
    query: z.string().trim().min(1).max(MAX_QUERY_LENGTH).optional(),
    categories: z.array(categorySlugSchema).optional(),
    levels: z.array(z.enum(CATALOG_LEVELS)).optional(),
    deliveries: z.array(z.enum(CATALOG_DELIVERIES)).optional(),
    languages: z.array(z.enum(locales)).optional(),
    features: z.array(z.enum(CATALOG_FEATURES)).optional(),
    price: z.enum(['gratuit', '0-1000', '1000-3000', '3000-6000', '6000+']).optional(),
    duration: z.enum(['0-2', '2-6', '6-20', '20+']).optional(),
    rating: z.union([z.literal(3), z.literal(4), z.literal(4.5)]).optional(),
    sort: z.enum(CATALOG_SORTS).optional(),
    view: z.enum(CATALOG_VIEWS).optional(),
    page: z.number().int().min(1).max(MAX_PAGE).optional(),
  })
  .strict();

/** Keeps vocabulary order and drops duplicates, so `?x=b&x=a` === `?x=a&x=b`. */
function orderedUnique<T extends string>(values: readonly T[], vocabulary: readonly T[]): T[] {
  const chosen = new Set(values);
  return vocabulary.filter((entry) => chosen.has(entry));
}

/** Category slugs have no fixed vocabulary — de-duplicate, then sort for stability. */
function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'fr'));
}

function parseRating(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePage(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Read a URL into a {@link CatalogFilters}. Never throws and never rejects:
 * a field that fails validation is simply not applied.
 *
 * Fields are validated one at a time rather than as one all-or-nothing object
 * so that a single stale value in a two-year-old shared link does not silently
 * discard the six filters beside it.
 */
export function parseCatalogFilters(params: RawSearchParams): CatalogFilters {
  const raw = {
    query: asSingle(params[CATALOG_PARAM.query]),
    categories: asList(params[CATALOG_PARAM.category]),
    levels: asList(params[CATALOG_PARAM.level]),
    deliveries: asList(params[CATALOG_PARAM.delivery]),
    languages: asList(params[CATALOG_PARAM.language]),
    features: asList(params[CATALOG_PARAM.feature]),
    price: asSingle(params[CATALOG_PARAM.price]),
    duration: asSingle(params[CATALOG_PARAM.duration]),
    rating: parseRating(asSingle(params[CATALOG_PARAM.rating])),
    sort: asSingle(params[CATALOG_PARAM.sort]),
    view: asSingle(params[CATALOG_PARAM.view]),
    page: parsePage(asSingle(params[CATALOG_PARAM.page])),
  };

  const shape = catalogParamsSchema.shape;

  const query = shape.query.safeParse(raw.query);
  const price = shape.price.safeParse(raw.price);
  const duration = shape.duration.safeParse(raw.duration);
  const rating = shape.rating.safeParse(raw.rating);
  const sort = shape.sort.safeParse(raw.sort);
  const view = shape.view.safeParse(raw.view);
  const page = shape.page.safeParse(raw.page);

  return {
    query: query.success && query.data !== undefined ? query.data : null,
    categories: sortedUnique(
      raw.categories.filter((value) => categorySlugSchema.safeParse(value).success),
    ),
    levels: orderedUnique(
      raw.levels.filter((value): value is CatalogLevel =>
        (CATALOG_LEVELS as readonly string[]).includes(value),
      ),
      CATALOG_LEVELS,
    ),
    deliveries: orderedUnique(
      raw.deliveries.filter((value): value is CatalogDelivery =>
        (CATALOG_DELIVERIES as readonly string[]).includes(value),
      ),
      CATALOG_DELIVERIES,
    ),
    languages: orderedUnique(
      raw.languages.filter((value): value is CatalogLanguage =>
        (locales as readonly string[]).includes(value),
      ),
      locales,
    ),
    features: orderedUnique(
      raw.features.filter((value): value is CatalogFeature =>
        (CATALOG_FEATURES as readonly string[]).includes(value),
      ),
      CATALOG_FEATURES,
    ),
    price: price.success && price.data !== undefined ? price.data : null,
    duration: duration.success && duration.data !== undefined ? duration.data : null,
    rating: rating.success && rating.data !== undefined ? rating.data : null,
    sort: sort.success && sort.data !== undefined ? sort.data : DEFAULT_SORT,
    view: view.success && view.data !== undefined ? view.data : DEFAULT_VIEW,
    page: page.success && page.data !== undefined ? page.data : 1,
  };
}

/* -------------------------------------------------------------------------- */
/* Serialisation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Turn filters back into a locale-relative href for `@/i18n/navigation`'s
 * `Link`, e.g. `/formations?niveau=debutant&tri=populaire`.
 *
 * Defaults are omitted: the canonical catalogue URL is `/formations` with no
 * query string at all, which keeps the crawler from indexing four spellings of
 * the same page. Parameters are emitted in a fixed order for the same reason.
 */
export function serializeFilters(filters: CatalogFilters): string {
  const search = new URLSearchParams();

  if (filters.query !== null) search.set(CATALOG_PARAM.query, filters.query);
  for (const slug of filters.categories) search.append(CATALOG_PARAM.category, slug);
  for (const level of filters.levels) search.append(CATALOG_PARAM.level, level);
  for (const delivery of filters.deliveries) search.append(CATALOG_PARAM.delivery, delivery);
  for (const language of filters.languages) search.append(CATALOG_PARAM.language, language);
  for (const feature of filters.features) search.append(CATALOG_PARAM.feature, feature);
  if (filters.price !== null) search.set(CATALOG_PARAM.price, filters.price);
  if (filters.duration !== null) search.set(CATALOG_PARAM.duration, filters.duration);
  if (filters.rating !== null) search.set(CATALOG_PARAM.rating, String(filters.rating));
  if (filters.sort !== DEFAULT_SORT) search.set(CATALOG_PARAM.sort, filters.sort);
  if (filters.view !== DEFAULT_VIEW) search.set(CATALOG_PARAM.view, filters.view);
  if (filters.page > 1) search.set(CATALOG_PARAM.page, String(filters.page));

  const encoded = search.toString();
  return encoded.length === 0 ? CATALOG_PATH : `${CATALOG_PATH}?${encoded}`;
}

/** `serializeFilters` with a patch applied. Any filter change resets `page`. */
export function catalogHref(filters: CatalogFilters, patch: Partial<CatalogFilters> = {}): string {
  const resetsPage = Object.keys(patch).some((key) => key !== 'page');
  return serializeFilters({ ...filters, ...(resetsPage ? { page: 1 } : {}), ...patch });
}

/* -------------------------------------------------------------------------- */
/* Mutation                                                                    */
/* -------------------------------------------------------------------------- */

/** Add or remove one member of a closed vocabulary, keeping vocabulary order. */
function toggleMember<T extends string>(
  current: readonly T[],
  vocabulary: readonly T[],
  value: string,
): readonly T[] {
  const member = vocabulary.find((entry) => entry === value);
  if (member === undefined) return current;
  const next = current.includes(member)
    ? current.filter((entry) => entry !== member)
    : [...current, member];
  return orderedUnique(next, vocabulary);
}

/**
 * Add a value to a dimension, or remove it when it is already selected —
 * the single operation behind every checkbox in the rail and every « × » on a
 * chip, so a chip and its checkbox can never disagree about what removal means.
 *
 * Multi-valued dimensions accumulate. Single-valued ones (price, duration,
 * rating) replace, and re-selecting the current value clears it, which is how
 * a user unsets a radio group without a dedicated « toutes » control.
 *
 * `page` always returns to 1: the results below are about to be different.
 */
export function toggleFilter(
  filters: CatalogFilters,
  dimension: CatalogDimension,
  value: string,
): CatalogFilters {
  if (dimension === 'categories') {
    const next = filters.categories.includes(value)
      ? filters.categories.filter((entry) => entry !== value)
      : [...filters.categories, value];
    return { ...filters, categories: sortedUnique(next), page: 1 };
  }

  if (dimension === 'levels') {
    return { ...filters, levels: toggleMember(filters.levels, CATALOG_LEVELS, value), page: 1 };
  }

  if (dimension === 'deliveries') {
    return {
      ...filters,
      deliveries: toggleMember(filters.deliveries, CATALOG_DELIVERIES, value),
      page: 1,
    };
  }

  if (dimension === 'languages') {
    return { ...filters, languages: toggleMember(filters.languages, locales, value), page: 1 };
  }

  if (dimension === 'features') {
    return {
      ...filters,
      features: toggleMember(filters.features, CATALOG_FEATURES, value),
      page: 1,
    };
  }

  if (dimension === 'rating') {
    const parsed = Number.parseFloat(value);
    const known = CATALOG_RATINGS.find((entry) => entry === parsed);
    if (known === undefined) return filters;
    return { ...filters, rating: filters.rating === known ? null : known, page: 1 };
  }

  if (dimension === 'price') {
    const known = CATALOG_PRICE_BANDS.find((band) => band.id === value);
    if (known === undefined) return filters;
    return { ...filters, price: filters.price === known.id ? null : known.id, page: 1 };
  }

  const known = CATALOG_DURATION_BANDS.find((band) => band.id === value);
  if (known === undefined) return filters;
  return { ...filters, duration: filters.duration === known.id ? null : known.id, page: 1 };
}

/** True when `value` is currently selected in `dimension`. */
export function isFilterActive(
  filters: CatalogFilters,
  dimension: CatalogDimension,
  value: string,
): boolean {
  switch (dimension) {
    case 'categories':
      return filters.categories.includes(value);
    case 'levels':
      return (filters.levels as readonly string[]).includes(value);
    case 'deliveries':
      return (filters.deliveries as readonly string[]).includes(value);
    case 'languages':
      return (filters.languages as readonly string[]).includes(value);
    case 'features':
      return (filters.features as readonly string[]).includes(value);
    case 'price':
      return filters.price === value;
    case 'duration':
      return filters.duration === value;
    case 'rating':
      return filters.rating !== null && String(filters.rating) === value;
  }
}

/**
 * Drop every facet and the search term, keeping the two preferences that are
 * about *looking* rather than about *narrowing*: sort order and grid/list.
 * « Tout effacer » should not also throw away the reader's chosen layout.
 */
export function clearFilters(filters: CatalogFilters): CatalogFilters {
  return { ...EMPTY_FILTERS, sort: filters.sort, view: filters.view };
}

/**
 * How many filters are applied — the number on the mobile sheet's badge.
 * The search term counts: it narrows the results exactly like a facet does.
 */
export function activeFilterCount(filters: CatalogFilters): number {
  return (
    (filters.query === null ? 0 : 1) +
    filters.categories.length +
    filters.levels.length +
    filters.deliveries.length +
    filters.languages.length +
    filters.features.length +
    (filters.price === null ? 0 : 1) +
    (filters.duration === null ? 0 : 1) +
    (filters.rating === null ? 0 : 1)
  );
}

export function hasActiveFilters(filters: CatalogFilters): boolean {
  return activeFilterCount(filters) > 0;
}

/* -------------------------------------------------------------------------- */
/* Band lookup                                                                 */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Message keys                                                                */
/* -------------------------------------------------------------------------- */

/**
 * URL value → message key, for the two vocabularies whose URL spelling is
 * kebab-case and whose message key is camelCase. Kept here so the rail, the
 * chips and the cards cannot drift into three different mappings.
 */
/**
 * Identity, deliberately. The message keys under `catalog.filters.level` are
 * keyed by the URL vocabulary itself, so no translation layer is needed — and a
 * mapping table here is exactly what silently broke when the keys were renamed:
 * it kept resolving to names the catalogue no longer used, and the labels
 * rendered as raw keys while every static check passed.
 */
export const LEVEL_MESSAGE_KEY: Record<CatalogLevel, string> = {
  debutant: 'debutant',
  intermediaire: 'intermediaire',
  avance: 'avance',
  'tous-niveaux': 'tous-niveaux',
};

/** Identity — see {@link LEVEL_MESSAGE_KEY}. */
export const DELIVERY_MESSAGE_KEY: Record<CatalogDelivery, string> = {
  'en-ligne': 'en-ligne',
  presentiel: 'presentiel',
  hybride: 'hybride',
};

/* -------------------------------------------------------------------------- */
/* Band lookup                                                                 */
/* -------------------------------------------------------------------------- */

export function priceBand(id: string | null): CatalogPriceBand | null {
  if (id === null) return null;
  return CATALOG_PRICE_BANDS.find((band) => band.id === id) ?? null;
}

export function durationBand(id: string | null): CatalogDurationBand | null {
  if (id === null) return null;
  return CATALOG_DURATION_BANDS.find((band) => band.id === id) ?? null;
}
