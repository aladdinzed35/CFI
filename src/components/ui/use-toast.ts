'use client';

import { useSyncExternalStore } from 'react';

/**
 * The toast store.
 *
 * A single module-level queue, readable by `Toaster` through
 * `useSyncExternalStore` and writable from anywhere in the client tree — an
 * action handler, a mutation callback, a `catch` block — without threading a
 * context through the app:
 *
 *   import { toast } from '@/components/ui/use-toast';
 *   toast.success({ title: t('saved'), dismissLabel: t('common.dismiss') });
 *
 * Rules enforced here rather than in the view:
 *  - **At most three toasts are visible.** A fourth closes the oldest still-open
 *    one first, so a burst of notifications never becomes a wall.
 *  - **Copy always comes from the caller.** `title`, `description`, the action
 *    label and `dismissLabel` are strings the caller has already translated;
 *    this file contains no user-facing text.
 *  - Errors stay on screen longer than confirmations, because they usually ask
 *    the reader to do something.
 *
 * Dismissal is two-phased: `open` flips to `false` so Radix can run its exit
 * animation, then the record is dropped once that animation has had time to
 * finish. Removing immediately would make toasts vanish instead of leaving.
 */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastActionSpec {
  /** Visible button label. */
  label: string;
  /**
   * What a screen-reader user should do instead, e.g. "Press Undo in the
   * payments list". Required by the ARIA toast pattern — a toast may be gone
   * before assistive tech reaches its button.
   */
  altText: string;
  onSelect: () => void;
}

export interface ToastOptions {
  title: string;
  description?: string;
  /** Defaults to `info`. */
  variant?: ToastVariant;
  /** Milliseconds on screen. Defaults per variant. `Infinity` to pin it. */
  duration?: number;
  action?: ToastActionSpec;
  /** Accessible name of the dismiss button. */
  dismissLabel: string;
}

export interface ToastRecord {
  id: string;
  title: string;
  description: string | undefined;
  variant: ToastVariant;
  duration: number;
  action: ToastActionSpec | undefined;
  dismissLabel: string;
  /** Drives the Radix `open` prop; `false` plays the exit animation. */
  open: boolean;
  createdAt: number;
}

export interface ToastHandle {
  id: string;
  dismiss: () => void;
  update: (patch: Partial<ToastOptions>) => void;
}

/** Never more than three on screen at once. */
export const MAX_VISIBLE_TOASTS = 3;

/** Long enough to read, long enough to reach the action button. */
const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 5000,
  info: 6000,
  warning: 8000,
  error: 10000,
};

/** Must outlast the exit animation in `toast.tsx` (180 ms) with margin. */
const REMOVE_DELAY_MS = 320;

const EMPTY: readonly ToastRecord[] = [];

let queue: readonly ToastRecord[] = EMPTY;
let sequence = 0;

const listeners = new Set<() => void>();
const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();

function publish(next: readonly ToastRecord[]): void {
  queue = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly ToastRecord[] {
  return queue;
}

function getServerSnapshot(): readonly ToastRecord[] {
  return EMPTY;
}

function scheduleRemoval(id: string): void {
  const pending = removalTimers.get(id);
  if (pending !== undefined) clearTimeout(pending);

  removalTimers.set(
    id,
    setTimeout(() => {
      removalTimers.delete(id);
      publish(queue.filter((item) => item.id !== id));
    }, REMOVE_DELAY_MS),
  );
}

/** Closes the oldest open toasts until at most `MAX_VISIBLE_TOASTS` remain. */
function capVisible(items: readonly ToastRecord[]): readonly ToastRecord[] {
  const open = items.filter((item) => item.open);
  const excess = open.length - MAX_VISIBLE_TOASTS;
  if (excess <= 0) return items;

  const doomed = new Set(open.slice(0, excess).map((item) => item.id));
  for (const id of doomed) scheduleRemoval(id);

  return items.map((item) => (doomed.has(item.id) ? { ...item, open: false } : item));
}

function push(options: ToastOptions): ToastHandle {
  const variant = options.variant ?? 'info';
  sequence += 1;

  const record: ToastRecord = {
    id: `cfi-toast-${sequence}`,
    title: options.title,
    description: options.description,
    variant,
    duration: options.duration ?? DEFAULT_DURATION[variant],
    action: options.action,
    dismissLabel: options.dismissLabel,
    open: true,
    createdAt: Date.now(),
  };

  publish(capVisible([...queue, record]));

  return {
    id: record.id,
    dismiss: () => dismissToast(record.id),
    update: (patch) => updateToast(record.id, patch),
  };
}

/** Starts the exit animation, then drops the record. Idempotent. */
export function dismissToast(id: string): void {
  const target = queue.find((item) => item.id === id);
  if (target === undefined) return;

  if (target.open) {
    publish(queue.map((item) => (item.id === id ? { ...item, open: false } : item)));
  }
  scheduleRemoval(id);
}

export function dismissAllToasts(): void {
  for (const item of queue) dismissToast(item.id);
}

/** Rewrites a live toast — used for "Uploading…" → "Uploaded". */
export function updateToast(id: string, patch: Partial<ToastOptions>): void {
  publish(
    queue.map((item) => {
      if (item.id !== id) return item;

      const variant = patch.variant ?? item.variant;
      return {
        ...item,
        variant,
        title: patch.title ?? item.title,
        description: 'description' in patch ? patch.description : item.description,
        duration: patch.duration ?? (patch.variant ? DEFAULT_DURATION[variant] : item.duration),
        action: 'action' in patch ? patch.action : item.action,
        dismissLabel: patch.dismissLabel ?? item.dismissLabel,
      };
    }),
  );
}

/** Subscribes a component to the queue. Used by `Toaster`; safe anywhere. */
export function useToasts(): readonly ToastRecord[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Imperative read of the queue, for callers outside React — an effect that
 * needs to know whether a given toast is still on screen, or a test.
 */
export function getToasts(): readonly ToastRecord[] {
  return queue;
}

type VariantOptions = Omit<ToastOptions, 'variant'>;

export interface ToastFn {
  (options: ToastOptions): ToastHandle;
  success: (options: VariantOptions) => ToastHandle;
  error: (options: VariantOptions) => ToastHandle;
  warning: (options: VariantOptions) => ToastHandle;
  info: (options: VariantOptions) => ToastHandle;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

/**
 * Queue a toast from any client component. Requires a mounted `<Toaster />`
 * inside `Providers` — calls made before that are queued, not lost.
 */
export const toast: ToastFn = Object.assign(
  (options: ToastOptions): ToastHandle => push(options),
  {
    success: (options: VariantOptions): ToastHandle => push({ ...options, variant: 'success' }),
    error: (options: VariantOptions): ToastHandle => push({ ...options, variant: 'error' }),
    warning: (options: VariantOptions): ToastHandle => push({ ...options, variant: 'warning' }),
    info: (options: VariantOptions): ToastHandle => push({ ...options, variant: 'info' }),
    dismiss: dismissToast,
    dismissAll: dismissAllToasts,
  },
);
