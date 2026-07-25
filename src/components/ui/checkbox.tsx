'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FormError } from '@/components/ui/form-field';

/**
 * Checkbox, on top of Radix, in two shapes:
 *
 * - `Checkbox` — the box alone, for a table header or an inline filter. It is
 *   20px of paint with a 44px hit area: a transparent `::after` pinned to
 *   `inset-0` and pulled outwards, exactly like `IconButton`.
 * - `CheckboxField` — box + label + optional description and error, with the
 *   ids generated and wired. This is the one the registration form's
 *   « J'accepte les conditions » uses.
 *
 * The checked state carries a checkmark, not just a fill, so it survives
 * greyscale and colour-blindness. A checkmark has no reading direction and is
 * never mirrored in Arabic.
 */

export type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
  /** Puts the box in its error state and sets `aria-invalid`. */
  invalid?: boolean;
};

export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(function Checkbox({ className, invalid = false, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      aria-invalid={invalid ? true : undefined}
      className={cn(
        'relative grid size-5 shrink-0 place-items-center rounded-sm border border-hairline bg-surface text-on-accent',
        'transition-[background-color,border-color] duration-[120ms] ease-[var(--ease-out-strait)]',
        // 20px painted, 44px touchable.
        "after:absolute after:inset-0 after:-m-3 after:content-['']",
        'hover:border-ink-muted',
        'data-[state=checked]:border-strait data-[state=checked]:bg-strait',
        'data-[state=indeterminate]:border-strait data-[state=indeterminate]:bg-strait',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-hairline',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-items-center text-current">
        {props.checked === 'indeterminate' ? (
          <Minus aria-hidden="true" className="size-3.5" strokeWidth={3} />
        ) : (
          <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

export interface CheckboxFieldProps extends CheckboxProps {
  /** Visible label. Clicking it toggles the box. */
  label: React.ReactNode;
  /** Help text under the label, linked with `aria-describedby`. */
  description?: React.ReactNode;
  /** Error message. Announced with `role="alert"` and shown with an icon. */
  error?: React.ReactNode;
  /** Classes for the row wrapper rather than the box. */
  containerClassName?: string;
}

export const CheckboxField = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxFieldProps
>(function CheckboxField(
  { label, description, error, containerClassName, className, id, disabled, ...props },
  ref,
) {
  const generatedId = React.useId();
  const boxId = id ?? `checkbox-${generatedId}`;
  const descriptionId = `${boxId}-description`;
  const errorId = `${boxId}-error`;

  const hasDescription = description !== undefined && description !== null && description !== false;
  const hasError = error !== undefined && error !== null && error !== false;

  const describedBy =
    [hasDescription ? descriptionId : null, hasError ? errorId : null]
      .filter((value): value is string => value !== null)
      .join(' ') || undefined;

  return (
    <div className={cn('flex w-full flex-col gap-1.5', containerClassName)}>
      <div className="flex items-start gap-3">
        <Checkbox
          ref={ref}
          id={boxId}
          disabled={disabled}
          invalid={hasError}
          aria-describedby={describedBy}
          className={cn('mt-0.5', className)}
          {...props}
        />
        <label
          htmlFor={boxId}
          className={cn(
            'min-w-0 flex-1 text-body text-ink',
            disabled === true ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
          )}
        >
          {label}
          {hasDescription ? (
            <span id={descriptionId} className="mt-0.5 block text-sm text-ink-muted">
              {description}
            </span>
          ) : null}
        </label>
      </div>
      {hasError ? <FormError id={errorId}>{error}</FormError> : null}
    </div>
  );
});
