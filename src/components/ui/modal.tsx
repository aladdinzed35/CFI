'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Modal — one component, two shapes (§11.4).
 *
 * Below `md` (768 px) it is a **bottom sheet**: pinned to the block end, rounded
 * top corners, a drag handle you can actually flick down to dismiss, and safe
 * area padding. From `md` up it is a centred dialog. There is no second
 * component and no JS breakpoint switch — the shape is pure CSS, so it is
 * correct before hydration and stays correct when the window is resized.
 *
 * Radix Dialog supplies the parts that must never be re-implemented: focus
 * trap, focus restore, `Esc`, scroll lock, `aria-modal`, and the
 * labelled-by/described-by wiring between `ModalTitle`/`ModalDescription` and
 * the content.
 *
 * ── `data-overlay-open` ────────────────────────────────────────────────────
 * While any overlay built on this file is mounted, `<body>` carries
 * `data-overlay-open="true"`. This is a **public contract**: the floating
 * WhatsApp button (§12.1) and the AI dock hide themselves while it is present.
 * The flag is reference-counted, so nested overlays (a drawer opening a
 * confirmation modal) only clear it when the last one closes.
 *
 * This module also owns two helpers shared by the other dialog-family
 * primitives — `useOverlayFlag` and `useSheetDrag` — plus `OverlayMotion`, the
 * keyframe sheet React 19 hoists and de-duplicates by `href`.
 */

/* ─────────────────────────────────────────────────────────────────────────────
   Shared overlay infrastructure
   ───────────────────────────────────────────────────────────────────────── */

/** The attribute the WhatsApp FAB and the AI dock watch. Do not rename. */
export const OVERLAY_OPEN_ATTRIBUTE = 'data-overlay-open';

let overlayDepth = 0;

/**
 * Marks `<body>` as covered by an overlay for as long as the calling component
 * is mounted. Reference-counted so nested overlays compose.
 */
export function useOverlayFlag(): void {
  useEffect(() => {
    overlayDepth += 1;
    document.body.setAttribute(OVERLAY_OPEN_ATTRIBUTE, 'true');

    return () => {
      overlayDepth = Math.max(0, overlayDepth - 1);
      if (overlayDepth === 0) document.body.removeAttribute(OVERLAY_OPEN_ATTRIBUTE);
    };
  }, []);
}

/**
 * Renders nothing; raises the flag for as long as it is mounted.
 *
 * It must live **inside** `Dialog.Portal`, which renders no children while the
 * dialog is closed. Calling `useOverlayFlag()` from the content component would
 * raise the flag as soon as that component appears in the tree — which, for the
 * usual `<Modal><ModalContent/></Modal>` shape, is permanently.
 */
export function OverlayFlag(): null {
  useOverlayFlag();
  return null;
}

const OVERLAY_KEYFRAMES = `
@keyframes cfi-overlay-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes cfi-overlay-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes cfi-dialog-in { from { opacity: 0; transform: translate3d(0, 12px, 0) scale(0.985) } to { opacity: 1; transform: none } }
@keyframes cfi-dialog-out { from { opacity: 1; transform: none } to { opacity: 0; transform: translate3d(0, 12px, 0) scale(0.985) } }
@keyframes cfi-sheet-in { from { transform: translate3d(0, 100%, 0) } to { transform: translate3d(0, 0, 0) } }
@keyframes cfi-sheet-out { from { transform: translate3d(0, 0, 0) } to { transform: translate3d(0, 100%, 0) } }
@keyframes cfi-panel-in-left { from { transform: translate3d(-100%, 0, 0) } to { transform: translate3d(0, 0, 0) } }
@keyframes cfi-panel-out-left { from { transform: translate3d(0, 0, 0) } to { transform: translate3d(-100%, 0, 0) } }
@keyframes cfi-panel-in-right { from { transform: translate3d(100%, 0, 0) } to { transform: translate3d(0, 0, 0) } }
@keyframes cfi-panel-out-right { from { transform: translate3d(0, 0, 0) } to { transform: translate3d(100%, 0, 0) } }
`;

