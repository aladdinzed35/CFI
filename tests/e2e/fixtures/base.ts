import { test as base, expect, type Page } from '@playwright/test';

import arMessages from '@/i18n/messages/ar.json';
import frMessages from '@/i18n/messages/fr.json';

import type { ProjectMetadata } from '../../../playwright.config';

/**
 * The shared ground the end-to-end suite stands on (§22).
 *
 * `playwright.config.ts` runs every spec four times — `fr`/`ar` × mobile 390 ×
 * 844 / desktop 1440 × 900 — and puts the locale, the expected `dir` and the
 * form factor in `testInfo.project.metadata`. Nothing here changes that
 * arrangement; this file only gives a spec a typed way to read it, plus the
 * handful of assertions that must be written exactly once because they are the
 * ones this project has actually shipped bugs against.
 *
 * ## Why messages are read from the JSON rather than typed into the specs
 * A test that hardcodes « Leçon d'essai » passes for the wrong reason the day
 * somebody renames the key: the page renders `course.programme.previewBadge`
 * and the literal string is simply not found — a failure, but one that says
 * "element missing" instead of "translation missing". {@link CfiContext.t}
 * resolves the key out of the locale's own message file and **throws when the
 * path is absent or lands on a nested object**, which is the exact defect
 * described in the project contract: `course.objectives` is
 * `{ title, subtitle }`, so `t("objectives")` renders its own key on screen
 * while typecheck, lint and build all pass. Here that is a hard error at the
 * moment the spec asks for it.
 */

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

/** The two locales the e2e projects cover. `en`/`es` are not routed publicly yet. */
export type TestLocale = ProjectMetadata['locale'];

const MESSAGES: Readonly<Record<TestLocale, unknown>> = {
  fr: frMessages,
  ar: arMessages,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolve `catalog.filters.title` in a locale's message file.
 *
 * Throws — loudly, with the path — when the key is missing or resolves to an
 * object. A spec asserting against a key that does not exist is worse than no
 * spec, because it looks green until somebody reads it.
 */
export function message(locale: TestLocale, path: string): string {
  let node: unknown = MESSAGES[locale];

  for (const segment of path.split('.')) {
    if (!isPlainObject(node)) {
      throw new Error(`i18n: "${path}" walks through a non-object in ${locale}.json`);
    }
    node = node[segment];
  }

  if (typeof node !== 'string') {
    throw new Error(
      node === undefined
        ? `i18n: "${path}" does not exist in ${locale}.json`
        : `i18n: "${path}" is a nested object in ${locale}.json, not a message`,
    );
  }

  return node;
}

/**
 * The literal prefix of an ICU message, up to its first placeholder.
 *
 * `course.programme.previewModalTitle` is `Leçon d'essai — {lessonTitle}`; the
 * dialog's title is that message with a course-specific tail, so the assertion
 * matches the part the translation owns and leaves the data alone.
 */
export function messagePrefix(locale: TestLocale, path: string): string {
  const raw = message(locale, path);
  const brace = raw.indexOf('{');
  return (brace === -1 ? raw : raw.slice(0, brace)).trim();
}

/* -------------------------------------------------------------------------- */
/* The fixture                                                                 */
/* -------------------------------------------------------------------------- */

export interface CfiContext extends ProjectMetadata {
  /** Origin under test — `PLAYWRIGHT_BASE_URL`, or the local server. */
  readonly baseUrl: string;
  /** `route('/formations')` → `/fr/formations`. Every route is locale-prefixed. */
  readonly route: (path: string) => string;
  /** A message from *this project's* locale. Throws on a missing or non-leaf key. */
  readonly t: (path: string) => string;
}

export const test = base.extend<{ cfi: CfiContext }>({
  // Playwright's second argument is conventionally called `use`; here it is
  // `provide`, because `react-hooks/rules-of-hooks` reads a bare `use(...)` as
  // React's `use` hook and fails the lint. The name is positional either way.
  cfi: async ({ baseURL }, provide, testInfo) => {
    const metadata = testInfo.project.metadata as ProjectMetadata;

    await provide({
      ...metadata,
      baseUrl: baseURL ?? 'http://localhost:3000',
      route: (path: string) => `/${metadata.locale}${path === '/' ? '' : path}`,
      t: (path: string) => message(metadata.locale, path),
    });
  },
});

export { expect };

/* -------------------------------------------------------------------------- */
/* The assertions that exist because this project shipped the bug              */
/* -------------------------------------------------------------------------- */

/**
 * Raw message keys rendered as text.
 *
 * Shipped twice. `t("objectives")` on a key that is an object renders the
 * literal string `course.objectives` in the page, and typecheck, lint and build
 * are all green — only a browser sees it. The namespaces below are the ones the
 * public site draws from; the trailing `[a-z]` keeps the pattern off ordinary
 * French prose, where a full stop is followed by a space and a capital.
 */
const RAW_MESSAGE_KEY = /\b(?:course|catalog|home|pages|auth|footer)\.[a-z][\w.]*/gu;

export async function expectNoRawMessageKeys(page: Page, label: string): Promise<void> {
  const text = await page.locator('body').innerText();
  const hits = [...text.matchAll(RAW_MESSAGE_KEY)].map((match) => match[0]);

  expect(
    [...new Set(hits)],
    `${label}: untranslated message keys are visible on screen`,
  ).toEqual([]);
}

/**
 * Horizontal overflow, measured on the **document** (§26, «no overflow at 360 px»).
 *
 * Deliberately not measured on descendants: the homepage's snap-scroll strips
 * are supposed to overflow their own container — that is what makes them
 * swipeable. What must never overflow is the page itself.
 */
export async function expectNoDocumentOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(
    metrics.scrollWidth,
    `${label}: the document scrolls sideways (${metrics.scrollWidth}px in a ${metrics.clientWidth}px viewport)`,
  ).toBeLessThanOrEqual(metrics.clientWidth);
}

