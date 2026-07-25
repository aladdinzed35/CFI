'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Select, on top of Radix — a real listbox with typeahead, keyboard navigation
 * and collision-aware positioning, which a styled native `<select>` cannot give
 * us on every platform.
 *
 * Composition (deliberately not a single `items` prop, because half the screens
 * need groups, separators or a richer item body):
 *
 *   <Select dir={dirFor(locale)} value={v} onValueChange={setV}>
 *     <SelectTrigger id={id}><SelectValue placeholder={t('choose')} /></SelectTrigger>
 *     <SelectContent>
 *       <SelectItem value="casablanca">{t('casablanca')}</SelectItem>
 *     </SelectContent>
 *   </Select>
 *
 * RTL: pass `dir` on the root — Radix then flips its own positioning and
 * keyboard model. The chevron is a *vertical* glyph and is never mirrored; what
 * moves is its position, and that follows from `justify-between` in a flex row,
 * so it lands on the right in French and on the left in Arabic on its own.
 * The check indicator is pinned with the logical `start-2`.
 */

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export type SelectSize = 'sm' | 'md' | 'lg';

const triggerSizeClasses: Record<SelectSize, string> = {
  sm: 'h-11 text-sm',
  md: 'h-12 text-body',
  lg: 'h-14 text-lead',
};

export interface SelectTriggerProps
  extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> {
  /** Control height, matched to `Input`. */
  selectSize?: SelectSize;
  /** Puts the trigger in its error state and sets `aria-invalid`. */
  invalid?: boolean;
}

export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(function SelectTrigger({ className, children, selectSize = 'md', invalid = false, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      aria-invalid={invalid ? true : undefined}
      className={cn(
        'group flex w-full items-center justify-between gap-2 rounded-md border border-hairline bg-surface px-4 text-ink text-start',
        'transition-[border-color,background-color] duration-[120ms] ease-[var(--ease-out-strait)]',
        'hover:border-ink-muted/60',
        'focus-visible:border-strait',
        // Radix marks the trigger while it is showing the placeholder.
        'data-[placeholder]:text-ink-muted',
        'disabled:cursor-not-allowed disabled:bg-raised disabled:opacity-55',
        'aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-wash',
        '[&>span]:min-w-0 [&>span]:truncate',
        triggerSizeClasses[selectSize],
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-muted transition-transform duration-[120ms] ease-[var(--ease-out-strait)] group-data-[state=open]:rotate-180"
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectScrollUpButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(function SelectScrollUpButton({ className, ...props }, ref) {
  return (
    <SelectPrimitive.ScrollUpButton
      ref={ref}
      className={cn('flex h-7 items-center justify-center text-ink-muted', className)}
      {...props}
    >
      <ChevronUp aria-hidden="true" className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
});

export const SelectScrollDownButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(function SelectScrollDownButton({ className, ...props }, ref) {
  return (
    <SelectPrimitive.ScrollDownButton
      ref={ref}
      className={cn('flex h-7 items-center justify-center text-ink-muted', className)}
      {...props}
    >
      <ChevronDown aria-hidden="true" className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
});

export const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = 'popper', sideOffset = 6, ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={position === 'popper' ? sideOffset : undefined}
        className={cn(
          'relative z-50 overflow-hidden rounded-md border border-hairline bg-raised text-ink shadow-e3',
          'max-h-[var(--radix-select-content-available-height)]',
          position === 'popper' && 'min-w-[var(--radix-select-trigger-width)]',
          className,
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport className="p-1.5">{children}</SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cn('px-2 py-1.5 text-xs font-medium text-ink-muted', className)}
      {...props}
    />
  );
});

export interface SelectItemProps
  extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> {
  /** Secondary line under the option label. */
  description?: React.ReactNode;
}

export const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  SelectItemProps
>(function SelectItem({ className, children, description, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-2.5 pe-2 ps-8 text-body text-start outline-none',
        'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
        'data-[highlighted]:bg-strait-wash data-[highlighted]:text-ink',
        'data-[state=checked]:font-medium',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-55',
        className,
      )}
      {...props}
    >
      <span className="absolute start-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          {/* A checkmark reads the same in both directions: never mirrored. */}
          <Check aria-hidden="true" className="size-4 text-strait" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {description != null ? (
          <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>
        ) : null}
      </span>
    </SelectPrimitive.Item>
  );
});

export const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Separator
      ref={ref}
      className={cn('-mx-1.5 my-1.5 h-px bg-hairline', className)}
      {...props}
    />
  );
});
