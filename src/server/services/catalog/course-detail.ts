import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { db } from '@/server/db';
import { MAX_SLUG_LENGTH } from '@/lib/slug';
import { locales, type Locale } from '@/i18n/routing';
import { translationLocales } from './locales';

/**
 * Read model for the course page (§12.4) — the conversion page.
 *
 * ## Why this file exists
 * `src/app/**` and `src/components/**` may not import `@/server/db` or
 * `@prisma/client` (§5, enforced by `eslint.config.mjs`), so the page needs a
 * service. Everything Prisma-shaped is flattened here into plain strings,
 * numbers and string-literal unions: the page never sees a Prisma enum, a
 * `JsonValue` or a `Decimal`.
 *
 * ## Locale resolution
 * Every translatable row is read for `[locale, 'fr']` and resolved with French
 * as the fallback, because French is the source language (§10.1) and a course
 * translated into Arabic three weeks after publication must not render an empty
 * page in the meantime.
 *
 * ## Honesty rules encoded here
 * - A storage key resolves to a URL **only when the bytes can exist**: a local
 *   `seed/…` cover is checked on disk, a remote key needs `S3_PUBLIC_BASE_URL`.
 *   Anything else returns `null` and the page draws its own placeholder rather
 *   than a broken image.
 * - A preview lesson is only advertised as previewable when it carries text we
 *   can actually show today (its MDX body or its transcript). Video hosting is
 *   M4; until it lands, a « leçon d'essai » with nothing behind it would be a
 *   dead play button, so it simply is not marked as a preview (§0, no
 *   placeholders).
 *
 * ## Authorization
 * Everything in `getCourseBySlug` is public by definition: only `PUBLISHED`,
 * non-deleted courses are returned, and only `APPROVED` reviews. The one
 * viewer-scoped read, {@link getViewerCourseState}, takes a user id that the
 * caller has already obtained from the session — it never accepts an id from
 * the request.
 */

/* -------------------------------------------------------------------------- */
/* Public shapes                                                               */
/* -------------------------------------------------------------------------- */

export type CourseLevelKey = 'DEBUTANT' | 'INTERMEDIAIRE' | 'AVANCE' | 'TOUS_NIVEAUX';
export type DeliveryModeKey = 'EN_LIGNE' | 'PRESENTIEL' | 'HYBRIDE';
export type LessonTypeKey = 'VIDEO' | 'DOCUMENT' | 'ARTICLE' | 'QUIZ' | 'ASSIGNMENT' | 'LIVE';

export interface CourseCategoryRef {
  readonly slug: string;
  readonly name: string;
}

export interface CourseInstructor {
  readonly id: string;
  readonly fullName: string;
  readonly headline: string | null;
  readonly bio: string | null;
  readonly avatarUrl: string | null;
  /** Published courses this person teaches. */
  readonly courseCount: number;
  /** Sum of `enrollmentCount` over those courses — real rows, never invented. */
  readonly studentCount: number;
}

/** A lesson body we can legitimately show to a visitor with no account. */
export interface LessonPreviewBody {
  /** `content` = the lesson's own MDX body; `transcript` = the video transcript. */
  readonly kind: 'content' | 'transcript';
  readonly body: string;
}

export interface CourseLesson {
  readonly id: string;
  readonly order: number;
  readonly type: LessonTypeKey;
  readonly title: string;
  readonly estimatedMinutes: number;
  /** Non-null only when there is something real to open in the preview modal. */
  readonly preview: LessonPreviewBody | null;
}

export interface CourseModule {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly summary: string | null;
  readonly durationMinutes: number;
  readonly lessons: readonly CourseLesson[];
}

export interface CourseResource {
  readonly id: string;
  readonly title: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface CoursePrerequisiteRef {
  readonly slug: string;
  readonly title: string;
  readonly isStrict: boolean;
}

export interface CourseReview {
  readonly id: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly authorName: string;
  readonly avatarUrl: string | null;
  readonly createdAt: Date;
  readonly adminReply: string | null;
}

/** One row of the distribution bars, five stars first. */
export interface RatingBucket {
  readonly stars: 1 | 2 | 3 | 4 | 5;
  readonly count: number;
}

export interface CourseReviews {
  readonly items: readonly CourseReview[];
  readonly distribution: readonly RatingBucket[];
  readonly average: number;
  readonly total: number;
}

export interface CourseFaqEntry {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}

export interface SimilarCourse {
  readonly slug: string;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly priceCentimes: number;
  readonly comparePriceCentimes: number | null;
  readonly durationMinutes: number;
  readonly lessonCount: number;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly level: CourseLevelKey;
}

export interface CourseDetail {
  readonly id: string;
  readonly slug: string;

