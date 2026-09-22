import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The public URL of a stored media key — one answer for every page.
 *
 * ## Why this exists
 * Six services each turned a `coverKey` / `avatarKey` into a URL, and they
 * disagreed. Only the course page knew about the committed seed covers
 * (`seed/…`), so the catalogue, the homepage and the parcours showed their
 * placeholder for the very courses whose page showed a cover. And five of them
 * returned `null` whenever no CDN was configured — which is the production
 * deployment (`STORAGE_DRIVER=local`, no `S3_PUBLIC_BASE_URL`): an image an
 * administrator attached to a course could never appear anywhere public.
 *
 * ## The answer, in order
 * 1. `seed/…` → `/brand/seed/…`, a file committed under `public/brand/`
 *    (`scripts/covers/`), when it exists. A seed key whose file is missing
 *    resolves to `null`, so the card draws its placeholder, never a 404.
 * 2. A CDN is configured (`S3_PUBLIC_BASE_URL`) → the object's CDN URL.
 * 3. No CDN, and the key is in a `public/*` scope → the file gateway
 *    (`/api/files/…`), which serves public scopes to anyone and streams from
 *    local storage or redirects to a signed S3 URL.
 * 4. Anything else → `null`. A private key never gets a public URL.
 *
 * `null` is a first-class answer everywhere: rendering an `<img>` at a 404 is
 * worse than rendering the designed placeholder the page already has.
 */

const SEED_PREFIX = 'seed/';
const SEED_ROOT = join(process.cwd(), 'public', 'brand');
const seedFiles = new Map<string, boolean>();

function seedFileExists(key: string): boolean {
  const cached = seedFiles.get(key);
  if (cached !== undefined) return cached;
  const exists = existsSync(join(SEED_ROOT, key));
  seedFiles.set(key, exists);
  return exists;
}

/** Characters a stored key may contain — what `buildStorageKey` produces, and nothing a URL could misread. */
const SAFE_KEY = /^[A-Za-z0-9._\-/]+$/u;

export function publicMediaUrl(key: string | null | undefined): string | null {
  if (typeof key !== 'string') return null;
  const clean = key.trim().replace(/^\/+/u, '');
  if (clean === '' || clean.includes('..') || !SAFE_KEY.test(clean)) return null;

  if (clean.startsWith(SEED_PREFIX)) {
    return seedFileExists(clean) ? `/brand/${clean}` : null;
  }

  const base = process.env.S3_PUBLIC_BASE_URL?.trim() ?? '';
  if (base !== '') {
    try {
      return new URL(clean, base.endsWith('/') ? base : `${base}/`).toString();
    } catch {
      return null;
    }
  }

  // `scope/folder/object` at least — the gateway's own shape check.
  if (clean.startsWith('public/') && clean.split('/').length >= 3) {
    return `/api/files/${clean}`;
  }

  return null;
}
