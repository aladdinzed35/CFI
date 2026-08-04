import { z } from 'zod';

import { db, transaction } from '@/server/db';
import { ActionError } from '@/server/auth/guards';
import { buildDiff, recordAudit, type AuditDbClient } from '@/server/services/audit';
import { readingMinutes } from '@/server/services/blog';
import { FAQ_GROUP_ORDER } from '@/server/services/faq';
import { isSlug, MAX_SLUG_LENGTH } from '@/lib/slug';
import { locales, type Locale } from '@/i18n/routing';

/**
 * The editorial domain behind `/admin/contenu` (§17.11).
 *
 * Five tables, one service: `Page`, `FaqItem`, `Testimonial`, `BlogPost` and
 * `Category`. Everything an administrator can change about the *words* on the
 * public site passes through here, and nothing else does.
 *
 * ## Why the admin read models are not the public ones
 * `public-pages.ts`, `faq.ts`, `blog.ts` and `home.ts` all resolve a row down to
 * **one** locale, falling back to French per document, and drop anything that is
 * not published. That is exactly right for a visitor and exactly wrong for an
 * editor: the person filling in the Arabic column needs to see that the column
 * is empty, and the person about to publish needs to see the draft. So the
 * readers below return every row and every locale column verbatim, with blanks
 * as `''` rather than `null`, which is the shape a controlled form wants.
 *
 * ## Translations are columns, not rows — except for categories
 * `Page`, `FaqItem`, `Testimonial` and `BlogPost` carry denormalised
 * `…Fr/…Ar/…En/…Es` columns. `Category` is the odd one out: it has a
 * `CategoryTranslation` row per locale. Both are normalised here into the same
 * {@link LocalisedText} record so the editor renders one component for all five
 * tabs. The column names are spelled out rather than built by string
 * concatenation, so renaming one in the schema breaks the build instead of
 * quietly writing to nowhere.
 *
 * ## Deletion is refused where something points at the row
 * Four slugs — `cgu`, `confidentialite`, `mentions-legales`, `cookies` — are
 * linked from the footer and named by the `[...legal]` route, so they can be
 * emptied but never deleted, and unpublishing one is a compliance decision the
 * interface warns about. A `Category` with courses is refused for the same
 * reason: the courses would silently lose their filter. FAQ items, testimonials
 * and blog posts are referenced by nothing, so they delete freely — behind a
 * typed confirmation, because there is no undo.
 *
 * ## Every mutation is one transaction with its audit row
 * §20: authorisation happens in the action wrapper, the write and its `AuditLog`
 * row commit together, and the diff carries changed fields only — never a whole
 * body, which would turn the journal into a second copy of the site.
 *
 * ## After a save, the public site catches up within a minute
 * The home page memoises its read for 60 s in process (`invalidateHomeData`),
 * and the public routes are statically rendered. The actions layer clears both;
 * the interface still tells the editor, because « I saved it and nothing
 * changed » is the support call this note prevents.
 */

/* -------------------------------------------------------------------------- */
/* Locales                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The four locales, French first — it is the source language every other column
 * falls back to. Taken from the routing table rather than retyped, so adding a
 * locale to the site adds a column to every editor at once.
 */
export const CONTENT_LOCALES = locales;

/** One field in the four locales. `''` means "not translated", never `null`. */
export type LocalisedText = Readonly<Record<Locale, string>>;

function text(value: string | null | undefined): string {
  return typeof value === 'string' ? value : '';
}

/** `''` → `null`, so an emptied column reads as absent rather than as a blank string. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/* -------------------------------------------------------------------------- */
/* Read models                                                                 */
/* -------------------------------------------------------------------------- */

export interface PageAdminRow {
  readonly id: string;
  readonly slug: string;
  readonly published: boolean;
  readonly title: LocalisedText;
  readonly body: LocalisedText;
  readonly seoTitle: string;
  readonly seoDescription: string;
  /** A §12.5 document the footer links to: editable, never deletable. */
  readonly locked: boolean;
  readonly updatedAt: Date;
}

export interface FaqAdminRow {
  readonly id: string;
  readonly category: FaqCategory;
  readonly order: number;
  readonly question: LocalisedText;
  readonly answer: LocalisedText;
  readonly published: boolean;
  readonly updatedAt: Date;
}

export interface TestimonialAdminRow {
  readonly id: string;
  readonly authorName: string;
  readonly authorRole: string;
  readonly rating: number;
  readonly quote: LocalisedText;
  readonly courseId: string | null;
  readonly featured: boolean;
  /** `Testimonial.isPublished` — the approval flag the public site filters on. */
  readonly published: boolean;
  readonly order: number;
  readonly updatedAt: Date;
}

