/**
 * The course catalogue, as an administrator operates it (spec §17.5).
 *
 * This file is the whole domain behind `/admin/formations`: the list read model,
 * the editor read model, the publication checklist, and every mutation the two
 * screens can perform. `src/server/actions/admin-courses.ts` authorises and
 * reshapes; it never writes a row itself.
 *
 * ## Authorisation happens before the first column is read
 * Every exported function takes the acting user and clears `can(actor,
 * 'course.author', …)` before touching Prisma (§20). Single-course entry points
 * resolve the course's `instructorId` first and pass it as the resource scope,
 * so §8's "own courses" cell for `INSTRUCTOR` is honoured rather than assumed
 * away by the admin-only page guard sitting above.
 *
 * ## Money crosses the boundary once
 * Everything here is integer centimes. Dirhams exist only in the form the
 * administrator types into, and {@link parseDirhams} is the single place that
 * converts — nothing downstream ever sees a float.
 *
 * ## Ordering is a swap, not a drag payload
 * `Module` and `Lesson` both carry `@@unique([parent, order])`, so two rows can
 * never share a position — which also means a naive "set A to B's order" update
 * violates the constraint halfway through. {@link moveModule} and
 * {@link moveLesson} park the moving row on a negative sentinel, move its
 * neighbour into the vacated slot, then land it. Deleting renumbers upward from
 * the gap, ascending, so every target slot is free by the time it is written.
 * The interface exposes this as up/down buttons: a drag handle that is the only
 * way to reorder a curriculum is a curriculum a keyboard user cannot edit.
 *
 * ## Publishing is gated, never silently refused
 * {@link publishChecklist} is a pure function over facts the editor already
 * loaded. `setCourseStatus` re-computes it inside the transaction from the
 * committed rows — the screen may be sixty seconds stale — and refuses with the
 * list of what is missing rather than with a shrug.
 */

import { z } from 'zod';
import type {
  CourseLevel,
  CourseStatus,
  DeliveryMode,
  LessonType,
  Locale as DbLocale,
  Prisma,
} from '@prisma/client';

import { db, transaction } from '@/server/db';
import {
  COURSE_STATUS_VALUES,
  COURSE_LEVEL_VALUES,
  DELIVERY_MODE_VALUES,
  LESSON_TYPE_VALUES,
} from '@/lib/course-enums';
import { env } from '@/lib/env';
import { ActionError } from '@/server/auth/guards';
import { can, type PermissionUser } from '@/server/auth/permissions';
import { buildDiff, recordAudit } from '@/server/services/audit';
import { MAX_SLUG_LENGTH, isSlug, slugify } from '@/lib/slug';
import { locales, type Locale } from '@/i18n/routing';

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                               */
/* -------------------------------------------------------------------------- */

export type QueryResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: 'FORBIDDEN' | 'INVALID' | 'NOT_FOUND' };

const FORBIDDEN = { ok: false, code: 'FORBIDDEN' } as const;
const INVALID = { ok: false, code: 'INVALID' } as const;
const NOT_FOUND = { ok: false, code: 'NOT_FOUND' } as const;

/**
 * Re-exported, not declared here.
 *
 * The editor's « Niveau » and « Mode » selects enumerate these arrays at
 * runtime, and importing them from this module dragged Prisma into the client
 * bundle — `tsc` and ESLint both passed, and only `next build` failed. They now
 * live in `@/lib/course-enums`, which the browser may import; the Zod schemas
 * below keep using them exactly as before.
 */
export { COURSE_STATUS_VALUES, COURSE_LEVEL_VALUES, DELIVERY_MODE_VALUES, LESSON_TYPE_VALUES };

/**
 * The three statuses this screen can move a course between (§17.5).
 *
 * `REVIEW` and `SCHEDULED` exist in the enum and are rendered wherever they
 * occur, but nothing here produces them: an editorial workflow and a publish-at
 * date are separate features, and a button that sets a state no other screen
 * understands is worse than no button.
 */
export const COURSE_TRANSITION_TARGETS = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type CourseTransitionTarget = (typeof COURSE_TRANSITION_TARGETS)[number];

export const COURSE_PAGE_SIZE_DEFAULT = 25;
export const COURSE_PAGE_SIZE_MAX = 100;

export const COURSE_SORT_FIELDS = [
  'updatedAt',
  'title',
  'priceCentimes',
  'enrollmentCount',
  'ratingAvg',
] as const;
export type CourseSortField = (typeof COURSE_SORT_FIELDS)[number];

/** How long an editor's save takes to reach the public catalogue (§17.5). */
export const PUBLIC_CACHE_SECONDS = 60;

const courseIdSchema = z.string().min(1).max(64);

/* -------------------------------------------------------------------------- */
/* Text limits — the columns are TEXT, the forms are not                       */
/* -------------------------------------------------------------------------- */

export const COURSE_TITLE_MAX = 160;
export const COURSE_SUBTITLE_MAX = 300;
export const COURSE_DESCRIPTION_MAX = 20_000;
export const MODULE_TITLE_MAX = 160;
export const MODULE_SUMMARY_MAX = 2_000;
export const LESSON_TITLE_MAX = 160;
/** Ten million dirhams in centimes: above any real course, far below overflow. */
export const PRICE_MAX_CENTIMES = 1_000_000_000;
export const LESSON_MINUTES_MAX = 24 * 60;
export const SEATS_MAX = 100_000;

/* -------------------------------------------------------------------------- */
/* Money at the boundary                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Turn what an administrator typed — `1 200`, `1200,50`, `1,200.50` — into
 * integer centimes, or `null` when it is not a price.
 *
 * `lib/money.ts` owns `toCentimes`; this wrapper adds the one thing a form
 * needs on top of it: an empty field is a legitimate "no value" for
 * `comparePriceCentimes`, not a zero.
 */
export function parseDirhams(input: string): number | null {
  const cleaned = input.replace(/[\s  ]/gu, '').replace(/,/gu, '.');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{1,2})?$/u.test(cleaned)) return null;
  const centimes = Math.round(Number(cleaned) * 100);
  if (!Number.isSafeInteger(centimes) || centimes < 0 || centimes > PRICE_MAX_CENTIMES) return null;
  return centimes;
}

/* -------------------------------------------------------------------------- */
/* Media                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `coverKey` is an object key in the bucket; the public base URL is optional in
 * `.env` (§3), so a deployment without a CDN yields `null` and the row falls
 * back to its initials rather than to a broken image.
 */
function coverUrl(key: string | null): string | null {
  if (key === null || key.length === 0) return null;
  const base = env.S3_PUBLIC_BASE_URL;
  if (typeof base !== 'string' || base.length === 0) return null;
  return `${base.replace(/\/+$/u, '')}/${key.replace(/^\/+/u, '')}`;
}

/* -------------------------------------------------------------------------- */
/* The list (§17.5 « List »)                                                   */
/* -------------------------------------------------------------------------- */

export interface AdminCourseRow {
  readonly id: string;
  readonly slug: string;
  /** French title — the administration works in French (§17). */
  readonly title: string;
  readonly categoryName: string | null;
  readonly instructorName: string | null;
  readonly status: CourseStatus;
  readonly coverUrl: string | null;
  readonly priceCentimes: number;
  readonly comparePriceCentimes: number | null;
  readonly lessonCount: number;
  readonly durationMinutes: number;
  readonly enrollmentCount: number;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly updatedAt: Date;
}