/**
 * Keyframes for every dialog-family overlay. Rendered inside each portal;
 * React 19 hoists it to `<head>` and de-duplicates it by `href`, so mounting a
 * hundred modals still yields exactly one stylesheet.
 *
 * Durations respect reduced motion through `globals.css`, which clamps every
 * `animation-duration` to 0.01 ms — Radix still receives its `animationend`
 * and unmounts cleanly.
 */
export function OverlayMotion(): React.JSX.Element {
  return (
    <style href="cfi-overlay-motion" precedence="high">
      {OVERLAY_KEYFRAMES}
    </style>
  );
}

/** Past this many pixels of downward travel, releasing dismisses the sheet. */
const SHEET_DISMISS_PX = 88;

export interface SheetDragHandleProps {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface SheetDrag {
  /** Spread onto the grab handle. */
  handleProps: SheetDragHandleProps;
  /** Inline transform for the panel — `undefined` unless a drag is in flight. */
  style: CSSProperties | undefined;
  dragging: boolean;
}

/**
 * Flick-down-to-dismiss for bottom sheets. Touch and pen only: a mouse has the
 * close button and `Esc`, and hijacking mouse drags breaks text selection.
 * The handle is decorative for assistive tech — every gesture it offers is also
 * available from the close button, so nothing is gesture-only.
 */
export function useSheetDrag(onDismiss: () => void): SheetDrag {
  const origin = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerType === 'mouse') return;
    origin.current = event.clientY;
    setOffset(0);
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const start = origin.current;
    if (start === null) return;
    const delta = event.clientY - start;
    // Rubber-band upward travel so the sheet feels attached, not free.
    setOffset(delta > 0 ? delta : delta / 5);
  }, []);

  const release = useCallback((event: ReactPointerEvent<HTMLElement>): number | null => {
    const start = origin.current;
    if (start === null) return null;
    origin.current = null;
    setDragging(false);
    setOffset(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    return event.clientY - start;
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const delta = release(event);
      if (delta !== null && delta > SHEET_DISMISS_PX) onDismiss();
    },
    [onDismiss, release],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      release(event);
    },
    [release],
  );

  return {
    handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    style: dragging ? { transform: `translate3d(0, ${offset}px, 0)`, transition: 'none' } : undefined,
    dragging,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Modal
   ───────────────────────────────────────────────────────────────────────── */

export type ModalSize = 'sm' | 'md' | 'lg' | 'full';

const MODAL_SIZE: Record<ModalSize, string> = {
  sm: 'md:max-w-[26rem]',
  md: 'md:max-w-[34rem]',
  lg: 'md:max-w-[48rem]',
  full: 'md:max-w-[min(80rem,calc(100vw_-_3rem))] md:max-h-[calc(100dvh_-_3rem)]',
};

export const Modal = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalClose = DialogPrimitive.Close;

export interface ModalContentProps extends ComponentPropsWithRef<typeof DialogPrimitive.Content> {
  /** Desktop width. Ignored below `md`, where the sheet is always full width. */
  size?: ModalSize;
  /** Accessible name of the close button. Supplied by the caller, always. */
  closeLabel: string;
  /** Drop the corner close button — only for flows that own their own exit. */
  hideClose?: boolean;
  children?: ReactNode;
}

export function ModalContent({
  size = 'md',
  closeLabel,
  hideClose = false,
  className,
  children,
  ...props
}: ModalContentProps): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dismiss = useCallback((): void => {
    closeRef.current?.click();
  }, []);
  const drag = useSheetDrag(dismiss);

  return (
    <DialogPrimitive.Portal>
      <OverlayFlag />
      <OverlayMotion />
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-40 bg-abyss/70 backdrop-blur-[2px]',
          'data-[state=open]:animate-[cfi-overlay-in_180ms_var(--ease-out-strait)]',
          'data-[state=closed]:animate-[cfi-overlay-out_150ms_var(--ease-out-strait)]',
        )}
      />
      {/* Centring wrapper. `pointer-events-none` so clicks land on the overlay
          and Radix's dismissable layer can close on outside press. */}
      <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
        <DialogPrimitive.Content
          className={cn(
            'pointer-events-auto relative flex max-h-[92dvh] w-full flex-col overflow-hidden outline-none',
            'rounded-t-lg bg-surface text-ink shadow-e4',
            'pb-[env(safe-area-inset-bottom,0px)] md:pb-0',
            'md:max-h-[85dvh] md:rounded-lg md:border md:border-hairline',
            'data-[state=open]:animate-[cfi-sheet-in_260ms_var(--ease-out-strait)]',
            'data-[state=closed]:animate-[cfi-sheet-out_200ms_var(--ease-out-strait)]',
            'md:data-[state=open]:animate-[cfi-dialog-in_200ms_var(--ease-out-strait)]',
            'md:data-[state=closed]:animate-[cfi-dialog-out_160ms_var(--ease-out-strait)]',
            MODAL_SIZE[size],
            className,
          )}
          style={drag.style}
          {...props}
        >
          {/* Programmatic close target for the drag gesture. Not focusable and
              hidden from assistive tech: it duplicates the button below. */}
          <DialogPrimitive.Close ref={closeRef} aria-hidden tabIndex={-1} className="hidden" />

          <div
            {...drag.handleProps}
            aria-hidden="true"
            className={cn(
              'flex shrink-0 touch-none items-center justify-center pt-3 pb-1 md:hidden',
              drag.dragging ? 'cursor-grabbing' : 'cursor-grab',
            )}
          >
            <span className="h-1 w-10 rounded-pill bg-hairline" />
          </div>

          {children}

          {!hideClose ? (
            <DialogPrimitive.Close
              className={cn(
                'absolute end-2 top-2 grid size-11 place-items-center rounded-sm text-ink-muted md:end-3 md:top-3',
                'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                'hover:bg-raised hover:text-ink active:bg-raised',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              <X className="size-5" aria-hidden="true" />
              <span className="sr-only">{closeLabel}</span>
            </DialogPrimitive.Close>
          ) : null}
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

export type ModalHeaderProps = ComponentPropsWithRef<'div'>;

export function ModalHeader({ className, ...props }: ModalHeaderProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col gap-1 ps-5 pe-14 pt-4 pb-3 md:ps-6 md:pe-16 md:pt-6 md:pb-4',
        className,
      )}
      {...props}
    />
  );
}

