'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Six-box one-time-code field.
 *
 * Behaviour people expect and rarely get:
 * - typing a digit advances to the next box, the last one submits;
 * - Backspace clears the current box, or steps back and clears when empty;
 * - ArrowLeft / ArrowRight, Home / End move between boxes;
 * - pasting a whole code — from an SMS, with spaces or dashes — fills every box
 *   and focuses the last one, from any box;
 * - `autoComplete="one-time-code"` lets iOS and Android offer the code from the
 *   SMS banner.
 *
 * Direction: a code is a number, and numbers do not flip. The row is forced
 * `dir="ltr"` even in Arabic (§10.3), which also keeps ArrowLeft meaning
 * "previous box" visually everywhere.
 *
 * The boxes are grouped in a `role="group"` labelled by `label`; each box gets
 * its own position name so a screen-reader user knows where they are.
 */

export interface OtpInputProps {
  /** Number of boxes. The verification codes in this product are 6 digits. */
  length?: number;
  /** Controlled value — digits only, shorter than `length` while incomplete. */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  /** Every change, already stripped to digits. */
  onValueChange?: (value: string) => void;
  /** Fired once the last box is filled — wire the auto-submit here. */
  onComplete?: (value: string) => void;
  /** Accessible name of the whole group, e.g. « Code de vérification ». */
  label: string;
  /** Per-box accessible name, e.g. `(i, n) => \`Chiffre ${i} sur ${n}\``. */
  digitLabel?: (position: number, total: number) => string;
  /** Ids of the description and error text, forwarded to every box. */
  describedBy?: string;
  disabled?: boolean;
  /** Error state: red boxes, `aria-invalid` on each input. */
  invalid?: boolean;
  autoFocus?: boolean;
  /** Name of the hidden field carrying the joined code in a plain form post. */
  name?: string;
  className?: string;
}

export function OtpInput({
  length = 6,
  value,
  defaultValue,
  onValueChange,
  onComplete,
  label,
  digitLabel,
  describedBy,
  disabled = false,
  invalid = false,
  autoFocus = false,
  name,
  className,
}: OtpInputProps): React.JSX.Element {
  const isControlled = value !== undefined;
  const [uncontrolled, setUncontrolled] = React.useState(() => sanitize(defaultValue ?? '', length));
  const code = isControlled ? sanitize(value, length) : uncontrolled;

  const inputsRef = React.useRef<Array<HTMLInputElement | null>>([]);
  const completedRef = React.useRef(false);

  const focusBox = React.useCallback((index: number) => {
    const target = inputsRef.current[index];
    if (target === null || target === undefined) return;
    target.focus();
    target.select();
  }, []);

  const commit = React.useCallback(
    (next: string) => {
      if (!isControlled) setUncontrolled(next);
      onValueChange?.(next);

      if (next.length === length) {
        // Guard against a second call while the caller re-renders with the
        // same complete value — an auto-submit must fire exactly once.
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete?.(next);
        }
      } else {
        completedRef.current = false;
      }
    },
    [isControlled, length, onComplete, onValueChange],
  );

  const setDigits = React.useCallback(
    (index: number, digits: string) => {
      const chars = code.padEnd(length, ' ').split('');
      for (let offset = 0; offset < digits.length && index + offset < length; offset += 1) {
        chars[index + offset] = digits.charAt(offset);
      }
      commit(sanitize(chars.join(''), length));
      const landing = Math.min(index + Math.max(digits.length, 1), length - 1);
      focusBox(landing);
    },
    [code, commit, focusBox, length],
  );

  const handleChange = React.useCallback(
    (index: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const digits = event.target.value.replace(/\D/gu, '');
      if (digits === '') {
        // The box was emptied by typing over it.
        const chars = code.padEnd(length, ' ').split('');
        chars[index] = ' ';
        commit(sanitize(chars.join('').trimEnd(), length));
        return;
      }
      setDigits(index, digits);
    },
    [code, commit, length, setDigits],
  );

  const handleKeyDown = React.useCallback(
    (index: number) => (event: React.KeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case 'Backspace': {
          event.preventDefault();
          const chars = code.padEnd(length, ' ').split('');
          if ((chars[index] ?? ' ').trim() === '' && index > 0) {
            chars[index - 1] = ' ';
            focusBox(index - 1);
          } else {
            chars[index] = ' ';
          }
          commit(sanitize(chars.join('').trimEnd(), length));
          break;
        }
        case 'Delete': {
          event.preventDefault();
          const chars = code.padEnd(length, ' ').split('');
          chars[index] = ' ';
          commit(sanitize(chars.join('').trimEnd(), length));
          break;
        }
        case 'ArrowLeft':
          event.preventDefault();
          focusBox(Math.max(0, index - 1));
          break;
        case 'ArrowRight':
          event.preventDefault();
          focusBox(Math.min(length - 1, index + 1));
          break;
        case 'Home':
          event.preventDefault();
          focusBox(0);
          break;
        case 'End':
          event.preventDefault();
          focusBox(length - 1);
          break;
        default:
          break;
      }
    },
    [code, commit, focusBox, length],
  );

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLInputElement>) => {
      const pasted = event.clipboardData.getData('text').replace(/\D/gu, '');
      if (pasted === '') return;
      event.preventDefault();
      const next = sanitize(pasted, length);
      commit(next);
      focusBox(Math.min(next.length, length - 1));
    },
    [commit, focusBox, length],
  );

  return (
    <div
      role="group"
      aria-label={label}
      // A code is a number: LTR everywhere, Arabic included (§10.3).
      dir="ltr"
      className={cn('flex items-center gap-2', className)}
    >
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(element) => {
            inputsRef.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          pattern="[0-9]*"
          maxLength={1}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          value={code.charAt(index)}
          aria-label={digitLabel !== undefined ? digitLabel(index + 1, length) : String(index + 1)}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          onChange={handleChange(index)}
          onKeyDown={handleKeyDown(index)}
          onPaste={handlePaste}
          onFocus={(event) => {
            // Never let the caret sit past the first empty box: the value is a
            // compact string, so a hole in the middle cannot be represented.
            const firstEmpty = Math.min(code.length, length - 1);
            if (index > firstEmpty) {
              focusBox(firstEmpty);
              return;
            }
            event.currentTarget.select();
          }}
          className={cn(
            'h-14 w-11 rounded-md border border-hairline bg-surface text-center text-lead text-ink sm:w-12',
            'font-mono tabular-nums',
            'transition-[border-color,background-color] duration-[120ms] ease-[var(--ease-out-strait)]',
            'hover:border-ink-muted/60',
            'focus-visible:border-strait',
            'disabled:cursor-not-allowed disabled:bg-raised disabled:opacity-55',
            'aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-wash',
          )}
        />
      ))}
      {name !== undefined ? <input type="hidden" name={name} value={code} /> : null}
    </div>
  );
}

/** Digits only, never longer than the box count. */
function sanitize(input: string, length: number): string {
  return input.replace(/\D/gu, '').slice(0, length);
}
