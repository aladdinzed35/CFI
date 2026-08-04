/**
 * Storage abstraction (§19.1).
 *
 * One interface — `put`, `get`, `getSignedUrl`, `delete`, `list`, `head` — with
 * two drivers: `LocalDriver` (dev, `LOCAL_STORAGE_PATH`) and `S3Driver`
 * (production, Cloudflare R2 or any S3-compatible endpoint). The driver is
 * chosen once from `STORAGE_DRIVER` and cached for the process.
 *
 * ## Keys, never URLs
 * The database stores **keys** (`private/receipts/2026/08/01J…-recu.webp`),
 * never URLs. A URL is derived at read time: public objects through
 * `S3_PUBLIC_BASE_URL`, private objects only through the authenticated
 * gateway `GET /api/files/[...key]` (§19.1 "Private objects are never public").
 *
 * ## Key convention
 * `{scope}/{yyyy}/{mm}/{ulid}-{slug}.{ext}` — built by {@link buildStorageKey}
 * and *only* by it, so a key is never derived from raw user input (§20).
 */

import { ulid } from 'ulid';

import { env } from '@/lib/env';

/* -------------------------------------------------------------------------- */
/* Scopes                                                                      */
/* -------------------------------------------------------------------------- */

/** The §19.1 scope vocabulary. Everything under `private/` requires the gateway. */
export const STORAGE_SCOPES = [
  'public/covers',
  'public/blog',
  'public/avatars',
  'private/receipts',
  'private/invoices',
  'private/certificates',
  'private/assignments',
  'private/resources',
] as const;

export type StorageScope = (typeof STORAGE_SCOPES)[number];

export function isStorageScope(value: string): value is StorageScope {
  return (STORAGE_SCOPES as readonly string[]).includes(value);
}

/** `true` when objects under this scope may be served without authentication. */
export function isPublicScope(scope: StorageScope): boolean {
  return scope.startsWith('public/');
}

/** The scope of a stored key, or `null` when the key does not follow the convention. */
export function scopeOfKey(key: string): StorageScope | null {
  const parts = key.split('/');
  if (parts.length < 3) return null;
  const scope = `${parts[0]}/${parts[1]}`;
  return isStorageScope(scope) ? scope : null;
}

/* -------------------------------------------------------------------------- */
/* Key building & validation                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A key is only ever built here: `{scope}/{yyyy}/{mm}/{ulid}-{slug}.{ext}`.
 *
 * `slug` and `ext` are re-derived server-side (never taken verbatim from the
 * client), so no user-controlled byte reaches the filesystem path.
 */
export function buildStorageKey(
  scope: StorageScope,
  slug: string,
  ext: string,
  now: Date = new Date(),
): string {
  const yyyy = String(now.getUTCFullYear()).padStart(4, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeSlug = slugifyForKey(slug);
  const safeExt = ext.replace(/[^a-z0-9]/giu, '').toLowerCase() || 'bin';
  return `${scope}/${yyyy}/${mm}/${ulid().toLowerCase()}-${safeSlug}.${safeExt}`;
}

/** Lower-case ASCII, dashes, max 40 chars — enough to keep a key readable. */
function slugifyForKey(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  return slug.length > 0 ? slug : 'fichier';
}

/**
 * Reject anything that could escape the storage root: absolute paths, `..`
 * segments, backslashes, empty segments, control characters.
 */
export function isSafeStorageKey(key: string): boolean {
  if (key.length === 0 || key.length > 512) return false;
  if (key.includes('\\') || key.includes('\0')) return false;
  if (key.startsWith('/') || key.endsWith('/')) return false;
  const segments = key.split('/');
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== '.' &&
      segment !== '..' &&
      // Windows-reserved and shell-hostile characters have no business in a key.
      !/[<>:"|?*\s]/u.test(segment),
  );
}

/* -------------------------------------------------------------------------- */
/* Driver contract                                                             */
/* -------------------------------------------------------------------------- */

export interface StorageObject {
  readonly body: Buffer;
  readonly contentType: string | null;
  readonly size: number;
}

export interface StorageHead {
  readonly size: number;
  readonly contentType: string | null;
}

export interface PutOptions {
  readonly contentType: string;
  /** `public, max-age=…` for CDN-served public objects. Ignored by the local driver. */
  readonly cacheControl?: string;
}

export interface SignedUrlOptions {
  /** Lifetime of the URL. §9.2 rule 5: five minutes for a receipt. */
  readonly expiresInSec: number;
  /** Explicit `Content-Disposition` — §19.1 forbids guessing. */
  readonly disposition?: string;
}

/**
 * The §19.1 interface. Every method takes a full key (scope included) that has
 * already passed {@link isSafeStorageKey} — drivers re-check and throw rather
 * than trust the caller.
 */
export interface StorageDriver {
  readonly kind: 'local' | 's3';
  put(key: string, body: Buffer, options: PutOptions): Promise<void>;
  /** @throws StorageNotFoundError when the object does not exist. */
  get(key: string): Promise<StorageObject>;
  /**
   * A short-lived URL a browser can be redirected to, or `null` when the driver
   * cannot mint one (the local driver — the gateway streams instead).
   */
  getSignedUrl(key: string, options: SignedUrlOptions): Promise<string | null>;
  /** Deleting a missing object is a no-op, not an error — deletes are retried. */
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
  head(key: string): Promise<StorageHead | null>;
}

/** Typed "no such object", so callers can turn it into a 404 instead of a 500. */
export class StorageNotFoundError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Objet introuvable dans le stockage : ${key}`);
    this.name = 'StorageNotFoundError';
    this.key = key;
  }
}

/* -------------------------------------------------------------------------- */
/* Driver selection                                                            */
/* -------------------------------------------------------------------------- */

let cached: StorageDriver | null = null;

/**
 * The process-wide driver, from `STORAGE_DRIVER`.
 *
 * Imported lazily so that importing this module never pulls the AWS SDK into a
 * bundle that only needed `buildStorageKey` — and so the local driver stays the
 * only thing a dev environment touches.
 */
export async function getStorage(): Promise<StorageDriver> {
  if (cached !== null) return cached;

  if (env.STORAGE_DRIVER === 's3') {
    const { createS3Driver } = await import('./s3');
    cached = createS3Driver();
  } else {
    const { createLocalDriver } = await import('./local');
    cached = createLocalDriver();
  }
  return cached;
}

/** Test hook: forget the cached driver (used after env changes in a harness). */
export function resetStorageForTests(): void {
  cached = null;
}
