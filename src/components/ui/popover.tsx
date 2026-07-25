'use client';

import { type ComponentPropsWithRef } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/cn';
import { useDirection } from '@/hooks/use-direction';

/**
 * Popover — a themed Radix popover.
 *
 * The content is portalled to `<body>`, so the writing direction is written
 * explicitly onto the panel: it drives the text direction of everything inside
 * *and* lets the positioning engine mirror `align="start" | "end"` correctly
 * in Arabic. Collision handling keeps the panel inside the viewport at 360 px.
 *
 * A popover is dismissible with `Esc` and an outside press, and its trigger
 * carries `aria-expanded` / `aria-controls` from Radix — never wrap a bare
 * `<div>` as the trigger; use `asChild` with a real button.
 */

const POPOVER_KEYFRAMES = `
@keyframes cfi-popover-in { from { opacity: 0; transform: scale(0.96) } to { opacity: 1; transform: none } }
@keyframes cfi-popover-out { from { opacity: 1; transform: none } to { opacity: 0; transform: scale(0.96) } }
`;

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export interface PopoverContentProps
  extends ComponentPropsWithRef<typeof PopoverPrimitive.Content> {
  /** Render the little pointer connecting the panel to its trigger. */
  withArrow?: boolean;
}

export function PopoverContent({
  align = 'center',
  side = 'bottom',
  sideOffset = 8,
  collisionPadding = 12,
  withArrow = false,
  className,
  children,
  ...props
}: PopoverContentProps): React.JSX.Element {
  const { dir } = useDirection();

  return (
    <PopoverPrimitive.Portal>
      <style href="cfi-popover-motion" precedence="high">
        {POPOVER_KEYFRAMES}
      </style>
      <PopoverPrimitive.Content
        dir={dir}
        align={align}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'z-50 w-[min(20rem,calc(100vw_-_1.5rem))] rounded-md border border-hairline bg-raised text-ink shadow-e3 outline-none',
          'max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain',
          'ps-4 pe-4 py-3 text-sm',
          'origin-[var(--radix-popover-content-transform-origin)]',
          'data-[state=open]:animate-[cfi-popover-in_160ms_var(--ease-out-strait)]',
          'data-[state=closed]:animate-[cfi-popover-out_120ms_var(--ease-out-strait)]',
          className,
        )}
        {...props}
      >
        {children}
        {withArrow ? (
          <PopoverPrimitive.Arrow className="fill-raised" width={12} height={6} />
        ) : null}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export type PopoverHeaderProps = ComponentPropsWithRef<'div'>;

/** Optional title row. Pair it with an `id` referenced by `aria-labelledby`. */
export function PopoverHeader({ className, ...props }: PopoverHeaderProps): React.JSX.Element {
  return (
    <div className={cn('mb-2 flex flex-col gap-0.5 text-ink', className)} {...props} />
  );
}
