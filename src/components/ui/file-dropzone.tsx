'use client';

import * as React from 'react';
import { AlertCircle, Camera, CheckCircle2, FileText, ImageIcon, UploadCloud, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from '@/components/ui/icon-button';

/**
 * The receipt upload from §9.2, step 2 — the single most important file input
 * in the product, and the one most often used one-handed, at a bank counter,
 * on a phone.
 *
 * Three ways in, all equal citizens:
 * - drag and drop onto the zone (desktop);
 * - click / Enter / Space on the zone, which is a real `<button>`, not a
 *   `<div onClick>`, so it is keyboard operable and announced as a button;
 * - « Prendre une photo », a second file input carrying `capture="environment"`,
 *   which opens the rear camera directly on Android and iOS.
 *
 * Validation (type, size, count) happens before anything leaves the component;
 * rejects come back through `onReject` with a machine-readable reason so the
 * caller can phrase the message in the user's language. Nothing here is
 * hardcoded copy.
 *
 * Upload progress is *displayed*, not performed: the parent owns the request
 * and feeds `progress` / `status` back per item. That keeps retry, abort and
 * idempotency where they belong — in the caller — while the visual stays here.
 */

export type FileRejectionReason = 'type' | 'size' | 'count';

export interface FileRejection {
  readonly file: File;
  readonly reason: FileRejectionReason;
}

export type FileItemStatus = 'pending' | 'uploading' | 'done' | 'error';

export interface FileDropzoneItem {
  /** Stable id owned by the caller — used for `onRemove` and as the React key. */
  readonly id: string;
  readonly file: File;
  /** 0–100. Shown as a determinate progress bar while `status` is `uploading`. */
  readonly progress?: number;
  readonly status?: FileItemStatus;
  /** Per-file failure message, already localised by the caller. */
  readonly errorMessage?: string;
}

export interface FileDropzoneProps {
  /** The files currently attached, owned by the caller. */
  items: readonly FileDropzoneItem[];
  /** Called with the files that passed validation. */
  onSelect: (files: File[]) => void;
  /** Called with the id of the file whose remove button was pressed. */
  onRemove: (id: string) => void;
  /** Called with everything that failed validation, with the reason. */
  onReject?: (rejections: readonly FileRejection[]) => void;
  /** Accepted MIME types or extensions, e.g. `['image/jpeg', 'application/pdf']`. */
  accept: readonly string[];
  /** Hard size limit per file, in bytes. */
  maxSizeBytes: number;
  /** How many files may be attached at once. Defaults to 1 — a receipt is one file. */
  maxFiles?: number;
  /** Headline inside the zone, e.g. « Déposez votre justificatif ». */
  title: string;
  /** The constraints line, e.g. « JPG, PNG, WEBP ou PDF · 5 Mo maximum ». */
  hint: string;
  /** Label of the visible browse affordance, e.g. « Parcourir mes fichiers ». */
  browseLabel: string;
  /** Label of the camera button. Omit it to hide the camera path entirely. */
  cameraLabel?: string;
  /** Accessible name of a file's remove button, e.g. `(n) => \`Retirer ${n}\``. */
  removeLabel: (fileName: string) => string;
  /** Accessible name of a file's progress bar, e.g. `(n) => \`Envoi de ${n}\``. */
  progressLabel?: (fileName: string) => string;
  /** Formats a byte count. Defaults to a localised megabyte figure. */
  formatSize?: (bytes: number) => string;
  disabled?: boolean;
  /** Error state for the whole control (« justificatif obligatoire »). */
  invalid?: boolean;
  className?: string;
}

export function FileDropzone({
  items,
  onSelect,
  onRemove,
  onReject,
  accept,
  maxSizeBytes,
  maxFiles = 1,
  title,
  hint,
  browseLabel,
  cameraLabel,
  removeLabel,
  progressLabel,
  formatSize,
  disabled = false,
  invalid = false,
  className,
}: FileDropzoneProps): React.JSX.Element {
  const [dragging, setDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const cameraInputRef = React.useRef<HTMLInputElement | null>(null);
  const acceptAttribute = accept.join(',');
  const isFull = items.length >= maxFiles;

  const intake = React.useCallback(
    (list: FileList | null) => {
      if (list === null || list.length === 0) return;
      const room = Math.max(0, maxFiles - items.length);
      const accepted: File[] = [];
      const rejected: FileRejection[] = [];

      for (const file of Array.from(list)) {
        if (!matchesAccept(file, accept)) {
          rejected.push({ file, reason: 'type' });
        } else if (file.size > maxSizeBytes) {
          rejected.push({ file, reason: 'size' });
        } else if (accepted.length >= room) {
          rejected.push({ file, reason: 'count' });
        } else {
          accepted.push(file);
        }
      }

      if (accepted.length > 0) onSelect(accepted);
      if (rejected.length > 0) onReject?.(rejected);
    },
    [accept, items.length, maxFiles, maxSizeBytes, onReject, onSelect],
  );

  const openPicker = React.useCallback((ref: React.RefObject<HTMLInputElement | null>) => {
    const input = ref.current;
    if (input === null) return;
    // Reset first: picking the same file twice must still fire `change`.
    input.value = '';
    input.click();
  }, []);

  const zoneDisabled = disabled || isFull;

  return (
    <div className={cn('flex w-full flex-col gap-3', className)}>
      <button
        type="button"
        disabled={zoneDisabled}
        onClick={() => {
          openPicker(fileInputRef);
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!zoneDisabled) setDragging(true);
        }}
        onDragOver={(event) => {
          // Without this the browser navigates to the dropped file.
          event.preventDefault();
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          // Dragging over a child fires dragleave on the zone; only a pointer
          // that actually left the zone should clear the highlight.
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (zoneDisabled) return;
          intake(event.dataTransfer.files);
        }}
        // `aria-invalid` is not allowed on role="button"; the failure is carried
        // by the caller's FormError (role="alert") plus the border treatment.
        data-invalid={invalid ? 'true' : undefined}
        className={cn(
          'flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-hairline bg-surface px-6 py-8 text-center',
          'transition-[border-color,background-color] duration-[120ms] ease-[var(--ease-out-strait)]',
          'hover:border-strait/60 hover:bg-raised',
          'disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-hairline disabled:hover:bg-surface',
          dragging && 'border-strait bg-strait-wash',
          invalid && 'border-danger bg-danger-wash',
        )}
      >
        <UploadCloud
          aria-hidden="true"
          className={cn('size-8', dragging ? 'text-strait' : 'text-ink-muted')}
        />
        <span className="text-body font-medium text-ink">{title}</span>
        <span className="text-sm text-ink-muted">{hint}</span>
        <span className="mt-1 inline-flex h-11 items-center rounded-md border border-hairline bg-raised px-4 text-sm font-medium text-ink">
          {browseLabel}
        </span>
      </button>

      {cameraLabel !== undefined ? (
        <button
          type="button"
          disabled={zoneDisabled}
          onClick={() => {
            openPicker(cameraInputRef);
          }}
          className={cn(
            'inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-hairline bg-raised px-4 text-body font-medium text-ink',
            'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
            'hover:bg-surface',
            'disabled:cursor-not-allowed disabled:opacity-55',
          )}
        >
          {/* A camera is an object, not a direction: never mirrored in RTL. */}
          <Camera aria-hidden="true" className="size-5" />
          {cameraLabel}
        </button>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={acceptAttribute}
        multiple={maxFiles > 1}
        onChange={(event) => {
          intake(event.target.files);
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        className="hidden"
        accept={acceptAttribute}
        capture="environment"
        onChange={(event) => {
          intake(event.target.files);
        }}
      />

      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn(
                'flex items-center gap-3 rounded-md border border-hairline bg-surface p-2.5',
                item.status === 'error' && 'border-danger bg-danger-wash',
              )}
            >
              <FilePreview file={item.file} />

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm text-ink">{item.file.name}</span>
                <span className="text-xs text-ink-muted" data-numeric="">
                  <span className="force-ltr" dir="ltr">
                    {(formatSize ?? defaultFormatSize)(item.file.size)}
                  </span>
                </span>

                {item.status === 'uploading' && item.progress !== undefined ? (
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(clamp(item.progress))}
                    aria-label={progressLabel?.(item.file.name)}
                    className="mt-0.5 h-1 w-full overflow-hidden rounded-pill bg-raised"
                  >
                    <div
                      className="h-full rounded-pill bg-strait transition-[inline-size] duration-[200ms] ease-[var(--ease-out-strait)]"
                      style={{ inlineSize: `${clamp(item.progress)}%` }}
                    />
                  </div>
                ) : null}

                {item.status === 'error' && item.errorMessage !== undefined ? (
                  <p role="alert" className="flex items-start gap-1.5 text-xs text-danger">
                    <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                    <span>{item.errorMessage}</span>
                  </p>
                ) : null}
              </div>

              {item.status === 'done' ? (
                <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-success" />
              ) : null}

              <IconButton
                size="sm"
                variant="ghost"
                aria-label={removeLabel(item.file.name)}
                disabled={disabled}
                onClick={() => {
                  onRemove(item.id);
                }}
                icon={<X aria-hidden="true" />}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Image thumbnail from an in-memory `File`. The object URL is created and
 * revoked per file, so nothing leaks when the student replaces a receipt five
 * times. Non-images fall back to a document glyph.
 *
 * `alt=""`: the file name is already displayed next to it, so the thumbnail is
 * decorative and repeating the name would be noise.
 */
function FilePreview({ file }: { file: File }): React.JSX.Element {
  const isImage = file.type.startsWith('image/');
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isImage) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, isImage]);

  if (isImage && url !== null) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a blob: URL cannot go through next/image.
      <img
        src={url}
        alt=""
        className="size-12 shrink-0 rounded-sm border border-hairline object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="grid size-12 shrink-0 place-items-center rounded-sm border border-hairline bg-raised text-ink-muted"
    >
      {isImage ? <ImageIcon className="size-5" /> : <FileText className="size-5" />}
    </span>
  );
}

/** `image/*` wildcards, exact MIME types and `.ext` suffixes all work. */
function matchesAccept(file: File, accept: readonly string[]): boolean {
  if (accept.length === 0) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  return accept.some((entry) => {
    const candidate = entry.trim().toLowerCase();
    if (candidate === '') return false;
    if (candidate.startsWith('.')) return name.endsWith(candidate);
    if (candidate.endsWith('/*')) return type.startsWith(candidate.slice(0, -1));
    return type === candidate;
  });
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Megabytes, formatted by `Intl` in the browser's locale — a unit, not a
 * translatable string, so it stays out of the message catalogue.
 */
function defaultFormatSize(bytes: number): string {
  const megabytes = bytes / 1_000_000;
  return new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: 'megabyte',
    unitDisplay: 'short',
    maximumFractionDigits: megabytes < 1 ? 2 : 1,
  }).format(megabytes);
}