/** §21: exactly one `h1`, on every page, always. */
export async function expectSingleH1(page: Page, label: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 }), `${label}: heading count`).toHaveCount(1);
}

/** `<html lang>` and `<html dir>` match the project's locale (fr-MA/ltr, ar-MA/rtl). */
export async function expectDocumentLanguage(page: Page, cfi: CfiContext): Promise<void> {
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', `${cfi.locale}-MA`);
  await expect(html).toHaveAttribute('dir', cfi.dir);
}

/* -------------------------------------------------------------------------- */
/* Navigation helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every same-origin page link inside `header` or `footer`, absolute and deduped.
 *
 * `mailto:`, `tel:`, `https://wa.me/…` and the skip link's `#contenu` are not
 * pages and are dropped. Anchors are stripped so `/fr/contact#form` and
 * `/fr/contact` are crawled once.
 */
export async function chromeLinkUrls(page: Page, scope: 'header' | 'footer'): Promise<string[]> {
  const hrefs = await page
    .locator(`${scope} a[href]`)
    .evaluateAll((nodes) =>
      nodes.map((node) => (node instanceof HTMLAnchorElement ? node.href : '')),
    );

  const origin = new URL(page.url()).origin;
  const urls = new Set<string>();

  for (const href of hrefs) {
    if (href === '') continue;

    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }

    if (url.origin !== origin) continue;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;

    url.hash = '';
    urls.add(url.toString());
  }

  return [...urls].sort();
}

/**
 * The slugs the catalogue is currently showing, in display order.
 *
 * Read off the rendered cards rather than hardcoded, so the suite follows the
 * seed instead of pinning it — a renamed course must not fail the acceptance
 * gate, a broken card must.
 */
export async function catalogueSlugs(page: Page, locale: TestLocale): Promise<string[]> {
  const prefix = `/${locale}/formations/`;
  const hrefs = await page
    .locator(`main a[href^="${prefix}"]`)
    .evaluateAll((nodes) =>
      nodes.map((node) => (node instanceof HTMLAnchorElement ? node.getAttribute('href') ?? '' : '')),
    );

  const slugs = hrefs
    .map((href) => href.slice(prefix.length).split('?')[0] ?? '')
    .filter((slug) => slug !== '' && !slug.includes('/'));

  return [...new Set(slugs)];
}

/**
 * Apply the first category facet, whichever way this form factor offers it.
 *
 * Below `lg` the rail is `hidden` and the bottom sheet is the only route to a
 * filter, so a single spec cannot simply click "the rail". Both paths end in the
 * same `<a>` produced by `toggleFilter` + `serializeFilters`, which is the point
 * §12.3 is really making: applying a filter is a navigation.
 */
export async function applyFirstCategoryFilter(page: Page, cfi: CfiContext): Promise<void> {
  const groupName = cfi.t('catalog.filters.category.label');

  if (cfi.formFactor === 'desktop') {
    const rail = page.getByRole('complementary', { name: cfi.t('catalog.filters.title') });
    await rail.getByRole('region', { name: groupName }).getByRole('link').first().click();
  } else {
    await page.getByRole('button', { name: cfi.t('catalog.filters.open') }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('region', { name: groupName }).getByRole('link').first().click();

    // The sheet stays open on purpose so facets can be stacked; close it before
    // the journey carries on into the grid behind it.
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }

  await expectFilteredCatalogue(page, cfi);
}

/**
 * Wait for the *server's* filtered response to have replaced the grid.
 *
 * `toHaveURL` resolves the moment the address bar changes, which on a soft
 * navigation is before the new server payload has rendered — reading the cards
 * there compares the new URL against the old results. The "clear the filters"
 * affordance exists only while a facet is applied and is rendered on the
 * server, so its arrival is proof the response landed.
 */
export async function expectFilteredCatalogue(page: Page, cfi: CfiContext): Promise<void> {
  await expect
    .poll(() => page.getByRole('link', { name: cfi.t('catalog.filters.clearAll') }).count(), {
      message: 'the filtered catalogue offers a way to clear the facet',
      // A facet click is a SOFT navigation dispatched from a client component,
      // so three things must line up: React hydrates, the router commits, and
      // the server payload streams back. 10 s is enough on a warm desktop and
      // marginal on the throttled mobile profile — the suite failed here on a
      // different project each run while the server was returning the correct
      // filtered HTML all along. Waiting longer costs nothing when it passes.
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
}

/** The mirror image: no facet applied, therefore nothing to clear. */
export async function expectUnfilteredCatalogue(page: Page, cfi: CfiContext): Promise<void> {
  await expect
    .poll(() => page.getByRole('link', { name: cfi.t('catalog.filters.clearAll') }).count(), {
      message: 'the unfiltered catalogue has no facet to clear',
    })
    .toBe(0);
}
