import { expect, test } from './fixtures/base';

/**
 * **A form submitted before JavaScript loads never puts its fields in the URL.**
 *
 * Every form here handles `onSubmit` in React and calls a Server Action. Before
 * hydration there is no handler, and a `<form>` without `method` falls back to
 * the HTML default — GET — serialising every field into the query string. It
 * was found by accident, by an audit script that clicked too early:
 *
 *   /fr/connexion?email=admin%40cfi.ma&password=Cfi%21SuperAdmin2026
 *
 * On a slow phone a real person tapping « Se connecter » early does the same,
 * and the password lands in browser history, in the host's access logs and in
 * the Referer of the next request.
 *
 * Disabling JavaScript IS the pre-hydration state, reproduced deterministically
 * instead of by racing a slow network. ESLint now refuses a `<form>` without a
 * `method` or a Server Action (eslint.config.mjs); this proves the attribute
 * does what the rule assumes.
 */

test.use({ javaScriptEnabled: false });

const SECRET = 'Never-In-The-Url-7!';

test.describe('Forms submitted before hydration', () => {
  test('@critical the login form does not leak the password into the URL', async ({ page, cfi }) => {
    await page.goto(cfi.route('/connexion'));
    await page.locator('input[type="email"], input[name="email"]').first().fill('someone@example.com');
    await page.locator('input[type="password"]').first().fill(SECRET);
    // `force`: the auth pages carry a looping CSS illustration, so Playwright's
    // stability check never settles on a phone. What is under test is what the
    // BROWSER does with the submit, not whether the button holds still.
    await page.locator('form button[type="submit"]').first().click({ force: true });
    await page.waitForLoadState('domcontentloaded');

    expect(page.url(), 'no field reached the query string').not.toContain('password');
    expect(page.url()).not.toContain(encodeURIComponent(SECRET));
    expect(page.url()).not.toContain('someone');
  });

  test('@critical the registration form does not leak the password into the URL', async ({ page, cfi }) => {
    await page.goto(cfi.route('/inscription'));
    const password = page.locator('input[type="password"]');
    const count = await password.count();
    for (let index = 0; index < count; index += 1) await password.nth(index).fill(SECRET);
    // `force`: the auth pages carry a looping CSS illustration, so Playwright's
    // stability check never settles on a phone. What is under test is what the
    // BROWSER does with the submit, not whether the button holds still.
    await page.locator('form button[type="submit"]').first().click({ force: true });
    await page.waitForLoadState('domcontentloaded');

    expect(page.url()).not.toContain('password');
    expect(page.url()).not.toContain(encodeURIComponent(SECRET));
  });

  test('@critical the certificate code never reaches the URL', async ({ page, cfi }) => {
    // Its own page promises this: an employer's code must not land in a URL,
    // a Referer or a server log line.
    await page.goto(cfi.route('/certificat'));
    await page.locator('input[name="code"]').fill('CFI-2026-SECRET1');
    // `force`: the auth pages carry a looping CSS illustration, so Playwright's
    // stability check never settles on a phone. What is under test is what the
    // BROWSER does with the submit, not whether the button holds still.
    await page.locator('form button[type="submit"]').first().click({ force: true });
    await page.waitForLoadState('domcontentloaded');

    expect(page.url()).not.toContain('SECRET1');
    expect(page.url()).not.toContain('code=');
  });
});