export interface BlogAdminRow {
  readonly id: string;
  readonly slug: string;
  readonly published: boolean;
  readonly publishedAt: Date | null;
  readonly title: LocalisedText;
  readonly excerpt: LocalisedText;
  readonly body: LocalisedText;
  readonly tags: string;
  readonly readMinutes: number;
  readonly updatedAt: Date;
}

export interface CategoryAdminRow {
  readonly id: string;
  readonly slug: string;
  readonly icon: string;
  readonly color: string;
  readonly order: number;
  readonly isActive: boolean;
  readonly name: LocalisedText;
  readonly description: LocalisedText;
  /** Courses filed under it. Non-zero blocks deletion. */
  readonly courseCount: number;
  readonly updatedAt: Date;
}

/** A course a testimonial may be attached to. */
export interface CourseRef {
  readonly id: string;
  readonly title: string;
}

/* -------------------------------------------------------------------------- */
/* Fixed vocabularies                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The categories a FAQ item may be filed under.
 *
 * Re-exported from the public reader rather than retyped: that module decides
 * the reading order of the groups on `/faq`, and a category the editor can pick
 * but the page cannot place would simply disappear into the alphabetical tail.
 */
export const FAQ_CATEGORIES = FAQ_GROUP_ORDER;

export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

function toFaqCategory(value: string): FaqCategory {
  const known = FAQ_CATEGORIES.find((entry) => entry === value);
  return known ?? 'INSCRIPTION';
}

/**
 * The four documents §12.5 requires, linked from the footer and served by the
 * `[...legal]` route. Deleting one would 404 a URL that is printed on invoices
 * and consent notices; unpublishing one is a compliance decision.
 */
export const LOCKED_PAGE_SLUGS = [
  'cgu',
  'confidentialite',
  'mentions-legales',
  'cookies',
] as const;

export function isLockedPageSlug(slug: string): boolean {
  return (LOCKED_PAGE_SLUGS as readonly string[]).includes(slug);
}

/** Design-token names a category badge may use (§3 — never a raw hex). */
export const CATEGORY_COLOR_TOKENS = [
  'strait',
  'brass',
  'success',
  'warn',
  'danger',
  'ink',
] as const;

export type CategoryColorToken = (typeof CATEGORY_COLOR_TOKENS)[number];

/* -------------------------------------------------------------------------- */
/* Readers                                                                     */
/* -------------------------------------------------------------------------- */

export async function listPages(): Promise<readonly PageAdminRow[]> {
  const rows = await db.page.findMany({ orderBy: [{ slug: 'asc' }] });

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    published: row.status === 'PUBLISHED',
    title: { fr: row.titleFr, ar: text(row.titleAr), en: text(row.titleEn), es: text(row.titleEs) },
    body: { fr: row.bodyFr, ar: text(row.bodyAr), en: text(row.bodyEn), es: text(row.bodyEs) },
    seoTitle: text(row.seoTitle),
    seoDescription: text(row.seoDescription),
    locked: isLockedPageSlug(row.slug),
    updatedAt: row.updatedAt,
  }));
}

export async function listFaqItems(): Promise<readonly FaqAdminRow[]> {
  const rows = await db.faqItem.findMany({
    orderBy: [{ category: 'asc' }, { order: 'asc' }, { id: 'asc' }],
  });

  return rows.map((row) => ({
    id: row.id,
    category: toFaqCategory(row.category),
    order: row.order,
    question: {
      fr: row.questionFr,
      ar: text(row.questionAr),
      en: text(row.questionEn),
      es: text(row.questionEs),
    },
    answer: {
      fr: row.answerFr,
      ar: text(row.answerAr),
      en: text(row.answerEn),
      es: text(row.answerEs),
    },
    published: row.isPublished,
    updatedAt: row.updatedAt,
  }));
}

export async function listTestimonials(): Promise<readonly TestimonialAdminRow[]> {
  const rows = await db.testimonial.findMany({
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
  });

  return rows.map((row) => ({
    id: row.id,
    authorName: row.authorName,
    authorRole: text(row.authorRole),
    rating: row.rating,
    quote: { fr: row.quoteFr, ar: text(row.quoteAr), en: text(row.quoteEn), es: text(row.quoteEs) },
    courseId: row.courseId,
    featured: row.isFeatured,
    published: row.isPublished,
    order: row.order,
    updatedAt: row.updatedAt,
  }));
}

