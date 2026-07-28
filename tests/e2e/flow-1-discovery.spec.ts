import type { Locator, Page } from '@playwright/test';

import {
  applyFirstCategoryFilter,
  catalogueSlugs,
  expect,
  expectDocumentLanguage,
  expectFilteredCatalogue,
  expectNoDocumentOverflow,
  expectNoRawMessageKeys,
  expectSingleH1,
  expectUnfilteredCatalogue,
  messagePrefix,
  test,
  type CfiContext,
} from './fixtures/base';

/**
 * **E2E flow #1 — discovery** (§22, §26).
 *
 * The definition of done for Milestone 2, written as one journey rather than a
 * grid of page checks: land on the homepage, walk into the catalogue, narrow it,
 * open a course, read a trial lesson *without an account*, and arrive at
 * registration with the course still attached to the URL. Everything the guest
 * section of §26 promises is on that path, and every step of it is a real click
 * — no `goto` shortcut into the middle of the funnel, no arbitrary sleep.
 *
 * Around it sit the assertions that are not "nice extra coverage". Each one
 * exists because the defect it catches was shipped in this repository and
 * survived typecheck, lint and build:
 *
 * 1. **No raw message key is visible.** Shipped twice. `t()` on a key that is a
 *    nested object — or on a message whose ICU argument was not supplied —
 *    renders the key path itself, and every static check stays green.
 * 2. **The catalogue URL survives a filter, a reload and the back button**, both
 *    ways. That is the whole of §12.3's "shareable, back-button-safe".
 * 3. **The guest CTA carries `?suivant=` back to that course**, so somebody who
 *    registers mid-decision is returned to what they were reading.
 * 4. **No horizontal document overflow at 360 px**, in both directions.
 *
 * Every spec here is tagged `@critical` so the Arabic projects run it too: the
 * config filters `ar` to that tag, and RTL is precisely where this breaks.
 *
 * Slugs are read off the rendered catalogue rather than hardcoded, so renaming a
 * seeded course cannot fail the acceptance gate while a broken card still does.
 */

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** The trial-lesson triggers in the programme accordion. */
function trialTriggers(page: Page, cfi: CfiContext): Locator {
  return page.getByRole('button', { name: cfi.t('course.programme.previewBadge') });
}

/**
 * Open every module, then count the trial lessons on screen.
 *
 * A collapsed module's lessons are not in the DOM at all, so a course has to be
 * expanded before it can be counted. The expand button flipping to « Tout
 * replier » is the state commit — that, rather than a timer, is what is waited
 * on.
 */
