import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright — end-to-end suite (spec §22).
 *
 * The critical journeys are exercised on two form factors and in two
 * directions:
 *
 *   • **mobile 390 × 844** — the phone the majority of students actually use,
 *     and the layout the admin approves payments from;
 *   • **desktop 1440 × 900** — the layout the administration works in;
 *   • **fr** — the default locale, runs the whole suite;
 *   • **ar** — the only right-to-left locale, runs everything tagged
 *     `@critical` (§10.3 requires the critical suite in both directions).
 *
 * A spec reads its locale from `testInfo.project.metadata`, so no test has to
 * know which project it is running under:
 *
 * ```ts
 * import { test, expect } from '@playwright/test';
 * import { locales, dirFor, type Locale } from '@/i18n/routing';
 *
 * test('@critical homepage', async ({ page }, testInfo) => {
 *   const { locale, dir } = testInfo.project.metadata as ProjectMetadata;
 *   await page.goto(`/${locale}`);
 *   await expect(page.locator('html')).toHaveAttribute('dir', dir);
 * });
 * ```
 *
 * Against a deployed environment, set `PLAYWRIGHT_BASE_URL` and the local
 * server is not started at all.
 */

/** Shape of `testInfo.project.metadata` — import this from your specs. */
export interface ProjectMetadata {
  /** Locale segment of the URL: every route is prefixed (`localePrefix: 'always'`). */
  readonly locale: 'fr' | 'ar';
  /** Expected `dir` attribute on `<html>` for that locale. */
  readonly dir: 'ltr' | 'rtl';
  readonly formFactor: 'mobile' | 'desktop';
}

const isCI = process.env.CI !== undefined && process.env.CI !== '';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const localBaseUrl = `http://localhost:${Number.isNaN(port) ? 3000 : port}`;
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseUrl ?? localBaseUrl;

const MOBILE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;

/** Only the Arabic run is filtered; French runs every spec. */
const CRITICAL = /@critical/u;

const LOCALE_SETUP = {
  fr: {
    locale: 'fr-MA',
    headers: 'fr-MA,fr;q=0.9,en;q=0.5',
    dir: 'ltr',
  },
  ar: {
    locale: 'ar-MA',
    headers: 'ar-MA,ar;q=0.9,fr;q=0.5',
    dir: 'rtl',
  },
} as const;

function project(locale: 'fr' | 'ar', formFactor: 'mobile' | 'desktop') {
  const setup = LOCALE_SETUP[locale];
  const viewport = formFactor === 'mobile' ? MOBILE : DESKTOP;
  const metadata: ProjectMetadata = { locale, dir: setup.dir, formFactor };

  return {
    name: `${formFactor}-${locale}`,
    metadata,
    ...(locale === 'ar' ? { grep: CRITICAL } : {}),
    use: {
      ...devices['Desktop Chrome'],
      viewport,
      isMobile: formFactor === 'mobile',
      hasTouch: formFactor === 'mobile',
      locale: setup.locale,
      timezoneId: 'Africa/Casablanca',
      extraHTTPHeaders: { 'Accept-Language': setup.headers },
    },
  };
}

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  snapshotDir: 'tests/e2e/__screenshots__',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  /**
   * Two workers, everywhere — not just in CI.
   *
   * Left unbounded, Playwright starts one worker per core and they all drive a
   * SINGLE `next start` process backed by one MySQL container. That saturates
   * the server rather than the suite: runs failed on a different project each
   * time while the server was demonstrably returning correct HTML, and the same
   * suite passed 22/22 with `--workers=1`. A rotating failure is a resource
   * signal, not a defect signal, and a suite that cries wolf gets ignored.
   */
  workers: 2,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    // Visual-regression baselines are committed (§22); antialiasing differs
    // slightly between the local machine and the CI runner.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
  },
  // HTML locally — it is worth opening. A plain list in CI, where the log is
  // the artifact and an HTML report nobody downloads is noise.
  reporter: isCI ? [['list']] : [['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    project('fr', 'mobile'),
    project('fr', 'desktop'),
    project('ar', 'mobile'),
    project('ar', 'desktop'),
  ],
  // Testing a deployed environment? `PLAYWRIGHT_BASE_URL` disables the local
  // server entirely. Otherwise run the production build, never `next dev`:
  // dev-mode compilation timings make the whole suite flaky.
  webServer:
    externalBaseUrl === undefined
      ? {
          command: 'npm run start',
          url: localBaseUrl,
          reuseExistingServer: !isCI,
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            NODE_ENV: 'production',
            PORT: String(Number.isNaN(port) ? 3000 : port),
            SKIP_ENV_VALIDATION: '1',
          },
        }
      : undefined,
});