  readonly title: string;
  readonly subtitle: string | null;
  readonly description: string;
  readonly objectives: readonly string[];
  readonly targetAudience: readonly string[];
  readonly requirementsText: readonly string[];
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;

  readonly level: CourseLevelKey;
  readonly deliveryMode: DeliveryModeKey;
  readonly contentLocale: Locale;

  readonly priceCentimes: number;
  readonly comparePriceCentimes: number | null;
  readonly installmentsAllowed: boolean;
  readonly installmentCount: number | null;

  readonly coverUrl: string | null;
  readonly durationMinutes: number;
  readonly lessonCount: number;
  readonly certificateEnabled: boolean;
  readonly passingScore: number;
  readonly accessDurationDays: number | null;
  readonly maxSeats: number | null;
  readonly seatsTaken: number;
  /** `null` when seats are unlimited. Never negative. */
  readonly seatsLeft: number | null;

  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly enrollmentCount: number;

  readonly publishedAt: Date | null;
  readonly updatedAt: Date;

  readonly category: CourseCategoryRef | null;
  readonly instructor: CourseInstructor | null;
  readonly modules: readonly CourseModule[];
  readonly resources: readonly CourseResource[];
  readonly prerequisites: readonly CoursePrerequisiteRef[];
  readonly reviews: CourseReviews;
  readonly faq: readonly CourseFaqEntry[];
  readonly similar: readonly SimilarCourse[];
  /** How many lessons a visitor can open without an account. */
  readonly previewCount: number;
}

/* -------------------------------------------------------------------------- */
/* Viewer state                                                                */
/* -------------------------------------------------------------------------- */

export type ViewerEnrollmentStatus = 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'REVOKED';

export type ViewerRequestStatus =
  | 'AWAITING_RECEIPT'
  | 'UNDER_REVIEW'
  | 'INFO_REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface ViewerEnrollment {
  readonly status: ViewerEnrollmentStatus;
  readonly lastLessonId: string | null;
  readonly expiresAt: Date | null;
  readonly completedAt: Date | null;
  /** The public verification code, when a certificate has been issued. */
  readonly certificateCode: string | null;
}

export interface ViewerRequest {
  readonly reference: string;
  readonly status: ViewerRequestStatus;
}

export interface ViewerCourseState {
  readonly enrollment: ViewerEnrollment | null;
  readonly request: ViewerRequest | null;
}

/* -------------------------------------------------------------------------- */
/* Input validation                                                            */
/* -------------------------------------------------------------------------- */

const localeValues: [Locale, ...Locale[]] = [...locales] as [Locale, ...Locale[]];

/** Every input into this module is validated, `.strict()`, before a query runs (§5). */
export const courseDetailQuerySchema = z
  .object({
    slug: z.string().trim().min(1).max(MAX_SLUG_LENGTH),
    locale: z.enum(localeValues),
  })
  .strict();

export type CourseDetailQuery = z.output<typeof courseDetailQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Media resolution                                                            */
/* -------------------------------------------------------------------------- */

/** Seed assets are committed under `public/brand/` (see `public/brand/README.md`). */
const LOCAL_ASSET_PREFIX = 'seed/';
const LOCAL_ASSET_ROOT = join(process.cwd(), 'public', 'brand');

const localAssetCache = new Map<string, boolean>();

function localAssetExists(relativeKey: string): boolean {
  const cached = localAssetCache.get(relativeKey);
  if (cached !== undefined) return cached;

  const exists = existsSync(join(LOCAL_ASSET_ROOT, relativeKey));
  localAssetCache.set(relativeKey, exists);
  return exists;
}

/**
 * Turn a storage key into a URL, or `null`.
 *
 * `null` is a first-class answer: the owner's covers are blocking for launch,
 * not for development, and rendering an `<img>` at a 404 is worse than
 * rendering the designed placeholder the page already has.
 */