export interface AdminCourseListResult {
  readonly rows: readonly AdminCourseRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
}

const listCoursesSchema = z
  .object({
    status: z.enum(COURSE_STATUS_VALUES).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    categoryId: z.string().min(1).max(64).optional(),
    page: z.number().int().min(1).max(100_000).default(1),
    pageSize: z.number().int().min(5).max(COURSE_PAGE_SIZE_MAX).default(COURSE_PAGE_SIZE_DEFAULT),
    sortBy: z.enum(COURSE_SORT_FIELDS).default('updatedAt'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export type ListCoursesInput = z.input<typeof listCoursesSchema>;

/**
 * One page of the catalogue, ordered by whatever the URL asked for.
 *
 * Sorting by `title` sorts by the **French** translation, which is the column
 * the table actually renders; Prisma expresses that as a relation order, and
 * the `[courseId, locale]` unique index keeps it cheap.
 */
export async function listAdminCourses(
  input: ListCoursesInput,
  actor: PermissionUser | null,
): Promise<QueryResult<AdminCourseListResult>> {
  if (!can(actor, 'course.author')) return FORBIDDEN;

  const parsed = listCoursesSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const filters = parsed.data;

  const where = buildCourseWhere(filters);

  const total = await db.course.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
  const page = Math.min(filters.page, pageCount);

  const rows = await db.course.findMany({
    where,
    orderBy: courseOrderBy(filters.sortBy, filters.sortDir),
    skip: (page - 1) * filters.pageSize,
    take: filters.pageSize,
    select: {
      id: true,
      slug: true,
      status: true,
      coverKey: true,
      priceCentimes: true,
      comparePriceCentimes: true,
      lessonCount: true,
      durationMinutes: true,
      enrollmentCount: true,
      ratingAvg: true,
      ratingCount: true,
      updatedAt: true,
      instructor: { select: { fullName: true } },
      category: { select: { translations: { where: { locale: 'fr' }, select: { name: true } } } },
      translations: { where: { locale: 'fr' }, select: { title: true } },
    },
  });

  return {
    ok: true,
    data: {
      rows: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.translations[0]?.title ?? row.slug,
        categoryName: row.category?.translations[0]?.name ?? null,
        instructorName: row.instructor?.fullName ?? null,
        status: row.status,
        coverUrl: coverUrl(row.coverKey),
        priceCentimes: row.priceCentimes,
        comparePriceCentimes: row.comparePriceCentimes,
        lessonCount: row.lessonCount,
        durationMinutes: row.durationMinutes,
        enrollmentCount: row.enrollmentCount,
        ratingAvg: row.ratingAvg,
        ratingCount: row.ratingCount,
        updatedAt: row.updatedAt,
      })),
      total,
      page,
      pageSize: filters.pageSize,
      pageCount,
    },
  };
}

function buildCourseWhere(filters: z.output<typeof listCoursesSchema>): Prisma.CourseWhereInput {
  const and: Prisma.CourseWhereInput[] = [{ deletedAt: null }];

  if (filters.status !== undefined) and.push({ status: filters.status });
  if (filters.categoryId !== undefined) and.push({ categoryId: filters.categoryId });

  if (filters.search !== undefined) {
    // `slug` and the French title are what an administrator remembers. The
    // description is deliberately excluded: `LIKE '%…%'` over TEXT is a table
    // scan for a payoff nobody asked for.
    and.push({
      OR: [
        { slug: { contains: filters.search } },
        { translations: { some: { title: { contains: filters.search } } } },
      ],
    });
  }

  return { AND: and };
}

/**
 * Ordering, with one deliberate approximation.
 *
 * « Titre » sorts by `slug`, not by `CourseTranslation.title`: Prisma cannot
 * order a `findMany` by a field of a to-many relation, and the alternatives are
 * a raw join or sorting a page in memory — the second of which produces a table
 * whose page 2 is not the continuation of page 1. Every slug in this catalogue
 * is generated from its French title, so the two orders agree to within the
 * accents `slugify` strips, and the column stays honest about being alphabetical.
 */
function courseOrderBy(
  sortBy: CourseSortField,
  sortDir: 'asc' | 'desc',
): Prisma.CourseOrderByWithRelationInput[] {
  // A stable secondary key: two courses updated in the same second must not
  // swap places between two page loads and hide a row across the boundary.
  const tail: Prisma.CourseOrderByWithRelationInput = { id: 'asc' };

  switch (sortBy) {
    case 'title':
      return [{ slug: sortDir }, tail];
    case 'priceCentimes':
      return [{ priceCentimes: sortDir }, tail];
    case 'enrollmentCount':
      return [{ enrollmentCount: sortDir }, tail];
    case 'ratingAvg':
      return [{ ratingAvg: sortDir }, tail];
    case 'updatedAt':
      return [{ updatedAt: sortDir }, tail];
  }
}

/** How many courses sit behind each status tab, plus the total. */
export type CourseStatusCounts = Readonly<Record<CourseStatus | 'ALL', number>>;

export async function adminCourseCounts(
  actor: PermissionUser | null,
): Promise<QueryResult<CourseStatusCounts>> {
  if (!can(actor, 'course.author')) return FORBIDDEN;

  const grouped = await db.course.groupBy({
    by: ['status'],
    where: { deletedAt: null },
    _count: { _all: true },
  });

  const counts: Record<CourseStatus | 'ALL', number> = {
    DRAFT: 0,
    REVIEW: 0,
    PUBLISHED: 0,
    SCHEDULED: 0,
    ARCHIVED: 0,
    ALL: 0,
  };

  for (const entry of grouped) {
    counts[entry.status] = entry._count._all;
    counts.ALL += entry._count._all;
  }

  return { ok: true, data: counts };
}

export interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

/** The category vocabulary, in French, for the list filter and the editor. */
export async function listCategoryOptions(
  actor: PermissionUser | null,
): Promise<QueryResult<readonly CategoryOption[]>> {
  if (!can(actor, 'course.author')) return FORBIDDEN;

  const rows = await db.category.findMany({
    where: { isActive: true },
    orderBy: [{ order: 'asc' }, { slug: 'asc' }],
    select: { id: true, slug: true, translations: { where: { locale: 'fr' }, select: { name: true } } },
  });

  return {
    ok: true,
    data: rows.map((row) => ({ id: row.id, name: row.translations[0]?.name ?? row.slug })),
  };
}

/* -------------------------------------------------------------------------- */
/* The editor read model (§17.5 « Course editor »)                             */
/* -------------------------------------------------------------------------- */

export interface CourseTranslationView {
  readonly locale: Locale;
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  /** `0`–`3`: how many of title, subtitle and description this locale has. */
  readonly filled: number;
}

export interface AdminLessonView {
  readonly id: string;
  readonly order: number;
  readonly type: LessonType;
  readonly isPreview: boolean;
  readonly isPublished: boolean;
  readonly isMandatory: boolean;
  readonly estimatedMinutes: number;
  readonly titles: Readonly<Record<Locale, string>>;
}

export interface AdminModuleView {
  readonly id: string;
  readonly order: number;
  readonly isPublished: boolean;
  readonly titles: Readonly<Record<Locale, string>>;
  readonly summaryFr: string;
  readonly lessons: readonly AdminLessonView[];
}

