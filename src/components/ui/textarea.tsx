'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * The multi-line text field.
 *
 * Resizing is vertical only: a horizontally resizable textarea is the fastest
 * way to break a responsive layout, and §11.4 forbids horizontal overflow.
 *
 * When `maxLength` is set the component shows a live counter. The visible
 * counter is `aria-hidden` — repeating "12 / 500" after every keystroke is
 * unusable with a screen reader — and an optional `counterAnnouncement` prop
 * supplies the polite message that is announced only near the limit.
 */

export type TextareaSize = 'sm' | 'md' | 'lg';

const sizeClasses: Record<TextareaSize, string> = {
  sm: 'min-h-24 px-3.5 py-2.5 text-sm',
  md: 'min-h-32 px-4 py-3 text-body',
  lg: 'min-h-44 px-4 py-3.5 text-lead',
};

/** Below this many remaining characters the counter starts being announced. */
const ANNOUNCE_THRESHOLD = 20;

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Minimum height / padding preset. */
  textareaSize?: TextareaSize;
  /** Puts the field in its error state and sets `aria-invalid`. */
  invalid?: boolean;
  /**
   * Polite announcement for assistive technology once fewer than 20 characters
   * remain, e.g. `(remaining) => \`${remaining} caractères restants\``.
   * Without it the counter stays purely visual.
   */
  counterAnnouncement?: (remaining: number, max: number) => string;
  /** Classes for the wrapper rather than the `<textarea>` itself. */
  containerClassName?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    className,
    containerClassName,
    textareaSize = 'md',
    invalid = false,
    counterAnnouncement,
    maxLength,
    value,
    defaultValue,
    onChange,
    ...props
  },
  ref,
) {
  const isControlled = value !== undefined;
  const [uncontrolledLength, setUncontrolledLength] = React.useState(
    () => stringLength(defaultValue),
  );

  const usedLength = isControlled ? stringLength(value) : uncontrolledLength;
  const showCounter = typeof maxLength === 'number' && maxLength > 0;
  const remaining = showCounter ? maxLength - usedLength : 0;
  const nearLimit = showCounter && remaining <= ANNOUNCE_THRESHOLD;

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setUncontrolledLength(event.target.value.length);
      onChange?.(event);
    },
    [onChange],
  );

  return (
    <div className={cn('w-full', containerClassName)}>
      <textarea
        ref={ref}
        maxLength={maxLength}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        aria-invalid={invalid ? true : undefined}
        className={cn(
          'block w-full resize-y rounded-md border border-hairline bg-surface text-ink text-start',
          'transition-[border-color,background-color] duration-[120ms] ease-[var(--ease-out-strait)]',
          'placeholder:text-ink-muted',
          'hover:border-ink-muted/60',
          'focus-visible:border-strait',
          'disabled:cursor-not-allowed disabled:resize-none disabled:bg-raised disabled:opacity-55',
          'read-only:bg-raised',
          'aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-wash',
          sizeClasses[textareaSize],
          className,
        )}
        {...props}
      />

      {showCounter ? (
        <div className="mt-1.5 flex justify-end">
          <span
            aria-hidden="true"
            data-numeric=""
            className={cn(
              'text-xs tabular-nums',
              nearLimit ? 'text-warn' : 'text-ink-muted',
              remaining <= 0 && 'text-danger',
            )}
          >
            {/* Digits stay LTR inside Arabic — §10.3. */}
            <span className="force-ltr" dir="ltr">
              {usedLength}/{maxLength}
            </span>
          </span>
          {counterAnnouncement !== undefined ? (
            <span role="status" aria-live="polite" className="sr-only">
              {nearLimit ? counterAnnouncement(remaining, maxLength) : ''}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

function stringLength(value: string | number | readonly string[] | undefined): number {
  if (value === undefined) return 0;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number') return String(value).length;
  return value.join('').length;
}
