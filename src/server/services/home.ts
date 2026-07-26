import type { Prisma } from '@prisma/client';

import { db } from '@/server/db';
import { env } from '@/lib/env';
import { formatPhoneDisplay, parsePhone } from '@/lib/phone';
import type { Locale } from '@/i18n/routing';
import { translationLocales } from './catalog/locales';

/**
 * The homepage read model (§12.2).
 *
 * `src/app/**` and `src/components/**` may not import `@/server/db` (§5,
 * enforced by `eslint.config.mjs`), so every figure the shop window shows —
 * the Lattice tiles, the bento, the paths, the testimonials, the instructors,
 * the FAQ, the price band and the centre block — is resolved here, once, and
 * handed to the sections as plain data.
 *
 * ## Nothing here throws, and nothing here invents
 *
 * A public page must render even if MySQL blinks: a failed read degrades to an
 * empty homepage payload, and each section decides between an honest empty
 * state and simply not rendering. More importantly, §12.2 forbids inventing a
 * proof — so `stats` is a *candidate list*: a figure only survives when it is
 * backed by enough rows to mean something (`MIN_*` below). The hero renders the
 * first three survivors, so a fresh installation shows « Formations » and
 * « Domaines » rather than a fabricated success rate.
 *
 * ## One round trip per concern, all in parallel
 *
 * Ten indexed reads issued together. Every `where` clause matches an existing
 * index on the model (`Course @@index([status, isFeatured, publishedAt])`,
 * `FaqItem @@index([isPublished, category, order])`, and so on), and the result
 * is memoised per locale for a minute — the same trade-off, and the same
 * duration, as `public-chrome.ts`. An edit in the admin lands within the minute.
 *
 * ## Translations
 *
 * Content tables come in two shapes in this schema: relational translations
 * (`CourseTranslation`, `PathTranslation`, `CategoryTranslation`) and
 * denormalised per-locale columns (`FaqItem.questionFr…`, `Testimonial.quoteFr…`).
 * Both resolve the same way — active locale first, French as the fallback,
 * because French is the source language (§10.2) — and a row with no usable text
 * in either is dropped rather than rendered blank.
 */

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

export type HomeStatId =
  | 'learners'
  | 'courses'
  | 'successRate'
  | 'graduates'
  | 'instructors'
  | 'categories';

export interface HomeStat {
  readonly id: HomeStatId;
  /** A count, or a percentage when `kind` is `percent`. */
  readonly value: number;
  readonly kind: 'count' | 'percent';
}

export interface HomeImage {
  readonly url: string;
  readonly alt: string;
}

export interface HomeCategory {
  readonly slug: string;
  readonly name: string;
  readonly courseCount: number;
}

export interface HomeCourse {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly categoryName: string | null;
  readonly level: 'DEBUTANT' | 'INTERMEDIAIRE' | 'AVANCE' | 'TOUS_NIVEAUX';
  readonly durationMinutes: number;
  readonly lessonCount: number;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly enrollmentCount: number;
  readonly priceCentimes: number;
  readonly comparePriceCentimes: number | null;
  readonly isNew: boolean;
  /** `null` when no cover has been uploaded — the card draws the lattice motif. */
  readonly coverUrl: string | null;
}

export interface HomeLatticeTile {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  /** 0…1, popularity relative to the most enrolled published course. */
  readonly intensity: number;
}

export interface HomePathStep {
  readonly slug: string;
  readonly title: string;
}

export interface HomePath {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly HomePathStep[];
  readonly durationMinutes: number;
  /** Bundle price. `null` when the path is simply the sum of its courses. */
  readonly priceCentimes: number | null;
  /** Sum of the member courses' prices — the reference for the saving. */
  readonly sumCentimes: number;
}

export interface HomeTestimonial {
  readonly id: string;
  readonly authorName: string;
  readonly authorRole: string | null;
  readonly avatarUrl: string | null;
  readonly rating: number;
  readonly quote: string;
}

export interface HomeInstructor {
  readonly id: string;
  readonly fullName: string;
  readonly headline: string | null;
  readonly avatarUrl: string | null;
  readonly courseCount: number;
  /** The domain they teach most in — a real category name, never a guess. */
  readonly specialty: string | null;
}

export interface HomeFaq {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}