export interface AdminCourseDetail {
  readonly id: string;
  readonly slug: string;
  readonly status: CourseStatus;
  readonly level: CourseLevel;
  readonly deliveryMode: DeliveryMode;
  readonly contentLocale: Locale;
  readonly categoryId: string | null;
  readonly coverKey: string | null;
  readonly coverUrl: string | null;
  readonly priceCentimes: number;
  readonly comparePriceCentimes: number | null;
  readonly maxSeats: number | null;
  readonly seatsTaken: number;
  readonly enrollmentCount: number;
  /** Enrollments that are still live — what an archive warns about. */
  readonly activeEnrollments: number;
  readonly lessonCount: number;
  readonly durationMinutes: number;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
  readonly translations: readonly CourseTranslationView[];
  readonly modules: readonly AdminModuleView[];
  readonly checklist: PublishChecklist;
  /** `true` only while `DRAFT` — a published slug is a public URL (§10.1). */
  readonly slugEditable: boolean;
}

const EMPTY_TITLES: Readonly<Record<Locale, string>> = { fr: '', ar: '', en: '', es: '' };

function titlesFrom(rows: readonly { locale: DbLocale; title: string }[]): Record<Locale, string> {
  const titles: Record<Locale, string> = { ...EMPTY_TITLES };
  for (const row of rows) titles[row.locale] = row.title;
  return titles;
}

/**
 * Everything the editor renders, in one round trip.
 *
 * The whole curriculum comes back rather than a page of it: a course is fifty
 * lessons at the outside, and reorder buttons that only see one page of
 * neighbours cannot be made correct.
 */
