'use client';

import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Accordion — the FAQ on the homepage, the curriculum rail in the player, the
 * module list on the course page.
 *
 * Radix gives the semantics (button + region, `aria-expanded`, full keyboard
 * support) and exposes `--radix-accordion-content-height`, which is what makes a
 * real height transition possible. The keyframes live in a hoisted, de-duplicated
 * `<style>` (React 19 `href` + `precedence`) rather than in globals.css, which
 * this component does not own; both run once, both stop, and both are removed
 * under `prefers-reduced-motion`.
 *
 * The chevron rotates on the block axis, so it is *not* mirrored in RTL — only
 * direction-carrying icons are (§10.3).
 */

const accordionKeyframes = `
@keyframes cfi-accordion-down {
  from { height: 0; opacity: 0; }
  to   { height: var(--radix-accordion-content-height); opacity: 1; }
}
@keyframes cfi-accordion-up {
  from { height: var(--radix-accordion-content-height); opacity: 1; }
  to   { height: 0; opacity: 0; }
}
.cfi-accordion-content[data-state='open']   { animation: cfi-accordion-down 200ms var(--ease-out-strait); }
.cfi-accordion-content[data-state='closed'] { animation: cfi-accordion-up 180ms var(--ease-out-strait); }
@media (prefers-reduced-motion: reduce) {
  .cfi-accordion-content[data-state='open'],
  .cfi-accordion-content[data-state='closed'] { animation: none; }
}
`;

export function Accordion(
  props: React.ComponentProps<typeof AccordionPrimitive.Root>,
): React.JSX.Element {
  return (
    <>
      <style href="cfi-accordion" precedence="medium">
        {accordionKeyframes}
      </style>
      <AccordionPrimitive.Root {...props} />
    </>
  );
}

export function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>): React.JSX.Element {
  return (
    <AccordionPrimitive.Item
      className={cn('border-b border-hairline last:border-b-0', className)}
      {...props}
    />
  );
}

export interface AccordionTriggerProps
  extends React.ComponentProps<typeof AccordionPrimitive.Trigger> {
  /** Slot rendered between the label and the chevron — a duration, a count, a pill. */
  meta?: React.ReactNode;
}

export function AccordionTrigger({
  className,
  children,
  meta,
  ...props
}: AccordionTriggerProps): React.JSX.Element {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          'group flex min-h-11 w-full flex-1 items-center justify-between gap-3 py-4 text-start text-body font-medium text-ink',
          'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none',
          'hover:text-strait disabled:pointer-events-none disabled:opacity-50',
          className,
        )}
        {...props}
      >
        <span className="min-w-0 flex-1 text-balance">{children}</span>
        <span className="flex shrink-0 items-center gap-3">
          {meta === undefined ? null : (
            <span className="text-sm font-normal text-ink-muted">{meta}</span>
          )}
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-ink-muted transition-transform duration-200 ease-[var(--ease-out-strait)] group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>): React.JSX.Element {
  return (
    <AccordionPrimitive.Content
      className="cfi-accordion-content overflow-hidden"
      {...props}
    >
      <div className={cn('pb-4 text-body text-ink-muted', className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