export type ModalTitleProps = ComponentPropsWithRef<typeof DialogPrimitive.Title>;

export function ModalTitle({ className, ...props }: ModalTitleProps): React.JSX.Element {
  return (
    <DialogPrimitive.Title
      className={cn('font-display text-heading text-ink', className)}
      {...props}
    />
  );
}

export type ModalDescriptionProps = ComponentPropsWithRef<typeof DialogPrimitive.Description>;

export function ModalDescription({
  className,
  ...props
}: ModalDescriptionProps): React.JSX.Element {
  return (
    <DialogPrimitive.Description
      className={cn('text-sm text-ink-muted', className)}
      {...props}
    />
  );
}

export type ModalBodyProps = ComponentPropsWithRef<'div'>;

export function ModalBody({ className, ...props }: ModalBodyProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-y-auto overscroll-contain ps-5 pe-5 py-1 md:ps-6 md:pe-6',
        className,
      )}
      {...props}
    />
  );
}

export type ModalFooterProps = ComponentPropsWithRef<'div'>;

export function ModalFooter({ className, ...props }: ModalFooterProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'hairline-t mt-4 flex shrink-0 flex-col-reverse gap-2 ps-5 pe-5 py-4 sm:flex-row sm:justify-end md:ps-6 md:pe-6 md:py-5',
        className,
      )}
      {...props}
    />
  );
}
