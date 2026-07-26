import type { CourseLevel, DeliveryMode, Locale as DbLocale, Prisma } from '@prisma/client';

import { db } from '@/server/db';
import { env } from '@/lib/env';
import { locales, type Locale } from '@/i18n/routing';

import {
  CATALOG_DURATION_BANDS,
  CATALOG_FEATURES,
  CATALOG_LEVELS,
  CATALOG_DELIVERIES,
  CATALOG_PAGE_SIZE,
  CATALOG_PRICE_BANDS,
  CATALOG_RATINGS,
  durationBand,
  priceBand,
  type CatalogDelivery,
  type CatalogFeature,
  type CatalogFilters,
  type CatalogLevel,
} from './filters';

/**
 * The catalogue's read model (§12.3).
 *
 * One entry point, {@link getCatalog}, turns a {@link CatalogFilters} into
 * everything the page needs: the page of courses, the total, the facet counts
 * and the category vocabulary. The UI never touches Prisma (§5) and never has
 * to know that "gratuit" means `priceCentimes = 0`.
 *
 * ## Facet counts are what makes the rail honest
 * Every facet is counted against **the other filters but not its own**. That is
 * the only definition that behaves: with « Débutant » selected, the level group
 * must still show how many courses each *other* level holds, or the user can
 * never widen. A count of zero greys the option out — §12.3 says grey out,
 * never hide, because a disappearing checkbox is how a user loses their place.
 *
 * ## Search
 * `@@fulltext` exists on `CourseTranslation`, but Prisma's `search` operator
 * needs the `fullTextSearch` preview flag, which this project does not enable
 * (§4: no preview features in production). Search therefore matches `title` and
 * `subtitle` with `contains` against the active locale *and* French, which the
 * `[courseId, locale]` unique index keeps cheap. `description` is deliberately
 * excluded: a `LIKE '%…%'` over a `TEXT` column is a table scan for a payoff
 * nobody asked for.
 *
 * ## Nothing here is user-specific
 * The catalogue is identical for a guest and for a signed-in student, so no
 * session is read and no `Enrollment` is joined. That keeps the page cacheable
 * and keeps §6's authorisation rule trivially satisfied: there is nothing here
 * that is not already public.
 */

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

export interface CatalogCourse {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly categorySlug: string | null;
  readonly categoryName: string | null;
  /** Absolute cover URL, or `null` when the course has no cover configured. */
  readonly coverUrl: string | null;
  readonly level: CatalogLevel;
  readonly delivery: CatalogDelivery;
  readonly language: Locale;
  readonly durationMinutes: number;
  readonly lessonCount: number;
  readonly priceCentimes: number;
  readonly comparePriceCentimes: number | null;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly enrollmentCount: number;
  readonly isNew: boolean;
  readonly isFeatured: boolean;
  /** `null` when the course has no seat cap. */
  readonly seatsLeft: number | null;
}

export interface FacetOption {
  /** The URL value — feed it straight to `toggleFilter`. */
  readonly value: string;
  /** How many courses this option would return alongside the other filters. */
  readonly count: number;
}

export interface CatalogCategoryOption extends FacetOption {
  readonly name: string;
}

export interface CatalogFacets {
  readonly categories: readonly CatalogCategoryOption[];
  readonly levels: readonly FacetOption[];
  readonly deliveries: readonly FacetOption[];
  readonly languages: readonly FacetOption[];
  readonly features: readonly FacetOption[];
  readonly prices: readonly FacetOption[];
  readonly durations: readonly FacetOption[];
  readonly ratings: readonly FacetOption[];
}

export interface CatalogResult {
  readonly courses: readonly CatalogCourse[];
  /** Courses matching the filters, across all pages. */
  readonly total: number;
  /** Clamped into `[1, pageCount]` — a `?page=99` link lands on the last page. */
  readonly page: number;
  readonly pageCount: number;
  readonly facets: CatalogFacets;
  /**
   * Published courses ignoring every filter. Zero means the catalogue itself is
   * empty, which is a different message from "no match" (§11.5).
   */
  readonly catalogueSize: number;
}

