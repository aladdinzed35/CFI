/**
 * How long the public site may lag behind the database.
 *
 * §17.5 promises an editor that a save is live "within a minute", and three
 * places have to agree on what that minute is:
 *
 *  - `app/[locale]/(public)/layout.tsx` — `export const revalidate`, which is
 *    what actually delivers it. Next reads segment config *statically*, so that
 *    one must be a literal and cannot import this constant; a unit test
 *    (`tests/unit/public-cache.test.ts`) reads it back out of the source and
 *    fails if the two drift.
 *  - `server/actions/admin-courses.ts` — reports it to the editor after a save.
 *  - `server/services/course-admin.ts` — re-exports it for its own callers.
 *
 * It lives in `lib/` rather than beside the course service because it is a
 * number with no dependencies, and a number that a test wants to read should
 * not drag Prisma and Auth.js into the test environment to be read.
 */

/** Public pages regenerate at most this often. */
export const PUBLIC_CACHE_SECONDS = 60;