export async function getAdminCourse(
  courseId: string,
  actor: PermissionUser | null,
): Promise<QueryResult<AdminCourseDetail>> {
  if (!courseIdSchema.safeParse(courseId).success) return INVALID;
  // Cheapest possible read first: the ownership fact the capability needs.
  const scope = await db.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { instructorId: true },
  });
  if (scope === null) return NOT_FOUND;
  if (!can(actor, 'course.author', { instructorId: scope.instructorId })) return FORBIDDEN;

  const row = await db.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: {
      id: true,
      slug: true,
      status: true,
      level: true,
      deliveryMode: true,
      contentLocale: true,
      categoryId: true,
      coverKey: true,
      priceCentimes: true,
      comparePriceCentimes: true,
      maxSeats: true,
      seatsTaken: true,
      enrollmentCount: true,
      lessonCount: true,
      durationMinutes: true,
      updatedAt: true,
      publishedAt: true,
      translations: {
        select: { locale: true, title: true, subtitle: true, description: true },
      },
      modules: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          order: true,
          isPublished: true,
          translations: { select: { locale: true, title: true, summary: true } },
          lessons: {
            where: { deletedAt: null },
            orderBy: { order: 'asc' },
            select: {
              id: true,
              order: true,
              type: true,
              isPreview: true,
              isPublished: true,
              isMandatory: true,
              estimatedMinutes: true,
              translations: { select: { locale: true, title: true } },
            },
          },
        },
      },
    },
  });
  if (row === null) return NOT_FOUND;

  const activeEnrollments = await db.enrollment.count({
    where: { courseId, status: 'ACTIVE' },
  });

  const translations = locales.map<CourseTranslationView>((locale) => {
    const found = row.translations.find((entry) => entry.locale === locale);
    const title = found?.title ?? '';
    const subtitle = found?.subtitle ?? '';
    const description = found?.description ?? '';
    return {
      locale,
      title,
      subtitle,
      description,
      filled: [title, subtitle, description].filter((value) => value.trim() !== '').length,
    };
  });

  const modules = row.modules.map<AdminModuleView>((courseModule) => ({
    id: courseModule.id,
    order: courseModule.order,
    isPublished: courseModule.isPublished,
    titles: titlesFrom(courseModule.translations),
    summaryFr: courseModule.translations.find((entry) => entry.locale === 'fr')?.summary ?? '',
    lessons: courseModule.lessons.map<AdminLessonView>((lesson) => ({
      id: lesson.id,
      order: lesson.order,
      type: lesson.type,
      isPreview: lesson.isPreview,
      isPublished: lesson.isPublished,
      isMandatory: lesson.isMandatory,
      estimatedMinutes: lesson.estimatedMinutes,
      titles: titlesFrom(lesson.translations),
    })),
  }));

  const french = translations.find((entry) => entry.locale === 'fr');

  return {
    ok: true,
    data: {
      id: row.id,
      slug: row.slug,
      status: row.status,
      level: row.level,
      deliveryMode: row.deliveryMode,
      contentLocale: row.contentLocale,
      categoryId: row.categoryId,
      coverKey: row.coverKey,
      coverUrl: coverUrl(row.coverKey),
      priceCentimes: row.priceCentimes,
      comparePriceCentimes: row.comparePriceCentimes,
      maxSeats: row.maxSeats,
      seatsTaken: row.seatsTaken,
      enrollmentCount: row.enrollmentCount,
      activeEnrollments,
      lessonCount: row.lessonCount,
      durationMinutes: row.durationMinutes,
      updatedAt: row.updatedAt,
      publishedAt: row.publishedAt,
      translations,
      modules,
      checklist: publishChecklist({
        hasCategory: row.categoryId !== null,
        hasCover: row.coverKey !== null && row.coverKey !== '',
        moduleCount: modules.length,
        lessonCount: modules.reduce((sum, courseModule) => sum + courseModule.lessons.length, 0),
        previewCount: modules.reduce(
          (sum, courseModule) => sum + courseModule.lessons.filter((lesson) => lesson.isPreview).length,
          0,
        ),
        frenchFilled: french?.filled ?? 0,
      }),
      slugEditable: row.status === 'DRAFT',
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The publication checklist (§17.5)                                           */
/* -------------------------------------------------------------------------- */

/**
 * One condition per requirement, in the order the interface lists them. The
 * union is exhaustive on purpose: a new condition breaks the label map in
 * `formations/course-view.ts` until it is given words.
 */
export const CHECKLIST_KEYS = [
  'frenchTranslation',
  'category',
  'cover',
  'module',
  'lesson',
  'preview',
] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

export interface ChecklistItem {
  readonly key: ChecklistKey;
  readonly done: boolean;
}

export interface PublishChecklist {
  readonly items: readonly ChecklistItem[];
  readonly missing: readonly ChecklistKey[];
  readonly done: number;
  readonly total: number;
  readonly ready: boolean;
}

export interface ChecklistFacts {
  readonly hasCategory: boolean;
  readonly hasCover: boolean;
  readonly moduleCount: number;
  readonly lessonCount: number;
  readonly previewCount: number;
  /** How many of title, subtitle and description the French translation has. */
  readonly frenchFilled: number;
}

/** Pure, synchronous, and unit-testable without a database. */
export function publishChecklist(facts: ChecklistFacts): PublishChecklist {
  const items: readonly ChecklistItem[] = [
    { key: 'frenchTranslation', done: facts.frenchFilled === 3 },
    { key: 'category', done: facts.hasCategory },
    { key: 'cover', done: facts.hasCover },
    { key: 'module', done: facts.moduleCount >= 1 },
    { key: 'lesson', done: facts.lessonCount >= 1 },
    { key: 'preview', done: facts.previewCount >= 1 },
  ];

  const missing = items.filter((item) => !item.done).map((item) => item.key);

  return {
    items,
    missing,
    done: items.length - missing.length,
    total: items.length,
    ready: missing.length === 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Mutations — shared plumbing                                                 */
/* -------------------------------------------------------------------------- */

export interface ActorContext {
  readonly actor: PermissionUser;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly now?: Date;
}

/** A Prisma client or an interactive-transaction client. */
type TxClient = Prisma.TransactionClient;

/**
 * Load a course for writing and prove the actor may write it.
 *
 * Called as the first statement inside every mutation's transaction, so the
 * capability decision and the write see the same snapshot.
 */
async function requireAuthoredCourse(
  tx: TxClient,
  courseId: string,
  actor: PermissionUser,
): Promise<{ id: string; slug: string; status: CourseStatus; instructorId: string | null }> {
  const course = await tx.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true, slug: true, status: true, instructorId: true },
  });
  if (course === null) throw new ActionError('not_found', 'admin.actionError.notFound');
  if (!can(actor, 'course.author', { instructorId: course.instructorId })) {
    throw new ActionError('forbidden', 'admin.actionError.forbidden');
  }
  return course;
}

/** The French title, for an audit summary a human can read six months later. */
async function frenchTitle(tx: TxClient, courseId: string, fallback: string): Promise<string> {
  const row = await tx.courseTranslation.findUnique({
    where: { courseId_locale: { courseId, locale: 'fr' } },
    select: { title: true },
  });
  return row?.title ?? fallback;
}

/**
 * Recompute the two derived columns the public catalogue renders.
 *
 * `lessonCount` and `durationMinutes` are denormalised on `Course` (§4), which
 * means every curriculum write owes them an update inside the same transaction
 * — otherwise the card says « 23 leçons » about a course that has 24.
 */
async function recomputeCourseTotals(tx: TxClient, courseId: string): Promise<void> {
  const aggregate = await tx.lesson.aggregate({
    where: { module: { courseId }, deletedAt: null },
    _count: { _all: true },
    _sum: { estimatedMinutes: true },
  });

  await tx.course.update({
    where: { id: courseId },
    data: {
      lessonCount: aggregate._count._all,
      durationMinutes: aggregate._sum.estimatedMinutes ?? 0,
    },
  });
}

/** Facts the checklist needs, read from committed rows rather than the form. */
async function checklistFactsFor(tx: TxClient, courseId: string): Promise<ChecklistFacts> {
  const [course, french, moduleCount, lessonCount, previewCount] = await Promise.all([
    tx.course.findUnique({ where: { id: courseId }, select: { categoryId: true, coverKey: true } }),
    tx.courseTranslation.findUnique({
      where: { courseId_locale: { courseId, locale: 'fr' } },
      select: { title: true, subtitle: true, description: true },
    }),
    tx.module.count({ where: { courseId } }),
    tx.lesson.count({ where: { module: { courseId }, deletedAt: null } }),
    tx.lesson.count({ where: { module: { courseId }, deletedAt: null, isPreview: true } }),
  ]);

  const filled = [french?.title ?? '', french?.subtitle ?? '', french?.description ?? ''].filter(
    (value) => value.trim() !== '',
  ).length;

  return {
    hasCategory: course?.categoryId !== null && course?.categoryId !== undefined,
    hasCover: course?.coverKey !== null && course?.coverKey !== undefined && course.coverKey !== '',
    moduleCount,
    lessonCount,
    previewCount,
    frenchFilled: filled,
  };
}

/** What every mutation gives the interface back. */
export interface MutationOutcome {
  readonly courseId: string;
  /** `false` when the write was a no-op — a double-clicked button, not an error. */
  readonly changed: boolean;
}

/* -------------------------------------------------------------------------- */
/* Creation — « Nouvelle formation »                                           */
/* -------------------------------------------------------------------------- */

export const createCourseSchema = z
  .object({ title: z.string().trim().min(3).max(COURSE_TITLE_MAX) })
  .strict();

/**
 * Open a new course, with a title and nothing else.
 *
 * Deliberately the smallest possible row: a `DRAFT`, free, uncategorised course
 * whose French translation holds only the title. Everything the catalogue needs
 * is then missing, the publication checklist says exactly which parts, and the
 * author fills them in the editor instead of in a ten-field creation form they
 * would have to guess their way through.
 *
 * The slug is derived from the title and de-duplicated with a numeric suffix,
 * so two « Excel » courses do not race each other into a unique-constraint
 * error the author cannot act on.
 */
export async function createCourse(
  input: z.output<typeof createCourseSchema>,
  ctx: ActorContext,
): Promise<{ readonly courseId: string; readonly slug: string }> {
  if (!can(ctx.actor, 'course.author', { ownerId: ctx.actor.id })) {
    throw new ActionError('forbidden', 'admin.actionError.forbidden');
  }

  return transaction(async (tx) => {
    const base = slugify(input.title);
    if (!isSlug(base)) {
      throw new ActionError('validation', 'admin.actionError.validation', {
        title: ['admin.actionError.validation'],
      });
    }

    const neighbours = await tx.course.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    const taken = new Set(neighbours.map((row) => row.slug));

    let slug = base;
    for (let suffix = 2; taken.has(slug) && suffix < 1_000; suffix += 1) {
      slug = `${base.slice(0, MAX_SLUG_LENGTH - 5)}-${suffix}`;
    }
    if (taken.has(slug)) throw new ActionError('conflict', 'admin.actionError.conflict');

    const course = await tx.course.create({
      data: {
        slug,
        status: 'DRAFT',
        priceCentimes: 0,
        translations: {
          create: {
            locale: 'fr',
            title: input.title,
            description: '',
            objectives: [],
            targetAudience: [],
            requirementsText: [],
            isComplete: false,
          },
        },
      },
      select: { id: true },
    });

    await recordAudit(
      {
        actorId: ctx.actor.id,
        action: 'COURSE_CREATED',
        entityType: 'Course',
        entityId: course.id,
        summary: `Formation « ${input.title} » créée en brouillon.`,
        diff: buildDiff({}, { slug, status: 'DRAFT', title: input.title }),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return { courseId: course.id, slug };
  });
}

/* -------------------------------------------------------------------------- */
/* Infos tab                                                                   */
/* -------------------------------------------------------------------------- */

const translationInputSchema = z
  .object({
    locale: z.enum(locales),
    title: z.string().trim().max(COURSE_TITLE_MAX),
    subtitle: z.string().trim().max(COURSE_SUBTITLE_MAX),
    description: z.string().trim().max(COURSE_DESCRIPTION_MAX),
  })
  .strict();

export const updateCourseInfoSchema = z
  .object({
    courseId: courseIdSchema,
    /** Omitted when the course is not a draft; the service refuses it there anyway. */
    slug: z.string().trim().min(3).max(MAX_SLUG_LENGTH).optional(),
    categoryId: z.string().min(1).max(64).nullable(),
    level: z.enum(COURSE_LEVEL_VALUES),
    deliveryMode: z.enum(DELIVERY_MODE_VALUES),
    contentLocale: z.enum(locales),
    priceCentimes: z.number().int().min(0).max(PRICE_MAX_CENTIMES),
    comparePriceCentimes: z.number().int().min(0).max(PRICE_MAX_CENTIMES).nullable(),
    maxSeats: z.number().int().min(1).max(SEATS_MAX).nullable(),
    coverKey: z.string().trim().max(512).nullable(),
    translations: z.array(translationInputSchema).min(1).max(locales.length),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.comparePriceCentimes !== null &&
      value.comparePriceCentimes <= value.priceCentimes
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comparePriceCentimes'],
        message: 'admin.courses.pricing.compareAtHint',
      });
    }
    const seen = new Set<string>();
    for (const entry of value.translations) {
      if (seen.has(entry.locale)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['translations'],
          message: 'admin.actionError.validation',
        });
      }
      seen.add(entry.locale);
    }
  });

