'use client';

import * as React from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { AlertTriangle, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * A radio group rendered as selectable cards — the transfer-type picker in the
 * enrollment modal (§9.2, step 1):
 *
 *   ○ Virement instantané (recommandé)  — activation le jour même
 *   ○ Virement standard (48 h)          — ⚠ activation à réception des fonds
 *   ○ Paiement au centre (espèces)
 *
 * Because the choice between those three carries real money and a real delay,
 * the selected card is legible four different ways and never by colour alone:
 * a filled radio dot, a two-pixel accent ring, a check badge, and a bolder
 * title. `aria-checked` comes from Radix, so assistive technology sees it too.
 *
 * The `warning` slot is where the verbatim 48-hour notice goes — spec §9.2
 * rule 4 requires that copy to appear in the modal, the confirmation screen and
 * the e-mail. It renders inside the card so it cannot be missed while choosing.
 *
 * Everything is `<span>`-based: the card *is* the radio button, and a `<button>`
 * may only contain phrasing content.
 */

export type RadioCardGroupProps = React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>;

export const RadioCardGroup = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  RadioCardGroupProps
>(function RadioCardGroup({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Root ref={ref} className={cn('grid gap-3', className)} {...props} />
  );
});

export interface RadioCardProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>,
    'children' | 'title'
  > {
  /** The option's name. Always visible, never truncated. (Shadows the HTML `title` attribute — a tooltip is not a label.) */
  title: React.ReactNode;
  /** One line of consequence — what choosing this option means. */
  description?: React.ReactNode;
  /** Short qualifier shown next to the title, e.g. « recommandé ». */
  badge?: React.ReactNode;
  /** Amber notice inside the card — the verbatim 48 h delay copy (§9.2). */
  warning?: React.ReactNode;
  /** Optional leading glyph (a bank, a wallet, a building). Decorative. */
  icon?: React.ReactNode;
  /** Trailing slot for a price or a delay. Kept out of the title so it wraps well. */
  meta?: React.ReactNode;
}

export const RadioCard = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  RadioCardProps
>(function RadioCard(
  { className, title, description, badge, warning, icon, meta, disabled, ...props },
  ref,
) {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      disabled={disabled}
      className={cn(
        'group relative flex w-full items-start gap-3 rounded-lg border border-hairline bg-surface p-4 text-start',
        'transition-[background-color,border-color,box-shadow] duration-[120ms] ease-[var(--ease-out-strait)]',
        'hover:border-ink-muted/60 hover:bg-raised',
        'data-[state=checked]:border-strait data-[state=checked]:bg-strait-wash data-[state=checked]:shadow-e2',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55 data-[disabled]:hover:border-hairline data-[disabled]:hover:bg-surface',
        className,
      )}
      {...props}
    >
      {/* The radio itself: ring + dot, drawn so it reads in high contrast. */}
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-pill border-2 border-hairline',
          'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
          'group-data-[state=checked]:border-strait',
        )}
      >
        <span className="size-2.5 scale-0 rounded-pill bg-strait transition-transform duration-[120ms] ease-[var(--ease-out-strait)] group-data-[state=checked]:scale-100" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          {icon != null ? (
            <span aria-hidden="true" className="inline-flex items-center text-ink-muted">
              {icon}
            </span>
          ) : null}
          <span className="text-body text-ink group-data-[state=checked]:font-medium">{title}</span>
          {badge != null ? (
            <span className="inline-flex items-center rounded-pill bg-strait-wash px-2 py-0.5 text-xs font-medium text-strait">
              {badge}
            </span>
          ) : null}
          {meta != null ? (
            <span className="ms-auto text-sm text-ink-muted" data-numeric="">
              {meta}
            </span>
          ) : null}
        </span>

        {description != null ? (
          <span className="text-sm text-ink-muted">{description}</span>
        ) : null}

        {warning != null ? (
          <span className="mt-1 flex items-start gap-2 rounded-md bg-warn-wash p-2.5 text-sm text-warn">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{warning}</span>
          </span>
        ) : null}
      </span>

      {/* Fourth, redundant signal of selection — shape, not just colour. */}
      <span
        aria-hidden="true"
        className="grid size-5 shrink-0 scale-0 place-items-center rounded-pill bg-strait text-on-accent transition-transform duration-[120ms] ease-[var(--ease-out-strait)] group-data-[state=checked]:scale-100"
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    </RadioGroupPrimitive.Item>
  );
});
