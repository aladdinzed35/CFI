import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { formatDateTime } from '@/lib/dates';
import { fromCentimes } from '@/lib/money';
import { isLocale, type Locale } from '@/i18n/routing';
import { requirePageAdmin } from '@/server/auth/guards';
import {
  getAdminCourse,
  listCategoryOptions,
  type AdminCourseDetail,
  type CategoryOption,
} from '@/server/services/course-admin';

import { AdminBackLink } from '../../admin-nav';
import { CourseEditor } from './course-editor';
import type { CourseEditorView } from '../course-view';

/**
 * `/admin/formations/[id]` — the course editor (§17.5).
 *
 * A Server Component that loads the whole course once and hands the client a
 * plain view model: no `Date`, no centimes, no Prisma type. Everything the
 * three tabs need — the four locales, every module, every lesson, the
 * publication checklist — arrives in a single round trip, because reorder
 * buttons that can only see one page of neighbours cannot be made correct.
 *
 * ## Three tabs, not ten
 * §17.5 describes ten. This milestone builds the three that a catalogue cannot
 * be run without: the identity of the course, its programme, and the decision
 * to publish it. Quizzes, pricing plans, announcements and statistics are not
 * stubbed here — a tab that opens onto « bientôt » is a promise the panel has
 * no way to keep.
 */

type RouteParams = { locale: string; id: string };

export default async function CourseEditorPage({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  const user = await requirePageAdmin(locale);

  const [courseResult, categoriesResult] = await Promise.all([
    getAdminCourse(id, user),
    listCategoryOptions(user),
  ]);

  // A refusal and an absence are both 404 here: telling an under-privileged
  // administrator that the course exists is itself a disclosure (§20).
  if (!courseResult.ok) notFound();

  const t = await getTranslations('admin.courses');
  const categories: readonly CategoryOption[] = categoriesResult.ok ? categoriesResult.data : [];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <AdminBackLink href="/admin/formations" label={t('editor.backToList')} />

      <CourseEditor course={toEditorView(courseResult.data, locale)} categories={categories} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* View-model builder                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Centimes → the decimal string the price input holds.
 *
 * Trailing « ,00 » is dropped: an author who typed `1200` must find `1200` in
 * the field when they come back, not `1200.00`. The conversion the other way is
 * the action's job, and it is the only one that matters for correctness.
 */
function toDirhamField(centimes: number | null): string {
  if (centimes === null) return '';
  const dirhams = fromCentimes(centimes);
  return Number.isInteger(dirhams) ? String(dirhams) : dirhams.toFixed(2);
}

function toEditorView(course: AdminCourseDetail, locale: Locale): CourseEditorView {
  return {
    id: course.id,
    slug: course.slug,
    status: course.status,
    level: course.level,
    deliveryMode: course.deliveryMode,
    contentLocale: course.contentLocale,
    categoryId: course.categoryId,
    coverKey: course.coverKey ?? '',
    coverUrl: course.coverUrl,
    price: toDirhamField(course.priceCentimes),
    comparePrice: toDirhamField(course.comparePriceCentimes),
    maxSeats: course.maxSeats,
    activeEnrollments: course.activeEnrollments,
    slugEditable: course.slugEditable,
    updatedAtLabel: formatDateTime(course.updatedAt, locale),
    translations: course.translations.map((entry) => ({
      locale: entry.locale,
      title: entry.title,
      subtitle: entry.subtitle,
      description: entry.description,
    })),
    modules: course.modules.map((module) => ({
      id: module.id,
      isPublished: module.isPublished,
      titles: module.titles,
      summaryFr: module.summaryFr,
      lessons: module.lessons.map((lesson) => ({
        id: lesson.id,
        type: lesson.type,
        isPreview: lesson.isPreview,
        isPublished: lesson.isPublished,
        isMandatory: lesson.isMandatory,
        estimatedMinutes: lesson.estimatedMinutes,
        titles: lesson.titles,
      })),
    })),
    checklist: course.checklist.items.map((item) => ({ key: item.key, done: item.done })),
    checklistDone: course.checklist.done,
    checklistTotal: course.checklist.total,
    checklistReady: course.checklist.ready,
  };
}