export interface HomePricing {
  /** Cheapest and dearest *paid* published course, in centimes. */
  readonly cfiMinCentimes: number | null;
  readonly cfiMaxCentimes: number | null;
  /**
   * Observed market range for an equivalent in-person course, in centimes.
   * `null` unless an administrator has entered it (§12.2: honest, labelled
   * ranges, editable from the admin — never a number this code made up).
   */
  readonly marketMinCentimes: number | null;
  readonly marketMaxCentimes: number | null;
  readonly installmentsAvailable: boolean;
}

export interface HomeCentre {
  readonly address: string | null;
  readonly hours: string | null;
  readonly phoneE164: string | null;
  readonly phoneDisplay: string | null;
  readonly whatsappNumber: string | null;
  readonly gallery: readonly HomeImage[];
}

export interface HomeData {
  readonly stats: readonly HomeStat[];
  readonly lattice: readonly HomeLatticeTile[];
  readonly categories: readonly HomeCategory[];
  readonly featured: readonly HomeCourse[];
  readonly paths: readonly HomePath[];
  readonly testimonials: readonly HomeTestimonial[];
  readonly instructors: readonly HomeInstructor[];
  readonly faq: readonly HomeFaq[];
  readonly pricing: HomePricing;
  readonly centre: HomeCentre;
}

/* -------------------------------------------------------------------------- */
/* Thresholds — what makes a proof number honest                               */
/* -------------------------------------------------------------------------- */

/** Below this, « Nos apprenants » reads as a confession, not a proof. */
const MIN_LEARNERS = 25;
/** A success rate computed on a handful of finished enrolments is noise. */
const MIN_TERMINAL_ENROLLMENTS = 20;
const MIN_GRADUATES = 10;
const MIN_COURSES = 3;
const MIN_INSTRUCTORS = 2;
const MIN_CATEGORIES = 3;

/** §12.2 asks for exactly three figures in the hero. */
export const HERO_STAT_COUNT = 3;

const FEATURED_LIMIT = 6;
const LATTICE_LIMIT = 24;
const PATH_LIMIT = 3;
const TESTIMONIAL_LIMIT = 8;
const INSTRUCTOR_LIMIT = 4;
const FAQ_LIMIT = 8;
const GALLERY_LIMIT = 6;
const CATEGORY_CHIP_LIMIT = 8;

const CACHE_TTL_MS = 60_000;

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** `SiteSetting.value` is JSON: an amount may arrive as a number or a string. */
function asPositiveInteger(value: unknown): number | null {
  const raw = typeof value === 'string' ? Number.parseFloat(value.trim()) : value;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw);
}

/**
 * A storage key becomes a URL only when a public base is configured. Returning
 * `null` otherwise is deliberate: a broken `<img>` is worse than a designed
 * fallback, and `next.config.ts` only whitelists the host of
 * `S3_PUBLIC_BASE_URL`, so any other origin would fail optimisation anyway.
 */
function mediaUrl(key: string | null | undefined): string | null {
  const trimmed = asString(key);
  if (trimmed === null) return null;

  const base = env.S3_PUBLIC_BASE_URL;
  if (base === undefined || base === null || base === '') return null;

  try {
    return new URL(trimmed.replace(/^\/+/u, ''), base.endsWith('/') ? base : `${base}/`).toString();
  } catch {
    return null;
  }
}

