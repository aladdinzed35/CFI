import { describe, expect, it } from 'vitest';

import {
  DEV_AUTH_SECRET,
  SKIP_VALIDATION_AUTH_SECRET,
  authSecretFallback,
} from '@/lib/auth-secret-fallback';

/**
 * Auth.js signs sessions with the secret `lib/env` resolves; the middleware
 * decrypts them with the one it resolves itself. They must be the same string
 * in every configuration, or every signed-in visitor looks anonymous. They
 * were not under SKIP_ENV_VALIDATION, which is how 20 sign-in E2E tests
 * failed in CI while passing on every developer machine.
 */
describe('authSecretFallback', () => {
  it('uses the build placeholder when validation is skipped — as lib/env does', () => {
    expect(authSecretFallback({ SKIP_ENV_VALIDATION: '1' })).toBe(SKIP_VALIDATION_AUTH_SECRET);
  });

  it('uses the development secret otherwise', () => {
    expect(authSecretFallback({})).toBe(DEV_AUTH_SECRET);
  });

  it('treats a blank SKIP_ENV_VALIDATION as unset, like lib/env', () => {
    expect(authSecretFallback({ SKIP_ENV_VALIDATION: '  ' })).toBe(DEV_AUTH_SECRET);
  });

  it('never hands out a secret that could pass for a real one', () => {
    for (const secret of [DEV_AUTH_SECRET, SKIP_VALIDATION_AUTH_SECRET]) {
      expect(secret).toMatch(/insecure|placeholder/u);
    }
  });
});
