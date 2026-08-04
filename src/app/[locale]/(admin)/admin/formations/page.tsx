import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';

import { formatDateTime, toDateTimeAttribute } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { isLocale, type Locale } from '@/i18n/routing';
import { requirePageAdmin } from '@/server/auth/guards';
import {
  adminCourseCounts,
  listAdminCourses,
  listCategoryOptions,
  type AdminCourseRow,
  type CategoryOption,
  type CourseStatusCounts,
} from '@/server/services/course-admin';

import { CoursesTable } from './courses-table';
import { NewCourseButton } from './new-course-button';
import {
  PARAM,
  SORT_KEYS,
  TABS,
  type CourseRowView,
  type SortParam,
  type TabKey,
} from './course-view';

/**
 * `/admin/formations` — the catalogue an administrator can actually run (§17.5).
 *
 * The boundary layer, and only that: it validates the URL, asks the read model
 * for one page, and turns `Date` and centimes into strings. The table below it
 * receives nothing it would need a timezone database or a message catalogue to
 * render.
 *
 * ## Which tab opens
 * « Toutes », always. Unlike the account and payment queues this screen has no
 * backlog to clear — an author arrives looking for a specific course, and a
 * default that hides two thirds of the catalogue is a default that hides the
 * course they came for.
 */

type LocaleParams = { locale: string };
type RawSearchParams = Record<string, string | string[] | undefined>;

const TAB_KEYS = TABS.map((tab) => tab.key) as [TabKey, ...TabKey[]];

const searchParamsSchema = z.object({
  [PARAM.tab]: z.enum(TAB_KEYS).optional().catch(undefined),
  [PARAM.search]: z.string().trim().min(1).max(120).optional().catch(undefined),
  [PARAM.category]: z.string().trim().min(1).max(64).optional().catch(undefined),
  [PARAM.page]: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  [PARAM.pageSize]: z.coerce.number().int().min(5).max(100).optional().catch(undefined),
  [PARAM.sortBy]: z
    .enum(['titre', 'prix', 'inscrits', 'note', 'maj'])
    .optional()
    .catch(undefined),
  [PARAM.sortDir]: z.enum(['asc', 'desc']).optional().catch(undefined),
});

type Query = z.output<typeof searchParamsSchema>;

/** Only the first value of a repeated parameter is considered. */
function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function CoursesPage({
  params,
  searchParams,
}: {
  params: Promise<LocaleParams>;
  searchParams: Promise<RawSearchParams>;
}): Promise<React.JSX.Element> {
  const [{ locale }, rawSearch] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  const user = await requirePageAdmin(locale);

  const t = await getTranslations('admin.courses');

  const query: Query = searchParamsSchema.parse(
    Object.fromEntries(Object.entries(rawSearch).map(([key, value]) => [key, firstValue(value)])),
  );

  const tab: TabKey = query[PARAM.tab] ?? 'toutes';
  const status = TABS.find((entry) => entry.key === tab)?.status ?? null;
  const page = query[PARAM.page] ?? 1;
  const pageSize = query[PARAM.pageSize] ?? 25;
  const sortBy: SortParam = query[PARAM.sortBy] ?? 'maj';
  const sortDir = query[PARAM.sortDir] ?? 'desc';

  const [listResult, countsResult, categoriesResult] = await Promise.all([
    listAdminCourses(
      {
        ...(status === null ? {} : { status }),
        ...(query[PARAM.search] === undefined ? {} : { search: query[PARAM.search] }),
        ...(query[PARAM.category] === undefined ? {} : { categoryId: query[PARAM.category] }),
        page,
        pageSize,
        sortBy: SORT_KEYS[sortBy],
        sortDir,
      },
      user,
    ),
    adminCourseCounts(user),
    listCategoryOptions(user),
  ]);

  const listing = listResult.ok
    ? listResult.data
    : { rows: [] as readonly AdminCourseRow[], total: 0, page: 1, pageSize, pageCount: 1 };

  const counts: CourseStatusCounts = countsResult.ok
    ? countsResult.data
    : { DRAFT: 0, REVIEW: 0, PUBLISHED: 0, SCHEDULED: 0, ARCHIVED: 0, ALL: 0 };

  const categories: readonly CategoryOption[] = categoriesResult.ok ? categoriesResult.data : [];

  const currentParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) currentParams[key] = String(value);
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4 pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-title text-ink">{t('title')}</h1>
          <p className="max-w-prose text-sm text-ink-muted">{t('subtitle')}</p>
        </div>
        <NewCourseButton />
      </header>

      <CoursesTable
        rows={listing.rows.map((row) => toRowView(row, locale))}
        counts={{
          toutes: counts.ALL,
          brouillons: counts.DRAFT,
          publiees: counts.PUBLISHED,
          archivees: counts.ARCHIVED,
        }}
        tab={tab}
        total={listing.total}
        page={listing.page}
        pageSize={listing.pageSize}
        pageCount={listing.pageCount}
        sortBy={sortBy}
        sortDir={sortDir}
        search={query[PARAM.search] ?? ''}
        filters={{ category: query[PARAM.category] ?? null }}
        categories={categories}
        currentParams={currentParams}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* View-model builder                                                          */
/* -------------------------------------------------------------------------- */

function toRowView(row: AdminCourseRow, locale: Locale): CourseRowView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    categoryName: row.categoryName,
    status: row.status,
    priceLabel: formatMoney(row.priceCentimes, locale),
    isFree: row.priceCentimes === 0,
    lessonCount: row.lessonCount,
    enrollmentCount: row.enrollmentCount,
    ratingAvg: row.ratingAvg,
    ratingCount: row.ratingCount,
    updatedAtLabel: formatDateTime(row.updatedAt, locale),
    updatedAtIso: toDateTimeAttribute(row.updatedAt),
  };
}