/** Active locale first, French second — French is the source language (§10.2). */
function pickTranslation<T extends { locale: string }>(
  rows: readonly T[],
  locale: Locale,
): T | undefined {
  return rows.find((row) => row.locale === locale) ?? rows.find((row) => row.locale === 'fr');
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 1 ? 1 : value;
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                       */
/* -------------------------------------------------------------------------- */

interface CacheEntry {
  readonly value: HomeData;
  readonly expiresAt: number;
}

const cache = new Map<Locale, CacheEntry>();

/** Called by the admin homepage builder (§17.11) after a save. */
export function invalidateHomeData(): void {
  cache.clear();
}

const EMPTY_HOME: HomeData = {
  stats: [],
  lattice: [],
  categories: [],
  featured: [],
  paths: [],
  testimonials: [],
  instructors: [],
  faq: [],
  pricing: {
    cfiMinCentimes: null,
    cfiMaxCentimes: null,
    marketMinCentimes: null,
    marketMaxCentimes: null,
    installmentsAvailable: false,
  },
  centre: {
    address: null,
    hours: null,
    phoneE164: null,
    phoneDisplay: null,
    whatsappNumber: null,
    gallery: [],
  },
};

/* -------------------------------------------------------------------------- */
/* Entry points                                                                */
/* -------------------------------------------------------------------------- */

export async function getHomeData(locale: Locale): Promise<HomeData> {
  const now = Date.now();
  const cached = cache.get(locale);
  if (cached !== undefined && cached.expiresAt > now) return cached.value;

  let value: HomeData;
  try {
    value = await readHomeData(locale);
  } catch (cause) {
    console.warn('[home] lecture impossible, page servie sans données :', cause);
    return EMPTY_HOME;
  }

  cache.set(locale, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

/**
 * The three hero figures (§12.2), already filtered down to the ones a real
 * database can back. Exposed on its own because the hero is the only caller
 * that must not be handed a fourth.
 */
export async function getHomeStats(locale: Locale): Promise<readonly HomeStat[]> {
  const data = await getHomeData(locale);
  return data.stats.slice(0, HERO_STAT_COUNT);
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

const PUBLISHED_COURSE = { status: 'PUBLISHED', deletedAt: null } as const;

const SETTING_KEYS = [
  'contact.phone',
  'contact.whatsapp',
  'contact.address',
  'contact.hours',
  'home.market.minCentimes',
  'home.market.maxCentimes',
  'home.gallery',
] as const;

async function readHomeData(locale: Locale): Promise<HomeData> {
  const [
    counts,
    settingRows,
    latticeRows,
    categoryRows,
    featuredRows,
    pathRows,
    testimonialRows,
    instructorRows,
    faqRows,
    priceRange,
    installmentCount,
  ] = await Promise.all([
    readCounts(),
    db.siteSetting.findMany({
      where: { key: { in: [...SETTING_KEYS] } },
      select: { key: true, value: true },
    }),
    db.course.findMany({
      where: PUBLISHED_COURSE,
      orderBy: [{ enrollmentCount: 'desc' }, { publishedAt: 'desc' }],
      take: LATTICE_LIMIT,
      select: {
        id: true,
        slug: true,
        enrollmentCount: true,
        translations: {
          where: { locale: { in: translationLocales(locale) } },
          select: { locale: true, title: true },
        },
      },
    }),
    db.category.findMany({
      where: { isActive: true, courses: { some: PUBLISHED_COURSE } },
      orderBy: [{ order: 'asc' }, { slug: 'asc' }],
      take: CATEGORY_CHIP_LIMIT,
      select: {
        slug: true,
        _count: { select: { courses: { where: PUBLISHED_COURSE } } },
        translations: {
          where: { locale: { in: translationLocales(locale) } },
          select: { locale: true, name: true },
        },
      },
    }),
    readFeatured(locale),
    db.path.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
      take: PATH_LIMIT,
      select: {
        id: true,
        slug: true,
        priceCentimes: true,
        translations: {
          where: { locale: { in: translationLocales(locale) } },
          select: { locale: true, title: true, description: true },
        },
        items: {
          orderBy: { order: 'asc' },
          select: {
            course: {
              select: {
                slug: true,
                status: true,
                deletedAt: true,
                priceCentimes: true,
                durationMinutes: true,
                translations: {
                  where: { locale: { in: translationLocales(locale) } },
                  select: { locale: true, title: true },
                },
              },
            },
          },
        },
      },
    }),
    db.testimonial.findMany({
      where: { isPublished: true },
      orderBy: [{ isFeatured: 'desc' }, { order: 'asc' }, { createdAt: 'desc' }],
      take: TESTIMONIAL_LIMIT,
      select: {
        id: true,
        authorName: true,
        authorRole: true,
        avatarKey: true,
        rating: true,
        quoteFr: true,
        quoteAr: true,
        quoteEn: true,
        quoteEs: true,
      },
    }),
    db.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        authoredCourses: { some: PUBLISHED_COURSE },
      },
      orderBy: { createdAt: 'asc' },
      take: INSTRUCTOR_LIMIT,
      select: {
        id: true,
        fullName: true,
        headline: true,
        avatarKey: true,
        _count: { select: { authoredCourses: { where: PUBLISHED_COURSE } } },
        authoredCourses: {
          where: PUBLISHED_COURSE,
          orderBy: { enrollmentCount: 'desc' },
          take: 1,
          select: {
            category: {
              select: {
                translations: {
                  where: { locale: { in: translationLocales(locale) } },
                  select: { locale: true, name: true },
                },
              },
            },
          },
        },
      },
    }),
    db.faqItem.findMany({
      where: { isPublished: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      take: FAQ_LIMIT,
      select: {
        id: true,
        questionFr: true,
        questionAr: true,
        questionEn: true,
        questionEs: true,
        answerFr: true,
        answerAr: true,
        answerEn: true,
        answerEs: true,
      },
    }),
    db.course.aggregate({
      where: { ...PUBLISHED_COURSE, priceCentimes: { gt: 0 } },
      _min: { priceCentimes: true },
      _max: { priceCentimes: true },
    }),
    db.course.count({ where: { ...PUBLISHED_COURSE, installmentsAllowed: true } }),
  ]);

  const settings = new Map<string, unknown>();
  for (const row of settingRows) settings.set(row.key, row.value);

  /* ---------------------------------------------------------------- lattice */

  const peak = latticeRows.reduce((max, row) => Math.max(max, row.enrollmentCount), 0);
  const lattice: HomeLatticeTile[] = [];
  for (const row of latticeRows) {
    const title = asString(pickTranslation(row.translations, locale)?.title);
    if (title === null) continue;
    lattice.push({
      id: row.id,
      slug: row.slug,
      title,
      // A brand-new catalogue has no enrolments at all; every tile then reads at
      // a calm mid intensity rather than as a dead grid.
      intensity: peak === 0 ? 0.45 : clamp01(0.28 + 0.72 * (row.enrollmentCount / peak)),
    });
  }

  /* ------------------------------------------------------------- categories */

  const categories: HomeCategory[] = [];
  for (const row of categoryRows) {
    const name = asString(pickTranslation(row.translations, locale)?.name);
    if (name === null) continue;
    categories.push({ slug: row.slug, name, courseCount: row._count.courses });
  }

  /* ------------------------------------------------------------------ paths */

  const paths: HomePath[] = [];
  for (const row of pathRows) {
    const translation = pickTranslation(row.translations, locale);
    const title = asString(translation?.title);
    const description = asString(translation?.description);
    if (title === null || description === null) continue;

    const steps: HomePathStep[] = [];
    let durationMinutes = 0;
    let sumCentimes = 0;

    for (const item of row.items) {
      const { course } = item;
      if (course.status !== 'PUBLISHED' || course.deletedAt !== null) continue;
      const stepTitle = asString(pickTranslation(course.translations, locale)?.title);
      if (stepTitle === null) continue;
      steps.push({ slug: course.slug, title: stepTitle });
      durationMinutes += course.durationMinutes;
      sumCentimes += course.priceCentimes;
    }

    // A path with a single course is not a path; §12.5 sells it as a sequence.
    if (steps.length < 2) continue;

    paths.push({
      id: row.id,
      slug: row.slug,
      title,
      description,
      steps,
      durationMinutes,
      priceCentimes: row.priceCentimes,
      sumCentimes,
    });
  }

  /* ----------------------------------------------------------- testimonials */

  const testimonials: HomeTestimonial[] = [];
  for (const row of testimonialRows) {
    const quote = localizedColumn(locale, {
      fr: row.quoteFr,
      ar: row.quoteAr,
      en: row.quoteEn,
      es: row.quoteEs,
    });
    if (quote === null) continue;
    testimonials.push({
      id: row.id,
      authorName: row.authorName,
      authorRole: asString(row.authorRole),
      avatarUrl: mediaUrl(row.avatarKey),
      rating: Math.min(5, Math.max(1, row.rating)),
      quote,
    });
  }

  /* ------------------------------------------------------------ instructors */

  const instructors: HomeInstructor[] = instructorRows.map((row) => {
    const topCourse = row.authoredCourses[0];
    const specialty =
      topCourse?.category === undefined || topCourse.category === null
        ? null
        : asString(pickTranslation(topCourse.category.translations, locale)?.name);

    return {
      id: row.id,
      fullName: row.fullName,
      headline: asString(row.headline),
      avatarUrl: mediaUrl(row.avatarKey),
      courseCount: row._count.authoredCourses,
      specialty,
    };
  });

  /* -------------------------------------------------------------------- faq */

  const faq: HomeFaq[] = [];
  for (const row of faqRows) {
    const question = localizedColumn(locale, {
      fr: row.questionFr,
      ar: row.questionAr,
      en: row.questionEn,
      es: row.questionEs,
    });
    const answer = localizedColumn(locale, {
      fr: row.answerFr,
      ar: row.answerAr,
      en: row.answerEn,
      es: row.answerEs,
    });
    if (question === null || answer === null) continue;
    faq.push({ id: row.id, question, answer });
  }

  /* ---------------------------------------------------------------- pricing */

  const marketMin = asPositiveInteger(settings.get('home.market.minCentimes'));
  const marketMax = asPositiveInteger(settings.get('home.market.maxCentimes'));

  const pricing: HomePricing = {
    cfiMinCentimes: priceRange._min.priceCentimes ?? null,
    cfiMaxCentimes: priceRange._max.priceCentimes ?? null,
    // Both ends or neither: half a range is not a range.
    marketMinCentimes: marketMin !== null && marketMax !== null ? marketMin : null,
    marketMaxCentimes: marketMin !== null && marketMax !== null ? marketMax : null,
    installmentsAvailable: installmentCount > 0,
  };

  /* ----------------------------------------------------------------- centre */

  const phone = asString(settings.get('contact.phone'));
  const parsedPhone = phone === null ? null : parsePhone(phone);
  const whatsapp = asString(settings.get('contact.whatsapp'));
  const parsedWhatsapp = whatsapp === null ? null : parsePhone(whatsapp);

  const centre: HomeCentre = {
    address: asString(settings.get('contact.address')),
    hours: asString(settings.get('contact.hours')),
    phoneE164: parsedPhone?.e164 ?? null,
    phoneDisplay: parsedPhone === null ? null : formatPhoneDisplay(parsedPhone.e164),
    whatsappNumber: parsedWhatsapp === null ? null : parsedWhatsapp.e164.replace(/\D/gu, ''),
    gallery: readGallery(settings.get('home.gallery')),
  };

  return {
    stats: buildStats(counts),
    lattice,
    categories,
    featured: featuredRows,
    paths,
    testimonials,
    instructors,
    faq,
    pricing,
    centre,
  };
}

