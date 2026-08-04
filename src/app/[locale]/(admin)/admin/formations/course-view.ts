import type { ActionErrorCode } from '@/server/auth/guards';
import type { ChecklistKey, CourseSortField } from '@/server/services/course-admin';
import type { Locale } from '@/i18n/routing';

/**
 * The vocabulary shared by the §17.5 list, the editor and their server pages.
 *
 * Two rules force this file to exist:
 *
 * - A `'use server'` module may only export async functions, so no constant can
 *   live beside the actions it belongs to.
 * - The page is a Server Component and the table is a Client Component. Anything
 *   both of them name — a URL parameter, a sort key, a status tab — has to be
 *   declared somewhere neither of them owns, or the two drift and the table
 *   silently stops reading the parameter the page writes.
 *
 * Nothing here renders. It is names, maps and view-model shapes only: the copy
 * lives in `admin.courses`, the data lives in `services/course-admin.ts`.
 */

/* -------------------------------------------------------------------------- */
/* URL contract                                                                */
/* -------------------------------------------------------------------------- */

/** French query keys, like every URL on this site (§10.1). */
export const PARAM = {
  tab: 'onglet',
  search: 'q',
  category: 'categorie',
  page: 'page',
  pageSize: 'taille',
  sortBy: 'tri',
  sortDir: 'sens',
} as const;

/** The status tabs, in the order they are rendered. `toutes` is the catch-all. */
export const TABS = [
  { key: 'toutes', status: null },
  { key: 'brouillons', status: 'DRAFT' },
  { key: 'publiees', status: 'PUBLISHED' },
  { key: 'archivees', status: 'ARCHIVED' },
] as const;

export type TabKey = (typeof TABS)[number]['key'];

/**
 * Tab → the i18n key under `admin.courses` that names it.
 *
 * « Toutes » is absent on purpose: `admin.courses` has no word for it, and the
 * queue vocabulary in `admin.requests.tabs.all` already says it in the right
 * register — the table reads that one through its second translator rather than
 * pretending the key lives here.
 */
export const TAB_LABEL_KEY: Record<Exclude<TabKey, 'toutes'>, string> = {
  brouillons: 'status.draft',
  publiees: 'status.published',
  archivees: 'status.archived',
};

/** Sort parameter as it appears in the URL → the field the service sorts on. */
export const SORT_KEYS: Record<SortParam, CourseSortField> = {
  titre: 'title',
  prix: 'priceCentimes',
  inscrits: 'enrollmentCount',
  note: 'ratingAvg',
  maj: 'updatedAt',
};

export type SortParam = 'titre' | 'prix' | 'inscrits' | 'note' | 'maj';

/** The column id TanStack sorts by, per URL value — and its inverse. */
export const SORT_COLUMN_ID: Record<SortParam, string> = {
  titre: 'title',
  prix: 'price',
  inscrits: 'enrollments',
  note: 'rating',
  maj: 'updatedAt',
};

export const COLUMN_TO_SORT: Record<string, SortParam | undefined> = {
  title: 'titre',
  price: 'prix',
  enrollments: 'inscrits',
  rating: 'note',
  updatedAt: 'maj',
};

/* -------------------------------------------------------------------------- */
/* Failure vocabulary                                                          */
/* -------------------------------------------------------------------------- */

/** `ActionResult.error` → the key under `admin.actionError` that explains it. */
export const ACTION_ERROR_KEY: Record<ActionErrorCode, string> = {
  validation: 'validation',
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  csrf: 'csrf',
  rate_limited: 'rateLimited',
  not_found: 'notFound',
  conflict: 'conflict',
  server_error: 'server',
};

/* -------------------------------------------------------------------------- */
/* The publication checklist                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Checklist condition → the key under `admin.courses` that names it.
 *
 * `category`, `lesson` and `preview` borrow a column heading and a field label
 * because `admin.courses.checklist` does not yet spell them out; they read as
 * the nouns they are, and the gap is listed for the i18n owner. Everything else
 * uses the sentence written for it.
 */
export const CHECKLIST_LABEL_KEY: Record<ChecklistKey, string> = {
  frenchTranslation: 'checklist.fr',
  category: 'columns.category',
  cover: 'checklist.cover',
  module: 'checklist.module',
  lesson: 'columns.lessons',
  preview: 'curriculum.freePreview',
};

/* -------------------------------------------------------------------------- */
/* Enum vocabulary                                                             */
/* -------------------------------------------------------------------------- */

/** `CourseStatus` → the key under `admin.courses.status`. Total, so a new enum member breaks the build. */
export const COURSE_STATUS_LABEL_KEY = {
  DRAFT: 'status.draft',
  REVIEW: 'status.review',
  PUBLISHED: 'status.published',
  SCHEDULED: 'status.scheduled',
  ARCHIVED: 'status.archived',
} as const;