export function resolveMediaUrl(key: string | null | undefined): string | null {
  if (typeof key !== 'string') return null;

  const clean = key.trim().replace(/^\/+/, '');
  if (clean === '' || clean.includes('..')) return null;

  if (clean.startsWith(LOCAL_ASSET_PREFIX)) {
    return localAssetExists(clean) ? `/brand/${clean}` : null;
  }

  const base = process.env.S3_PUBLIC_BASE_URL;
  if (base === undefined || base.trim() === '') return null;
  return `${base.replace(/\/+$/, '')}/${clean}`;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

/** `objectives`, `targetAudience` and `requirementsText` are `Json` columns holding `string[]`. */
function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed !== '') out.push(trimmed);
  }
  return out;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

interface LocalisedRow {
  readonly locale: Locale;
}

/** Exact locale first, French second — French is the source language (§10.1). */
function pickTranslation<T extends LocalisedRow>(
  rows: readonly T[],
  locale: Locale,
): T | undefined {
  return rows.find((row) => row.locale === locale) ?? rows.find((row) => row.locale === 'fr');
}

/** The FAQ groups a visitor asks about before paying (§12.4, §23). */
const COURSE_FAQ_CATEGORIES = ['FORMATIONS', 'INSCRIPTION', 'PAIEMENT'] as const;
const CERTIFICATE_FAQ_CATEGORY = 'CERTIFICAT';
const COURSE_FAQ_LIMIT = 6;
const REVIEW_LIMIT = 12;
const SIMILAR_LIMIT = 3;

function faqFieldsFor(locale: Locale): {
  readonly question: (row: FaqRow) => string | null;
  readonly answer: (row: FaqRow) => string | null;
} {
  switch (locale) {
    case 'ar':
      return { question: (row) => nonEmpty(row.questionAr), answer: (row) => nonEmpty(row.answerAr) };
    case 'en':
      return { question: (row) => nonEmpty(row.questionEn), answer: (row) => nonEmpty(row.answerEn) };
    case 'es':
      return { question: (row) => nonEmpty(row.questionEs), answer: (row) => nonEmpty(row.answerEs) };
    default:
      return { question: () => null, answer: () => null };
  }
}

interface FaqRow {
  readonly id: string;
  readonly questionFr: string;
  readonly questionAr: string | null;
  readonly questionEn: string | null;
  readonly questionEs: string | null;
  readonly answerFr: string;
  readonly answerAr: string | null;
  readonly answerEn: string | null;
  readonly answerEs: string | null;
}

function transcriptFor(
  locale: Locale,
  row: {
    readonly transcriptFr: string | null;
    readonly transcriptAr: string | null;
    readonly transcriptEn: string | null;
    readonly transcriptEs: string | null;
  },
): string | null {
  const byLocale =
    locale === 'ar'
      ? row.transcriptAr
      : locale === 'en'
        ? row.transcriptEn
        : locale === 'es'
          ? row.transcriptEs
          : row.transcriptFr;

  return nonEmpty(byLocale) ?? nonEmpty(row.transcriptFr);
}

/* -------------------------------------------------------------------------- */
/* The read                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Everything `/formations/[slug]` renders, in one call.
 *
 * Returns `null` for an unknown, unpublished, archived or soft-deleted slug —
 * the page turns that into a 404. Never throws for missing content: a course
 * with no modules, no reviews and no resources renders its honest empty states.
 */
