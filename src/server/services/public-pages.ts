import { db } from '@/server/db';
import type { Locale } from '@/i18n/routing';

/**
 * Read models for the §12.5 secondary public pages and for `sitemap.ts`.
 *
 * ## Why this file exists
 * `eslint.config.mjs` forbids `src/app/**` from importing `@/server/db` (§5), so
 * a page — and `sitemap.ts`, which is a page as far as that rule is concerned —
 * cannot query Prisma itself. Everything the method, pricing, about,
 * instructors, paths, contact and legal screens need is resolved here, in the
 * shape the page renders, with the locale fallback already applied.
 *
 * ## Fallback discipline (§10.2)
 * Requested locale → `fr` → nothing. `fr` is the source language and is
 * guaranteed non-null in the schema for every localised column on `Page`,
 * `FaqItem` and `BlogPost`, which is why the chain can stop there. Each read
 * model reports which locale it actually served in `resolvedLocale`, so the page
 * can show the « contenu disponible en français » pill instead of silently
 * mixing languages.
 *
 * ## Nothing here throws for the public site
 * A marketing page must render even when a query fails. The list readers return
 * an empty array and log once; the single-document reader returns `null`, which
 * the caller turns into a 404. A legal page is the one place where "empty" is
 * unacceptable, and that is handled by the fallback chain, not by an exception.
 */

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

/** The four suffixes used by the denormalised localised columns. */
type LocaleSuffix = 'Fr' | 'Ar' | 'En' | 'Es';

const SUFFIX: Record<Locale, LocaleSuffix> = {
  fr: 'Fr',
  ar: 'Ar',
  en: 'En',
  es: 'Es',
};

/** A non-empty trimmed string, or `null`. */
function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pick `<field><Locale>` with a fallback to `<field>Fr`, and say which one won.
 * Used for `Page`, `FaqItem` and `BlogPost`, whose translations are columns
 * rather than rows.
 */
function pickColumn(
  row: Readonly<Record<string, unknown>>,
  field: string,
  locale: Locale,
): { readonly value: string | null; readonly resolvedLocale: Locale } {
  const exact = clean(row[`${field}${SUFFIX[locale]}`] as string | null | undefined);
  if (exact !== null) return { value: exact, resolvedLocale: locale };

  const french = clean(row[`${field}Fr`] as string | null | undefined);
  return { value: french, resolvedLocale: 'fr' };
}

/** Pick a translation row for `locale`, falling back to `fr`. */
function pickTranslation<T extends { readonly locale: Locale }>(
  rows: readonly T[],
  locale: Locale,
): T | null {
  return rows.find((row) => row.locale === locale) ?? rows.find((row) => row.locale === 'fr') ?? null;
}

function warn(scope: string, cause: unknown): void {
  console.warn(`[public-pages] ${scope} : lecture impossible, repli sur une liste vide.`, cause);
}

/**
 * Public URL of an object-storage key, or `null` when no public base is
 * configured. Keys are stored in the database; URLs are never stored, so that
 * moving the bucket is a configuration change and not a migration.
 */
