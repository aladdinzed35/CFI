'use client';

import { type ComponentProps, type ComponentPropsWithRef } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useDirection } from '@/hooks/use-direction';

/**
 * DropdownMenu — Radix menu, themed and direction-aware.
 *
 * The root receives the active `dir`, which is what makes Radix mirror the
 * arrow keys, the sub-menu opening edge and `align="start" | "end"` in Arabic.
 * Every item is at least 44 px tall so it is a legitimate touch target, and the
 * whole menu is keyboard operable: type-ahead, arrows, `Home`/`End`, `Esc`,
 * and `→`/`←` (mirrored) for sub-menus — all from Radix, none re-implemented.
 *
 * Destructive entries use `variant="danger"`: colour *and* a distinct label are
 * required, colour alone never carries the meaning.
 */

const MENU_KEYFRAMES = `
@keyframes cfi-menu-in { from { opacity: 0; transform: scale(0.96) } to { opacity: 1; transform: none } }
@keyframes cfi-menu-out { from { opacity: 1; transform: none } to { opacity: 0; transform: scale(0.96) } }
`;

const SURFACE =
  'z-50 min-w-[11rem] overflow-y-auto overscroll-contain rounded-md border border-hairline bg-raised p-1.5 text-ink shadow-e3 outline-none';

const MOTION =
  'origin-[var(--radix-dropdown-menu-content-transform-origin)] data-[state=open]:animate-[cfi-menu-in_140ms_var(--ease-out-strait)] data-[state=closed]:animate-[cfi-menu-out_110ms_var(--ease-out-strait)]';

const ITEM_BASE =
  'relative flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-sm ps-3 pe-3 py-2 text-sm outline-none transition-colors duration-[120ms] ease-[var(--ease-out-strait)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

const ITEM_TONE: Record<'default' | 'danger', string> = {
  default: 'text-ink data-[highlighted]:bg-strait-wash data-[highlighted]:text-ink',
  danger: 'text-danger data-[highlighted]:bg-danger-wash data-[highlighted]:text-danger',
};

export type DropdownMenuItemTone = keyof typeof ITEM_TONE;

export type DropdownMenuProps = ComponentProps<typeof DropdownMenuPrimitive.Root>;

export function DropdownMenu({ dir, ...props }: DropdownMenuProps): React.JSX.Element {
  const { dir: active } = useDirection();
  return <DropdownMenuPrimitive.Root dir={dir ?? active} {...props} />;
}

export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

export type DropdownMenuContentProps = ComponentPropsWithRef<
  typeof DropdownMenuPrimitive.Content
>;

export function DropdownMenuContent({
  sideOffset = 6,
  collisionPadding = 12,
  align = 'start',
  className,
  ...props
}: DropdownMenuContentProps): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Portal>
      <style href="cfi-menu-motion" precedence="high">
        {MENU_KEYFRAMES}
      </style>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        align={align}
        className={cn(
          SURFACE,
          MOTION,
          'max-h-[var(--radix-dropdown-menu-content-available-height)]',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export interface DropdownMenuItemProps
  extends ComponentPropsWithRef<typeof DropdownMenuPrimitive.Item> {
  variant?: DropdownMenuItemTone;
  /** Adds the indent used by checkbox and radio items, for visual alignment. */
  inset?: boolean;
}

export function DropdownMenuItem({
  variant = 'default',
  inset = false,
  className,
  ...props
}: DropdownMenuItemProps): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(ITEM_BASE, ITEM_TONE[variant], inset ? 'ps-9' : null, className)}
      {...props}
    />
  );
}

export type DropdownMenuCheckboxItemProps = ComponentPropsWithRef<
  typeof DropdownMenuPrimitive.CheckboxItem
>;

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: DropdownMenuCheckboxItemProps): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(ITEM_BASE, ITEM_TONE.default, 'ps-9', className)}
      {...props}
    >
      <span className="absolute start-2.5 grid size-4 place-items-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-4 text-strait" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export type DropdownMenuRadioItemProps = ComponentPropsWithRef<
  typeof DropdownMenuPrimitive.RadioItem
>;

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: DropdownMenuRadioItemProps): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(ITEM_BASE, ITEM_TONE.default, 'ps-9', className)}
      {...props}
    >
      <span className="absolute start-2.5 grid size-4 place-items-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="size-2.5 fill-strait text-strait" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export interface DropdownMenuLabelProps
  extends ComponentPropsWithRef<typeof DropdownMenuPrimitive.Label> {
  inset?: boolean;
}

export function DropdownMenuLabel({
  inset = false,
  className,
  ...props
}: DropdownMenuLabelProps): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        'ps-3 pe-3 pt-2 pb-1 text-xs font-medium tracking-wide text-ink-muted uppercase',
        inset ? 'ps-9' : null,
        className,
      )}
      {...props}
    />
  );
}

export type DropdownMenuSeparatorProps = ComponentPropsWithRef<
  typeof DropdownMenuPrimitive.Separator
>;

export function DropdownMenuSeparator({
  className,
  ...props
}: DropdownMenuSeparatorProps): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('my-1.5 h-px bg-hairline', className)}
      {...props}
    />
  );
}

export interface DropdownMenuSubTriggerProps
  extends ComponentPropsWithRef<typeof DropdownMenuPrimitive.SubTrigger> {
  inset?: boolean;
}

export function DropdownMenuSubTrigger({
  inset = false,
  className,
  children,
  ...props
}: DropdownMenuSubTriggerProps): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        ITEM_BASE,
        ITEM_TONE.default,
        'data-[state=open]:bg-strait-wash',
        inset ? 'ps-9' : null,
        className,
      )}
      {...props}
    >
      {children}
      {/* Direction-carrying icon: mirrored in RTL. */}
      <ChevronRight className="ms-auto size-4 shrink-0 text-ink-muted rtl:-scale-x-100" aria-hidden="true" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export type DropdownMenuSubContentProps = ComponentPropsWithRef<
  typeof DropdownMenuPrimitive.SubContent
>;

export function DropdownMenuSubContent({
  sideOffset = 2,
  collisionPadding = 12,
  className,
  ...props
}: DropdownMenuSubContentProps): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Portal>
      <style href="cfi-menu-motion" precedence="high">
        {MENU_KEYFRAMES}
      </style>
      <DropdownMenuPrimitive.SubContent
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(SURFACE, MOTION, className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

/** Keyboard hint. Latin glyphs stay LTR inside Arabic menus (§10.3). */
export type DropdownMenuShortcutProps = ComponentPropsWithRef<'span'>;

export function DropdownMenuShortcut({
  className,
  ...props
}: DropdownMenuShortcutProps): React.JSX.Element {
  return (
    <span
      dir="ltr"
      className={cn('force-ltr ms-auto text-xs tracking-wide text-ink-muted', className)}
      {...props}
    />
  );
}
