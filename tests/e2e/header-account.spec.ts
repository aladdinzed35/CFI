import { expect, test } from './fixtures/base';

/**
 * **The public header shows the right account link, from a static page.**
 *
 * The public layout used to call `getCurrentUser()` to decide one header
 * element. Reading cookies on the server opts the whole route out of static
 * generation, so every marketing page was rendered per request and served
 * `Cache-Control: no-store` — which is also what blocked the back/forward
 * cache. Eight routes in the entire build were prerendered; it is 56 now.
 *
 * The replacement ships all three variants and reveals one with CSS, keyed on a
 * `data-chrome` attribute the bootstrap script writes from a display-only
 * cookie before the first paint. That buys the caching back, and buys a new way
 * to be wrong: if the cookie, the script, the CSS and the markup ever disagree,
 * every visitor sees the wrong call to action — and the page still renders, the
 * build still passes, and no unit test notices.
 *
 * ## The hint cannot be forged, which shaped this spec
 * The first version of these tests set `cfi.chrome=student` on the context and
 * expected the student link. They failed, and the failure was the feature: the
 * middleware rewrites the cookie from the real session on **every** matched
 * request, so a hand-set value is corrected before the document is even parsed.
 * A forged hint does not survive one navigation.
 *
 * So the chain is tested in two halves that meet in the middle:
 *   1. attribute → CSS → visible link, driven directly;
 *   2. real sign-in → middleware → cookie, driven through the login form.
 */

/** Locator for each variant's slot. `display: contents` keeps the button visible. */
const SLOT = {
  guest: '.cfi-chrome-guest',
  student: '.cfi-chrome-student',
  admin: '.cfi-chrome-admin',
} as const;

/** Seeded in `prisma/seed/people.ts`; passwords are demo-only (§23). */
const STUDENT = { email: 'imane.chraibi@gmail.com', password: 'Cfi!Etudiant2026' };
const ADMIN = { email: 'admin@cfi.ma', password: 'Cfi!SuperAdmin2026' };

test.describe('Public header — the account slot', () => {
  test('@critical the attribute reveals exactly one variant', async ({ page, cfi }) => {
    // The desktop slot is `hidden lg:flex`; the mobile sheet carries the same
    // three variants behind the hamburger.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(cfi.route('/'));

    const header = page.locator('header').first();

    for (const expected of ['guest', 'student', 'admin'] as const) {
      await page.evaluate((value) => {
        const root = document.documentElement;
        if (value === 'guest') root.removeAttribute('data-chrome');
        else root.setAttribute('data-chrome', value);
      }, expected);

      for (const variant of ['guest', 'student', 'admin'] as const) {
        const link = header.locator(`${SLOT[variant]} a`).first();
        if (variant === expected) {
          await expect(link, `data-chrome=${expected} → ${variant} visible`).toBeVisible();
        } else {
          await expect(link, `data-chrome=${expected} → ${variant} hidden`).toBeHidden();
        }
      }
    }
  });

  test('@critical every variant is in the markup, pointing where it should', async ({
    page,
    cfi,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(cfi.route('/'));

    const header = page.locator('header').first();

    // Present regardless of visibility: the page is static and identical for
    // everyone, which is the entire point.
    await expect(header.locator(`${SLOT.student} a`)).toHaveAttribute(
      'href',
      cfi.route('/espace'),
    );
    await expect(header.locator(`${SLOT.admin} a`)).toHaveAttribute('href', cfi.route('/admin'));
    await expect(header.locator(`${SLOT.guest} a`).first()).toBeVisible();
  });

  /**
   * The regression this whole design exists to prevent. A page that reads the
   * session on the server cannot be prerendered, and Next signals that by
   * refusing to let it be cached.
   */
  test('@critical the homepage is served as a cacheable static document', async ({ page, cfi }) => {
    const response = await page.goto(cfi.route('/'));
    expect(response, 'the homepage responded').not.toBeNull();

    const cacheControl = response?.headers()['cache-control'] ?? '';
    expect(cacheControl, `Cache-Control was "${cacheControl}"`).not.toContain('no-store');
  });

  /**
   * A visitor with no JavaScript, or with cookies blocked, still gets a working
   * header — and the honest default on a marketing page is anonymous.
   */
  test('@critical falls back to the guest calls to action with no attribute', async ({
    page,
    cfi,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(cfi.route('/'));

    await expect(page.locator('html')).not.toHaveAttribute('data-chrome', /student|admin/u);
    await expect(page.locator('header').first().locator(`${SLOT.guest} a`).first()).toBeVisible();
  });

  /**
   * The other half: a real session must actually produce the right hint. Driven
   * through the login form rather than by minting a cookie, because the value
   * being tested is precisely the one the middleware derives from a genuine
   * token.
   */
  for (const [label, who, expected, href] of [
    ['a student', STUDENT, 'student', '/espace'],
    ['an administrator', ADMIN, 'admin', '/admin'],
  ] as const) {
    test(`@critical signing in as ${label} switches the header`, async ({ page, cfi }) => {
      await page.setViewportSize({ width: 1280, height: 800 });

      await page.goto(cfi.route('/connexion'));
      await page.getByRole('textbox', { name: /e-?mail|بريد|correo/iu }).fill(who.email);
      await page.locator('input[type="password"]').fill(who.password);
      await page.locator('form button[type="submit"]').first().click();

      // Land anywhere signed-in, then go to the public homepage.
      await page.waitForURL((url) => !url.pathname.includes('/connexion'), { timeout: 30_000 });
      await page.goto(cfi.route('/'));

      const cookie = (await page.context().cookies()).find((c) => c.name === 'cfi.chrome');
      expect(cookie?.value, 'middleware published the hint').toBe(expected);

      await expect(page.locator('html')).toHaveAttribute('data-chrome', expected);

      const link = page.locator('header').first().locator(`${SLOT[expected]} a`).first();
      await expect(link, `${expected} link visible`).toBeVisible();
      await expect(link).toHaveAttribute('href', cfi.route(href));
      await expect(
        page.locator('header').first().locator(`${SLOT.guest} a`).first(),
        'guest calls to action hidden',
      ).toBeHidden();
    });
  }
});
