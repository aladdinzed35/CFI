import type { CourseLevel, CourseStatus, DeliveryMode, LessonType } from '@prisma/client';

/**
 * The catalogue enum values, as runtime arrays, in a module the browser may
 * import.
 *
 * They lived in `server/services/course-admin.ts` beside the Zod schemas that
 * use them, which is where they belong logically — but the editor's « Niveau »
 * and « Mode » selects need to *enumerate* them, and that made a client
 * component import a module that reaches Prisma. `tsc` and ESLint both passed:
 * the boundary rule forbids importing `@prisma/client` and `@/server/db`
 * directly, and this import was neither — it was a service that imports them
 * two hops down. Only `next build` failed, with « You're importing a component
 * that needs next/headers ».
 *
 * The type-only import above is erased at compile time, so nothing server-side
 * follows these constants into the bundle. `satisfies` keeps them honest: drop
 * a value Prisma still declares, or add one it does not, and this file stops
 * compiling.
 *
 * `scripts/check-client-boundary.ts` now fails on this class of import before
 * the build does.
 */

export const COURSE_STATUS_VALUES = [
  'DRAFT',
  'REVIEW',
  'PUBLISHED',
  'SCHEDULED',
  'ARCHIVED',
] as const satisfies readonly CourseStatus[];

export const COURSE_LEVEL_VALUES = [
  'DEBUTANT',
  'INTERMEDIAIRE',
  'AVANCE',
  'TOUS_NIVEAUX',
] as const satisfies readonly CourseLevel[];

export const DELIVERY_MODE_VALUES = [
  'EN_LIGNE',
  'PRESENTIEL',
  'HYBRIDE',
] as const satisfies readonly DeliveryMode[];

export const LESSON_TYPE_VALUES = [
  'VIDEO',
  'DOCUMENT',
  'ARTICLE',
  'QUIZ',
  'ASSIGNMENT',
  'LIVE',
] as const satisfies readonly LessonType[];