export type UpdateCourseInfoInput = z.output<typeof updateCourseInfoSchema>;

/**
 * Save the Infos tab.
 *
 * The slug is the one field with a state rule: while a course is `DRAFT` its
 * address is nobody's bookmark, so it may be rewritten freely; once published it
 * is a public URL that search engines and students hold, and changing it here
 * would 404 them silently. A published course therefore keeps its slug and says
 * so, rather than accepting the field and discarding it.
 */
export async function updateCourseInfo(
  input: UpdateCourseInfoInput,
  ctx: ActorContext,
): Promise<MutationOutcome> {
  return transaction(async (tx) => {
    const course = await requireAuthoredCourse(tx, input.courseId, ctx.actor);

    let slug = course.slug;
    if (input.slug !== undefined && input.slug !== course.slug) {
      // Defence in depth: the field is disabled outside `DRAFT`, so reaching
      // this is a forged request or a tab left open across a publication.
      if (course.status !== 'DRAFT') {
        throw new ActionError('conflict', 'admin.actionError.conflict');
      }
      const candidate = slugify(input.slug);
      if (!isSlug(candidate)) {
        throw new ActionError('validation', 'admin.actionError.validation', {
          slug: ['admin.actionError.validation'],
        });
      }
      const clash = await tx.course.findFirst({
        where: { slug: candidate, NOT: { id: course.id } },
        select: { id: true },
      });
      if (clash !== null) {
        throw new ActionError('conflict', 'admin.courses.general.slugTaken', {
          slug: ['admin.courses.general.slugTaken'],
        });
      }
      slug = candidate;
    }

    if (input.categoryId !== null) {
      const category = await tx.category.findUnique({
        where: { id: input.categoryId },
        select: { id: true },
      });
      if (category === null) {
        throw new ActionError('validation', 'admin.actionError.validation', {
          categoryId: ['admin.actionError.validation'],
        });
      }
    }

    const before = await tx.course.findUniqueOrThrow({
      where: { id: course.id },
      select: {
        slug: true,
        categoryId: true,
        level: true,
        deliveryMode: true,
        contentLocale: true,
        priceCentimes: true,
        comparePriceCentimes: true,
        maxSeats: true,
        coverKey: true,
      },
    });

    const after = {
      slug,
      categoryId: input.categoryId,
      level: input.level,
      deliveryMode: input.deliveryMode,
      contentLocale: input.contentLocale as DbLocale,
      priceCentimes: input.priceCentimes,
      comparePriceCentimes: input.comparePriceCentimes,
      maxSeats: input.maxSeats,
      coverKey: input.coverKey === null || input.coverKey === '' ? null : input.coverKey,
    };

    await tx.course.update({ where: { id: course.id }, data: after });

    // One upsert per submitted locale. A locale whose three fields are all empty
    // is deleted rather than stored blank: an empty `CourseTranslation` makes the
    // public page believe a translation exists (§10.1) and renders a titleless card.
    const translationChanges: Record<string, string> = {};
    for (const entry of input.translations) {
      const isEmpty =
        entry.title === '' && entry.subtitle === '' && entry.description === '';
      const key = `translation.${entry.locale}`;

      const existing = await tx.courseTranslation.findUnique({
        where: { courseId_locale: { courseId: course.id, locale: entry.locale } },
        select: { title: true, subtitle: true, description: true },
      });

      if (isEmpty) {
        if (existing !== null) {
          await tx.courseTranslation.delete({
            where: { courseId_locale: { courseId: course.id, locale: entry.locale } },
          });
          translationChanges[key] = 'supprimée';
        }
        continue;
      }

      const complete =
        entry.title !== '' && entry.subtitle !== '' && entry.description !== '';

      await tx.courseTranslation.upsert({
        where: { courseId_locale: { courseId: course.id, locale: entry.locale } },
        create: {
          courseId: course.id,
          locale: entry.locale,
          title: entry.title,
          subtitle: entry.subtitle === '' ? null : entry.subtitle,
          description: entry.description,
          objectives: [],
          targetAudience: [],
          requirementsText: [],
          isComplete: complete,
        },
        update: {
          title: entry.title,
          subtitle: entry.subtitle === '' ? null : entry.subtitle,
          description: entry.description,
          isComplete: complete,
        },
      });

      if (
        existing === null ||
        existing.title !== entry.title ||
        (existing.subtitle ?? '') !== entry.subtitle ||
        existing.description !== entry.description
      ) {
        translationChanges[key] = existing === null ? 'créée' : 'modifiée';
      }
    }

    const title = await frenchTitle(tx, course.id, slug);
    const diff = buildDiff({ ...before, ...emptyOf(translationChanges) }, { ...after, ...translationChanges });

    await recordAudit(
      {
        actorId: ctx.actor.id,
        action: 'COURSE_UPDATED',
        entityType: 'Course',
        entityId: course.id,
        summary: `Fiche de la formation « ${title} » modifiée.`,
        diff,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return { courseId: course.id, changed: diff !== null };
  });
}

/** `{ a: 'x' }` → `{ a: 'inchangée' }`, so the diff shows a before for every after. */
function emptyOf(changes: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(changes)) out[key] = 'inchangée';
  return out;
}

/* -------------------------------------------------------------------------- */
/* Programme tab — modules                                                     */
/* -------------------------------------------------------------------------- */

export const createModuleSchema = z
  .object({
    courseId: courseIdSchema,
    title: z.string().trim().min(1).max(MODULE_TITLE_MAX),
  })
  .strict();

export async function createModule(
  input: z.output<typeof createModuleSchema>,
  ctx: ActorContext,
): Promise<MutationOutcome & { readonly moduleId: string }> {
  return transaction(async (tx) => {
    const course = await requireAuthoredCourse(tx, input.courseId, ctx.actor);

    const last = await tx.module.findFirst({
      where: { courseId: course.id },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const order = (last?.order ?? 0) + 1;

    const courseModule = await tx.module.create({
      data: {
        courseId: course.id,
        order,
        isPublished: true,
        translations: { create: { locale: 'fr', title: input.title } },
      },
      select: { id: true },
    });

    await recordAudit(
      {
        actorId: ctx.actor.id,
        action: 'COURSE_MODULE_CREATED',
        entityType: 'Module',
        entityId: courseModule.id,
        summary: `Module « ${input.title} » ajouté à la formation ${course.slug}.`,
        diff: buildDiff({}, { courseId: course.id, order, title: input.title }),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return { courseId: course.id, moduleId: courseModule.id, changed: true };
  });
}

export const updateModuleSchema = z
  .object({
    moduleId: z.string().min(1).max(64),
    titles: z
      .array(
        z
          .object({
            locale: z.enum(locales),
            title: z.string().trim().max(MODULE_TITLE_MAX),
          })
          .strict(),
      )
      .min(1)
      .max(locales.length),
    summaryFr: z.string().trim().max(MODULE_SUMMARY_MAX),
    isPublished: z.boolean(),
  })
  .strict();

export async function updateModule(
  input: z.output<typeof updateModuleSchema>,
  ctx: ActorContext,
): Promise<MutationOutcome> {
  return transaction(async (tx) => {
    const courseModule = await tx.module.findUnique({
      where: { id: input.moduleId },
      select: { id: true, courseId: true, isPublished: true },
    });
    if (courseModule === null) throw new ActionError('not_found', 'admin.actionError.notFound');
    const course = await requireAuthoredCourse(tx, courseModule.courseId, ctx.actor);

    const french = input.titles.find((entry) => entry.locale === 'fr');
    if (french === undefined || french.title === '') {
      throw new ActionError('validation', 'admin.actionError.validation', {
        title: ['admin.courses.curriculum.moduleTitle'],
      });
    }

    await tx.module.update({
      where: { id: courseModule.id },
      data: { isPublished: input.isPublished },
    });

    const changes: Record<string, string> = {};
    for (const entry of input.titles) {
      const summary = entry.locale === 'fr' ? input.summaryFr : undefined;
      const existing = await tx.moduleTranslation.findUnique({
        where: { moduleId_locale: { moduleId: courseModule.id, locale: entry.locale } },
        select: { title: true, summary: true },
      });

      if (entry.title === '') {
        if (existing !== null && entry.locale !== 'fr') {
          await tx.moduleTranslation.delete({
            where: { moduleId_locale: { moduleId: courseModule.id, locale: entry.locale } },
          });
          changes[`title.${entry.locale}`] = 'supprimé';
        }
        continue;
      }

      await tx.moduleTranslation.upsert({
        where: { moduleId_locale: { moduleId: courseModule.id, locale: entry.locale } },
        create: {
          moduleId: courseModule.id,
          locale: entry.locale,
          title: entry.title,
          summary: summary === undefined || summary === '' ? null : summary,
        },
        update: {
          title: entry.title,
          ...(summary === undefined ? {} : { summary: summary === '' ? null : summary }),
        },
      });

      if (existing === null || existing.title !== entry.title) {
        changes[`title.${entry.locale}`] = entry.title;
      }
      if (summary !== undefined && (existing?.summary ?? '') !== summary) {
        changes['summary.fr'] = summary === '' ? 'vide' : 'modifié';
      }
    }

    const diff = buildDiff(
      { isPublished: courseModule.isPublished, ...emptyOf(changes) },
      { isPublished: input.isPublished, ...changes },
    );

    await recordAudit(
      {
        actorId: ctx.actor.id,
        action: 'COURSE_MODULE_UPDATED',
        entityType: 'Module',
        entityId: courseModule.id,
        summary: `Module « ${french.title} » de la formation ${course.slug} modifié.`,
        diff,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return { courseId: course.id, changed: diff !== null };
  });
}

export const moveSchema = z
  .object({
    id: z.string().min(1).max(64),
    direction: z.enum(['up', 'down']),
  })
  .strict();

/**
 * Swap a module with its neighbour.
 *
 * `@@unique([courseId, order])` forbids the two rows sharing a position even
 * for the length of a statement, so the mover is parked on a negative sentinel
 * first. Negative orders never occur otherwise, and the whole dance is inside
 * one transaction, so no reader ever observes it.
 */
export async function moveModule(
  input: z.output<typeof moveSchema>,
  ctx: ActorContext,
): Promise<MutationOutcome> {
  return transaction(async (tx) => {
    const courseModule = await tx.module.findUnique({
      where: { id: input.id },
      select: { id: true, courseId: true, order: true },
    });
    if (courseModule === null) throw new ActionError('not_found', 'admin.actionError.notFound');
    const course = await requireAuthoredCourse(tx, courseModule.courseId, ctx.actor);

    const neighbour = await tx.module.findFirst({
      where:
        input.direction === 'up'
          ? { courseId: course.id, order: { lt: courseModule.order } }
          : { courseId: course.id, order: { gt: courseModule.order } },
      orderBy: { order: input.direction === 'up' ? 'desc' : 'asc' },
      select: { id: true, order: true },
    });
    // Already first or last. Not an error: the button is disabled there, and a
    // race that gets through must not explode.
    if (neighbour === null) return { courseId: course.id, changed: false };

    await tx.module.update({ where: { id: courseModule.id }, data: { order: SWAP_SENTINEL } });
    await tx.module.update({ where: { id: neighbour.id }, data: { order: courseModule.order } });
    await tx.module.update({ where: { id: courseModule.id }, data: { order: neighbour.order } });

    await recordAudit(
      {
        actorId: ctx.actor.id,
        action: 'COURSE_MODULE_REORDERED',
        entityType: 'Module',
        entityId: courseModule.id,
        summary: `Module réordonné dans la formation ${course.slug}.`,
        diff: buildDiff({ order: courseModule.order }, { order: neighbour.order }),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return { courseId: course.id, changed: true };
  });
}

/** Out of the range `order` ever legitimately holds, so the swap cannot collide. */
const SWAP_SENTINEL = -1;

export const deleteModuleSchema = z.object({ moduleId: z.string().min(1).max(64) }).strict();

/**
 * Delete a module and its lessons, then close the gap it left.
 *
 * `Module` carries no `deletedAt`, so this one really is a hard delete and it
 * cascades to every `Lesson` under it — and from there to `LessonProgress`.
 * A module whose lessons someone has already watched is therefore refused:
 * losing a student's history is not an acceptable side effect of tidying a
 * programme. Empty its lessons first, or unpublish it.
 *
 * Renumbering ascends from the hole, so every slot a row moves into has already
 * been vacated by the row before it — the unique index is satisfied at every
 * step, without a sentinel.
 */
export async function deleteModule(
  input: z.output<typeof deleteModuleSchema>,
  ctx: ActorContext,
): Promise<MutationOutcome> {
  return transaction(async (tx) => {
    const courseModule = await tx.module.findUnique({
      where: { id: input.moduleId },
      select: {
        id: true,
        courseId: true,
        order: true,
        translations: { where: { locale: 'fr' }, select: { title: true } },
        _count: { select: { lessons: true } },
      },
    });
    if (courseModule === null) throw new ActionError('not_found', 'admin.actionError.notFound');
    const course = await requireAuthoredCourse(tx, courseModule.courseId, ctx.actor);

    const watched = await tx.lessonProgress.count({
      where: { lesson: { moduleId: courseModule.id } },
    });
    if (watched > 0) throw new ActionError('conflict', 'admin.actionError.conflict');

    await tx.module.delete({ where: { id: courseModule.id } });

    const following = await tx.module.findMany({
      where: { courseId: course.id, order: { gt: courseModule.order } },
      orderBy: { order: 'asc' },
      select: { id: true, order: true },
    });
    for (const row of following) {
      await tx.module.update({ where: { id: row.id }, data: { order: row.order - 1 } });
    }

    await recomputeCourseTotals(tx, course.id);

    await recordAudit(
      {
        actorId: ctx.actor.id,
        action: 'COURSE_MODULE_DELETED',
        entityType: 'Module',
        entityId: courseModule.id,
        summary: `Module « ${courseModule.translations[0]?.title ?? courseModule.order} » supprimé de la formation ${course.slug}.`,
        diff: buildDiff(
          { order: courseModule.order, lessons: courseModule._count.lessons },
          { order: null, lessons: null },
        ),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return { courseId: course.id, changed: true };
  });
}

/* -------------------------------------------------------------------------- */
/* Programme tab — lessons                                                     */
/* -------------------------------------------------------------------------- */

export const createLessonSchema = z
  .object({
    moduleId: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(LESSON_TITLE_MAX),
    type: z.enum(LESSON_TYPE_VALUES),
  })
  .strict();

export async function createLesson(
  input: z.output<typeof createLessonSchema>,
  ctx: ActorContext,
): Promise<MutationOutcome & { readonly lessonId: string }> {
  return transaction(async (tx) => {
    const courseModule = await tx.module.findUnique({
      where: { id: input.moduleId },
      select: { id: true, courseId: true },
    });
    if (courseModule === null) throw new ActionError('not_found', 'admin.actionError.notFound');
    const course = await requireAuthoredCourse(tx, courseModule.courseId, ctx.actor);

    // Soft-deleted lessons keep their `order`, so the next free slot is computed
    // over every row, not only the live ones.
    const last = await tx.lesson.findFirst({
      where: { moduleId: courseModule.id },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const order = (last?.order ?? 0) + 1;

    const lesson = await tx.lesson.create({
      data: {
        moduleId: courseModule.id,
        order,
        type: input.type,
        translations: { create: { locale: 'fr', title: input.title } },
      },
      select: { id: true },
    });

    await recomputeCourseTotals(tx, course.id);

    await recordAudit(
      {
        actorId: ctx.actor.id,
        action: 'COURSE_LESSON_CREATED',
        entityType: 'Lesson',
        entityId: lesson.id,
        summary: `Leçon « ${input.title} » ajoutée à la formation ${course.slug}.`,
        diff: buildDiff({}, { moduleId: courseModule.id, order, type: input.type, title: input.title }),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return { courseId: course.id, lessonId: lesson.id, changed: true };
  });
}

export const updateLessonSchema = z
  .object({
    lessonId: z.string().min(1).max(64),
    titles: z
      .array(
        z
          .object({
            locale: z.enum(locales),
            title: z.string().trim().max(LESSON_TITLE_MAX),
          })
          .strict(),
      )
      .min(1)
      .max(locales.length),
    type: z.enum(LESSON_TYPE_VALUES),
    estimatedMinutes: z.number().int().min(0).max(LESSON_MINUTES_MAX),
    isPreview: z.boolean(),
    isPublished: z.boolean(),
    isMandatory: z.boolean(),
  })
  .strict();

export async function updateLesson(
  input: z.output<typeof updateLessonSchema>,
  ctx: ActorContext,
): Promise<MutationOutcome> {
  return transaction(async (tx) => {
    const lesson = await tx.lesson.findFirst({
      where: { id: input.lessonId, deletedAt: null },
      select: {
        id: true,
        type: true,
        estimatedMinutes: true,
        isPreview: true,
        isPublished: true,
        isMandatory: true,
        module: { select: { courseId: true } },
      },
    });
    if (lesson === null) throw new ActionError('not_found', 'admin.actionError.notFound');
    const course = await requireAuthoredCourse(tx, lesson.module.courseId, ctx.actor);

    const french = input.titles.find((entry) => entry.locale === 'fr');
    if (french === undefined || french.title === '') {
      throw new ActionError('validation', 'admin.actionError.validation', {
        title: ['admin.courses.curriculum.lessonTitle'],
      });
    }

    await tx.lesson.update({
      where: { id: lesson.id },
      data: {
        type: input.type,
        estimatedMinutes: input.estimatedMinutes,
        isPreview: input.isPreview,
        isPublished: input.isPublished,
        isMandatory: input.isMandatory,
      },
    });

    const changes: Record<string, string> = {};
    for (const entry of input.titles) {
      const existing = await tx.lessonTranslation.findUnique({
        where: { lessonId_locale: { lessonId: lesson.id, locale: entry.locale } },
        select: { title: true },
      });

      if (entry.title === '') {
        if (existing !== null && entry.locale !== 'fr') {
          await tx.lessonTranslation.delete({
            where: { lessonId_locale: { lessonId: lesson.id, locale: entry.locale } },
          });
          changes[`title.${entry.locale}`] = 'supprimé';
        }
        continue;
      }

      await tx.lessonTranslation.upsert({
        where: { lessonId_locale: { lessonId: lesson.id, locale: entry.locale } },
        create: { lessonId: lesson.id, locale: entry.locale, title: entry.title },
        update: { title: entry.title },
      });

      if (existing === null || existing.title !== entry.title) {
        changes[`title.${entry.locale}`] = entry.title;
      }
    }

    await recomputeCourseTotals(tx, course.id);

    const diff = buildDiff(
      {
        type: lesson.type,
        estimatedMinutes: lesson.estimatedMinutes,
        isPreview: lesson.isPreview,
        isPublished: lesson.isPublished,
        isMandatory: lesson.isMandatory,
        ...emptyOf(changes),
      },
      {
        type: input.type,
        estimatedMinutes: input.estimatedMinutes,
        isPreview: input.isPreview,
        isPublished: input.isPublished,
        isMandatory: input.isMandatory,
        ...changes,
      },
    );

    await recordAudit(
      {
        actorId: ctx.actor.id,
        action: 'COURSE_LESSON_UPDATED',
        entityType: 'Lesson',
        entityId: lesson.id,
        summary: `Leçon « ${french.title} » de la formation ${course.slug} modifiée.`,
        diff,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return { courseId: course.id, changed: diff !== null };
  });
}

/** Same sentinel dance as {@link moveModule}, scoped to one module. */
export async function moveLesson(
  input: z.output<typeof moveSchema>,
  ctx: ActorContext,
): Promise<MutationOutcome> {
  return transaction(async (tx) => {
    const lesson = await tx.lesson.findFirst({
      where: { id: input.id, deletedAt: null },
      select: { id: true, order: true, moduleId: true, module: { select: { courseId: true } } },
    });
    if (lesson === null) throw new ActionError('not_found', 'admin.actionError.notFound');
    const course = await requireAuthoredCourse(tx, lesson.module.courseId, ctx.actor);

    const neighbour = await tx.lesson.findFirst({
      where:
        input.direction === 'up'
          ? { moduleId: lesson.moduleId, deletedAt: null, order: { lt: lesson.order } }
          : { moduleId: lesson.moduleId, deletedAt: null, order: { gt: lesson.order } },
      orderBy: { order: input.direction === 'up' ? 'desc' : 'asc' },
      select: { id: true, order: true },
    });
    if (neighbour === null) return { courseId: course.id, changed: false };

    await tx.lesson.update({ where: { id: lesson.id }, data: { order: SWAP_SENTINEL } });
    await tx.lesson.update({ where: { id: neighbour.id }, data: { order: lesson.order } });
    await tx.lesson.update({ where: { id: lesson.id }, data: { order: neighbour.order } });

    await recordAudit(
      {
        actorId: ctx.actor.id,
        action: 'COURSE_LESSON_REORDERED',
        entityType: 'Lesson',
        entityId: lesson.id,
        summary: `Leçon réordonnée dans la formation ${course.slug}.`,
        diff: buildDiff({ order: lesson.order }, { order: neighbour.order }),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return { courseId: course.id, changed: true };
  });
}

export const deleteLessonSchema = z.object({ lessonId: z.string().min(1).max(64) }).strict();

/**
 * Remove a lesson — a **soft** delete, and that is not timidity.
 *
 * `LessonProgress`, `Note` and `Bookmark` all cascade from `Lesson`, so a hard
 * delete of a lesson someone has watched silently destroys their history and
 * their notes. `Lesson.deletedAt` exists precisely so that removing a lesson
 * from the programme and erasing what students did in it are different acts.
 *
 * The row therefore keeps its `order`, and the surviving lessons are **not**
 * renumbered: `@@unique([moduleId, order])` still counts the tombstone, and
 * closing the gap would collide with it. Gaps are invisible — every reader
 * orders by `order` and filters `deletedAt: null` — and {@link createLesson}
 * takes the next slot after the highest, tombstones included.
 */
export async function deleteLesson(
  input: z.output<typeof deleteLessonSchema>,
  ctx: ActorContext,
): Promise<MutationOutcome> {
  const now = ctx.now ?? new Date();

  return transaction(async (tx) => {
    // Deliberately **not** filtered on `deletedAt`: a second press of a button
    // whose row is already a tombstone is a no-op, and reporting « introuvable »
    // for a lesson the author has just removed is a lie about what happened.
    const lesson = await tx.lesson.findUnique({
      where: { id: input.lessonId },
      select: {
        id: true,
        order: true,
        moduleId: true,
        module: { select: { courseId: true } },
        translations: { where: { locale: 'fr' }, select: { title: true } },
      },
    });
    if (lesson === null) throw new ActionError('not_found', 'admin.actionError.notFound');
    const course = await requireAuthoredCourse(tx, lesson.module.courseId, ctx.actor);

    // Compare-and-set on `deletedAt`, so a double-clicked « Supprimer » removes
    // one lesson and reports the second press as the no-op it is.
    const removed = await tx.lesson.updateMany({
      where: { id: lesson.id, deletedAt: null },
      data: { deletedAt: now, isPublished: false, isPreview: false },
    });
    if (removed.count === 0) return { courseId: course.id, changed: false };

    await recomputeCourseTotals(tx, course.id);

    await recordAudit(
      {
        actorId: ctx.actor.id,
        action: 'COURSE_LESSON_DELETED',
        entityType: 'Lesson',
        entityId: lesson.id,
        summary: `Leçon « ${lesson.translations[0]?.title ?? lesson.order} » supprimée de la formation ${course.slug}.`,
        diff: buildDiff({ deletedAt: null }, { deletedAt: now }),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return { courseId: course.id, changed: true };
  });
}

/* -------------------------------------------------------------------------- */
/* Publication tab — the state transitions                                     */
/* -------------------------------------------------------------------------- */

export const setCourseStatusSchema = z
  .object({
    courseId: courseIdSchema,
    status: z.enum(COURSE_TRANSITION_TARGETS),
  })
  .strict();

export interface StatusOutcome extends MutationOutcome {
  readonly status: CourseStatus;
  /** Non-empty only when a publish was refused; the interface lists these. */
  readonly missing: readonly ChecklistKey[];
  /** Live enrollments at the moment of an archive — what the warning counted. */
  readonly activeEnrollments: number;
}

/**
 * Move a course between `DRAFT`, `PUBLISHED` and `ARCHIVED`.
 *
 * Three rules, all enforced here rather than in the button:
 *
 * - **Publishing is gated** by {@link publishChecklist}, re-derived inside the
 *   transaction from committed rows. A refusal comes back as the list of
 *   unmet conditions, so the interface can name them; it is never a silent no-op.
 * - **The update is a compare-and-set** on the status the decision was made
 *   against, so two administrators pressing « Publier » produce one winner and
 *   one honest `changed: false`.
 * - **`publishedAt` is set once.** It is the date the course first went live and
 *   the field the catalogue sorts « nouveautés » by; a re-publication after an
 *   archive must not push an old course back to the top.
 */
export async function setCourseStatus(
  input: z.output<typeof setCourseStatusSchema>,
  ctx: ActorContext,
): Promise<StatusOutcome> {
  const now = ctx.now ?? new Date();

  return transaction(async (tx) => {
    const course = await requireAuthoredCourse(tx, input.courseId, ctx.actor);

    const current = await tx.course.findUniqueOrThrow({
      where: { id: course.id },
      select: { status: true, publishedAt: true },
    });

    const activeEnrollments = await tx.enrollment.count({
      where: { courseId: course.id, status: 'ACTIVE' },
    });

    if (current.status === input.status) {
      return {
        courseId: course.id,
        changed: false,
        status: current.status,
        missing: [],
        activeEnrollments,
      };
    }

    if (input.status === 'PUBLISHED') {
      // Publishing is the only capability §8 separates from authoring.
      if (!can(ctx.actor, 'course.publish')) {
        throw new ActionError('forbidden', 'admin.actionError.forbidden');
      }
      const checklist = publishChecklist(await checklistFactsFor(tx, course.id));
      if (!checklist.ready) {
        return {
          courseId: course.id,
          changed: false,
          status: current.status,
          missing: checklist.missing,
          activeEnrollments,
        };
      }
    }

    const data: Prisma.CourseUpdateManyMutationInput = {
      status: input.status,
      publishedAt:
        input.status === 'PUBLISHED' && current.publishedAt === null ? now : current.publishedAt,
      archivedAt: input.status === 'ARCHIVED' ? now : null,
    };

    const updated = await tx.course.updateMany({
      where: { id: course.id, status: current.status, deletedAt: null },
      data,
    });
    if (updated.count === 0) {
      return {
        courseId: course.id,
        changed: false,
        status: current.status,
        missing: [],
        activeEnrollments,
      };
    }

    const title = await frenchTitle(tx, course.id, course.slug);

    await recordAudit(
      {
        actorId: ctx.actor.id,
        action: STATUS_AUDIT_ACTION[input.status],
        entityType: 'Course',
        entityId: course.id,
        summary: `Formation « ${title} » ${STATUS_SUMMARY[input.status]}.`,
        diff: buildDiff({ status: current.status }, { status: input.status }),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return {
      courseId: course.id,
      changed: true,
      status: input.status,
      missing: [],
      activeEnrollments,
    };
  });
}

const STATUS_AUDIT_ACTION: Record<CourseTransitionTarget, string> = {
  DRAFT: 'COURSE_UNPUBLISHED',
  PUBLISHED: 'COURSE_PUBLISHED',
  ARCHIVED: 'COURSE_ARCHIVED',
};

const STATUS_SUMMARY: Record<CourseTransitionTarget, string> = {
  DRAFT: 'repassée en brouillon',
  PUBLISHED: 'publiée',
  ARCHIVED: 'archivée',
};
