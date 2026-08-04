/**
 * `GET /api/files/[...key]` — the authenticated gateway to private storage
 * (§19.1, §9.2 rule 5).
 *
 * Order (§20): validate the key shape → resolve the session → ask the
 * enrollment service's authorization oracle → serve. Route handlers may not
 * touch Prisma (§5); every ownership lookup and every audit row happens in
 * `services/enrollment/queries.authorizeFileRead`.
 *
 * ## 404, never 403
 * A denied read and a missing object answer identically. A 403 on someone
 * else's receipt key would confirm the key exists — a probeable oracle over
 * private financial documents.
 *
 * ## Serving
 * S3 driver → 302 to a 5-minute signed URL (the §9.2 rule 5 short-lived URL),
 * with the `Content-Disposition` fixed at signing time. Local driver → the
 * bytes are streamed directly with an explicit content type from the object's
 * metadata — never guessed from the extension (§19.1).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentUser, requestContext } from '@/server/auth/guards';
import { getStorage, isSafeStorageKey, StorageNotFoundError } from '@/server/storage';
import { authorizeFileRead } from '@/server/services/enrollment/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** §9.2 rule 5 — a signed receipt URL lives five minutes. */
const SIGNED_URL_TTL_SEC = 5 * 60;

const paramsSchema = z
  .object({ key: z.array(z.string().min(1).max(255)).min(3).max(8) })
  .strict();

const NOT_FOUND = NextResponse.json(
  { error: 'not_found' },
  { status: 404, headers: { 'Cache-Control': 'no-store' } },
);

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  // 1 — Boundary validation before anything is trusted.
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NOT_FOUND;

  const key = params.data.key.map(decodeURIComponentSafe).join('/');
  if (!isSafeStorageKey(key)) return NOT_FOUND;

  // 2 — Session (may be null: public scopes are served to anyone).
  const user = await getCurrentUser();
  const { ip, userAgent } = await requestContext();

  // 3 — Authorization, scoped by the actor, audited for receipts and invoices.
  const decision = await authorizeFileRead(user, key, { ip, userAgent });
  if (!decision.allowed) return NOT_FOUND;

  // 4 — Serve.
  const storage = await getStorage();

  const signed = await storage.getSignedUrl(key, {
    expiresInSec: SIGNED_URL_TTL_SEC,
    disposition: decision.disposition,
  });
  if (signed !== null) {
    return NextResponse.redirect(signed, {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  let object;
  try {
    object = await storage.get(key);
  } catch (cause) {
    if (cause instanceof StorageNotFoundError) return NOT_FOUND;
    throw cause;
  }

  return new Response(new Uint8Array(object.body), {
    status: 200,
    headers: {
      // §19.1: explicit, never guessed. A stored object always carries the
      // type its pipeline wrote; the octet-stream fallback covers a sidecar
      // lost to a hand-wiped dev store without letting the browser sniff.
      'Content-Type': object.contentType ?? 'application/octet-stream',
      'Content-Length': String(object.size),
      'Content-Disposition': decision.disposition,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': decision.scope.startsWith('public/')
        ? 'public, max-age=3600'
        : 'private, no-store',
    },
  });
}

/** A malformed escape sequence must read as "no such file", not a 500. */
function decodeURIComponentSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
