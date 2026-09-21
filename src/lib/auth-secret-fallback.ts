/**
 * What AUTH_SECRET falls back to when none is configured — in ONE place.
 *
 * Two readers need the same answer and cannot share the module that decides
 * it. Auth.js signs session tokens with `env.AUTH_SECRET` from `lib/env`; the
 * middleware decrypts them, and must not import `lib/env`, which validates the
 * whole environment and would stop a request handler over a missing SMTP host.
 * So the middleware used to repeat the fallback literally, with a comment
 * promising it was "the same literal lib/env substitutes".
 *
 * It was the same in development and different under SKIP_ENV_VALIDATION:
 * `lib/env` substituted `skip-env-validation-placeholder-…` while the
 * middleware still used `dev-insecure-…`. Auth.js signed every session with
 * one secret and the middleware tried to read it with the other, so every
 * signed-in visitor looked anonymous and was bounced to the login page. It
 * surfaced in CI — no `.env`, placeholders only — as exactly the 20 E2E tests
 * that sign in failing, while all 54 others passed.
 *
 * Production is unaffected (a real AUTH_SECRET is always set there). This
 * module makes the drift impossible rather than merely documented. It has no
 * imports, so the middleware bundle gains a few bytes and nothing else.
 */

/** Development only: `lib/env` substitutes it and warns at boot. */
export const DEV_AUTH_SECRET = 'dev-insecure-auth-secret-do-not-use-in-production';

/** Only under SKIP_ENV_VALIDATION — builds and CI with no real secrets. */
export const SKIP_VALIDATION_AUTH_SECRET = 'skip-env-validation-placeholder-auth-secret-value';

/**
 * The secret to use when AUTH_SECRET is not configured, resolved exactly as
 * `lib/env` resolves it: the build placeholder when validation is skipped,
 * the development fallback otherwise.
 */
export function authSecretFallback(
  source: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const skip = source.SKIP_ENV_VALIDATION;
  return skip !== undefined && skip.trim() !== '' ? SKIP_VALIDATION_AUTH_SECRET : DEV_AUTH_SECRET;
}
