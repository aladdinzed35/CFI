import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Vitest — unit and integration suites (spec §22).
 *
 * Unit tests cover pure logic: money math, phone parsing, slugs, the `can()`
 * permission matrix, progress computation, quiz scoring, the request state
 * machine, coupon math, invoice numbering, the SM-2 scheduler, RRF fusion,
 * chunking and the context builder. Integration tests run against a real MySQL
 * schema (a `mysql:8` service container in CI) and assert transactional
 * atomicity, access gates and entitlement-filtered retrieval.
 *
 * Node environment, never jsdom: nothing here renders React. Browser behaviour
 * is Playwright's job (`playwright.config.ts`), which keeps this suite fast and
 * keeps the two layers from overlapping.
 *
 * Determinism comes from `tests/setup.ts`, which pins the timezone and freezes
 * the clock before any test module is imported.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the `@/*` → `./src/*` path alias in tsconfig.json.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**', 'coverage/**'],
    // Integration tests share one MySQL schema; running files in parallel would
    // have them truncating each other's tables mid-assertion.
    fileParallelism: false,
    // The suites are added milestone by milestone. Without this, a checkout that
    // has not reached the first testing milestone fails CI for the wrong reason.
    passWithNoTests: true,
    restoreMocks: true,
    unstubEnvs: true,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    reporters: process.env.CI === undefined ? ['default'] : ['default', 'junit'],
    outputFile: { junit: 'test-results/vitest-junit.xml' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/lib/**', 'src/server/**', 'src/i18n/**'],
      exclude: ['**/*.d.ts', 'src/server/db.ts', 'src/generated/**'],
    },
  },
});