export async function listBlogPosts(): Promise<readonly BlogAdminRow[]> {
  const rows = await db.blogPost.findMany({
    orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
  });

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    published: row.status === 'PUBLISHED',
    publishedAt: row.publishedAt,
    title: { fr: row.titleFr, ar: text(row.titleAr), en: text(row.titleEn), es: text(row.titleEs) },
    excerpt: {
      fr: text(row.excerptFr),
      ar: text(row.excerptAr),
      en: text(row.excerptEn),
      es: text(row.excerptEs),
    },
    body: { fr: row.bodyFr, ar: text(row.bodyAr), en: text(row.bodyEn), es: text(row.bodyEs) },
    tags: text(row.tags),
    readMinutes: row.readMinutes,
    updatedAt: row.updatedAt,
  }));
}

export async function listCategories(): Promise<readonly CategoryAdminRow[]> {
  const rows = await db.category.findMany({
    orderBy: [{ order: 'asc' }, { slug: 'asc' }],
    include: {
      translations: true,
      _count: { select: { courses: true } },
    },
  });

  return rows.map((row) => {
    const name: Record<Locale, string> = { fr: '', ar: '', en: '', es: '' };
    const description: Record<Locale, string> = { fr: '', ar: '', en: '', es: '' };

    for (const translation of row.translations) {
      const locale = CONTENT_LOCALES.find((entry) => entry === translation.locale);
      if (locale === undefined) continue;
      name[locale] = translation.name;
      description[locale] = text(translation.description);
    }

    return {
      id: row.id,
      slug: row.slug,
      icon: text(row.icon),
      color: text(row.color),
      order: row.order,
      isActive: row.isActive,
      name,
      description,
      courseCount: row._count.courses,
      updatedAt: row.updatedAt,
    };
  });
}

/** Published courses a testimonial can be attached to, French title. */
export async function listCourseRefs(): Promise<readonly CourseRef[]> {
  const rows = await db.course.findMany({
    where: { deletedAt: null },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      slug: true,
      translations: { where: { locale: 'fr' }, select: { title: true }, take: 1 },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.translations[0]?.title ?? row.slug,
  }));
}

/* -------------------------------------------------------------------------- */
/* Input schemas                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A field in four locales, French required.
 *
 * `.strict()` on the nested object too: `withAction` only inspects the top-level
 * schema, so an unknown key nested one level down would otherwise slip through.
 */
function localisedRequired(max: number): z.ZodType<LocalisedText> {
  return z
    .object({
      fr: z.string().trim().min(1).max(max),
      ar: z.string().trim().max(max),
      en: z.string().trim().max(max),
      es: z.string().trim().max(max),
    })
    .strict();
}

/** The same, with every locale optional — an excerpt, a description. */
function localisedOptional(max: number): z.ZodType<LocalisedText> {
  return z
    .object({
      fr: z.string().trim().max(max),
      ar: z.string().trim().max(max),
      en: z.string().trim().max(max),
      es: z.string().trim().max(max),
    })
    .strict();
}

const idSchema = z.string().min(1).max(64);
const optionalIdSchema = idSchema.nullable();

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(MAX_SLUG_LENGTH)
  .refine(isSlug, { message: 'slug' });

const TITLE_MAX = 200;
const SHORT_MAX = 300;
const EXCERPT_MAX = 600;
const BODY_MAX = 60_000;
const ANSWER_MAX = 8_000;
const QUOTE_MAX = 2_000;

export const savePageSchema = z
  .object({
    id: optionalIdSchema,
    slug: slugSchema,
    title: localisedRequired(TITLE_MAX),
    body: localisedRequired(BODY_MAX),
    seoTitle: z.string().trim().max(TITLE_MAX),
    seoDescription: z.string().trim().max(EXCERPT_MAX),
    published: z.boolean(),
  })
  .strict();

export const saveFaqSchema = z
  .object({
    id: optionalIdSchema,
    category: z.enum(FAQ_CATEGORIES),
    question: localisedRequired(SHORT_MAX),
    answer: localisedRequired(ANSWER_MAX),
    published: z.boolean(),
  })
  .strict();

export const saveTestimonialSchema = z
  .object({
    id: optionalIdSchema,
    authorName: z.string().trim().min(2).max(120),
    authorRole: z.string().trim().max(120),
    rating: z.number().int().min(1).max(5),
    quote: localisedRequired(QUOTE_MAX),
    courseId: optionalIdSchema,
    featured: z.boolean(),
    published: z.boolean(),
  })
  .strict();

