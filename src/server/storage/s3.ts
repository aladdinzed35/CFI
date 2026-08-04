/**
 * S3-compatible driver (§19.1 — production; Cloudflare R2 by default).
 *
 * Configured entirely from the validated environment: `S3_ENDPOINT`,
 * `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. The
 * env schema already refuses `STORAGE_DRIVER=s3` without them, so the throws
 * below are belt-and-braces for a hand-edited runtime environment.
 *
 * `forcePathStyle` is on: R2 and MinIO address buckets by path, and AWS proper
 * accepts it too — one setting that works everywhere beats a conditional.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';

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

export function createS3Driver(): StorageDriver {
  const bucket = env.S3_BUCKET;
  const endpoint = env.S3_ENDPOINT;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;

  if (bucket === undefined || endpoint === undefined || accessKeyId === undefined || secretAccessKey === undefined) {
    throw new Error(
      'Pilote S3 demandé mais S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY sont incomplets.',
    );
  }

  const client = new S3Client({
    endpoint,
    region: env.S3_REGION,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  function checkedKey(key: string): string {
    if (!isSafeStorageKey(key)) {
      throw new Error(`Clé de stockage invalide : « ${key} »`);
    }
    return key;
  }

  return {
    kind: 's3',

    async put(key, body, options: PutOptions): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: checkedKey(key),
          Body: body,
          ContentType: options.contentType,
          ...(options.cacheControl === undefined ? {} : { CacheControl: options.cacheControl }),
        }),
      );
    },

    async get(key): Promise<StorageObject> {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: checkedKey(key) }),
        );
        const bytes = await result.Body?.transformToByteArray();
        if (bytes === undefined) throw new StorageNotFoundError(key);
        const body = Buffer.from(bytes);
        return {
          body,
          contentType: result.ContentType ?? null,
          size: body.byteLength,
        };
      } catch (cause) {
        if (cause instanceof NoSuchKey || cause instanceof NotFound) {
          throw new StorageNotFoundError(key);
        }
        throw cause;
      }
    },

    async getSignedUrl(key, options: SignedUrlOptions): Promise<string | null> {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: checkedKey(key),
        ...(options.disposition === undefined
          ? {}
          : { ResponseContentDisposition: options.disposition }),
      });
      return presign(client, command, { expiresIn: options.expiresInSec });
    },

    async delete(key): Promise<void> {
      // S3 deletes are idempotent by design: deleting a missing key succeeds.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: checkedKey(key) }));
    },

    async list(prefix): Promise<readonly string[]> {
      const keys: string[] = [];
      let continuationToken: string | undefined;

      do {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
          }),
        );
        for (const object of result.Contents ?? []) {
          if (object.Key !== undefined) keys.push(object.Key);
        }
        continuationToken = result.IsTruncated === true ? result.NextContinuationToken : undefined;
      } while (continuationToken !== undefined);

      return keys;
    },

    async head(key): Promise<StorageHead | null> {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: checkedKey(key) }),
        );
        return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? null };
      } catch (cause) {
        if (cause instanceof NotFound || cause instanceof NoSuchKey) return null;
        // The SDK sometimes surfaces a bare 404 without the typed class.
        if (isHttp404(cause)) return null;
        throw cause;
      }
    },
  };
}

function isHttp404(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
  );
}
