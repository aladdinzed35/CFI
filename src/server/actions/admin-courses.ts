'use server';

/**
 * Server actions for the §17.5 course console.
 *
 * Every export goes through {@link withAction}: Origin check → Zod `.strict()`
 * → session → the §8 capability `course.author` → handler. Nothing above the
 * handler touches the database, and nothing in this file writes a row: the
 * transactions, the compare-and-sets and the audit rows all live in
 * `@/server/services/course-admin`.
 *
 * ## What this layer adds
 * Three things the domain has no business knowing:
 *
 * 1. **The dirham/centime boundary.** The form posts what the administrator
 *    typed — `1 200`, `1200,50` — and this is the only place it becomes an
 *    integer. §21: money is centimes everywhere below this line.
 * 2. **Cache invalidation.** An edit must reach the public catalogue, which is
 *    statically rendered. `revalidatePath` marks the admin screens *and* the
 *    public course routes, and `refreshSeconds` is what the interface quotes
 *    back to the author afterwards — a promise the page can keep.
 * 3. **A result the interface can narrate.** `changed: false` comes back as an
 *    answer, not a failure, and a refused publication comes back as the list of
 *    unmet conditions rather than as a shrug.
 */

import { z } from 'zod';
import { revalidatePath } from 'next/cache';

import { withAction } from '@/server/auth/guards';
import {
  COURSE_TITLE_MAX,
  MODULE_TITLE_MAX,
  LESSON_TITLE_MAX,
  LESSON_TYPE_VALUES,
  LESSON_MINUTES_MAX,
  COURSE_LEVEL_VALUES,
  COURSE_SUBTITLE_MAX,
  COURSE_DESCRIPTION_MAX,
  COURSE_TRANSITION_TARGETS,
  DELIVERY_MODE_VALUES,
  MODULE_SUMMARY_MAX,
  PUBLIC_CACHE_SECONDS,
  SEATS_MAX,
  createCourse,
  createLesson,
  createModule,
  deleteLesson,
  deleteModule,
  moveLesson,
  moveModule,
  parseDirhams,
  setCourseStatus,
  updateCourseInfo,
  updateLesson,
  updateModule,
  type MutationOutcome,
  type StatusOutcome,
} from '@/server/services/course-admin';
import { MAX_SLUG_LENGTH } from '@/lib/slug';
import { locales } from '@/i18n/routing';

/* -------------------------------------------------------------------------- */
/* Shared plumbing                                                             */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().min(1).max(64);

/** The capability guard every action in this file shares (§8 row « Author courses »). */
const AUTHOR = { auth: 'active', can: 'course.author' } as const;

/**
 * Refresh the admin screens and the public catalogue.
 *
 * The public pages are prerendered, so an edit is invisible until their paths
 * are marked stale. The course page is invalidated by **route pattern**, not by
 * resolved slug: a slug change would otherwise purge the new address while
 * leaving the old one cached and live.
 *
 * Done here rather than in the service: a job runner calling the same domain
 * function has no request to revalidate against.
 */