/* -------------------------------------------------------------------------- */
/* Featured courses                                                            */
/* -------------------------------------------------------------------------- */

const COURSE_CARD_SELECT = {
  id: true,
  slug: true,
  level: true,
  durationMinutes: true,
  lessonCount: true,
  ratingAvg: true,
  ratingCount: true,
  enrollmentCount: true,
  priceCentimes: true,
  comparePriceCentimes: true,
  isNew: true,
  coverKey: true,
  thumbnailKey: true,
} satisfies Prisma.CourseSelect;

/**
 * Six cards, always six if the catalogue can supply them: the admin's featured
 * flags first (§17.11 owns that list), then the most enrolled published courses
 * to backfill. A bento with a hole in it looks broken, and « à la une » with two
 * cards looks empty.
 */
async function readFeatured(locale: Locale): Promise<HomeCourse[]> {
  // `satisfies` rather than a bare literal: without it the nested `select`
  // widens to `{ locale: string }` and the rows lose `title`/`name`, which is
  // what the second half of these errors was. The helper keeps `in` mutable.
  const translationFilter = {
    where: { locale: { in: translationLocales(locale) } },
    select: { locale: true, title: true },
  } satisfies Prisma.Course$translationsArgs;

  const categoryFilter = {
    select: {
      translations: {
        where: { locale: { in: translationLocales(locale) } },
        select: { locale: true, name: true },
      },
    },
  } satisfies Prisma.Course$categoryArgs;

  const featured = await db.course.findMany({
    where: { ...PUBLISHED_COURSE, isFeatured: true },
    orderBy: [{ enrollmentCount: 'desc' }, { publishedAt: 'desc' }],
    take: FEATURED_LIMIT,
    select: { ...COURSE_CARD_SELECT, translations: translationFilter, category: categoryFilter },
  });

  const missing = FEATURED_LIMIT - featured.length;
  const backfill =
    missing <= 0
      ? []
      : await db.course.findMany({
          where: {
            ...PUBLISHED_COURSE,
            isFeatured: false,
            id: { notIn: featured.map((row) => row.id) },
          },
          orderBy: [{ enrollmentCount: 'desc' }, { publishedAt: 'desc' }],
          take: missing,
          select: {
            ...COURSE_CARD_SELECT,
            translations: translationFilter,
            category: categoryFilter,
          },
        });

  const courses: HomeCourse[] = [];
  for (const row of [...featured, ...backfill]) {
    const title = asString(pickTranslation(row.translations, locale)?.title);
    if (title === null) continue;

    courses.push({
      id: row.id,
      slug: row.slug,
      title,
      categoryName:
        row.category === null
          ? null
          : asString(pickTranslation(row.category.translations, locale)?.name),
      level: row.level,
      durationMinutes: row.durationMinutes,
      lessonCount: row.lessonCount,
      ratingAvg: row.ratingAvg,
      ratingCount: row.ratingCount,
      enrollmentCount: row.enrollmentCount,
      priceCentimes: row.priceCentimes,
      comparePriceCentimes: row.comparePriceCentimes,
      isNew: row.isNew,
      coverUrl: mediaUrl(row.coverKey) ?? mediaUrl(row.thumbnailKey),
    });
  }

  return courses;
}

