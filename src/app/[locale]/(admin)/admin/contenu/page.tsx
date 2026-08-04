import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';

import { formatDate, formatDateTime, toDateTimeAttribute } from '@/lib/dates';
import { isLocale, type Locale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { requirePageAdmin } from '@/server/auth/guards';
import {
  FAQ_CATEGORIES,
  listBlogPosts,
  listCategories,
  listCourseRefs,
  listFaqItems,
  listPages,
  listTestimonials,
} from '@/server/services/content-admin';

import { BlogTab } from './blog-tab';
import { CategoriesTab } from './categories-tab';
import { FaqTab } from './faq-tab';
import { PagesTab } from './pages-tab';
import { TestimonialsTab } from './testimonials-tab';
import {
  CMS_TABS,
  CMS_TAB_KEYS,
  PARAM,
  type BlogItem,
  type BlogStatus,
  type CmsTabKey,
} from './content-view';

/**
 * `/admin/contenu` — the CMS (§17.11).
 *
 * Five editorial tables behind five tabs: the legal pages, the FAQ, the
 * testimonials, the blog and the catalogue categories. This file is the
 * boundary. It validates the URL, asks `content-admin` for the rows of the
 * **active tab only**, formats every date into a string, and hands the result to
 * a client component. Nothing below it queries; nothing above it formats.
 *
 * ## One query per visit, not five
 * The tab lives in the URL (`?onglet=faq`), so the server renders exactly the
 * list being looked at. Loading all five would mean five round trips to show one
 * of them — and the blog bodies alone are the largest text columns in the
 * schema.
 *
 * ## The tabs are links, not client state
 * A `<nav>` of `Link`s rather than a Radix `Tabs`: the tab must survive a
 * refresh, be shareable (« regarde la FAQ, deuxième question »), and go back
 * with the browser's own button after a save. `aria-current="page"` is what
 * marks the active one — the same pattern the admin navigation uses.
 *
 * ## What is deliberately absent
 * §17.11 also names a homepage builder, a media library and an announcements
 * list. Those belong to other agents and other milestones. A tab that opens on
 * « bientôt » is worse than a tab that is not there (rule 8), so they are not
 * rendered at all.
 */

type LocaleParams = { locale: string };
type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * The URL is attacker-controlled input (§20). An unknown tab falls back to the
 * first one with `.catch()` rather than throwing: a tracking parameter appended
 * to a shared link must not turn the CMS into an error page.
 */
const searchParamsSchema = z.object({
  [PARAM.tab]: z.enum(CMS_TAB_KEYS).optional().catch(undefined),
});

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default async function ContentPage({
  params,
  searchParams,
}: {
  params: Promise<LocaleParams>;
  searchParams: Promise<RawSearchParams>;
}): Promise<React.JSX.Element> {
  const [{ locale }, rawSearch] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  await requirePageAdmin(locale);

  const t = await getTranslations('admin.cms');

  const query = searchParamsSchema.parse(
    Object.fromEntries(Object.entries(rawSearch).map(([key, value]) => [key, firstValue(value)])),
  );
  const tab: CmsTabKey = query[PARAM.tab] ?? 'pages';

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1 pb-4">
        <h1 className="font-display text-title text-ink">{t('title')}</h1>
        <p className="max-w-prose text-sm text-ink-muted">{t('subtitle')}</p>
      </header>

      <nav aria-label={t('title')} className="hairline-b mb-6 flex w-full items-stretch gap-1 overflow-x-auto">
        {CMS_TABS.map((entry) => {
          const active = entry.key === tab;
          return (
            <Link
              key={entry.key}
              href={{ pathname: '/admin/contenu', query: { [PARAM.tab]: entry.key } }}
              aria-current={active ? 'page' : undefined}
              className={[
                'relative -mb-px inline-flex min-h-11 shrink-0 items-center whitespace-nowrap px-4 text-body',
                'border-b-2 transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                active
                  ? 'border-strait font-medium text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {t(entry.labelKey)}
            </Link>
          );
        })}
      </nav>

      {await renderTab(tab, locale)}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab rendering                                                               */
/* -------------------------------------------------------------------------- */

async function renderTab(tab: CmsTabKey, locale: Locale): Promise<React.JSX.Element> {
  switch (tab) {
    case 'faq': {
      const rows = await listFaqItems();
      return (
        <FaqTab
          categories={[...FAQ_CATEGORIES]}
          items={rows.map((row) => ({
            id: row.id,
            category: row.category,
            question: { ...row.question },
            answer: { ...row.answer },
            published: row.published,
            updatedAtLabel: formatDateTime(row.updatedAt, locale),
            updatedAtIso: toDateTimeAttribute(row.updatedAt),
          }))}
        />
      );
    }

    case 'temoignages': {
      const [rows, courses] = await Promise.all([listTestimonials(), listCourseRefs()]);
      return (
        <TestimonialsTab
          courses={courses.map((course) => ({ id: course.id, title: course.title }))}
          items={rows.map((row) => ({
            id: row.id,
            authorName: row.authorName,
            authorRole: row.authorRole,
            rating: row.rating,
            quote: { ...row.quote },
            courseId: row.courseId,
            featured: row.featured,
            published: row.published,
            updatedAtLabel: formatDateTime(row.updatedAt, locale),
            updatedAtIso: toDateTimeAttribute(row.updatedAt),
          }))}
        />
      );
    }

    case 'blog': {
      const rows = await listBlogPosts();
      const now = Date.now();
      return <BlogTab items={rows.map((row) => toBlogItem(row, locale, now))} />;
    }

    case 'categories': {
      const rows = await listCategories();
      return (
        <CategoriesTab
          items={rows.map((row) => ({
            id: row.id,
            slug: row.slug,
            icon: row.icon,
            color: row.color,
            isActive: row.isActive,
            name: { ...row.name },
            description: { ...row.description },
            courseCount: row.courseCount,
            updatedAtLabel: formatDateTime(row.updatedAt, locale),
            updatedAtIso: toDateTimeAttribute(row.updatedAt),
          }))}
        />
      );
    }

    default: {
      const rows = await listPages();
      return (
        <PagesTab
          items={rows.map((row) => ({
            id: row.id,
            slug: row.slug,
            published: row.published,
            title: { ...row.title },
            body: { ...row.body },
            seoTitle: row.seoTitle,
            seoDescription: row.seoDescription,
            locked: row.locked,
            updatedAtLabel: formatDateTime(row.updatedAt, locale),
            updatedAtIso: toDateTimeAttribute(row.updatedAt),
          }))}
        />
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Blog view model                                                             */
/* -------------------------------------------------------------------------- */

type BlogRow = Awaited<ReturnType<typeof listBlogPosts>>[number];

/**
 * `YYYY-MM-DD` in the Casablanca day the instant falls in — the value the native
 * date input round-trips without inventing a timezone shift.
 */
function isoDay(value: Date | null): string {
  if (value === null) return '';
  return toDateTimeAttribute(value).slice(0, 10);
}

/**
 * The pill the list shows.
 *
 * « Programmé » is `status = PUBLISHED` with a `publishedAt` still in the
 * future — exactly the combination the public reader filters out. Derived here
 * rather than in the browser: a clock read during hydration would not match the
 * one read during the render.
 */
function blogStatus(row: BlogRow, now: number): BlogStatus {
  if (!row.published) return 'DRAFT';
  if (row.publishedAt !== null && row.publishedAt.getTime() > now) return 'SCHEDULED';
  return 'PUBLISHED';
}

function toBlogItem(row: BlogRow, locale: Locale, now: number): BlogItem {
  return {
    id: row.id,
    slug: row.slug,
    published: row.published,
    status: blogStatus(row, now),
    publishedOn: isoDay(row.publishedAt),
    publishedAtLabel: row.publishedAt === null ? '' : formatDate(row.publishedAt, locale),
    title: { ...row.title },
    excerpt: { ...row.excerpt },
    body: { ...row.body },
    tags: row.tags,
    readMinutes: row.readMinutes,
    updatedAtLabel: formatDateTime(row.updatedAt, locale),
    updatedAtIso: toDateTimeAttribute(row.updatedAt),
  };
}
