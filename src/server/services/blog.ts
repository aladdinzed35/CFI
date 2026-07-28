import { db } from '@/server/db';
import { publicMediaUrl } from '@/server/services/public-pages';
import type { Locale } from '@/i18n/routing';

/**
 * Read models for `/blog` and `/blog/[slug]` (§12.5).
 *
 * ## Nothing here assumes there is a blog yet
 * `BlogPost` is empty in production today. Every reader in this file returns an
 * empty list or `null` for that case rather than throwing, so the index renders
 * its designed empty state (§11.5), `generateStaticParams` returns `[]` — which
 * is a legal answer for a dynamic segment, Next simply renders on demand — and
 * `next build` succeeds. The moment an editor publishes a row, the same code
 * paths produce a real, paginated, filterable blog with no further work.
 *
 * ## Columns, not translation rows
 * Like `Page` and `FaqItem`, `BlogPost` denormalises its translations into
 * `titleFr`/`titleAr`/… columns. `pickText` resolves the requested locale and
 * falls back to French (§10.2), and reports which locale actually won so the
 * article can carry the right `lang` and `dir`.
 *
 * ## Reading time is computed, never trusted
 * `BlogPost.readMinutes` is a single integer for four bodies of four different
 * lengths — an Arabic translation and its French original are never the same
 * number of words. The public pages therefore count the body they are about to
 * render. The stored column stays as the editor's own estimate for the admin.
 *
 * ## Categories are the `tags` column
 * There is no blog-category table; `tags` is the same comma-separated convention
 * `User.tags` already uses. The facet list is derived from the tags of the posts
 * that actually exist, so a category can never be offered that leads nowhere.
 */

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Cards per page on the index. */
export const BLOG_PAGE_SIZE = 9;

/** A deliberately conservative pace: prose, on a phone, in a second language. */
const WORDS_PER_MINUTE = 200;

/** A non-empty trimmed string, or `null`. */
function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The four localised values of one column, in the shape `pickText` reads. */
export type LocalisedColumn = Readonly<Record<Locale, string | null>>;

interface Resolved {
  readonly value: string | null;
  readonly resolvedLocale: Locale;
}

/** Requested locale → French → nothing, saying which one answered. */
function pickText(column: LocalisedColumn, locale: Locale): Resolved {
  const exact = clean(column[locale]);
  if (exact !== null) return { value: exact, resolvedLocale: locale };
  return { value: clean(column.fr), resolvedLocale: 'fr' };
}

function warn(scope: string, cause: unknown): void {
  console.warn(`[blog] ${scope} : lecture impossible, repli sur une liste vide.`, cause);
}

/* -------------------------------------------------------------------------- */
/* Tags → categories                                                           */
/* -------------------------------------------------------------------------- */

export interface BlogTag {
  /** URL-safe identifier used in `?categorie=`. */
  readonly slug: string;
  /** The label exactly as the editor typed it. */
  readonly label: string;
}

export interface BlogCategory extends BlogTag {
  /** Published posts carrying this tag. Never zero — the facet is derived. */
  readonly count: number;
}

/**
 * A tag as a URL segment: accents folded, Latin lowercased, Arabic preserved.
 *
 * Arabic letters are kept rather than transliterated, so « تسويق » stays itself
 * in the query string (percent-encoded on the wire) instead of collapsing to an
 * empty slug the way a Latin-only pattern would make it.
 */