/* -------------------------------------------------------------------------- */
/* Proof numbers                                                               */
/* -------------------------------------------------------------------------- */

interface HomeCounts {
  readonly learners: number;
  readonly courses: number;
  readonly completed: number;
  readonly terminal: number;
  readonly graduates: number;
  readonly instructors: number;
  readonly categories: number;
}

async function readCounts(): Promise<HomeCounts> {
  const [learners, courses, completed, terminal, graduates, instructors, categories] =
    await Promise.all([
      db.user.count({ where: { role: 'STUDENT', status: 'ACTIVE', deletedAt: null } }),
      db.course.count({ where: PUBLISHED_COURSE }),
      db.enrollment.count({ where: { status: 'COMPLETED' } }),
      db.enrollment.count({ where: { status: { in: ['COMPLETED', 'EXPIRED'] } } }),
      db.certificate.count({ where: { revokedAt: null } }),
      db.user.count({
        where: { deletedAt: null, status: 'ACTIVE', authoredCourses: { some: PUBLISHED_COURSE } },
      }),
      db.category.count({ where: { isActive: true, courses: { some: PUBLISHED_COURSE } } }),
    ]);

  return { learners, courses, completed, terminal, graduates, instructors, categories };
}

/**
 * §12.2: "if a number is not yet meaningful, show a different proof instead of a
 * fake one". So this returns the figures *in preference order*, keeping only
 * those a real database can defend, and the hero takes the first three. On a
 * fresh install that is « Formations », « Domaines » and nothing else — which is
 * the honest answer.
 */
