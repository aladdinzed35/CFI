/**
 * The §9.2 rule 7 / §1678 upload pipeline, as pure byte transforms.
 *
 * ## Never trust the declared MIME
 * Everything starts from {@link sniffFileKind}: the first bytes of the upload
 * decide what it is. A `.pdf` that opens with JPEG magic is a JPEG; a file the
 * sniffer does not recognise is rejected whatever the browser claimed.
 *
 * ## Images are re-encoded, PDFs are not
 * An accepted image goes through sharp: resized to at most
 * {@link RECEIPT_MAX_EDGE_PX} on the long edge (never enlarged), converted to
 * WebP, metadata dropped — sharp strips EXIF/GPS by default unless
 * `withMetadata()` is called, which it deliberately is not. A PDF is stored
 * byte-for-byte after the magic check: re-writing a PDF is how you corrupt one.
 *
 * ## The digest is of the ORIGINAL bytes
 * `sha256` is computed before any re-encode (§9.2 rule 6), so two uploads of
 * the same screenshot produce the same digest even though each re-encode could
 * differ, and the duplicate-receipt flag in §17.3 actually works.
 */

import sharp from 'sharp';

import { sha256File } from '@/lib/crypto';

/* -------------------------------------------------------------------------- */
/* Constants (§9.2 step 2)                                                     */
/* -------------------------------------------------------------------------- */

/** « max 5 Mo » — the upload constraint printed under the §9.2 upload box. */
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

/** §1678: cap at 2000 px on the long edge. */
export const RECEIPT_MAX_EDGE_PX = 2_000;

/** WebP quality for the re-encode — receipts are documents, not art. */
const RECEIPT_WEBP_QUALITY = 82;

/* -------------------------------------------------------------------------- */
/* Magic-byte sniffing                                                         */
/* -------------------------------------------------------------------------- */

export type SniffedKind = 'jpeg' | 'png' | 'webp' | 'pdf';

/**
 * Identify a file by its leading bytes. Returns `null` for anything that is
 * not one of the four §9.2 receipt formats.
 */
export function sniffFileKind(bytes: Buffer): SniffedKind | null {
  if (bytes.byteLength < 12) return null;

  // JPEG — FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';

  // PNG — 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }

  // WebP — "RIFF" …4 bytes… "WEBP"
  if (
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }

  // PDF — "%PDF-"
  if (bytes.toString('ascii', 0, 5) === '%PDF-') return 'pdf';

  return null;
}

/* -------------------------------------------------------------------------- */
/* The pipeline                                                                */
/* -------------------------------------------------------------------------- */

export interface ProcessedUpload {
  /** What the magic bytes said the upload was. */
  readonly sniffed: SniffedKind;
  /** Bytes to store — WebP for images, untouched for PDFs. */
  readonly body: Buffer;
  readonly contentType: 'image/webp' | 'application/pdf';
  readonly ext: 'webp' | 'pdf';
  /** SHA-256 hex of the ORIGINAL upload, for §9.2 rule 6 duplicate detection. */
  readonly sha256: string;
  readonly sizeBytes: number;
}

/** Why an upload was refused. Codes, not sentences — the UI translates. */
export type UploadRejection =
  | { readonly ok: false; readonly reason: 'TOO_LARGE'; readonly maxBytes: number }
  | { readonly ok: false; readonly reason: 'UNSUPPORTED_TYPE' }
  | { readonly ok: false; readonly reason: 'CORRUPT_IMAGE' };

export type ProcessUploadResult = ({ readonly ok: true } & ProcessedUpload) | UploadRejection;

/**
 * Run one receipt upload through the §1678 pipeline.
 *
 * Order matters: size first (cheapest), then magic bytes, then the re-encode —
 * which doubles as the integrity check, because sharp throws on a truncated or
 * lying file that happened to start with valid magic.
 */
export async function processReceiptUpload(
  original: Buffer,
  maxBytes: number = RECEIPT_MAX_BYTES,
): Promise<ProcessUploadResult> {
  if (original.byteLength === 0 || original.byteLength > maxBytes) {
    return { ok: false, reason: 'TOO_LARGE', maxBytes };
  }

  const sniffed = sniffFileKind(original);
  if (sniffed === null) return { ok: false, reason: 'UNSUPPORTED_TYPE' };

  const sha256 = sha256File(original);

  if (sniffed === 'pdf') {
    return {
      ok: true,
      sniffed,
      body: original,
      contentType: 'application/pdf',
      ext: 'pdf',
      sha256,
      sizeBytes: original.byteLength,
    };
  }

  let reencoded: Buffer;
  try {
    reencoded = await sharp(original, { failOn: 'error' })
      // `rotate()` with no argument applies the EXIF orientation *before* the
      // metadata is dropped — otherwise a phone photo of a receipt comes out
      // sideways once its orientation tag is stripped.
      .rotate()
      .resize({
        width: RECEIPT_MAX_EDGE_PX,
        height: RECEIPT_MAX_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: RECEIPT_WEBP_QUALITY })
      .toBuffer();
  } catch {
    return { ok: false, reason: 'CORRUPT_IMAGE' };
  }

  return {
    ok: true,
    sniffed,
    body: reencoded,
    contentType: 'image/webp',
    ext: 'webp',
    sha256,
    sizeBytes: reencoded.byteLength,
  };
}

/**
 * Hook point for a virus scanner (§20 Uploads). A no-op by default; swap the
 * body for a ClamAV socket or an API call without touching any caller —
 * every stored receipt already flows through it.
 */
export async function scanFile(_bytes: Buffer): Promise<{ readonly clean: boolean }> {
  return { clean: true };
}