function revalidateAfterEdit(): void {
  revalidatePath('/[locale]/admin', 'layout');
  revalidatePath('/[locale]/(public)/formations', 'page');
  revalidatePath('/[locale]/(public)/formations/[slug]', 'page');
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * « Nouvelle formation » — a title, and straight into the editor.
 *
 * Returns the new id so the list can navigate to it; nothing is published, so
 * no public path needs invalidating beyond the admin screens.
 */
export const createCourseAction = withAction(
  z.object({ title: z.string().trim().min(3).max(COURSE_TITLE_MAX) }).strict(),
  async (input, ctx): Promise<{ readonly courseId: string; readonly slug: string }> => {
    const result = await createCourse(input, {
      actor: ctx.user,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidatePath('/[locale]/admin', 'layout');
    return result;
  },
  AUTHOR,
);

/* -------------------------------------------------------------------------- */
/* Infos tab                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A price as the administrator typed it, in dirhams.
 *
 * Parsed here, once, into centimes. An unparseable value is a field error, not
 * a silent zero: « 12OO » with letter O must not quietly become « 0 DH » on a
 * live sales page.
 */
const dirhamSchema = z.string().trim().max(20);

const infoTranslationSchema = z
  .object({
    locale: z.enum(locales),
    title: z.string().trim().max(COURSE_TITLE_MAX),
    subtitle: z.string().trim().max(COURSE_SUBTITLE_MAX),
    description: z.string().trim().max(COURSE_DESCRIPTION_MAX),
  })
  .strict();

const updateCourseInfoActionSchema = z
  .object({
    courseId: idSchema,
    /** Sent only while the course is a draft; the service refuses it elsewhere. */
    slug: z.string().trim().min(3).max(MAX_SLUG_LENGTH).optional(),
    categoryId: idSchema.nullable(),
    level: z.enum(COURSE_LEVEL_VALUES),
    deliveryMode: z.enum(DELIVERY_MODE_VALUES),
    contentLocale: z.enum(locales),
    /** Dirhams, as typed. `0` is a free course. */
    price: dirhamSchema,
    /** Dirhams, as typed. Empty means « no struck-through price ». */
    comparePrice: dirhamSchema,
    maxSeats: z.number().int().min(1).max(SEATS_MAX).nullable(),
    coverKey: z.string().trim().max(512).nullable(),
    translations: z.array(infoTranslationSchema).min(1).max(locales.length),
  })
  .strict();

export const updateCourseInfoAction = withAction(
  updateCourseInfoActionSchema,
  async (input, ctx): Promise<MutationOutcome & { readonly refreshSeconds: number }> => {
    const priceCentimes = parseDirhams(input.price);
    if (priceCentimes === null) {
      return failField('price');
    }

    const compareRaw = input.comparePrice.trim();
    const comparePriceCentimes = compareRaw === '' ? null : parseDirhams(compareRaw);
    if (compareRaw !== '' && comparePriceCentimes === null) {
      return failField('comparePrice');
    }

    const result = await updateCourseInfo(
      {
        courseId: input.courseId,
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        categoryId: input.categoryId,
        level: input.level,
        deliveryMode: input.deliveryMode,
        contentLocale: input.contentLocale,
        priceCentimes,
        comparePriceCentimes,
        maxSeats: input.maxSeats,
        coverKey: input.coverKey,
        translations: input.translations,
      },
      { actor: ctx.user, ip: ctx.ip, userAgent: ctx.userAgent },
    );

    revalidateAfterEdit();
    return { ...result, refreshSeconds: PUBLIC_REFRESH_SECONDS };
  },
  AUTHOR,
);

/* -------------------------------------------------------------------------- */
/* Programme tab — modules                                                     */
/* -------------------------------------------------------------------------- */

export const createModuleAction = withAction(
  z
    .object({ courseId: idSchema, title: z.string().trim().min(1).max(MODULE_TITLE_MAX) })
    .strict(),
  async (input, ctx) => {
    const result = await createModule(input, {
      actor: ctx.user,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateAfterEdit();
    return result;
  },
  AUTHOR,
);

export const updateModuleAction = withAction(
  z
    .object({
      moduleId: idSchema,
      titles: z
        .array(
          z
            .object({ locale: z.enum(locales), title: z.string().trim().max(MODULE_TITLE_MAX) })
            .strict(),
        )
        .min(1)
        .max(locales.length),
      summaryFr: z.string().trim().max(MODULE_SUMMARY_MAX),
      isPublished: z.boolean(),
    })
    .strict(),
  async (input, ctx) => {
    const result = await updateModule(input, {
      actor: ctx.user,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateAfterEdit();
    return result;
  },
  AUTHOR,
);

export const moveModuleAction = withAction(
  z.object({ id: idSchema, direction: z.enum(['up', 'down']) }).strict(),
  async (input, ctx) => {
    const result = await moveModule(input, {
      actor: ctx.user,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateAfterEdit();
    return result;
  },
  AUTHOR,
);

export const deleteModuleAction = withAction(
  z.object({ moduleId: idSchema }).strict(),
  async (input, ctx) => {
    const result = await deleteModule(input, {
      actor: ctx.user,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateAfterEdit();
    return result;
  },
  AUTHOR,
);

/* -------------------------------------------------------------------------- */
/* Programme tab — lessons                                                     */
/* -------------------------------------------------------------------------- */

export const createLessonAction = withAction(
  z
    .object({
      moduleId: idSchema,
      title: z.string().trim().min(1).max(LESSON_TITLE_MAX),
      type: z.enum(LESSON_TYPE_VALUES),
    })
    .strict(),
  async (input, ctx) => {
    const result = await createLesson(input, {
      actor: ctx.user,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateAfterEdit();
    return result;
  },
  AUTHOR,
);

export const updateLessonAction = withAction(
  z
    .object({
      lessonId: idSchema,
      titles: z
        .array(
          z
            .object({ locale: z.enum(locales), title: z.string().trim().max(LESSON_TITLE_MAX) })
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
    .strict(),
  async (input, ctx) => {
    const result = await updateLesson(input, {
      actor: ctx.user,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateAfterEdit();
    return result;
  },
  AUTHOR,
);

export const moveLessonAction = withAction(
  z.object({ id: idSchema, direction: z.enum(['up', 'down']) }).strict(),
  async (input, ctx) => {
    const result = await moveLesson(input, {
      actor: ctx.user,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateAfterEdit();
    return result;
  },
  AUTHOR,
);

export const deleteLessonAction = withAction(
  z.object({ lessonId: idSchema }).strict(),
  async (input, ctx) => {
    const result = await deleteLesson(input, {
      actor: ctx.user,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateAfterEdit();
    return result;
  },
  AUTHOR,
);

/* -------------------------------------------------------------------------- */
/* Publication tab                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Publish, unpublish or archive.
 *
 * Guarded by `course.publish` rather than `course.author`: §8 gives an
 * `INSTRUCTOR` the right to write their own course and reserves the decision to
 * make it public for an administrator. The service re-checks the same
 * capability inside the transaction, so this is the outer of two doors.
 *
 * A blocked publication is a successful action with `changed: false` and a
 * non-empty `missing` list — the interface names every unmet condition. Turning
 * it into `{ ok: false }` would collapse six actionable facts into one error
 * code (§17.5: « never a silent fail »).
 */
export const setCourseStatusAction = withAction(
  z.object({ courseId: idSchema, status: z.enum(COURSE_TRANSITION_TARGETS) }).strict(),
  async (input, ctx): Promise<StatusOutcome & { readonly refreshSeconds: number }> => {
    const result = await setCourseStatus(input, {
      actor: ctx.user,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateAfterEdit();
    return { ...result, refreshSeconds: PUBLIC_REFRESH_SECONDS };
  },
  { auth: 'active', can: 'course.publish' },
);

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How long the public catalogue may keep serving the previous version.
 *
 * Imported rather than restated, but **not** re-exported: a `'use server'`
 * module may only export async functions. It reaches the interface inside the
 * action's result, where it is the number the editor quotes back to the author.
 */
const PUBLIC_REFRESH_SECONDS = PUBLIC_CACHE_SECONDS;

/**
 * A field-level refusal, in the shape `withAction` produces for a Zod failure —
 * so the form's error handling has exactly one code path.
 *
 * Thrown rather than returned because the handler's return type is the success
 * payload; `ZodError` is what `toActionResult` turns into `fieldErrors`.
 */
function failField(field: 'price' | 'comparePrice'): never {
  throw new z.ZodError([
    {
      code: z.ZodIssueCode.custom,
      path: [field],
      message: 'admin.courses.pricing.price',
    },
  ]);
}