function buildStats(counts: HomeCounts): HomeStat[] {
  const stats: HomeStat[] = [];

  if (counts.learners >= MIN_LEARNERS) {
    stats.push({ id: 'learners', value: counts.learners, kind: 'count' });
  }

  if (counts.courses >= MIN_COURSES) {
    stats.push({ id: 'courses', value: counts.courses, kind: 'count' });
  }

  if (counts.terminal >= MIN_TERMINAL_ENROLLMENTS) {
    stats.push({
      id: 'successRate',
      value: Math.round((counts.completed / counts.terminal) * 100),
      kind: 'percent',
    });
  }

  if (counts.graduates >= MIN_GRADUATES) {
    stats.push({ id: 'graduates', value: counts.graduates, kind: 'count' });
  }

  if (counts.instructors >= MIN_INSTRUCTORS) {
    stats.push({ id: 'instructors', value: counts.instructors, kind: 'count' });
  }

  if (counts.categories >= MIN_CATEGORIES) {
    stats.push({ id: 'categories', value: counts.categories, kind: 'count' });
  }

  return stats;
}

/* -------------------------------------------------------------------------- */
/* Denormalised translations and the gallery setting                           */
/* -------------------------------------------------------------------------- */

type LocalizedColumns = Readonly<Record<Locale, string | null>>;

function localizedColumn(locale: Locale, columns: LocalizedColumns): string | null {
  return asString(columns[locale]) ?? asString(columns.fr);
}

/**
 * `home.gallery` holds `[{ "key": "...", "alt": "..." }]` — storage keys, not
 * URLs, and an alt text that is mandatory because a photo of the centre carries
 * meaning (§21). An entry missing either is dropped: the section then simply
 * renders without a gallery rather than with an empty frame.
 */
function readGallery(value: unknown): HomeImage[] {
  if (!Array.isArray(value)) return [];

  const images: HomeImage[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const url = mediaUrl(asString(record.key));
    const alt = asString(record.alt);
    if (url === null || alt === null) continue;
    images.push({ url, alt });
    if (images.length >= GALLERY_LIMIT) break;
  }

  return images;
}