/* -------------------------------------------------------------------------- */
/* Vocabulary mapping                                                          */
/* -------------------------------------------------------------------------- */

const LEVEL_TO_DB: Record<CatalogLevel, CourseLevel> = {
  debutant: 'DEBUTANT',
  intermediaire: 'INTERMEDIAIRE',
  avance: 'AVANCE',
  'tous-niveaux': 'TOUS_NIVEAUX',
};

const LEVEL_FROM_DB: Record<CourseLevel, CatalogLevel> = {
  DEBUTANT: 'debutant',
  INTERMEDIAIRE: 'intermediaire',
  AVANCE: 'avance',
  TOUS_NIVEAUX: 'tous-niveaux',
};

const DELIVERY_TO_DB: Record<CatalogDelivery, DeliveryMode> = {
  'en-ligne': 'EN_LIGNE',
  presentiel: 'PRESENTIEL',
  hybride: 'HYBRIDE',
};

const DELIVERY_FROM_DB: Record<DeliveryMode, CatalogDelivery> = {
  EN_LIGNE: 'en-ligne',
  PRESENTIEL: 'presentiel',
  HYBRIDE: 'hybride',
};

const LOCALE_TO_DB: Record<Locale, DbLocale> = { fr: 'fr', ar: 'ar', en: 'en', es: 'es' };

function localeFromDb(value: DbLocale): Locale {
  return (locales as readonly string[]).includes(value) ? (value as Locale) : 'fr';
}

/* -------------------------------------------------------------------------- */
/* Where clauses                                                               */
/* -------------------------------------------------------------------------- */

/** A course the public may see: published, not soft-deleted, past its embargo. */
function visibleCourses(now: Date): Prisma.CourseWhereInput {
  return {
    deletedAt: null,
    status: 'PUBLISHED',
    OR: [{ publishedAt: null }, { publishedAt: { lte: now } }],
  };
}

const FEATURE_CLAUSES: Record<CatalogFeature, Prisma.CourseWhereInput> = {
  certificat: { certificateEnabled: true },
  tranches: { installmentsAllowed: true },
  direct: { liveSessions: { some: { isCancelled: false } } },
  essai: {
    modules: {
      some: {
        isPublished: true,
        lessons: { some: { isPreview: true, isPublished: true, deletedAt: null } },
      },
    },
  },
};

function queryClause(query: string, locale: Locale): Prisma.CourseWhereInput {
  const wanted: DbLocale[] = locale === 'fr' ? ['fr'] : [LOCALE_TO_DB[locale], 'fr'];
  return {
    translations: {
      some: {
        locale: { in: wanted },
        OR: [{ title: { contains: query } }, { subtitle: { contains: query } }],
      },
    },
  };
}

function priceClause(id: string | null): Prisma.CourseWhereInput | null {
  const band = priceBand(id);
  if (band === null) return null;
  if (band.maxMad === 0) return { priceCentimes: 0 };
  const gte = band.minMad * 100;
  return band.maxMad === null
    ? { priceCentimes: { gte } }
    : { priceCentimes: { gte, lte: band.maxMad * 100 } };
}

function durationClause(id: string | null): Prisma.CourseWhereInput | null {
  const band = durationBand(id);
  if (band === null) return null;
  const gte = band.minHours * 60;
  return band.maxHours === null
    ? { durationMinutes: { gte } }
    : { durationMinutes: { gte, lte: band.maxHours * 60 } };
}

/** The dimensions a facet count may exclude — its own. */
type ExcludedDimension =
  | 'categories'
  | 'levels'
  | 'deliveries'
  | 'languages'
  | 'features'
  | 'price'
  | 'duration'
  | 'rating'
  | null;

/**
 * The `where` for a given request, optionally with one dimension lifted out so
 * that dimension's own facet counts describe what *widening* would give.
 */
