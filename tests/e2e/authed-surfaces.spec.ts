import type { Page } from '@playwright/test';

import { expect, expectNoRawMessageKeys, expectSingleH1, test } from './fixtures/base';

/**
 * **Every signed-in screen renders.**
 *
 * The whole admin console and the enrolment surfaces were written by agents,
 * gated by `tsc`, ESLint, the i18n guards and `next build` — and this project
 * has learned twice that all of those pass while a page renders raw message
 * keys or 500s on a circular import. `landing` and `accessDenied` shipped as
 * literal `landing.title` text; the admin accounts page returned 500 because
 * `parseRejectionReason` was undefined at runtime through an import cycle.
 * Neither was catchable without loading the page.
 *
 * So: sign in for real, open every authenticated route, and assert the three
 * things only a browser can see — the response was not an error, no raw key is
 * on screen, and the page has exactly one `h1`.
 *
 * `admin@cfi.ma` is SUPER_ADMIN, so it reaches every panel; the student pass
 * uses an ACTIVE account, because a PENDING one is legitimately redirected
 * away from `/espace` by §9.1 and would prove nothing about the screens.
 */

const ADMIN = { email: 'admin@cfi.ma', password: 'Cfi!SuperAdmin2026' };
const STUDENT = { email: 'imane.chraibi@gmail.com', password: 'Cfi!Etudiant2026' };

const ADMIN_ROUTES = [
  '/admin',
  '/admin/comptes',
  '/admin/demandes',
  '/admin/paiements',
  '/admin/formations',
  '/admin/contenu',
  '/admin/reglages',
  '/admin/journal',
] as const;

const STUDENT_ROUTES = ['/espace', '/espace/demandes'] as const;

async function signIn(
  page: Page,
  route: (path: string) => string,
  who: { email: string; password: string },
): Promise<void> {
  await page.goto(route('/connexion'));
  await page.getByRole('textbox', { name: /e-?mail|بريد|correo/iu }).fill(who.email);
  await page.locator('input[type="password"]').fill(who.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.includes('/connexion'), { timeout: 30_000 });
}

test.describe('Authenticated surfaces', () => {
  test('@critical every admin screen renders for a SUPER_ADMIN', async ({ page, cfi }) => {
    test.slow();
    await signIn(page, cfi.route, ADMIN);

    const broken: string[] = [];

    for (const path of ADMIN_ROUTES) {
      const response = await page.goto(cfi.route(path), { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;

      if (status >= 400) {
        broken.push(`${path} → HTTP ${status}`);
        continue;
      }

      await expectNoRawMessageKeys(page, path);
      await expectSingleH1(page, path);
    }

    expect(broken, 'admin screens that did not render').toEqual([]);
  });

  test('@critical every student screen renders for an ACTIVE account', async ({ page, cfi }) => {
    test.slow();
    await signIn(page, cfi.route, STUDENT);

    const broken: string[] = [];

    for (const path of STUDENT_ROUTES) {
      const response = await page.goto(cfi.route(path), { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;

      if (status >= 400) {
        broken.push(`${path} → HTTP ${status}`);
        continue;
      }

      await expectNoRawMessageKeys(page, path);
      await expectSingleH1(page, path);
    }

    expect(broken, 'student screens that did not render').toEqual([]);
  });

  /**
   * The cloaked refusal (§20): a student must not be able to tell « you may not
   * enter » from « there is nothing here ».
   */
  test('@critical a student gets a 404, not a 403, on the admin console', async ({ page, cfi }) => {
    await signIn(page, cfi.route, STUDENT);

    const response = await page.goto(cfi.route('/admin'), { waitUntil: 'domcontentloaded' });
    expect(response?.status(), '/admin is cloaked as not-found for a student').toBe(404);
  });
});
