/**
 * Local filesystem driver (§19.1 — dev only).
 *
 * Objects live under `LOCAL_STORAGE_PATH` (default `./.storage`), one file per
 * key, with a `.meta.json` sidecar carrying the content type — the filesystem
 * has nowhere else to remember it, and §19.1 forbids guessing it back from the
 * extension at serve time.
 *
 * `getSignedUrl` returns `null` on purpose: there is no object host to sign
 * for. The file gateway detects the `null` and streams the bytes itself, which
 * is exactly the "no presigned-URL client complexity for the local driver"
 * behaviour the flow requires.
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '@/lib/env';
import {
  isSafeStorageKey,
  StorageNotFoundError,
  type PutOptions,
  type SignedUrlOptions,
  type StorageDriver,
  type StorageHead,
  type StorageObject,
} from './index';

const META_SUFFIX = '.meta.json';

interface SidecarMeta {
  readonly contentType?: string;
}

export function createLocalDriver(): StorageDriver {
  const root = path.resolve(process.cwd(), env.LOCAL_STORAGE_PATH ?? './.storage');

  /** Resolve a key inside the root, refusing anything that escapes it. */
  function resolve(key: string): string {
    if (!isSafeStorageKey(key)) {
      throw new Error(`Clé de stockage invalide : « ${key} »`);
    }
    const absolute = path.resolve(root, key);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error(`Clé de stockage hors racine : « ${key} »`);
    }
    return absolute;
  }

  async function readMeta(absolute: string): Promise<SidecarMeta> {
    try {
      const raw = await readFile(absolute + META_SUFFIX, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const contentType = (parsed as { contentType?: unknown }).contentType;
        return typeof contentType === 'string' ? { contentType } : {};
      }
    } catch {
      // A missing or corrupt sidecar means "unknown content type", not a failure.
    }
    return {};
  }

  return {
    kind: 'local',

    async put(key, body, options: PutOptions): Promise<void> {
      const absolute = resolve(key);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, body);
      const meta: SidecarMeta = { contentType: options.contentType };
      await writeFile(absolute + META_SUFFIX, JSON.stringify(meta), 'utf8');
    },

    async get(key): Promise<StorageObject> {
      const absolute = resolve(key);
      let body: Buffer;
      try {
        body = await readFile(absolute);
      } catch (cause) {
        if (isNotFound(cause)) throw new StorageNotFoundError(key);
        throw cause;
      }
      const meta = await readMeta(absolute);
      return { body, contentType: meta.contentType ?? null, size: body.byteLength };
    },

    async getSignedUrl(_key, _options: SignedUrlOptions): Promise<string | null> {
      return null;
    },

    async delete(key): Promise<void> {
      const absolute = resolve(key);
      await rm(absolute, { force: true });
      await rm(absolute + META_SUFFIX, { force: true });
    },

    async list(prefix): Promise<readonly string[]> {
      // The prefix is validated with the same rules as a key, minus the "no
      // trailing slash" part — a directory prefix is the normal case.
      const trimmed = prefix.replace(/\/+$/u, '');
      if (trimmed.length > 0 && !isSafeStorageKey(trimmed)) {
        throw new Error(`Préfixe de stockage invalide : « ${prefix} »`);
      }
      const start = trimmed.length === 0 ? root : path.resolve(root, trimmed);
      if (start !== root && !start.startsWith(root + path.sep)) {
        throw new Error(`Préfixe de stockage hors racine : « ${prefix} »`);
      }

      const keys: string[] = [];
      await walk(start, keys);
      return keys
        .map((absolute) => path.relative(root, absolute).split(path.sep).join('/'))
        .filter((key) => !key.endsWith(META_SUFFIX))
        .sort();
    },

    async head(key): Promise<StorageHead | null> {
      const absolute = resolve(key);
      try {
        const info = await stat(absolute);
        if (!info.isFile()) return null;
        const meta = await readMeta(absolute);
        return { size: info.size, contentType: meta.contentType ?? null };
      } catch (cause) {
        if (isNotFound(cause)) return null;
        throw cause;
      }
    },
  };
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (cause) {
    if (isNotFound(cause)) return;
    throw cause;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: unknown }).code === 'ENOENT'
  );
}
