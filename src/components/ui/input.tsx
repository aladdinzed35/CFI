'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * The single-line text field.
 *
 * `invalid` is the only way to put the field in its error state, and it drives
 * `aria-invalid` as well as the border colour — the red outline is never the
 * sole signal, because `FormField` pairs it with a `role="alert"` message.
 *
 * Icons are positioned with logical insets (`start-0` / `end-0`), so an icon
 * declared as `iconStart` sits on the left in French and on the right in
 * Arabic without a single extra class.
 */

export type InputSize = 'sm' | 'md' | 'lg';

const sizeClasses: Record<InputSize, string> = {
  sm: 'h-11 text-sm',
  md: 'h-12 text-body',
  lg: 'h-14 text-lead',
};

/** Icon gutters, matched to the control height so the glyph stays centred. */
const gutterClasses: Record<InputSize, { start: string; end: string; box: string }> = {
  sm: { start: 'ps-10', end: 'pe-10', box: 'w-10' },
  md: { start: 'ps-11', end: 'pe-11', box: 'w-11' },
  lg: { start: 'ps-12', end: 'pe-12', box: 'w-12' },
};

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Control height. Named `inputSize` because `size` is a real HTML attribute. */
  inputSize?: InputSize;
  /** Puts the field in its error state and sets `aria-invalid`. */
  invalid?: boolean;
  /** Decorative glyph at the inline start. */
  iconStart?: React.ReactNode;
  /** Decorative glyph at the inline end (a reveal toggle, a unit, a spinner…). */
  iconEnd?: React.ReactNode;
  /** Classes for the positioning wrapper rather than the `<input>` itself. */
  containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className,
    containerClassName,
    inputSize = 'md',
    invalid = false,
    iconStart,
    iconEnd,
    disabled,
    type,
    ...props
  },
  ref,
) {
  const gutter = gutterClasses[inputSize];

  return (
    <div className={cn('relative flex w-full items-center', containerClassName)}>
      {iconStart != null ? (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center text-ink-muted',
            gutter.box,
            disabled === true && 'opacity-55',
          )}
        >
          {iconStart}
        </span>
      ) : null}

      <input
        ref={ref}
        type={type ?? 'text'}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        className={cn(
          'w-full min-w-0 rounded-md border border-hairline bg-surface px-4 text-ink text-start',
          'transition-[border-color,background-color,box-shadow] duration-[120ms] ease-[var(--ease-out-strait)]',
          'placeholder:text-ink-muted',
          'hover:border-ink-muted/60',
          'focus-visible:border-strait',
          'disabled:cursor-not-allowed disabled:bg-raised disabled:opacity-55',
          'read-only:bg-raised',
          'aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-wash',
          sizeClasses[inputSize],
          iconStart != null && gutter.start,
          iconEnd != null && gutter.end,
          className,
        )}
        {...props}
      />

      {iconEnd != null ? (
        <span
          className={cn(
            // The wrapper lets clicks fall through to the input; an interactive
            // child (a reveal toggle) opts back in.
            'pointer-events-none absolute inset-y-0 end-0 flex items-center justify-center text-ink-muted [&>*]:pointer-events-auto',
            gutter.box,
            disabled === true && 'opacity-55',
          )}
        >
          {iconEnd}
        </span>
      ) : null}
    </div>
  );
});
