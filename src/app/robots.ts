import type { MetadataRoute } from 'next';

import { siteOrigin } from '@/lib/seo';

/**
 * `/robots.txt` (§21).
 *
 * Two rules, and the second one is the important one.
 *
 * 1. **In production**: crawl the public site, keep crawlers out of `/api`, out
 *    of the student space and out of the administration — none of which a
 *    crawler can reach anyway (the middleware redirects), but a disallow costs
 *    nothing and stops the URLs appearing as "indexed, no content".
 * 2. **Anywhere else**: `Disallow: /`. A staging deployment that is publicly
 *    reachable and indexable competes with production for the same French
 *    slugs, and the duplicate-content damage outlives the staging box. The
 *    default is therefore "do not index", and production has to earn its
 *    exception.
 *
 * ## How "production" is decided
 * `NODE_ENV === 'production'` is necessary but not sufficient — a staging build
 * is also a production build. So the canonical host must additionally not look
 * like a non-production host: no `localhost`, no IP literal, no `.local`, and no
 * `staging.` / `preview.` / `dev.` / `test.` / `uat.` / `recette.` first label.
 *
 * `SEO_ALLOW_INDEXING` overrides the heuristic in both directions for the case
 * the heuristic gets wrong: `'false'` forces the closed robots file, `'true'`
 * forces the open one. It is read straight from `process.env` because this file
 * is evaluated at build time, before the env proxy has a request to bind to.
 */

/** First labels that never belong to a production deployment. */
const NON_PRODUCTION_LABELS = new Set([
  'staging',
  'stage',
  'preview',
  'dev',
  'develop',
  'test',
  'uat',
  'recette',
  'sandbox',
  'demo',
]);

/** `true` when the host looks like a real, public, canonical domain. */
function hostLooksProduction(host: string): boolean {
  const lower = host.toLowerCase();

  if (lower === 'localhost' || lower.endsWith('.localhost')) return false;
  if (lower.endsWith('.local') || lower.endsWith('.internal')) return false;
  // An IP literal is never a canonical marketing host.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lower) || lower.startsWith('[')) return false;

  const labels = lower.split('.');
  // A bare label with no dot cannot be a public domain.
  if (labels.length < 2) return false;

  const first = labels[0];
  return first === undefined || !NON_PRODUCTION_LABELS.has(first);
}

/** The single decision this file turns on. Exported so the SEO tests can pin it. */
export function isIndexableEnvironment(): boolean {
  const override = (process.env.SEO_ALLOW_INDEXING ?? '').trim().toLowerCase();
  if (override === 'false' || override === '0') return false;
  if (override === 'true' || override === '1') return true;

  if (process.env.NODE_ENV !== 'production') return false;

  try {
    return hostLooksProduction(new URL(siteOrigin()).hostname);
  } catch {
    return false;
  }
}

/**
 * Locale-prefixed private areas. `/*\/espace` covers `/fr/espace`, `/ar/espace`
 * and everything under them; the unprefixed forms cover the middleware's
 * pre-redirect URLs.
 */
const PRIVATE_PATHS: readonly string[] = [
  '/api/',
  '/espace',
  '/admin',
  '/*/espace',
  '/*/admin',
  '/*/acces-refuse',
  // One-shot links: indexing them would leak a token into the search index.
  '/*/verifier/',
  '/*/reinitialiser/',
];

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();

  if (!isIndexableEnvironment()) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
    };
  }

  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...PRIVATE_PATHS] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