export function slugifyTag(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `'marketing, réseaux sociaux'` → two tags. Blank and duplicate entries drop. */
export function parseTags(raw: string | null): readonly BlogTag[] {
  if (raw === null) return [];

  const tags: BlogTag[] = [];
  const seen = new Set<string>();

  for (const piece of raw.split(',')) {
    const label = piece.trim();
    if (label === '') continue;
    const slug = slugifyTag(label);
    if (slug === '' || seen.has(slug)) continue;
    seen.add(slug);
    tags.push({ slug, label });
  }

  return tags;
}

/* -------------------------------------------------------------------------- */
/* Reading time                                                                */
/* -------------------------------------------------------------------------- */

/** Markers the editors' Markdown subset carries, stripped before counting. */
const MARKDOWN_NOISE = /^\s{0,3}(#{1,6}\s+|>\s?|\d+[.)]\s+|[-*+]\s+)/gm;
const MARKDOWN_EMPHASIS = /(\*\*|[*_`])/g;

/** Minutes to read `body`, from the body itself. Always at least one. */
export function readingMinutes(body: string): number {
  const words = body
    .replace(MARKDOWN_NOISE, '')
    .replace(MARKDOWN_EMPHASIS, '')
    .split(/\s+/)
    .filter((word) => word !== '').length;

  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/* -------------------------------------------------------------------------- */
/* Read models                                                                 */
/* -------------------------------------------------------------------------- */

export interface BlogPostSummary {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string | null;
  readonly coverUrl: string | null;
  readonly tags: readonly BlogTag[];
  readonly authorName: string | null;
  readonly publishedAt: Date;
  readonly updatedAt: Date;
  /** Counted from the body served in `resolvedLocale`. */
  readonly readMinutes: number;
  /** The locale the text was actually served in — `fr` when falling back. */
  readonly resolvedLocale: Locale;
}

export interface BlogPostDetail extends BlogPostSummary {
  /** Markdown, as authored in the admin. Never HTML. */
  readonly body: string;
}

export interface BlogIndex {
  readonly posts: readonly BlogPostSummary[];
  /** Posts matching the active filter. */
  readonly total: number;
  /** Every published post, filter ignored — tells « no blog yet » from « no match ». */
  readonly totalPublished: number;
  readonly page: number;
  readonly pageCount: number;
  readonly categories: readonly BlogCategory[];
  /** The resolved active filter, or `null` when showing everything. */
  readonly category: BlogCategory | null;
  /** A `?categorie=` value no published post carries. The page redirects. */
  readonly unknownCategory: boolean;
}

const EMPTY_INDEX: BlogIndex = {
  posts: [],
  total: 0,
  totalPublished: 0,
  page: 1,
  pageCount: 1,
  categories: [],
  category: null,
  unknownCategory: false,
};

/** The row shape both readers select. Bodies included: reading time needs them. */
const POST_SELECT = {
  id: true,
  slug: true,
  authorId: true,
  coverKey: true,
  tags: true,
  readMinutes: true,
  publishedAt: true,
  updatedAt: true,
  titleFr: true,
  titleAr: true,
  titleEn: true,
  titleEs: true,
  excerptFr: true,
  excerptAr: true,
  excerptEn: true,
  excerptEs: true,
  bodyFr: true,
  bodyAr: true,
  bodyEn: true,
  bodyEs: true,
} as const;

interface PostRow {
  readonly id: string;
  readonly slug: string;
  readonly authorId: string | null;
  readonly coverKey: string | null;
  readonly tags: string | null;
  readonly readMinutes: number;
  readonly publishedAt: Date | null;
  readonly updatedAt: Date;
  readonly titleFr: string;
  readonly titleAr: string | null;
  readonly titleEn: string | null;
  readonly titleEs: string | null;
  readonly excerptFr: string | null;
  readonly excerptAr: string | null;
  readonly excerptEn: string | null;
  readonly excerptEs: string | null;
  readonly bodyFr: string;
  readonly bodyAr: string | null;
  readonly bodyEn: string | null;
  readonly bodyEs: string | null;
}

/**
 * One row → the shape a page renders, or `null` when it cannot be shown.
 *
 * The body decides the locale and the title follows it, exactly as the legal
 * pages do: a post with an Arabic body but no Arabic title must not render a
 * French heading over an Arabic article.
 */
function toDetail(row: PostRow, locale: Locale, authorName: string | null): BlogPostDetail | null {
  if (row.publishedAt === null) return null;

  const body = pickText(
    { fr: row.bodyFr, ar: row.bodyAr, en: row.bodyEn, es: row.bodyEs },
    locale,
  );
  if (body.value === null) return null;

  const served = body.resolvedLocale;
  const titles: LocalisedColumn = {
    fr: row.titleFr,
    ar: row.titleAr,
    en: row.titleEn,
    es: row.titleEs,
  };
  const title = clean(titles[served]) ?? clean(row.titleFr);
  if (title === null) return null;

  const excerpts: LocalisedColumn = {
    fr: row.excerptFr,
    ar: row.excerptAr,
    en: row.excerptEn,
    es: row.excerptEs,
  };

  return {
    id: row.id,
    slug: row.slug,
    title,
    excerpt: clean(excerpts[served]) ?? clean(row.excerptFr),
    coverUrl: publicMediaUrl(row.coverKey),
    tags: parseTags(row.tags),
    authorName,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    readMinutes: readingMinutes(body.value),
    resolvedLocale: served,
    body: body.value,
  };
}

/** Display names for a set of author ids, in one query. Missing ids are absent. */
async function authorNames(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  try {
    const rows = await db.user.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true, fullName: true },
    });

    const names = new Map<string, string>();
    for (const row of rows) {
      const name = clean(row.fullName);
      if (name !== null) names.set(row.id, name);
    }
    return names;
  } catch (cause) {
    warn('authors', cause);
    return new Map();
  }
}

/* -------------------------------------------------------------------------- */
/* Index                                                                       */
/* -------------------------------------------------------------------------- */

export interface BlogIndexQuery {
  readonly locale: Locale;
  /** 1-based. Out-of-range values are clamped, never 404. */
  readonly page?: number;
  /** A `slugifyTag` value from `?categorie=`. */
  readonly category?: string | null;
  readonly pageSize?: number;
}

/**
 * The index: facet counts over every published post, then one page of rows.
 *
 * ## Why two queries
 * The facets must count *all* published posts — a category list built from the
 * current page would change as the visitor paginates, which is worse than no
 * facets at all. The first query therefore reads two tiny columns for every
 * published post; only the nine rows actually shown are read in full, so the
 * `LongText` bodies never leave the database for posts nobody is looking at.
 *
 * ## Why the filter is applied in memory
 * `tags` is a comma-separated column, so `LIKE '%marketing%'` also matches
 * « marketing-automation ». Splitting the values and comparing whole tags is the
 * only way to be right, and at blog scale — hundreds of rows, two columns — it
 * costs nothing. When this becomes a real tag table, only this function changes.
 */
export async function getBlogIndex(query: BlogIndexQuery): Promise<BlogIndex> {
  const pageSize = Math.max(1, Math.round(query.pageSize ?? BLOG_PAGE_SIZE));
  const now = new Date();

  let index: ReadonlyArray<{ id: string; tags: string | null }>;
  try {
    index = await db.blogPost.findMany({
      where: { status: 'PUBLISHED', publishedAt: { not: null, lte: now } },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, tags: true },
    });
  } catch (cause) {
    warn('index', cause);
    return EMPTY_INDEX;
  }

  // Facets, in the order that reads best: most-used first, then alphabetically.
  const facets = new Map<string, { label: string; count: number }>();
  for (const row of index) {
    for (const tag of parseTags(row.tags)) {
      const existing = facets.get(tag.slug);
      if (existing === undefined) {
        facets.set(tag.slug, { label: tag.label, count: 1 });
      } else {
        existing.count += 1;
      }
    }
  }

  const categories: readonly BlogCategory[] = [...facets.entries()]
    .map(([slug, facet]) => ({ slug, label: facet.label, count: facet.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, query.locale));

  const requested = clean(query.category);
  const category = requested === null ? null : (categories.find((c) => c.slug === requested) ?? null);

  if (requested !== null && category === null) {
    return { ...EMPTY_INDEX, totalPublished: index.length, categories, unknownCategory: true };
  }

  const matching =
    category === null
      ? index
      : index.filter((row) => parseTags(row.tags).some((tag) => tag.slug === category.slug));

  const total = matching.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Math.round(query.page ?? 1), 1), pageCount);

  const slice = matching.slice((page - 1) * pageSize, page * pageSize);
  const order = new Map(slice.map((row, position) => [row.id, position]));

  if (slice.length === 0) {
    return {
      posts: [],
      total,
      totalPublished: index.length,
      page,
      pageCount,
      categories,
      category,
      unknownCategory: false,
    };
  }

  let rows: readonly PostRow[];
  try {
    rows = await db.blogPost.findMany({
      where: { id: { in: [...order.keys()] } },
      select: POST_SELECT,
    });
  } catch (cause) {
    warn('page', cause);
    return { ...EMPTY_INDEX, totalPublished: index.length, categories, category };
  }

  const names = await authorNames(
    rows.map((row) => row.authorId).filter((id): id is string => id !== null),
  );

  const posts = rows
    .map((row) => toDetail(row, query.locale, row.authorId === null ? null : (names.get(row.authorId) ?? null)))
    .filter((post): post is BlogPostDetail => post !== null)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return {
    posts,
    total,
    totalPublished: index.length,
    page,
    pageCount,
    categories,
    category,
    unknownCategory: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Single post                                                                 */
/* -------------------------------------------------------------------------- */

/** One published post by slug, in `locale`, falling back to French. */
export async function getPostBySlug(slug: string, locale: Locale): Promise<BlogPostDetail | null> {
  const now = new Date();

  let row: PostRow | null;
  try {
    row = await db.blogPost.findFirst({
      where: { slug, status: 'PUBLISHED', publishedAt: { not: null, lte: now } },
      select: POST_SELECT,
    });
  } catch (cause) {
    warn(`post:${slug}`, cause);
    return null;
  }

  if (row === null) return null;

  const names = await authorNames(row.authorId === null ? [] : [row.authorId]);
  return toDetail(row, locale, row.authorId === null ? null : (names.get(row.authorId) ?? null));
}

/**
 * Slugs of every published post, for `generateStaticParams`.
 *
 * Empty today, and that is a valid answer: Next renders the segment on demand
 * instead of pre-rendering nothing, and the build stays green.
 */
export async function listPublishedPostSlugs(): Promise<readonly string[]> {
  try {
    const rows = await db.blogPost.findMany({
      where: { status: 'PUBLISHED', publishedAt: { not: null, lte: new Date() } },
      orderBy: { publishedAt: 'desc' },
      select: { slug: true },
    });
    return rows.map((row) => row.slug);
  } catch (cause) {
    warn('slugs', cause);
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Related content                                                             */
/* -------------------------------------------------------------------------- */

export interface RelatedCourse {
  readonly slug: string;
  readonly title: string;
}

/**
 * Published courses whose category matches one of the article's tags.
 *
 * The link is real or it is absent: there is no editorial relation between a
 * post and a course, so the only honest join is « this article is tagged
 * *marketing* and these are the marketing courses ». A tag matching no category
 * simply yields nothing, and the section disappears (§12.2).
 */
export async function getRelatedCourses(
  tags: readonly BlogTag[],
  locale: Locale,
  limit = 3,
): Promise<readonly RelatedCourse[]> {
  const slugs = tags.map((tag) => tag.slug);
  if (slugs.length === 0) return [];

  try {
    const rows = await db.course.findMany({
      where: {
        status: 'PUBLISHED',
        deletedAt: null,
        category: { slug: { in: slugs }, isActive: true },
      },
      orderBy: [{ enrollmentCount: 'desc' }, { slug: 'asc' }],
      take: Math.max(1, limit),
      select: {
        slug: true,
        translations: {
          where: { locale: { in: [locale, 'fr'] } },
          select: { locale: true, title: true },
        },
      },
    });

    const courses: RelatedCourse[] = [];
    for (const row of rows) {
      const translations = row.translations;
      const chosen =
        translations.find((entry) => entry.locale === locale) ??
        translations.find((entry) => entry.locale === 'fr');
      const title = clean(chosen?.title);
      if (title !== null) courses.push({ slug: row.slug, title });
    }
    return courses;
  } catch (cause) {
    warn('related-courses', cause);
    return [];
  }
}

/** Other published posts sharing at least one tag, newest first. */
export async function getRelatedPosts(
  post: BlogPostSummary,
  locale: Locale,
  limit = 3,
): Promise<readonly BlogPostSummary[]> {
  const slugs = new Set(post.tags.map((tag) => tag.slug));
  if (slugs.size === 0) return [];

  const now = new Date();

  let index: ReadonlyArray<{ id: string; tags: string | null }>;
  try {
    index = await db.blogPost.findMany({
      where: { status: 'PUBLISHED', publishedAt: { not: null, lte: now }, id: { not: post.id } },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, tags: true },
    });
  } catch (cause) {
    warn('related-posts', cause);
    return [];
  }

  const ids = index
    .filter((row) => parseTags(row.tags).some((tag) => slugs.has(tag.slug)))
    .slice(0, Math.max(1, limit))
    .map((row) => row.id);

  if (ids.length === 0) return [];

  const position = new Map(ids.map((id, at) => [id, at]));

  try {
    const rows = await db.blogPost.findMany({ where: { id: { in: ids } }, select: POST_SELECT });
    const names = await authorNames(
      rows.map((row) => row.authorId).filter((id): id is string => id !== null),
    );

    return rows
      .map((row) =>
        toDetail(row, locale, row.authorId === null ? null : (names.get(row.authorId) ?? null)),
      )
      .filter((entry): entry is BlogPostDetail => entry !== null)
      .sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  } catch (cause) {
    warn('related-posts', cause);
    return [];
  }
}
