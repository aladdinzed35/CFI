'use client';

import { type ComponentPropsWithRef } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/cn';
import { useDirection } from '@/hooks/use-direction';

/**
 * Tooltip — a supplementary hint, never the only place a fact exists.
 *
 * Rules this primitive is designed around (§21):
 *  - A tooltip is **never the sole carrier of information**. Anything a user
 *    must know to complete a task lives in visible text, a label, or a
 *    `FormError`. Use a tooltip for shortcuts, units, and clarifications only.
 *  - Tooltips are not reachable on touch. If the hint matters on a phone, use
 *    a `Popover` (tap-triggered) or inline help text instead.
 *  - The trigger must be focusable — wrap a real button or link with `asChild`.
 *    Radix wires `aria-describedby` from the trigger to the content, so the
 *    hint is announced without duplicating the accessible name.
 *
 * `TooltipProvider` is already mounted app-wide in `components/system/providers`;
 * it is re-exported here for isolated trees (tests, previews).
 */

const TOOLTIP_KEYFRAMES = `
@keyframes cfi-tooltip-in { from { opacity: 0; transform: scale(0.96) } to { opacity: 1; transform: none } }
@keyframes cfi-tooltip-out { from { opacity: 1; transform: none } to { opacity: 0; transform: scale(0.96) } }
`;

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export interface TooltipContentProps
  extends ComponentPropsWithRef<typeof TooltipPrimitive.Content> {
  /** Hide the pointer. Only worth doing on very narrow anchors. */
  hideArrow?: boolean;
}

export function TooltipContent({
  side = 'top',
  sideOffset = 6,
  collisionPadding = 8,
  hideArrow = false,
  className,
  children,
  ...props
}: TooltipContentProps): React.JSX.Element {
  const { dir } = useDirection();

  return (
    <TooltipPrimitive.Portal>
      <style href="cfi-tooltip-motion" precedence="high">
        {TOOLTIP_KEYFRAMES}
      </style>
      <TooltipPrimitive.Content
        dir={dir}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'z-50 max-w-[min(18rem,calc(100vw_-_1.5rem))] rounded-sm border border-hairline bg-raised text-ink shadow-e2',
          'ps-2.5 pe-2.5 py-1.5 text-xs',
          'origin-[var(--radix-tooltip-content-transform-origin)]',
          'data-[state=delayed-open]:animate-[cfi-tooltip-in_140ms_var(--ease-out-strait)]',
          'data-[state=instant-open]:animate-[cfi-tooltip-in_140ms_var(--ease-out-strait)]',
          'data-[state=closed]:animate-[cfi-tooltip-out_100ms_var(--ease-out-strait)]',
          className,
        )}
        {...props}
      >
        {children}
        {!hideArrow ? (
          <TooltipPrimitive.Arrow className="fill-raised" width={10} height={5} />
        ) : null}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/**
 * A keyboard shortcut rendered inside a tooltip. Shortcuts are Latin glyphs and
 * stay LTR inside Arabic copy (§10.3).
 */
export type TooltipShortcutProps = ComponentPropsWithRef<'span'>;

export function TooltipShortcut({
  className,
  ...props
}: TooltipShortcutProps): React.JSX.Element {
  return (
    <span
      dir="ltr"
      data-numeric=""
      className={cn(
        'force-ltr ms-2 rounded-sm border border-hairline bg-surface px-1 text-[0.6875rem] text-ink-muted',
        className,
      )}
      {...props}
    />
  );
}