function buildWhere(
  filters: CatalogFilters,
  locale: Locale,
  now: Date,
  except: ExcludedDimension = null,
): Prisma.CourseWhereInput {
  const and: Prisma.CourseWhereInput[] = [visibleCourses(now)];

  if (filters.query !== null) and.push(queryClause(filters.query, locale));

  if (except !== 'categories' && filters.categories.length > 0) {
    and.push({ category: { slug: { in: [...filters.categories] } } });
  }

  if (except !== 'levels' && filters.levels.length > 0) {
    and.push({ level: { in: filters.levels.map((value) => LEVEL_TO_DB[value]) } });
  }

  if (except !== 'deliveries' && filters.deliveries.length > 0) {
    and.push({ deliveryMode: { in: filters.deliveries.map((value) => DELIVERY_TO_DB[value]) } });
  }

  if (except !== 'languages' && filters.languages.length > 0) {
    and.push({ contentLocale: { in: filters.languages.map((value) => LOCALE_TO_DB[value]) } });
  }

  if (except !== 'features') {
    // Features are additive: « avec certificat » *and* « paiement en tranches ».
    for (const feature of filters.features) and.push(FEATURE_CLAUSES[feature]);
  }

  if (except !== 'price') {
    const clause = priceClause(filters.price);
    if (clause !== null) and.push(clause);
  }

  if (except !== 'duration') {
    const clause = durationClause(filters.duration);
    if (clause !== null) and.push(clause);
  }

  if (except !== 'rating' && filters.rating !== null) {
    and.push({ ratingAvg: { gte: filters.rating } });
  }

  return { AND: and };
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `id` is always the last key: without a total order, MySQL is free to return
 * the same course on page 1 and page 2 when the sort key ties.
 */
function buildOrderBy(filters: CatalogFilters): Prisma.CourseOrderByWithRelationInput[] {
  switch (filters.sort) {
    case 'nouveautes':
      return [{ publishedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }];
    case 'prix-asc':
      return [{ priceCentimes: 'asc' }, { id: 'asc' }];
    case 'prix-desc':
      return [{ priceCentimes: 'desc' }, { id: 'asc' }];
    case 'populaire':
      return [{ enrollmentCount: 'desc' }, { ratingCount: 'desc' }, { id: 'asc' }];
    case 'mieux-notees':
      return [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }, { id: 'asc' }];
    case 'pertinence':
      return [
        { isFeatured: 'desc' },
        { enrollmentCount: 'desc' },
        { publishedAt: 'desc' },
        { id: 'asc' },
      ];
  }
}

/* -------------------------------------------------------------------------- */
/* Media                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `coverKey` is an object key in the bucket; the public base URL is optional in
 * `.env` (§3), so a deployment without a CDN yields `null` and the card falls
 * back to its own placeholder rather than to a broken image.
 */