export async function getCourseBySlug(input: CourseDetailQuery): Promise<CourseDetail | null> {
  const { slug, locale } = courseDetailQuerySchema.parse(input);
  const translationFilter = { locale: { in: translationLocales(locale) } };

  const course = await db.course.findFirst({
    where: { slug, status: 'PUBLISHED', deletedAt: null },
    select: {
      id: true,
      slug: true,
      level: true,
      deliveryMode: true,
      contentLocale: true,
      priceCentimes: true,
      comparePriceCentimes: true,
      installmentsAllowed: true,
      installmentCount: true,
      coverKey: true,
      durationMinutes: true,
      lessonCount: true,
      certificateEnabled: true,
      passingScore: true,
      accessDurationDays: true,
      maxSeats: true,
      seatsTaken: true,
      ratingAvg: true,
      ratingCount: true,
      enrollmentCount: true,
      publishedAt: true,
      updatedAt: true,
      categoryId: true,
      instructorId: true,
      translations: {
        where: translationFilter,
        select: {
          locale: true,
          title: true,
          subtitle: true,
          description: true,
          objectives: true,
          targetAudience: true,
          requirementsText: true,
          seoTitle: true,
          seoDescription: true,
        },
      },
      category: {
        select: {
          slug: true,
          translations: { where: translationFilter, select: { locale: true, name: true } },
        },
      },
      instructor: {
        select: {
          id: true,
          fullName: true,
          headline: true,
          bio: true,
          avatarKey: true,
          deletedAt: true,
        },
      },
      modules: {
        where: { isPublished: true },
        orderBy: { order: 'asc' },
        select: {
          id: true,
          order: true,
          translations: { where: translationFilter, select: { locale: true, title: true, summary: true } },
          lessons: {
            where: { isPublished: true, deletedAt: null },
            orderBy: { order: 'asc' },
            select: {
              id: true,
              order: true,
              type: true,
              isPreview: true,
              estimatedMinutes: true,
              translations: { where: translationFilter, select: { locale: true, title: true } },
            },
          },
        },
      },
      resources: {
        orderBy: [{ order: 'asc' }, { title: 'asc' }],
        select: { id: true, title: true, mimeType: true, sizeBytes: true, isDownloadable: true },
      },
      requirements: {
        select: {
          isStrict: true,
          required: {
            select: {
              slug: true,
              status: true,
              deletedAt: true,
              translations: { where: translationFilter, select: { locale: true, title: true } },
            },
          },
        },
      },
    },
  });

  if (course === null) return null;

  const text = pickTranslation(course.translations, locale);
  // A published course with no translation in any locale is a content defect,
  // not something to render as a nameless page.
  if (text === undefined) return null;

  const [previewRows, reviewRows, distributionRows, faqRows, instructorStats, similarRows] =
    await Promise.all([
      db.lesson.findMany({
        where: {
          module: { courseId: course.id, isPublished: true },
          isPreview: true,
          isPublished: true,
          deletedAt: null,
        },
        select: {
          id: true,
          transcriptFr: true,
          transcriptAr: true,
          transcriptEn: true,
          transcriptEs: true,
          translations: { where: translationFilter, select: { locale: true, content: true } },
        },
      }),
      db.review.findMany({
        where: { courseId: course.id, status: 'APPROVED' },
        orderBy: [{ createdAt: 'desc' }],
        take: REVIEW_LIMIT,
        select: {
          id: true,
          rating: true,
          comment: true,
          adminReply: true,
          createdAt: true,
          user: { select: { fullName: true, avatarKey: true } },
        },
      }),
      db.review.groupBy({
        by: ['rating'],
        where: { courseId: course.id, status: 'APPROVED' },
        _count: { _all: true },
      }),
      db.faqItem.findMany({
        where: {
          isPublished: true,
          category: {
            in: course.certificateEnabled
              ? [...COURSE_FAQ_CATEGORIES, CERTIFICATE_FAQ_CATEGORY]
              : [...COURSE_FAQ_CATEGORIES],
          },
        },
        orderBy: [{ category: 'asc' }, { order: 'asc' }],
        take: COURSE_FAQ_LIMIT,
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
      course.instructorId === null
        ? Promise.resolve(null)
        : db.course.aggregate({
            where: { instructorId: course.instructorId, status: 'PUBLISHED', deletedAt: null },
            _count: { _all: true },
            _sum: { enrollmentCount: true },
          }),
      course.categoryId === null
        ? Promise.resolve([])
        : db.course.findMany({
            where: {
              categoryId: course.categoryId,
              status: 'PUBLISHED',
              deletedAt: null,
              id: { not: course.id },
            },
            orderBy: [{ enrollmentCount: 'desc' }, { ratingAvg: 'desc' }, { publishedAt: 'desc' }],
            take: SIMILAR_LIMIT,
            select: {
              slug: true,
              coverKey: true,
              priceCentimes: true,
              comparePriceCentimes: true,
              durationMinutes: true,
              lessonCount: true,
              ratingAvg: true,
              ratingCount: true,
              level: true,
              translations: { where: translationFilter, select: { locale: true, title: true } },
            },
          }),
    ]);

  /* ── Preview bodies ───────────────────────────────────────────────────── */

  const previews = new Map<string, LessonPreviewBody>();
  for (const row of previewRows) {
    const content = nonEmpty(pickTranslation(row.translations, locale)?.content);
    if (content !== null) {
      previews.set(row.id, { kind: 'content', body: content });
      continue;
    }
    const transcript = transcriptFor(locale, row);
    if (transcript !== null) previews.set(row.id, { kind: 'transcript', body: transcript });
  }

  /* ── Modules ──────────────────────────────────────────────────────────── */

  const modules: CourseModule[] = [];
  for (const courseModule of course.modules) {
    const moduleText = pickTranslation(courseModule.translations, locale);
    if (moduleText === undefined) continue;

    const lessons: CourseLesson[] = [];
    let durationMinutes = 0;

    for (const lesson of courseModule.lessons) {
      const lessonText = pickTranslation(lesson.translations, locale);
      if (lessonText === undefined) continue;

      durationMinutes += lesson.estimatedMinutes;
      lessons.push({
        id: lesson.id,
        order: lesson.order,
        type: lesson.type,
        title: lessonText.title,
        estimatedMinutes: lesson.estimatedMinutes,
        preview: lesson.isPreview ? (previews.get(lesson.id) ?? null) : null,
      });
    }

    modules.push({
      id: courseModule.id,
      order: courseModule.order,
      title: moduleText.title,
      summary: nonEmpty(moduleText.summary),
      durationMinutes,
      lessons,
    });
  }

  const previewCount = modules.reduce(
    (total, entry) => total + entry.lessons.filter((lesson) => lesson.preview !== null).length,
    0,
  );

  /* ── Reviews ──────────────────────────────────────────────────────────── */

  const counts = new Map<number, number>();
  let total = 0;
  let weighted = 0;
  for (const row of distributionRows) {
    const count = row._count._all;
    counts.set(row.rating, count);
    total += count;
    weighted += row.rating * count;
  }

  const distribution: RatingBucket[] = ([5, 4, 3, 2, 1] as const).map((stars) => ({
    stars,
    count: counts.get(stars) ?? 0,
  }));

  /* ── Prerequisites ────────────────────────────────────────────────────── */

  const prerequisites: CoursePrerequisiteRef[] = [];
  for (const link of course.requirements) {
    const required = link.required;
    if (required.status !== 'PUBLISHED' || required.deletedAt !== null) continue;
    const requiredText = pickTranslation(required.translations, locale);
    if (requiredText === undefined) continue;
    prerequisites.push({ slug: required.slug, title: requiredText.title, isStrict: link.isStrict });
  }

  /* ── FAQ ──────────────────────────────────────────────────────────────── */

  const faqFields = faqFieldsFor(locale);
  const faq: CourseFaqEntry[] = faqRows.map((row) => ({
    id: row.id,
    question: faqFields.question(row) ?? row.questionFr,
    answer: faqFields.answer(row) ?? row.answerFr,
  }));

  /* ── Similar courses ──────────────────────────────────────────────────── */

  const similar: SimilarCourse[] = [];
  for (const row of similarRows) {
    const similarText = pickTranslation(row.translations, locale);
    if (similarText === undefined) continue;
    similar.push({
      slug: row.slug,
      title: similarText.title,
      coverUrl: resolveMediaUrl(row.coverKey),
      priceCentimes: row.priceCentimes,
      comparePriceCentimes: row.comparePriceCentimes,
      durationMinutes: row.durationMinutes,
      lessonCount: row.lessonCount,
      ratingAvg: row.ratingAvg,
      ratingCount: row.ratingCount,
      level: row.level,
    });
  }

  /* ── Instructor ───────────────────────────────────────────────────────── */

  const instructorRow = course.instructor;
  const instructor: CourseInstructor | null =
    instructorRow === null || instructorRow.deletedAt !== null
      ? null
      : {
          id: instructorRow.id,
          fullName: instructorRow.fullName,
          headline: nonEmpty(instructorRow.headline),
          bio: nonEmpty(instructorRow.bio),
          avatarUrl: resolveMediaUrl(instructorRow.avatarKey),
          courseCount: instructorStats?._count._all ?? 0,
          studentCount: instructorStats?._sum.enrollmentCount ?? 0,
        };

  /* ── Category ─────────────────────────────────────────────────────────── */

  const categoryRow = course.category;
  const categoryName =
    categoryRow === null ? null : nonEmpty(pickTranslation(categoryRow.translations, locale)?.name);

  return {
    id: course.id,
    slug: course.slug,

    title: text.title,
    subtitle: nonEmpty(text.subtitle),
    description: text.description,
    objectives: asStringArray(text.objectives),
    targetAudience: asStringArray(text.targetAudience),
    requirementsText: asStringArray(text.requirementsText),
    seoTitle: nonEmpty(text.seoTitle),
    seoDescription: nonEmpty(text.seoDescription),

    level: course.level,
    deliveryMode: course.deliveryMode,
    contentLocale: course.contentLocale,

    priceCentimes: course.priceCentimes,
    comparePriceCentimes: course.comparePriceCentimes,
    installmentsAllowed: course.installmentsAllowed,
    installmentCount: course.installmentCount,

    coverUrl: resolveMediaUrl(course.coverKey),
    durationMinutes: course.durationMinutes,
    lessonCount: course.lessonCount,
    certificateEnabled: course.certificateEnabled,
    passingScore: course.passingScore,
    accessDurationDays: course.accessDurationDays,
    maxSeats: course.maxSeats,
    seatsTaken: course.seatsTaken,
    seatsLeft: course.maxSeats === null ? null : Math.max(0, course.maxSeats - course.seatsTaken),

    ratingAvg: course.ratingAvg,
    ratingCount: course.ratingCount,
    enrollmentCount: course.enrollmentCount,

    publishedAt: course.publishedAt,
    updatedAt: course.updatedAt,

    category:
      categoryRow === null || categoryName === null
        ? null
        : { slug: categoryRow.slug, name: categoryName },
    instructor,
    modules,
    resources: course.resources
      .filter((resource) => resource.isDownloadable)
      .map((resource) => ({
        id: resource.id,
        title: resource.title,
        mimeType: resource.mimeType,
        sizeBytes: resource.sizeBytes,
      })),
    prerequisites,
    reviews: {
      items: reviewRows.map((row) => ({
        id: row.id,
        rating: row.rating,
        comment: nonEmpty(row.comment),
        adminReply: nonEmpty(row.adminReply),
        authorName: row.user.fullName,
        avatarUrl: resolveMediaUrl(row.user.avatarKey),
        createdAt: row.createdAt,
      })),
      distribution,
      average: total === 0 ? 0 : weighted / total,
      total,
    },
    faq,
    similar,
    previewCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Viewer-scoped read                                                          */
/* -------------------------------------------------------------------------- */

const viewerStateSchema = z
  .object({ userId: z.string().min(1).max(64), courseId: z.string().min(1).max(64) })
  .strict();

/**
 * What this visitor already has on this course: their enrolment, and their most
 * recent request.
 *
 * `userId` must come from the session — never from the URL. The caller in
 * `page.tsx` passes `getCurrentUser()?.id`, which is the only identity the
 * server trusts, so no additional authorization check is possible or needed
 * here: the query is scoped to the caller's own rows by construction.
 */
export async function getViewerCourseState(input: {
  userId: string;
  courseId: string;
}): Promise<ViewerCourseState> {
  const { userId, courseId } = viewerStateSchema.parse(input);

  const [enrollmentRow, requestRow] = await Promise.all([
    db.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: {
        status: true,
        lastLessonId: true,
        expiresAt: true,
        completedAt: true,
        certificate: { select: { verifyCode: true, revokedAt: true } },
      },
    }),
    db.enrollmentRequest.findFirst({
      where: { userId, courseId },
      orderBy: { createdAt: 'desc' },
      select: { reference: true, status: true },
    }),
  ]);

  return {
    enrollment:
      enrollmentRow === null
        ? null
        : {
            status: enrollmentRow.status,
            lastLessonId: enrollmentRow.lastLessonId,
            expiresAt: enrollmentRow.expiresAt,
            completedAt: enrollmentRow.completedAt,
            certificateCode:
              enrollmentRow.certificate === null || enrollmentRow.certificate.revokedAt !== null
                ? null
                : enrollmentRow.certificate.verifyCode,
          },
    request: requestRow === null ? null : { reference: requestRow.reference, status: requestRow.status },
  };
}

/* -------------------------------------------------------------------------- */
/* Build-time slugs                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Slugs of every published course, for `generateStaticParams`.
 *
 * Returns `[]` rather than throwing when the database is unreachable: a build
 * that cannot reach MySQL must still produce a deployable artefact, and the
 * route renders on demand (`dynamicParams` stays on).
 */
export async function listPublishedCourseSlugs(): Promise<readonly string[]> {
  try {
    const rows = await db.course.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      orderBy: { publishedAt: 'desc' },
      select: { slug: true },
    });
    return rows.map((row) => row.slug);
  } catch (cause) {
    console.warn('[course-detail] slugs indisponibles au build :', cause);
    return [];
  }
}
