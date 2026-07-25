'use client';

import { useCallback, useRef, type ComponentPropsWithRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useDirection } from '@/hooks/use-direction';
import { OverlayFlag, OverlayMotion, useSheetDrag } from './modal';

/**
 * Drawer — a dialog anchored to an edge.
 *
 * `side` is **logical**: `'start'` and `'end'` follow the writing direction, so
 * an inspector that opens from the right in French opens from the left in
 * Arabic without the caller thinking about it. Only the slide keyframe needs a
 * physical value, and that is resolved here from `useDirection()`.
 *
 * `size="wide"` plus `DrawerPanes` gives the two-pane desktop layout the admin
 * payment-verification drawer needs (§17.3): receipt viewer beside context and
 * decision on `lg`, stacked and independently scrollable on a phone — an admin
 * approving a payment from their phone is a primary use case, not a fallback.
 *
 * Shares the focus trap, scroll lock, `Esc` handling and the `data-overlay-open`
 * body flag with `Modal`.
 */

export type DrawerSide = 'start' | 'end' | 'bottom';
export type DrawerSize = 'md' | 'lg' | 'wide';

const SIDE_POSITION: Record<DrawerSide, string> = {
  start: 'inset-y-0 start-0 h-full w-full rounded-e-lg border-e border-hairline',
  end: 'inset-y-0 end-0 h-full w-full rounded-s-lg border-s border-hairline',
  bottom:
    'bottom-0 start-0 end-0 max-h-[92dvh] w-full rounded-t-lg border-t border-hairline pb-[env(safe-area-inset-bottom,0px)]',
};

const SIDE_WIDTH: Record<DrawerSize, string> = {
  md: 'max-w-[min(26rem,calc(100vw_-_2rem))]',
  lg: 'max-w-[min(38rem,calc(100vw_-_2rem))]',
  wide: 'max-w-[min(78rem,calc(100vw_-_1.5rem))]',
};

/** Physical keyframe pair for an inline-axis panel. */
function inlineMotion(side: 'start' | 'end', isRtl: boolean): string {
  const physical: 'left' | 'right' = side === 'start' ? (isRtl ? 'right' : 'left') : isRtl ? 'left' : 'right';

  return physical === 'left'
    ? 'data-[state=open]:animate-[cfi-panel-in-left_280ms_var(--ease-out-strait)] data-[state=closed]:animate-[cfi-panel-out-left_220ms_var(--ease-out-strait)]'
    : 'data-[state=open]:animate-[cfi-panel-in-right_280ms_var(--ease-out-strait)] data-[state=closed]:animate-[cfi-panel-out-right_220ms_var(--ease-out-strait)]';
}

const BOTTOM_MOTION =
  'data-[state=open]:animate-[cfi-sheet-in_280ms_var(--ease-out-strait)] data-[state=closed]:animate-[cfi-sheet-out_220ms_var(--ease-out-strait)]';

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export interface DrawerContentProps extends ComponentPropsWithRef<typeof DialogPrimitive.Content> {
  /** Logical edge the panel is anchored to. Defaults to the inline end. */
  side?: DrawerSide;
  /** Inline size on the inline-axis sides. Ignored when `side="bottom"`. */
  size?: DrawerSize;
  /** Accessible name of the close button. */
  closeLabel: string;
  hideClose?: boolean;
  children?: ReactNode;
}

export function DrawerContent({
  side = 'end',
  size = 'md',
  closeLabel,
  hideClose = false,
  className,
  children,
  ...props
}: DrawerContentProps): React.JSX.Element {
  const { isRtl } = useDirection();

  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dismiss = useCallback((): void => {
    closeRef.current?.click();
  }, []);
  const drag = useSheetDrag(dismiss);
  const isBottom = side === 'bottom';

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
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col overflow-hidden bg-surface text-ink shadow-e4 outline-none',
          SIDE_POSITION[side],
          isBottom ? BOTTOM_MOTION : cn(SIDE_WIDTH[size], inlineMotion(side, isRtl)),
          className,
        )}
        style={isBottom ? drag.style : undefined}
        {...props}
      >
        <DialogPrimitive.Close ref={closeRef} aria-hidden tabIndex={-1} className="hidden" />

        {isBottom ? (
          <div
            {...drag.handleProps}
            aria-hidden="true"
            className={cn(
              'flex shrink-0 touch-none items-center justify-center pt-3 pb-1',
              drag.dragging ? 'cursor-grabbing' : 'cursor-grab',
            )}
          >
            <span className="h-1 w-10 rounded-pill bg-hairline" />
          </div>
        ) : null}

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
    </DialogPrimitive.Portal>
  );
}

export type DrawerHeaderProps = ComponentPropsWithRef<'div'>;

export function DrawerHeader({ className, ...props }: DrawerHeaderProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'hairline-b flex shrink-0 flex-col gap-1 ps-5 pe-14 pt-4 pb-4 md:ps-6 md:pe-16 md:pt-5',
        className,
      )}
      {...props}
    />
  );
}

export type DrawerTitleProps = ComponentPropsWithRef<typeof DialogPrimitive.Title>;

export function DrawerTitle({ className, ...props }: DrawerTitleProps): React.JSX.Element {
  return (
    <DialogPrimitive.Title
      className={cn('font-display text-heading text-ink', className)}
      {...props}
    />
  );
}

export type DrawerDescriptionProps = ComponentPropsWithRef<typeof DialogPrimitive.Description>;

export function DrawerDescription({
  className,
  ...props
}: DrawerDescriptionProps): React.JSX.Element {
  return (
    <DialogPrimitive.Description className={cn('text-sm text-ink-muted', className)} {...props} />
  );
}

export type DrawerBodyProps = ComponentPropsWithRef<'div'>;

export function DrawerBody({ className, ...props }: DrawerBodyProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-y-auto overscroll-contain ps-5 pe-5 py-4 md:ps-6 md:pe-6 md:py-5',
        className,
      )}
      {...props}
    />
  );
}

export type DrawerPanesRatio = 'wide-start' | 'equal';

export interface DrawerPanesProps extends ComponentPropsWithRef<'div'> {
  /**
   * `wide-start` gives the leading pane the room (receipt viewer beside a
   * fixed-width decision column). `equal` splits it down the middle.
   */
  ratio?: DrawerPanesRatio;
}

export function DrawerPanes({
  ratio = 'wide-start',
  className,
  ...props
}: DrawerPanesProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:overflow-hidden',
        ratio === 'equal'
          ? 'lg:grid-cols-2'
          : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]',
        className,
      )}
      {...props}
    />
  );
}

export interface DrawerPaneProps extends ComponentPropsWithRef<'div'> {
  /** `aside` is the trailing column: separated, slightly raised, narrower. */
  variant?: 'main' | 'aside';
}

export function DrawerPane({
  variant = 'main',
  className,
  ...props
}: DrawerPaneProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-col gap-4 ps-5 pe-5 py-4 md:ps-6 md:pe-6 md:py-5 lg:overflow-y-auto lg:overscroll-contain',
        variant === 'aside'
          ? 'border-t border-hairline bg-raised lg:border-t-0 lg:border-s lg:border-hairline'
          : null,
        className,
      )}
      {...props}
    />
  );
}

export type DrawerFooterProps = ComponentPropsWithRef<'div'>;

export function DrawerFooter({ className, ...props }: DrawerFooterProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'hairline-t flex shrink-0 flex-col-reverse gap-2 ps-5 pe-5 py-4 sm:flex-row sm:justify-end md:ps-6 md:pe-6',
        className,
      )}
      {...props}
    />
  );
}