function coverUrl(key: string | null): string | null {
  if (key === null || key.length === 0) return null;
  const base = env.S3_PUBLIC_BASE_URL;
  if (typeof base !== 'string' || base.length === 0) return null;
  return `${base.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

/* -------------------------------------------------------------------------- */
/* Translation picking                                                         */
/* -------------------------------------------------------------------------- */

interface TranslationRow {
  readonly locale: DbLocale;
  readonly title: string;
  readonly subtitle: string | null;
}

/** Active locale first, French as the source-language fallback (§10). */
function pickTranslation(
  rows: readonly TranslationRow[],
  locale: Locale,
): TranslationRow | undefined {
  const wanted = LOCALE_TO_DB[locale];
  return rows.find((row) => row.locale === wanted) ?? rows.find((row) => row.locale === 'fr');
}

/* -------------------------------------------------------------------------- */
/* Facet counting                                                              */
/* -------------------------------------------------------------------------- */

function bucketBy<T>(
  rows: readonly T[],
  bands: readonly { readonly id: string }[],
  matches: (row: T, id: string) => boolean,
): FacetOption[] {
  return bands.map((band) => ({
    value: band.id,
    count: rows.reduce((total, row) => (matches(row, band.id) ? total + 1 : total), 0),
  }));
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a catalogue request. Issues one round of concurrent queries: the page
 * itself, the total, the untouched catalogue size, the category vocabulary, and
 * one aggregate per facet dimension.
 */
export async function getCatalog(
  filters: CatalogFilters,
  locale: Locale,
): Promise<CatalogResult> {
  const now = new Date();
  const where = buildWhere(filters, locale, now);

  // The page number is clamped *after* the total is known, so a `?page=99` link
  // shows the last page instead of an empty grid the crawler would index.
  const total = await db.course.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page), pageCount);

  const [
    rows,
    catalogueSize,
    categoryRows,
    categoryCounts,
    levelCounts,
    deliveryCounts,
    languageCounts,
    featureCounts,
    priceRows,
    durationRows,
    ratingRows,
  ] = await Promise.all([
    db.course.findMany({
      where,
      orderBy: buildOrderBy(filters),
      skip: (page - 1) * CATALOG_PAGE_SIZE,
      take: CATALOG_PAGE_SIZE,
      select: {
        id: true,
        slug: true,
        coverKey: true,
        level: true,
        deliveryMode: true,
        contentLocale: true,
        durationMinutes: true,
        lessonCount: true,
        priceCentimes: true,
        comparePriceCentimes: true,
        ratingAvg: true,
        ratingCount: true,
        enrollmentCount: true,
        isNew: true,
        isFeatured: true,
        maxSeats: true,
        seatsTaken: true,
        category: {
          select: { slug: true, translations: { select: { locale: true, name: true } } },
        },
        translations: { select: { locale: true, title: true, subtitle: true } },
      },
    }),

    db.course.count({ where: visibleCourses(now) }),

    db.category.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { slug: 'asc' }],
      select: { slug: true, translations: { select: { locale: true, name: true } } },
    }),

    db.course.groupBy({
      by: ['categoryId'],
      where: buildWhere(filters, locale, now, 'categories'),
      _count: { _all: true },
    }),

    db.course.groupBy({
      by: ['level'],
      where: buildWhere(filters, locale, now, 'levels'),
      _count: { _all: true },
    }),

    db.course.groupBy({
      by: ['deliveryMode'],
      where: buildWhere(filters, locale, now, 'deliveries'),
      _count: { _all: true },
    }),

    db.course.groupBy({
      by: ['contentLocale'],
      where: buildWhere(filters, locale, now, 'languages'),
      _count: { _all: true },
    }),

    Promise.all(
      CATALOG_FEATURES.map(async (feature) => ({
        value: feature,
        count: await db.course.count({
          where: {
            AND: [buildWhere(filters, locale, now, 'features'), FEATURE_CLAUSES[feature]],
          },
        }),
      })),
    ),

    db.course.findMany({
      where: buildWhere(filters, locale, now, 'price'),
      select: { priceCentimes: true },
    }),

    db.course.findMany({
      where: buildWhere(filters, locale, now, 'duration'),
      select: { durationMinutes: true },
    }),

    db.course.findMany({
      where: buildWhere(filters, locale, now, 'rating'),
      select: { ratingAvg: true },
    }),
  ]);

  /* ---- courses ---------------------------------------------------------- */

  const courses: CatalogCourse[] = rows.map((row) => {
    const translation = pickTranslation(row.translations, locale);
    const categoryTranslation =
      row.category === null ? undefined : pickNamedTranslation(row.category.translations, locale);

    return {
      id: row.id,
      slug: row.slug,
      title: translation?.title ?? row.slug,
      subtitle: translation?.subtitle ?? null,
      categorySlug: row.category?.slug ?? null,
      categoryName: categoryTranslation?.name ?? null,
      coverUrl: coverUrl(row.coverKey),
      level: LEVEL_FROM_DB[row.level],
      delivery: DELIVERY_FROM_DB[row.deliveryMode],
      language: localeFromDb(row.contentLocale),
      durationMinutes: row.durationMinutes,
      lessonCount: row.lessonCount,
      priceCentimes: row.priceCentimes,
      comparePriceCentimes: row.comparePriceCentimes,
      ratingAvg: row.ratingAvg,
      ratingCount: row.ratingCount,
      enrollmentCount: row.enrollmentCount,
      isNew: row.isNew,
      isFeatured: row.isFeatured,
      seatsLeft: row.maxSeats === null ? null : Math.max(0, row.maxSeats - row.seatsTaken),
    };
  });

  /* ---- facets ----------------------------------------------------------- */

  const categoryCountBySlug = new Map<string, number>();

  // `groupBy` returns category *ids*; resolve them all in a single follow-up
  // query rather than issuing one per group.
  const idToSlug = await resolveCategorySlugs(
    categoryCounts.map((entry) => entry.categoryId).filter((id): id is string => id !== null),
  );
  for (const entry of categoryCounts) {
    if (entry.categoryId === null) continue;
    const slug = idToSlug.get(entry.categoryId);
    if (slug === undefined) continue;
    categoryCountBySlug.set(slug, entry._count._all);
  }

  const categories: CatalogCategoryOption[] = categoryRows.map((category) => ({
    value: category.slug,
    name: pickNamedTranslation(category.translations, locale)?.name ?? category.slug,
    count: categoryCountBySlug.get(category.slug) ?? 0,
  }));

  const levelCountByValue = new Map<CatalogLevel, number>();
  for (const entry of levelCounts) {
    levelCountByValue.set(LEVEL_FROM_DB[entry.level], entry._count._all);
  }

  const deliveryCountByValue = new Map<CatalogDelivery, number>();
  for (const entry of deliveryCounts) {
    deliveryCountByValue.set(DELIVERY_FROM_DB[entry.deliveryMode], entry._count._all);
  }

  const languageCountByValue = new Map<Locale, number>();
  for (const entry of languageCounts) {
    languageCountByValue.set(localeFromDb(entry.contentLocale), entry._count._all);
  }

  const facets: CatalogFacets = {
    categories,
    levels: CATALOG_LEVELS.map((value) => ({
      value,
      count: levelCountByValue.get(value) ?? 0,
    })),
    deliveries: CATALOG_DELIVERIES.map((value) => ({
      value,
      count: deliveryCountByValue.get(value) ?? 0,
    })),
    languages: locales.map((value) => ({ value, count: languageCountByValue.get(value) ?? 0 })),
    features: featureCounts,
    prices: bucketBy(priceRows, CATALOG_PRICE_BANDS, (row, id) => {
      const band = priceBand(id);
      if (band === null) return false;
      if (band.maxMad === 0) return row.priceCentimes === 0;
      if (row.priceCentimes < band.minMad * 100) return false;
      return band.maxMad === null || row.priceCentimes <= band.maxMad * 100;
    }),
    durations: bucketBy(durationRows, CATALOG_DURATION_BANDS, (row, id) => {
      const band = durationBand(id);
      if (band === null) return false;
      if (row.durationMinutes < band.minHours * 60) return false;
      return band.maxHours === null || row.durationMinutes <= band.maxHours * 60;
    }),
    ratings: CATALOG_RATINGS.map((threshold) => ({
      value: String(threshold),
      count: ratingRows.reduce(
        (count, row) => (row.ratingAvg >= threshold ? count + 1 : count),
        0,
      ),
    })),
  };

  return { courses, total, page, pageCount, facets, catalogueSize };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

interface NamedTranslationRow {
  readonly locale: DbLocale;
  readonly name: string;
}

function pickNamedTranslation(
  rows: readonly NamedTranslationRow[],
  locale: Locale,
): NamedTranslationRow | undefined {
  const wanted = LOCALE_TO_DB[locale];
  return rows.find((row) => row.locale === wanted) ?? rows.find((row) => row.locale === 'fr');
}

/** `id → slug` for the ids a `groupBy` returned. One query, never in a loop. */
async function resolveCategorySlugs(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.category.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, slug: true },
  });
  return new Map(rows.map((row) => [row.id, row.slug]));
}