export const saveBlogPostSchema = z
  .object({
    id: optionalIdSchema,
    slug: slugSchema,
    title: localisedRequired(TITLE_MAX),
    excerpt: localisedOptional(EXCERPT_MAX),
    body: localisedRequired(BODY_MAX),
    tags: z.string().trim().max(300),
    published: z.boolean(),
    /** `YYYY-MM-DD` — a future date schedules the post (§17.11 « scheduling »). */
    publishedOn: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable(),
  })
  .strict();

export const saveCategorySchema = z
  .object({
    id: optionalIdSchema,
    slug: slugSchema,
    icon: z.string().trim().max(40),
    color: z.enum(CATEGORY_COLOR_TOKENS).nullable(),
    isActive: z.boolean(),
    name: localisedRequired(TITLE_MAX),
    description: localisedOptional(EXCERPT_MAX),
  })
  .strict();

/** The five tables the CMS owns, as a discriminator for delete and reorder. */
export const CONTENT_KINDS = ['page', 'faq', 'testimonial', 'blog', 'category'] as const;

export type ContentKind = (typeof CONTENT_KINDS)[number];

export const deleteContentSchema = z
  .object({ kind: z.enum(CONTENT_KINDS), id: idSchema })
  .strict();

export const moveContentSchema = z
  .object({
    kind: z.enum(['faq', 'testimonial', 'category'] as const),
    id: idSchema,
    direction: z.enum(['up', 'down'] as const),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Actor & results                                                             */
/* -------------------------------------------------------------------------- */

/** Who is writing, and from where — everything the audit row needs. */
export interface ContentActor {
  readonly id: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** What a save did, in the shape the toast reports. */
export interface ContentSaveResult {
  readonly id: string;
  /** `true` when the row did not exist before this call. */
  readonly created: boolean;
  /** A human label for the toast — the slug, the author, the French title. */
  readonly label: string;
}

export interface ContentDeleteResult {
  readonly id: string;
  readonly label: string;
}

function notFound(): never {
  throw new ActionError('not_found', 'admin.actionError.notFound');
}

function conflict(): never {
  throw new ActionError('conflict', 'admin.actionError.conflict');
}

/** A duplicate slug is a field error, so the form can point at the field. */
function slugTaken(): never {
  throw new ActionError('validation', 'admin.courses.general.slugTaken', {
    slug: ['admin.courses.general.slugTaken'],
  });
}

async function audit(
  tx: AuditDbClient,
  actor: ContentActor,
  input: {
    readonly action: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly summary: string;
    readonly diff: ReturnType<typeof buildDiff>;
  },
): Promise<void> {
  await recordAudit(
    {
      actorId: actor.id,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      diff: input.diff,
      ip: actor.ip,
      userAgent: actor.userAgent,
    },
    tx,
  );
}

/** Field lengths rather than field contents: a diff is a list of changes, not a copy. */
function lengths(value: LocalisedText, prefix: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const locale of CONTENT_LOCALES) out[`${prefix}.${locale}`] = value[locale].trim().length;
  return out;
}

/* -------------------------------------------------------------------------- */
/* Pages                                                                       */
/* -------------------------------------------------------------------------- */

export async function savePage(
  input: z.output<typeof savePageSchema>,
  actor: ContentActor,
): Promise<ContentSaveResult> {
  return transaction(async (tx) => {
    const status = input.published ? 'PUBLISHED' : 'DRAFT';
    const data = {
      slug: input.slug,
      status,
      titleFr: input.title.fr,
      titleAr: orNull(input.title.ar),
      titleEn: orNull(input.title.en),
      titleEs: orNull(input.title.es),
      bodyFr: input.body.fr,
      bodyAr: orNull(input.body.ar),
      bodyEn: orNull(input.body.en),
      bodyEs: orNull(input.body.es),
      seoTitle: orNull(input.seoTitle),
      seoDescription: orNull(input.seoDescription),
    };

    const clash = await tx.page.findUnique({ where: { slug: input.slug }, select: { id: true } });
    if (clash !== null && clash.id !== input.id) slugTaken();

    if (input.id === null) {
      const created = await tx.page.create({ data, select: { id: true, slug: true } });
      await audit(tx, actor, {
        action: 'CMS_PAGE_CREATED',
        entityType: 'Page',
        entityId: created.id,
        summary: `Page « ${input.slug} » créée${input.published ? ' et publiée' : ' en brouillon'}.`,
        diff: buildDiff({}, { slug: input.slug, status, ...lengths(input.body, 'body') }),
      });
      return { id: created.id, created: true, label: created.slug };
    }

    const before = await tx.page.findUnique({ where: { id: input.id } });
    if (before === null) notFound();

    // A legal document may be edited freely; it may not lose its address — the
    // footer and the `[...legal]` route both name the slug.
    if (isLockedPageSlug(before.slug) && before.slug !== input.slug) conflict();

    await tx.page.update({ where: { id: input.id }, data });

    await audit(tx, actor, {
      action: 'CMS_PAGE_UPDATED',
      entityType: 'Page',
      entityId: input.id,
      summary: `Page « ${input.slug} » modifiée.`,
      diff: buildDiff(
        {
          slug: before.slug,
          status: before.status,
          ...lengths(
            {
              fr: before.bodyFr,
              ar: text(before.bodyAr),
              en: text(before.bodyEn),
              es: text(before.bodyEs),
            },
            'body',
          ),
        },
        { slug: input.slug, status, ...lengths(input.body, 'body') },
      ),
    });

    return { id: input.id, created: false, label: input.slug };
  });
}

/* -------------------------------------------------------------------------- */
/* FAQ                                                                         */
/* -------------------------------------------------------------------------- */

export async function saveFaqItem(
  input: z.output<typeof saveFaqSchema>,
  actor: ContentActor,
): Promise<ContentSaveResult> {
  return transaction(async (tx) => {
    const data = {
      category: input.category,
      questionFr: input.question.fr,
      questionAr: orNull(input.question.ar),
      questionEn: orNull(input.question.en),
      questionEs: orNull(input.question.es),
      answerFr: input.answer.fr,
      answerAr: orNull(input.answer.ar),
      answerEn: orNull(input.answer.en),
      answerEs: orNull(input.answer.es),
      isPublished: input.published,
    };

    if (input.id === null) {
      // New questions land at the end of their category, not on top of item 1.
      const last = await tx.faqItem.findFirst({
        where: { category: input.category },
        orderBy: { order: 'desc' },
        select: { order: true },
      });

      const created = await tx.faqItem.create({
        data: { ...data, order: (last?.order ?? -1) + 1 },
        select: { id: true },
      });

      await audit(tx, actor, {
        action: 'CMS_FAQ_CREATED',
        entityType: 'FaqItem',
        entityId: created.id,
        summary: `Question « ${input.question.fr} » ajoutée à la rubrique ${input.category}.`,
        diff: buildDiff({}, { category: input.category, isPublished: input.published }),
      });
      return { id: created.id, created: true, label: input.question.fr };
    }

    const before = await tx.faqItem.findUnique({ where: { id: input.id } });
    if (before === null) notFound();

    // Moving to another category puts the item at that category's end — the
    // only position that does not silently push somebody else down.
    let order = before.order;
    if (before.category !== input.category) {
      const last = await tx.faqItem.findFirst({
        where: { category: input.category },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      order = (last?.order ?? -1) + 1;
    }

    await tx.faqItem.update({ where: { id: input.id }, data: { ...data, order } });

    await audit(tx, actor, {
      action: 'CMS_FAQ_UPDATED',
      entityType: 'FaqItem',
      entityId: input.id,
      summary: `Question « ${input.question.fr} » modifiée.`,
      diff: buildDiff(
        { category: before.category, isPublished: before.isPublished, order: before.order },
        { category: input.category, isPublished: input.published, order },
      ),
    });

    return { id: input.id, created: false, label: input.question.fr };
  });
}

/* -------------------------------------------------------------------------- */
/* Testimonials                                                                */
/* -------------------------------------------------------------------------- */

export async function saveTestimonial(
  input: z.output<typeof saveTestimonialSchema>,
  actor: ContentActor,
): Promise<ContentSaveResult> {
  return transaction(async (tx) => {
    if (input.courseId !== null) {
      const course = await tx.course.findUnique({
        where: { id: input.courseId },
        select: { id: true },
      });
      if (course === null) notFound();
    }

    const data = {
      authorName: input.authorName,
      authorRole: orNull(input.authorRole),
      rating: input.rating,
      quoteFr: input.quote.fr,
      quoteAr: orNull(input.quote.ar),
      quoteEn: orNull(input.quote.en),
      quoteEs: orNull(input.quote.es),
      courseId: input.courseId,
      isFeatured: input.featured,
      isPublished: input.published,
    };

    if (input.id === null) {
      const last = await tx.testimonial.findFirst({
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      const created = await tx.testimonial.create({
        data: { ...data, order: (last?.order ?? -1) + 1 },
        select: { id: true },
      });

      await audit(tx, actor, {
        action: 'CMS_TESTIMONIAL_CREATED',
        entityType: 'Testimonial',
        entityId: created.id,
        summary: `Témoignage de ${input.authorName} ajouté${input.published ? ' et approuvé' : ' (non approuvé)'}.`,
        diff: buildDiff({}, { rating: input.rating, isPublished: input.published }),
      });
      return { id: created.id, created: true, label: input.authorName };
    }

    const before = await tx.testimonial.findUnique({ where: { id: input.id } });
    if (before === null) notFound();

    await tx.testimonial.update({ where: { id: input.id }, data });

    await audit(tx, actor, {
      action: 'CMS_TESTIMONIAL_UPDATED',
      entityType: 'Testimonial',
      entityId: input.id,
      summary: `Témoignage de ${input.authorName} modifié.`,
      diff: buildDiff(
        {
          authorName: before.authorName,
          rating: before.rating,
          isPublished: before.isPublished,
          isFeatured: before.isFeatured,
          courseId: before.courseId,
        },
        {
          authorName: input.authorName,
          rating: input.rating,
          isPublished: input.published,
          isFeatured: input.featured,
          courseId: input.courseId,
        },
      ),
    });

    return { id: input.id, created: false, label: input.authorName };
  });
}

/* -------------------------------------------------------------------------- */
/* Blog                                                                        */
/* -------------------------------------------------------------------------- */

/** `YYYY-MM-DD` at noon UTC — far enough from either midnight to survive a timezone. */
function publicationDate(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

export async function saveBlogPost(
  input: z.output<typeof saveBlogPostSchema>,
  actor: ContentActor,
): Promise<ContentSaveResult> {
  return transaction(async (tx) => {
    const before =
      input.id === null ? null : await tx.blogPost.findUnique({ where: { id: input.id } });
    if (input.id !== null && before === null) notFound();

    // §17.11: the address is locked once the post is published — an inbound link
    // and a sitemap entry already point at it.
    const slug = before !== null && before.status === 'PUBLISHED' ? before.slug : input.slug;

    const clash = await tx.blogPost.findUnique({ where: { slug }, select: { id: true } });
    if (clash !== null && clash.id !== input.id) slugTaken();

    const status = input.published ? 'PUBLISHED' : 'DRAFT';
    const publishedAt =
      input.publishedOn !== null
        ? publicationDate(input.publishedOn)
        : input.published
          ? (before?.publishedAt ?? new Date())
          : null;

    const data = {
      slug,
      status,
      publishedAt,
      titleFr: input.title.fr,
      titleAr: orNull(input.title.ar),
      titleEn: orNull(input.title.en),
      titleEs: orNull(input.title.es),
      excerptFr: orNull(input.excerpt.fr),
      excerptAr: orNull(input.excerpt.ar),
      excerptEn: orNull(input.excerpt.en),
      excerptEs: orNull(input.excerpt.es),
      bodyFr: input.body.fr,
      bodyAr: orNull(input.body.ar),
      bodyEn: orNull(input.body.en),
      bodyEs: orNull(input.body.es),
      tags: orNull(input.tags),
      // Recomputed from the French body on every save: the public card and the
      // article header must never disagree with the text they sit above.
      readMinutes: readingMinutes(input.body.fr),
    };

    if (before === null) {
      const created = await tx.blogPost.create({
        data: { ...data, authorId: actor.id },
        select: { id: true },
      });
      await audit(tx, actor, {
        action: 'CMS_POST_CREATED',
        entityType: 'BlogPost',
        entityId: created.id,
        summary: `Article « ${input.title.fr} » créé${input.published ? ' et publié' : ' en brouillon'}.`,
        diff: buildDiff({}, { slug, status, readMinutes: data.readMinutes }),
      });
      return { id: created.id, created: true, label: input.title.fr };
    }

    await tx.blogPost.update({ where: { id: before.id }, data });

    await audit(tx, actor, {
      action: 'CMS_POST_UPDATED',
      entityType: 'BlogPost',
      entityId: before.id,
      summary: `Article « ${input.title.fr} » modifié.`,
      diff: buildDiff(
        {
          slug: before.slug,
          status: before.status,
          publishedAt: before.publishedAt,
          readMinutes: before.readMinutes,
        },
        { slug, status, publishedAt, readMinutes: data.readMinutes },
      ),
    });

    return { id: before.id, created: false, label: input.title.fr };
  });
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

export async function saveCategory(
  input: z.output<typeof saveCategorySchema>,
  actor: ContentActor,
): Promise<ContentSaveResult> {
  return transaction(async (tx) => {
    const clash = await tx.category.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (clash !== null && clash.id !== input.id) slugTaken();

    const data = {
      slug: input.slug,
      icon: orNull(input.icon),
      color: input.color,
      isActive: input.isActive,
    };

    let categoryId: string;
    let created: boolean;
    let beforeSnapshot: Record<string, unknown> = {};

    if (input.id === null) {
      const last = await tx.category.findFirst({
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      const row = await tx.category.create({
        data: { ...data, order: (last?.order ?? -1) + 1 },
        select: { id: true },
      });
      categoryId = row.id;
      created = true;
    } else {
      const before = await tx.category.findUnique({ where: { id: input.id } });
      if (before === null) notFound();
      beforeSnapshot = { slug: before.slug, icon: before.icon, color: before.color, isActive: before.isActive };
      await tx.category.update({ where: { id: before.id }, data });
      categoryId = before.id;
      created = false;
    }

    // One `CategoryTranslation` row per filled locale. An emptied locale loses
    // its row rather than keeping a blank name the catalogue would render.
    for (const locale of CONTENT_LOCALES) {
      const name = input.name[locale].trim();
      const description = orNull(input.description[locale]);

      if (name === '') {
        await tx.categoryTranslation.deleteMany({ where: { categoryId, locale } });
        continue;
      }

      await tx.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId, locale } },
        create: { categoryId, locale, name, description },
        update: { name, description },
      });
    }

    await audit(tx, actor, {
      action: created ? 'CMS_CATEGORY_CREATED' : 'CMS_CATEGORY_UPDATED',
      entityType: 'Category',
      entityId: categoryId,
      summary: `Catégorie « ${input.name.fr} » ${created ? 'créée' : 'modifiée'}.`,
      diff: buildDiff(beforeSnapshot, {
        slug: input.slug,
        icon: orNull(input.icon),
        color: input.color,
        isActive: input.isActive,
      }),
    });

    return { id: categoryId, created, label: input.name.fr };
  });
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Move one row up or down among its siblings.
 *
 * Orders are **renumbered from zero** rather than swapped with the neighbour:
 * the seed leaves every row at `order = 0`, and swapping two zeroes moves
 * nothing. Renumbering the whole sibling list is O(n) on a list of at most a few
 * dozen rows and leaves the column in a state where the next move works.
 */
export async function moveContentItem(
  input: z.output<typeof moveContentSchema>,
  actor: ContentActor,
): Promise<{ readonly moved: boolean }> {
  return transaction(async (tx) => {
    const siblings = await loadSiblings(tx, input.kind, input.id);
    const index = siblings.findIndex((row) => row.id === input.id);
    if (index < 0) notFound();

    const target = input.direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= siblings.length) return { moved: false };

    const reordered = [...siblings];
    const [moving] = reordered.splice(index, 1);
    if (moving === undefined) return { moved: false };
    reordered.splice(target, 0, moving);

    for (const [position, row] of reordered.entries()) {
      if (row.order === position) continue;
      await updateOrder(tx, input.kind, row.id, position);
    }

    await audit(tx, actor, {
      action: 'CMS_ORDER_CHANGED',
      entityType: ENTITY_TYPE[input.kind],
      entityId: input.id,
      summary: `Ordre d'affichage modifié : position ${index + 1} → ${target + 1}.`,
      diff: buildDiff({ order: index }, { order: target }),
    });

    return { moved: true };
  });
}

const ENTITY_TYPE: Record<ContentKind, string> = {
  page: 'Page',
  faq: 'FaqItem',
  testimonial: 'Testimonial',
  blog: 'BlogPost',
  category: 'Category',
};

type OrderableKind = z.output<typeof moveContentSchema>['kind'];

interface OrderableRow {
  readonly id: string;
  readonly order: number;
}

/**
 * The rows a move is relative to, in display order.
 *
 * FAQ order is scoped to a category (§17.11: « order within category »), so the
 * siblings of a question are the other questions in its own rubric — moving one
 * up must never jump it into `PAIEMENT`.
 */
async function loadSiblings(
  tx: AuditDbClient,
  kind: OrderableKind,
  id: string,
): Promise<readonly OrderableRow[]> {
  if (kind === 'faq') {
    const row = await tx.faqItem.findUnique({ where: { id }, select: { category: true } });
    if (row === null) notFound();
    return tx.faqItem.findMany({
      where: { category: row.category },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: { id: true, order: true },
    });
  }

  if (kind === 'testimonial') {
    return tx.testimonial.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, order: true },
    });
  }

  return tx.category.findMany({
    orderBy: [{ order: 'asc' }, { slug: 'asc' }],
    select: { id: true, order: true },
  });
}

async function updateOrder(
  tx: AuditDbClient,
  kind: OrderableKind,
  id: string,
  order: number,
): Promise<void> {
  if (kind === 'faq') {
    await tx.faqItem.update({ where: { id }, data: { order } });
    return;
  }
  if (kind === 'testimonial') {
    await tx.testimonial.update({ where: { id }, data: { order } });
    return;
  }
  await tx.category.update({ where: { id }, data: { order } });
}

/* -------------------------------------------------------------------------- */
/* Deletion                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Delete one editorial row.
 *
 * Refused — with `conflict`, which the interface renders as « modifié
 * entre-temps / rechargez » — when something still points at it: one of the four
 * legal slugs, or a category that still files courses. The interface disables
 * the button in both cases and explains why; this is the server-side half of the
 * same rule, because a disabled button is a hint, not a guarantee.
 */
export async function deleteContentItem(
  input: z.output<typeof deleteContentSchema>,
  actor: ContentActor,
): Promise<ContentDeleteResult> {
  return transaction(async (tx) => {
    switch (input.kind) {
      case 'page': {
        const row = await tx.page.findUnique({ where: { id: input.id } });
        if (row === null) notFound();
        if (isLockedPageSlug(row.slug)) conflict();
        await tx.page.delete({ where: { id: input.id } });
        await audit(tx, actor, {
          action: 'CMS_PAGE_DELETED',
          entityType: 'Page',
          entityId: input.id,
          summary: `Page « ${row.slug} » supprimée.`,
          diff: buildDiff({ slug: row.slug, status: row.status }, {}),
        });
        return { id: input.id, label: row.slug };
      }

      case 'faq': {
        const row = await tx.faqItem.findUnique({ where: { id: input.id } });
        if (row === null) notFound();
        await tx.faqItem.delete({ where: { id: input.id } });
        await audit(tx, actor, {
          action: 'CMS_FAQ_DELETED',
          entityType: 'FaqItem',
          entityId: input.id,
          summary: `Question « ${row.questionFr} » supprimée.`,
          diff: buildDiff({ category: row.category }, {}),
        });
        return { id: input.id, label: row.questionFr };
      }

      case 'testimonial': {
        const row = await tx.testimonial.findUnique({ where: { id: input.id } });
        if (row === null) notFound();
        await tx.testimonial.delete({ where: { id: input.id } });
        await audit(tx, actor, {
          action: 'CMS_TESTIMONIAL_DELETED',
          entityType: 'Testimonial',
          entityId: input.id,
          summary: `Témoignage de ${row.authorName} supprimé.`,
          diff: buildDiff({ authorName: row.authorName, rating: row.rating }, {}),
        });
        return { id: input.id, label: row.authorName };
      }

      case 'blog': {
        const row = await tx.blogPost.findUnique({ where: { id: input.id } });
        if (row === null) notFound();
        await tx.blogPost.delete({ where: { id: input.id } });
        await audit(tx, actor, {
          action: 'CMS_POST_DELETED',
          entityType: 'BlogPost',
          entityId: input.id,
          summary: `Article « ${row.titleFr} » supprimé.`,
          diff: buildDiff({ slug: row.slug, status: row.status }, {}),
        });
        return { id: input.id, label: row.titleFr };
      }

      default: {
        const row = await tx.category.findUnique({
          where: { id: input.id },
          include: {
            _count: { select: { courses: true } },
            translations: { where: { locale: 'fr' }, select: { name: true }, take: 1 },
          },
        });
        if (row === null) notFound();
        if (row._count.courses > 0) conflict();

        // `CategoryTranslation` cascades on delete (schema `onDelete: Cascade`).
        await tx.category.delete({ where: { id: input.id } });

        const label = row.translations[0]?.name ?? row.slug;
        await audit(tx, actor, {
          action: 'CMS_CATEGORY_DELETED',
          entityType: 'Category',
          entityId: input.id,
          summary: `Catégorie « ${label} » supprimée.`,
          diff: buildDiff({ slug: row.slug }, {}),
        });
        return { id: input.id, label };
      }
    }
  });
}
