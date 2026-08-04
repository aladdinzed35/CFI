'use client';

/**
 * Client-side receipt compression (§9.2, §1642).
 *
 * A phone camera produces a 9 MB, 4032 × 3024 JPEG. The server refuses
 * anything over 5 MB (`RECEIPT_MAX_BYTES`) and re-encodes what it accepts down
 * to 2000 px anyway, so uploading the original costs the student a minute of
 * 3G and then a rejection. Shrinking it in the browser turns that into a
 * two-second upload of a file the server was going to produce regardless.
 *
 * Three rules:
 *
 * 1. **PDFs are never touched.** They are documents, often the bank's own
 *    receipt, and re-encoding them is neither possible nor desirable.
 * 2. **The original wins ties.** If compression fails, is unsupported, or comes
 *    back *larger* than what we started with, the original file is returned —
 *    this helper may make an upload smaller, never worse.
 * 3. **Orientation is baked in.** `imageOrientation: 'from-image'` applies the
 *    EXIF rotation while drawing, so a photo taken in portrait does not arrive
 *    sideways once the server strips EXIF (§1678).
 *
 * The result is a JPEG rather than a WebP: `canvas.toBlob` support for WebP is
 * still uneven on older iOS, and a receipt that silently failed to compress on
 * an iPhone is exactly the case this exists for.
 */

/** §1678 caps the long edge at 2000 px server-side; match it here. */
const MAX_EDGE_PX = 2_000;

/** Tried in order until the result fits under the ceiling. */
const QUALITY_LADDER: readonly number[] = [0.82, 0.65, 0.5];

function isCompressibleImage(file: File): boolean {
  return file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp';
}

function replaceExtension(name: string, extension: string): string {
  const trimmed = name.replace(/\.[^./\\]+$/u, '');
  const base = trimmed.length > 0 ? trimmed : 'justificatif';
  return `${base}.${extension}`;
}

async function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

/**
 * Shrink `file` so its long edge is at most 2000 px and its size at most
 * `maxBytes`, returning the original whenever that is not possible or not an
 * improvement.
 */
export async function compressReceiptImage(file: File, maxBytes: number): Promise<File> {
  if (!isCompressibleImage(file)) return file;
  if (typeof createImageBitmap !== 'function') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // A corrupt or unsupported image: let the server give the real verdict.
    return file;
  }

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge === 0) return file;

    const scale = Math.min(1, MAX_EDGE_PX / longEdge);
    // Nothing to gain: already small enough, and already under the ceiling.
    if (scale === 1 && file.size <= maxBytes) return file;

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (context === null) return file;

    // A transparent PNG flattened onto nothing turns black; receipts are
    // documents, so white is the honest background.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    let best: Blob | null = null;
    for (const quality of QUALITY_LADDER) {
      const blob = await toBlob(canvas, quality);
      if (blob === null) break;
      best = blob;
      if (blob.size <= maxBytes) break;
    }

    if (best === null || best.size >= file.size) return file;

    return new File([best], replaceExtension(file.name, 'jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}