async function expandProgramme(page: Page, cfi: CfiContext): Promise<number> {
  const expand = page.getByRole('button', { name: cfi.t('course.programme.expandAll') });
  if ((await expand.count()) === 0) return 0;

  const collapse = page.getByRole('button', { name: cfi.t('course.programme.collapseAll') });

  // Retried, not clicked once. The button is server-rendered before React
  // attaches its handler, so on the slower mobile profile a click can land in
  // the gap and do nothing — the element is visible, enabled and stable, so
  // Playwright's actionability checks all pass and the assertion then fails on
  // an app that is perfectly correct. Re-clicking until the label commits is
  // the documented way to wait for hydration without a sleep.
  await expect(async () => {
    await expand.click();
    await expect(collapse).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  return trialTriggers(page, cfi).count();
}

/* -------------------------------------------------------------------------- */

test.describe('Flow 1 — discovery, from the homepage to registration', () => {
  test('@critical a guest reads a trial lesson and reaches registration', async ({ page, cfi }) => {
    /* ---------------------------------------------------------- 1 — homepage */

    await page.goto(cfi.route('/'));

    await expectDocumentLanguage(page, cfi);
    await expectSingleH1(page, 'homepage');
    await expectNoRawMessageKeys(page, 'homepage');

    /* --------------------------------------------------------- 2 — catalogue */

    // The hero's own route into the catalogue — the link a visitor uses on a
    // phone, where the header navigation is behind the menu button.
    await page.locator(`main a[href="${cfi.route('/formations')}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${cfi.route('/formations')}/?$`, 'u'));

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(cfi.t('catalog.title'));
    await expectNoRawMessageKeys(page, 'catalogue');

    const unfiltered = await catalogueSlugs(page, cfi.locale);
    expect(unfiltered.length, 'the seeded catalogue shows published courses').toBeGreaterThan(0);

    /* ------------------------------------------------------------ 3 — filter */

    await applyFirstCategoryFilter(page, cfi);

    // §12.3: applying a filter is a navigation, so it lands in the URL.
    await expect(page).toHaveURL(/[?]/u);
    const filtered = await catalogueSlugs(page, cfi.locale);
    expect(filtered.length, 'a category facet still returns courses').toBeGreaterThan(0);
    expect(filtered.length, 'a category facet narrows the catalogue').toBeLessThanOrEqual(
      unfiltered.length,
    );

    // Back to the whole catalogue the way the interface offers it, so the walk
    // below can reach every course.
    await page.getByRole('link', { name: cfi.t('catalog.filters.clearAll') }).first().click();
    await expect(page).toHaveURL(new RegExp(`${cfi.route('/formations')}/?$`, 'u'));
    await expectUnfilteredCatalogue(page, cfi);

    /* ------------------------------- 4 — open courses until one offers a trial */

    let chosen: string | null = null;
    let trials = 0;

    for (const slug of unfiltered) {
      await page.locator(`main a[href="${cfi.route(`/formations/${slug}`)}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/formations/${slug}$`, 'u'));

      await expectDocumentLanguage(page, cfi);
      await expectSingleH1(page, `course ${slug}`);
      await expectNoRawMessageKeys(page, `course ${slug}`);

      /* ------------------------------ 5 — the guest CTA carries ?suivant= back */

      const guestCta = page.getByRole('link', { name: cfi.t('course.cta.guest') });
      const ctaCount = await guestCta.count();
      expect(ctaCount, `${slug}: a signed-out visitor is offered the guest CTA`).toBeGreaterThan(0);

      // One sticky card on desktop, one bottom bar on mobile — exactly one is
      // on screen, never both and never neither.
      await expect(guestCta.locator('visible=true')).toHaveCount(1);

      for (let index = 0; index < ctaCount; index += 1) {
        const href = await guestCta.nth(index).getAttribute('href');
        expect(href, `${slug}: the guest CTA is a real link`).not.toBeNull();
        const target = new URL(href ?? '', cfi.baseUrl);

        expect(target.pathname).toBe(cfi.route('/inscription'));
        expect(
          target.searchParams.get('suivant'),
          `${slug}: registration returns the visitor to this course`,
        ).toBe(`/formations/${slug}`);
      }

      trials = await expandProgramme(page, cfi);
      if (trials > 0) {
        chosen = slug;
        break;
      }

      // Nothing to read here — back to the catalogue and on to the next card,
      // which is exactly what the visitor does.
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${cfi.route('/formations')}/?$`, 'u'));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(cfi.t('catalog.title'));
    }

    expect(
      chosen,
      '§26: at least one published course must let a visitor read a lesson without an account',
    ).not.toBeNull();
    if (chosen === null) return;

    /* -------------------------------------------------- 6 — the trial lesson */

    // §12.4 calls this « Leçon d'essai », not « Aperçu » — an "aperçu" reads as
    // a marketing teaser, an "essai" as a lesson you actually get to read.
    if (cfi.locale === 'fr') {
      await expect(page.getByRole('button', { name: 'Aperçu' })).toHaveCount(0);
    }

    await trialTriggers(page, cfi).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { level: 2 })).toContainText(
      messagePrefix(cfi.locale, 'course.programme.previewModalTitle'),
    );

    // Real prose, not a padlock and a promise. The "nothing to show" branch
    // renders `programme.locked`; a trial that opens on it is a broken promise.
    const body = (await dialog.innerText()).trim();
    expect(body.length, 'the trial dialog contains a real lesson body').toBeGreaterThan(200);
    expect(body, 'the trial lesson opened on a locked lesson').not.toContain(
      cfi.t('course.programme.locked'),
    );
    await expectNoRawMessageKeys(page, 'trial dialog');

    /* -------------------------------------------------- 7 — reach registration */

    await dialog.getByRole('link', { name: cfi.t('course.programme.previewModalCta') }).click();

    await expect(page).toHaveURL(new RegExp(`${cfi.route('/inscription')}\\?`, 'u'));
    expect(new URL(page.url()).searchParams.get('suivant')).toBe(`/formations/${chosen}`);

    await expectSingleH1(page, 'registration');
    await expectNoRawMessageKeys(page, 'registration');
    await expect(page.getByRole('button', { name: cfi.t('auth.register.submit') })).toBeVisible();
  });

  /* ------------------------------------------------------------------------ */

  test('@critical the trial-lesson dialog can be walked without closing it', async ({
    page,
    cfi,
  }) => {
    await page.goto(cfi.route('/formations'));
    const slugs = await catalogueSlugs(page, cfi.locale);

    // §12.4: a course may expose several trial lessons, and the reader must be
    // able to move between them without losing the dialog. Find a course that
    // has more than one — the walk cannot be asserted on a course with one.
    let found: string | null = null;
    for (const slug of slugs) {
      await page.goto(cfi.route(`/formations/${slug}`));
      if ((await expandProgramme(page, cfi)) > 1) {
        found = slug;
        break;
      }
    }

    expect(
      found,
      'no published course exposes two readable trial lessons in this locale, so the dialog’s previous/next affordance cannot exist',
    ).not.toBeNull();
    if (found === null) return;

    await trialTriggers(page, cfi).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const previous = dialog.getByRole('button', { name: cfi.t('course.programme.previewPrevious') });
    const next = dialog.getByRole('button', { name: cfi.t('course.programme.previewNext') });

    await expect(previous, 'the first trial lesson has nothing before it').toBeDisabled();
    await expect(next).toBeEnabled();

    const firstTitle = await dialog.getByRole('heading', { level: 2 }).innerText();
    await next.click();
    await expect(dialog.getByRole('heading', { level: 2 })).not.toHaveText(firstTitle);
    await expect(dialog, 'the dialog stays open while the reader moves').toBeVisible();
    await expect(previous, 'previous becomes available once the reader moves').toBeEnabled();

    await previous.click();
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(firstTitle);
  });

  /* ------------------------------------------------------------------------ */

  test('@critical the catalogue URL survives a filter, a reload and the back button', async ({
    page,
    cfi,
  }) => {
    await page.goto(cfi.route('/formations'));
    const unfiltered = await catalogueSlugs(page, cfi.locale);
    const unfilteredUrl = page.url();

    await applyFirstCategoryFilter(page, cfi);
    await expect(page).toHaveURL(/[?]/u);

    const filteredUrl = page.url();
    const filtered = await catalogueSlugs(page, cfi.locale);
    expect(new URL(filteredUrl).search, 'the facet is written into the query string').not.toBe('');

    // Shareable: the same URL, opened cold, renders the same results.
    await page.reload();
    expect(page.url(), 'a reload keeps the filtered URL').toBe(filteredUrl);
    await expectFilteredCatalogue(page, cfi);
    expect(await catalogueSlugs(page, cfi.locale), 'a reload keeps the filtered results').toEqual(
      filtered,
    );

    // Back-button-safe: the filter click was a real history entry. The address
    // bar changes before the payload behind it does, so the grid is polled.
    await page.goBack();
    await expect(page).toHaveURL(unfilteredUrl);
    await expectUnfilteredCatalogue(page, cfi);
    await expect
      .poll(() => catalogueSlugs(page, cfi.locale), {
        message: 'going back restores the unfiltered catalogue',
      })
      .toEqual(unfiltered);

    await page.goForward();
    await expect(page).toHaveURL(filteredUrl);
    await expectFilteredCatalogue(page, cfi);
    await expect
      .poll(() => catalogueSlugs(page, cfi.locale), {
        message: 'going forward restores the filtered catalogue',
      })
      .toEqual(filtered);
  });

  /* ------------------------------------------------------------------------ */

  test('@critical every public page declares its locale and renders no raw message key', async ({
    page,
    cfi,
  }) => {
    await page.goto(cfi.route('/formations'));
    const slugs = await catalogueSlugs(page, cfi.locale);
    const slug = slugs[0];
    expect(slug, 'the catalogue lists at least one course').toBeDefined();

    const routes = [
      { label: 'homepage', path: '/' },
      { label: 'catalogue', path: '/formations' },
      { label: 'course', path: `/formations/${slug ?? ''}` },
      { label: 'contact', path: '/contact' },
      { label: 'registration', path: '/inscription' },
    ] as const;

    for (const route of routes) {
      await page.goto(cfi.route(route.path));
      await expectDocumentLanguage(page, cfi);
      await expectSingleH1(page, route.label);
      await expectNoRawMessageKeys(page, route.label);
    }

    // The filtered catalogue is a different render — the applied-filter chips
    // only exist once a facet is on — so it gets its own pass.
    await page.goto(cfi.route('/formations'));
    await applyFirstCategoryFilter(page, cfi);
    await expectNoRawMessageKeys(page, 'filtered catalogue');
  });

  /* ------------------------------------------------------------------------ */

  test('@critical nothing overflows the document at 360 px', async ({ page, cfi }) => {
    test.skip(
      cfi.formFactor !== 'mobile',
      'A 360 px viewport is what the mobile projects are for; running it twice proves nothing.',
    );

    // §26 states the narrowest supported width explicitly, and it is narrower
    // than the project's own 390 px phone.
    await page.setViewportSize({ width: 360, height: 780 });

    await page.goto(cfi.route('/formations'));
    const slugs = await catalogueSlugs(page, cfi.locale);
    const slug = slugs[0];
    expect(slug, 'the catalogue lists at least one course').toBeDefined();

    const routes = [
      { label: 'homepage', path: '/' },
      { label: 'catalogue', path: '/formations' },
      { label: 'course', path: `/formations/${slug ?? ''}` },
    ] as const;

    for (const route of routes) {
      await page.goto(cfi.route(route.path));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoDocumentOverflow(page, `${route.label} (${cfi.locale}, 360 px)`);
    }
  });
});
