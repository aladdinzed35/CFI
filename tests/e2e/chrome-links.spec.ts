import type { Page } from '@playwright/test';

import { catalogueSlugs, chromeLinkUrls, expect, test } from './fixtures/base';

/**
 * **Every internal link in the header and the footer resolves** (§12.1).
 *
 * Three dead links shipped in the public chrome — `/blog` in the header
 * navigation, `/faq` and `/certificat` in the footer's useful-links column —
 * and none of the static checks noticed: they are string constants in a
 * `NAV_ROUTES` array, so TypeScript, ESLint and `next build` are all perfectly
 * happy pointing at a route that does not exist. They were found by a human
 * clicking them. This spec is what stops that recurring.
 *
 * ## What it does
 * Crawls the chrome on two pages — the homepage and a real course page, because
 * the footer's category column is data-driven and a course page is where a
 * visitor is most likely to leave the funnel — collects every same-origin `<a>`,
 * and requests each one. Anything answering 400 or worse is reported, all of
 * them at once rather than failing on the first, so a single run tells you the
 * whole list.
 *
 * `mailto:`, `tel:` and `https://wa.me/…` are not pages and are dropped by
 * {@link chromeLinkUrls}; so is the skip link, which is a fragment.
 *
 * ## Why `page.request`
 * It reuses the browser context, so the locale cookie and `Accept-Language`
 * header are the ones the visitor actually has. A `fetch` from Node would test a
 * different request than the one the link makes.
 */

const BAD_STATUS = 400;

interface DeadLink {
  readonly url: string;
  readonly status: number;
}

async function crawlChrome(page: Page, label: string): Promise<DeadLink[]> {
  const urls = [
    ...new Set([
      ...(await chromeLinkUrls(page, 'header')),
      ...(await chromeLinkUrls(page, 'footer')),
    ]),
  ];

  expect(urls.length, `${label}: the chrome exposes internal links`).toBeGreaterThan(5);

  const dead: DeadLink[] = [];
  for (const url of urls) {
    const response = await page.request.get(url, { failOnStatusCode: false });
    if (response.status() >= BAD_STATUS) dead.push({ url, status: response.status() });
  }
  return dead;
}

test.describe('Public chrome', () => {
  test('@critical no header or footer link is dead', async ({ page, cfi }) => {
    await page.goto(cfi.route('/formations'));
    const slugs = await catalogueSlugs(page, cfi.locale);
    const slug = slugs[0];
    expect(slug, 'the catalogue lists at least one course').toBeDefined();

    const dead: DeadLink[] = [];

    await page.goto(cfi.route('/'));
    dead.push(...(await crawlChrome(page, 'homepage')));

    await page.goto(cfi.route(`/formations/${slug ?? ''}`));
    dead.push(...(await crawlChrome(page, 'course page')));

    const report = [...new Map(dead.map((entry) => [entry.url, entry])).values()]
      .map((entry) => `${entry.status} ${entry.url}`)
      .sort();

    expect(report, 'links in the public chrome that do not resolve').toEqual([]);
  });
});