/**
 * `LessonType` → the key under `admin.courses.curriculum.types`.
 *
 * `LIVE` has no entry in the catalogue and no live-session feature in this
 * milestone, so the selector does not offer it; existing `LIVE` rows fall back
 * to the video label rather than rendering their raw enum name.
 */
export const LESSON_TYPE_LABEL_KEY = {
  VIDEO: 'curriculum.types.video',
  ARTICLE: 'curriculum.types.article',
  DOCUMENT: 'curriculum.types.document',
  QUIZ: 'curriculum.types.quiz',
  ASSIGNMENT: 'curriculum.types.assignment',
  LIVE: 'curriculum.types.video',
} as const;

/** The lesson types the editor offers, in the order the selector lists them. */
export const EDITABLE_LESSON_TYPES = [
  'VIDEO',
  'ARTICLE',
  'DOCUMENT',
  'QUIZ',
  'ASSIGNMENT',
] as const;

/** `CourseLevel` → the key under `course.level`, where the public labels already live. */
export const COURSE_LEVEL_LABEL_KEY = {
  DEBUTANT: 'DEBUTANT',
  INTERMEDIAIRE: 'INTERMEDIAIRE',
  AVANCE: 'AVANCE',
  TOUS_NIVEAUX: 'TOUS_NIVEAUX',
} as const;

/** `DeliveryMode` → the key under `course.delivery`. */
export const DELIVERY_MODE_LABEL_KEY = {
  EN_LIGNE: 'EN_LIGNE',
  PRESENTIEL: 'PRESENTIEL',
  HYBRIDE: 'HYBRIDE',
} as const;

/* -------------------------------------------------------------------------- */
/* View models — Date and centimes never cross into a Client Component         */
/* -------------------------------------------------------------------------- */

export interface CourseRowView {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly categoryName: string | null;
  readonly status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'SCHEDULED' | 'ARCHIVED';
  readonly priceLabel: string;
  readonly isFree: boolean;
  readonly lessonCount: number;
  readonly enrollmentCount: number;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly updatedAtLabel: string;
  readonly updatedAtIso: string;
}

export interface CoursesFilterState {
  readonly category: string | null;
}

/** One locale's completeness in the Infos tab. */
export interface TranslationDraft {
  readonly locale: Locale;
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
}

export interface LessonView {
  readonly id: string;
  readonly type: 'VIDEO' | 'DOCUMENT' | 'ARTICLE' | 'QUIZ' | 'ASSIGNMENT' | 'LIVE';
  readonly isPreview: boolean;
  readonly isPublished: boolean;
  readonly isMandatory: boolean;
  readonly estimatedMinutes: number;
  readonly titles: Readonly<Record<Locale, string>>;
}

export interface ModuleView {
  readonly id: string;
  readonly isPublished: boolean;
  readonly titles: Readonly<Record<Locale, string>>;
  readonly summaryFr: string;
  readonly lessons: readonly LessonView[];
}

export interface ChecklistItemView {
  readonly key: ChecklistKey;
  readonly done: boolean;
}

export interface CourseEditorView {
  readonly id: string;
  readonly slug: string;
  readonly status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'SCHEDULED' | 'ARCHIVED';
  readonly level: 'DEBUTANT' | 'INTERMEDIAIRE' | 'AVANCE' | 'TOUS_NIVEAUX';
  readonly deliveryMode: 'EN_LIGNE' | 'PRESENTIEL' | 'HYBRIDE';
  readonly contentLocale: Locale;
  readonly categoryId: string | null;
  readonly coverKey: string;
  readonly coverUrl: string | null;
  /** Dirhams, as a decimal string the number input can hold. */
  readonly price: string;
  readonly comparePrice: string;
  readonly maxSeats: number | null;
  /** Enrollments that are still live — the number the archive dialog states. */
  readonly activeEnrollments: number;
  readonly slugEditable: boolean;
  readonly updatedAtLabel: string;
  readonly translations: readonly TranslationDraft[];
  readonly modules: readonly ModuleView[];
  readonly checklist: readonly ChecklistItemView[];
  readonly checklistDone: number;
  readonly checklistTotal: number;
  readonly checklistReady: boolean;
}

/** How many of title, subtitle and description a locale has filled in. */
export function filledCount(draft: TranslationDraft): number {
  return [draft.title, draft.subtitle, draft.description].filter(
    (value) => value.trim() !== '',
  ).length;
}

/** The per-locale percentage the Infos tab shows next to each tab. */
export function completenessPercent(draft: TranslationDraft): number {
  return Math.round((filledCount(draft) / 3) * 100);
}