export function publicMediaUrl(key: string | null | undefined): string | null {
  const objectKey = clean(key);
  const base = clean(process.env.S3_PUBLIC_BASE_URL);
  if (objectKey === null || base === null) return null;

  try {
    return new URL(objectKey.replace(/^\/+/, ''), base.endsWith('/') ? base : `${base}/`).toString();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Legal / editorial pages (`Page`)                                            */
/* -------------------------------------------------------------------------- */

export interface EditorialPage {
  readonly slug: string;
  readonly title: string;
  /** Markdown, as authored in the admin. */
  readonly body: string;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly updatedAt: Date;
  /** The locale the body was actually served in — `fr` when falling back. */
  readonly resolvedLocale: Locale;
}

/**
 * One published `Page` by slug, in `locale`, falling back to French.
 *
 * The fallback is per-document, not per-field: a page whose Arabic body exists
 * but whose Arabic title does not would otherwise render a French heading over
 * an Arabic document. The body decides, and the title follows it.
 */
export async function getEditorialPage(slug: string, locale: Locale): Promise<EditorialPage | null> {
  let row: Awaited<ReturnType<typeof db.page.findFirst>> = null;

  try {
    row = await db.page.findFirst({
      where: { slug, status: 'PUBLISHED' },
    });
  } catch (cause) {
    warn(`page:${slug}`, cause);
    return null;
  }

  if (row === null) return null;

  const record = row as unknown as Readonly<Record<string, unknown>>;
  const body = pickColumn(record, 'body', locale);
  if (body.value === null) return null;

  // The title follows whichever locale the body resolved to.
  const titleExact = clean(record[`title${SUFFIX[body.resolvedLocale]}`] as string | null);
  const title = titleExact ?? clean(record.titleFr as string | null);
  if (title === null) return null;

  return {
    slug: row.slug,
    title,
    body: body.value,
    seoTitle: clean(row.seoTitle),
    seoDescription: clean(row.seoDescription),
    updatedAt: row.updatedAt,
    resolvedLocale: body.resolvedLocale,
  };
}

/* -------------------------------------------------------------------------- */
/* FAQ                                                                         */
/* -------------------------------------------------------------------------- */

export interface FaqEntry {
  readonly id: string;
  readonly category: string;
  readonly question: string;
  readonly answer: string;
}

/** Published FAQ items, optionally restricted to a set of categories. */
export async function getFaqEntries(
  locale: Locale,
  categories?: readonly string[],
): Promise<readonly FaqEntry[]> {
  try {
    const rows = await db.faqItem.findMany({
      where: {
        isPublished: true,
        ...(categories === undefined ? {} : { category: { in: [...categories] } }),
      },
      orderBy: [{ category: 'asc' }, { order: 'asc' }],
    });

    const entries: FaqEntry[] = [];
    for (const row of rows) {
      const record = row as unknown as Readonly<Record<string, unknown>>;
      const question = pickColumn(record, 'question', locale).value;
      const answer = pickColumn(record, 'answer', locale).value;
      if (question === null || answer === null) continue;
      entries.push({ id: row.id, category: row.category, question, answer });
    }
    return entries;
  } catch (cause) {
    warn('faq', cause);
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Instructors                                                                 */
/* -------------------------------------------------------------------------- */

export interface InstructorCourseRef {
  readonly slug: string;
  readonly title: string;
}

export interface InstructorProfile {
  readonly id: string;
  readonly fullName: string;
  readonly headline: string | null;
  readonly bio: string | null;
  readonly avatarUrl: string | null;
  readonly courseCount: number;
  /** Sum of `Course.enrollmentCount` over their published courses. */
  readonly studentCount: number;
  /** Up to `courseSampleSize` published courses, newest first. */
  readonly courses: readonly InstructorCourseRef[];
}

/**
 * Instructors with at least one published course.
 *
 * An `INSTRUCTOR` account with nothing published is a staff record, not a public
 * profile: listing it would promise a catalogue that does not exist.
 */
export async function getInstructors(
  locale: Locale,
  courseSampleSize = 3,
): Promise<readonly InstructorProfile[]> {
  try {
    const rows = await db.user.findMany({
      where: {
        role: 'INSTRUCTOR',
        status: 'ACTIVE',
        deletedAt: null,
        authoredCourses: { some: { status: 'PUBLISHED', deletedAt: null } },
      },
      orderBy: [{ fullName: 'asc' }],
      select: {
        id: true,
        fullName: true,
        headline: true,
        bio: true,
        avatarKey: true,
        authoredCourses: {
          where: { status: 'PUBLISHED', deletedAt: null },
          orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
          select: {
            slug: true,
            enrollmentCount: true,
            translations: { select: { locale: true, title: true } },
          },
        },
      },
    });

    return rows.map((row) => {
      const courses: InstructorCourseRef[] = [];
      let studentCount = 0;

      for (const course of row.authoredCourses) {
        studentCount += course.enrollmentCount;
        if (courses.length >= courseSampleSize) continue;
        const translation = pickTranslation(course.translations, locale);
        const title = clean(translation?.title);
        if (title !== null) courses.push({ slug: course.slug, title });
      }

      return {
        id: row.id,
        fullName: row.fullName,
        headline: clean(row.headline),
        bio: clean(row.bio),
        avatarUrl: publicMediaUrl(row.avatarKey),
        courseCount: row.authoredCourses.length,
        studentCount,
        courses,
      };
    });
  } catch (cause) {
    warn('instructors', cause);
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Paths (« parcours »)                                                        */
/* -------------------------------------------------------------------------- */

export interface PathCourseRef {
  readonly slug: string;
  readonly title: string;
  readonly durationMinutes: number;
  readonly priceCentimes: number;
}

export interface PathSummary {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly outcome: string | null;
  readonly coverUrl: string | null;
  readonly courses: readonly PathCourseRef[];
  readonly totalDurationMinutes: number;
  /** Sum of the individual course prices, in centimes. */
  readonly separatePriceCentimes: number;
  /** The bundle price. Falls back to the sum when `Path.priceCentimes` is null. */
  readonly bundlePriceCentimes: number;
  /** `bundle < separate ? separate − bundle : 0`. */
  readonly savingCentimes: number;
  readonly resolvedLocale: Locale;
}

/** Published paths, ordered by their featured flag then by title. */
export async function getPublishedPaths(locale: Locale): Promise<readonly PathSummary[]> {
  try {
    const rows = await db.path.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        slug: true,
        coverKey: true,
        priceCentimes: true,
        translations: {
          where: { locale: { in: [locale, 'fr'] } },
          select: { locale: true, title: true, description: true, outcome: true },
        },
        items: {
          orderBy: { order: 'asc' },
          select: {
            course: {
              select: {
                slug: true,
                status: true,
                deletedAt: true,
                durationMinutes: true,
                priceCentimes: true,
                translations: {
                  where: { locale: { in: [locale, 'fr'] } },
                  select: { locale: true, title: true },
                },
              },
            },
          },
        },
      },
    });

    const summaries: PathSummary[] = [];

    for (const row of rows) {
      const translation = pickTranslation(row.translations, locale);
      const title = clean(translation?.title);
      const description = clean(translation?.description);
      if (translation === null || title === null || description === null) continue;

      const courses: PathCourseRef[] = [];
      let totalDurationMinutes = 0;
      let separatePriceCentimes = 0;

      for (const item of row.items) {
        const course = item.course;
        if (course.status !== 'PUBLISHED' || course.deletedAt !== null) continue;
        const courseTitle = clean(pickTranslation(course.translations, locale)?.title);
        if (courseTitle === null) continue;

        courses.push({
          slug: course.slug,
          title: courseTitle,
          durationMinutes: course.durationMinutes,
          priceCentimes: course.priceCentimes,
        });
        totalDurationMinutes += course.durationMinutes;
        separatePriceCentimes += course.priceCentimes;
      }

      // A path whose courses are all unpublished is not a public offer.
      if (courses.length === 0) continue;

      const bundlePriceCentimes = row.priceCentimes ?? separatePriceCentimes;

      summaries.push({
        id: row.id,
        slug: row.slug,
        title,
        description,
        outcome: clean(translation.outcome),
        coverUrl: publicMediaUrl(row.coverKey),
        courses,
        totalDurationMinutes,
        separatePriceCentimes,
        bundlePriceCentimes,
        savingCentimes: Math.max(0, separatePriceCentimes - bundlePriceCentimes),
        resolvedLocale: translation.locale,
      });
    }

    return summaries;
  } catch (cause) {
    warn('paths', cause);
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Pricing table                                                               */
/* -------------------------------------------------------------------------- */

export interface PricingRow {
  readonly categorySlug: string;
  readonly categoryName: string;
  readonly courseCount: number;
  readonly minPriceCentimes: number;
  readonly maxPriceCentimes: number;
  /** Mean course duration in minutes, rounded. `0` when no duration is set. */
  readonly averageDurationMinutes: number;
}

/**
 * The §12.5 price table: one row per active category that actually has
 * published courses, with the real observed price range and mean duration.
 *
 * Courses with no category are grouped nowhere — they still appear in the
 * catalogue, and inventing a « Divers » bucket would misrepresent the offer.
 */
export async function getPricingTable(locale: Locale): Promise<readonly PricingRow[]> {
  try {
    const rows = await db.category.findMany({
      where: {
        isActive: true,
        courses: { some: { status: 'PUBLISHED', deletedAt: null } },
      },
      orderBy: [{ order: 'asc' }, { slug: 'asc' }],
      select: {
        slug: true,
        translations: {
          where: { locale: { in: [locale, 'fr'] } },
          select: { locale: true, name: true },
        },
        courses: {
          where: { status: 'PUBLISHED', deletedAt: null },
          select: { priceCentimes: true, durationMinutes: true },
        },
      },
    });

    const table: PricingRow[] = [];

    for (const row of rows) {
      const name = clean(pickTranslation(row.translations, locale)?.name);
      if (name === null || row.courses.length === 0) continue;

      let min = Number.POSITIVE_INFINITY;
      let max = 0;
      let durationTotal = 0;

      for (const course of row.courses) {
        min = Math.min(min, course.priceCentimes);
        max = Math.max(max, course.priceCentimes);
        durationTotal += course.durationMinutes;
      }

      table.push({
        categorySlug: row.slug,
        categoryName: name,
        courseCount: row.courses.length,
        minPriceCentimes: Number.isFinite(min) ? min : 0,
        maxPriceCentimes: max,
        averageDurationMinutes: Math.round(durationTotal / row.courses.length),
      });
    }

    return table;
  } catch (cause) {
    warn('pricing', cause);
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Course options (contact form)                                               */
/* -------------------------------------------------------------------------- */

export interface CourseOption {
  readonly slug: string;
  readonly title: string;
}

/** Published courses, for the « formation qui vous intéresse » select. */
export async function getCourseOptions(locale: Locale): Promise<readonly CourseOption[]> {
  try {
    const rows = await db.course.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      orderBy: [{ enrollmentCount: 'desc' }, { slug: 'asc' }],
      select: {
        slug: true,
        translations: {
          where: { locale: { in: [locale, 'fr'] } },
          select: { locale: true, title: true },
        },
      },
    });

    const options: CourseOption[] = [];
    for (const row of rows) {
      const title = clean(pickTranslation(row.translations, locale)?.title);
      if (title !== null) options.push({ slug: row.slug, title });
    }
    return options;
  } catch (cause) {
    warn('course-options', cause);
    return [];
  }
}

/** The French title of a published course, for the admin-readable lead subject. */
export async function getCourseTitleBySlug(slug: string): Promise<string | null> {
  try {
    const row = await db.course.findFirst({
      where: { slug, status: 'PUBLISHED', deletedAt: null },
      select: { translations: { where: { locale: 'fr' }, select: { locale: true, title: true } } },
    });
    return clean(pickTranslation(row?.translations ?? [], 'fr')?.title);
  } catch (cause) {
    warn(`course-title:${slug}`, cause);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Centre figures                                                              */
/* -------------------------------------------------------------------------- */

export interface CentreFigures {
  readonly publishedCourses: number;
  readonly instructors: number;
  readonly categories: number;
  /** Distinct approved learners holding at least one enrolment. */
  readonly learners: number;
}

/**
 * The real counts behind the « en chiffres » band. Every figure is a `COUNT` on
 * a real table — §12.2 forbids hardcoding them, and the page hides any figure
 * that is still zero rather than printing a proud « 0 ».
 */
export async function getCentreFigures(): Promise<CentreFigures> {
  try {
    const [publishedCourses, instructors, categories, learners] = await Promise.all([
      db.course.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
      db.user.count({
        where: {
          role: 'INSTRUCTOR',
          status: 'ACTIVE',
          deletedAt: null,
          authoredCourses: { some: { status: 'PUBLISHED', deletedAt: null } },
        },
      }),
      db.category.count({
        where: { isActive: true, courses: { some: { status: 'PUBLISHED', deletedAt: null } } },
      }),
      db.user.count({
        where: { role: 'STUDENT', status: 'ACTIVE', deletedAt: null, enrollments: { some: {} } },
      }),
    ]);

    return { publishedCourses, instructors, categories, learners };
  } catch (cause) {
    warn('figures', cause);
    return { publishedCourses: 0, instructors: 0, categories: 0, learners: 0 };
  }
}

/* -------------------------------------------------------------------------- */
/* Sitemap                                                                     */
/* -------------------------------------------------------------------------- */

export interface SitemapRecord {
  /** Locale-relative path, e.g. `/formations/marketing-digital`. */
  readonly path: string;
  readonly lastModified: Date;
}

export interface SitemapIndex {
  readonly courses: readonly SitemapRecord[];
  readonly paths: readonly SitemapRecord[];
  readonly blogPosts: readonly SitemapRecord[];
  readonly legalPages: readonly SitemapRecord[];
}

const EMPTY_INDEX: SitemapIndex = {
  courses: [],
  paths: [],
  blogPosts: [],
  legalPages: [],
};

/**
 * Every database-backed public URL, with its real `updatedAt`.
 *
 * Locale prefixes are added by `sitemap.ts`, which also builds the alternate
 * set: the paths themselves are locale-independent (§10.1, French slugs).
 * A failure degrades to an empty index so the sitemap still lists the static
 * routes instead of returning a 500 to a crawler.
 */
export async function getSitemapIndex(): Promise<SitemapIndex> {
  try {
    const now = new Date();

    const [courses, paths, blogPosts, legalPages] = await Promise.all([
      db.course.findMany({
        where: { status: 'PUBLISHED', deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        select: { slug: true, updatedAt: true },
      }),
      db.path.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { updatedAt: 'desc' },
        select: { slug: true, updatedAt: true },
      }),
      db.blogPost.findMany({
        where: { status: 'PUBLISHED', publishedAt: { not: null, lte: now } },
        orderBy: { publishedAt: 'desc' },
        select: { slug: true, updatedAt: true },
      }),
      db.page.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { slug: 'asc' },
        select: { slug: true, updatedAt: true },
      }),
    ]);

    return {
      courses: courses.map((row) => ({
        path: `/formations/${row.slug}`,
        lastModified: row.updatedAt,
      })),
      paths: paths.map((row) => ({ path: `/parcours/${row.slug}`, lastModified: row.updatedAt })),
      blogPosts: blogPosts.map((row) => ({
        path: `/blog/${row.slug}`,
        lastModified: row.updatedAt,
      })),
      legalPages: legalPages.map((row) => ({
        path: `/legal/${row.slug}`,
        lastModified: row.updatedAt,
      })),
    };
  } catch (cause) {
    warn('sitemap', cause);
    return EMPTY_INDEX;
  }
}
