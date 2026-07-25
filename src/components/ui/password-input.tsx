'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Input, type InputProps } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';

/**
 * Password field: reveal toggle + a four-segment strength meter.
 *
 * The policy is the one in §9.1 — at least ten characters, letters AND digits,
 * not on the bundled weak list. No forced special character: mandatory symbol
 * theatre pushes people towards `Password1!` and away from a long passphrase,
 * which is strictly worse. Length and variety are *bonuses* here, never gates.
 */

/** Below this, a password is rejected outright (§9.1). */
export const PASSWORD_MIN_LENGTH = 10;

/**
 * Score a password from 0 (unusable) to 4 (strong). Pure, dependency-free and
 * exported on its own so the Zod schema, the server and the meter all agree.
 *
 * 0 — empty, too short, missing letters or digits, or on the weak list.
 * 1 — meets the minimum, nothing more (or built from a handful of characters).
 * 2 — one or two of: ≥14 chars, ≥18 chars, mixed case, a symbol, ≥8 distinct chars.
 * 3 — three of them.
 * 4 — four or five.
 *
 * @param pw The candidate password, exactly as typed.
 * @param commonPasswords Lower-cased weak list; membership forces 0.
 */
export function scorePassword(
  pw: string,
  commonPasswords?: ReadonlySet<string>,
): 0 | 1 | 2 | 3 | 4 {
  if (typeof pw !== 'string' || pw.length === 0) return 0;
  if (commonPasswords !== undefined && commonPasswords.has(pw.toLowerCase())) return 0;

  const hasLetter = /\p{L}/u.test(pw);
  const hasDigit = /\d/u.test(pw);
  if (pw.length < PASSWORD_MIN_LENGTH || !hasLetter || !hasDigit) return 0;

  // `aaaaaaaa11` is ten characters of nothing.
  const distinct = new Set(pw).size;
  if (distinct <= 3) return 1;

  let bonus = 0;
  if (pw.length >= 14) bonus += 1;
  if (pw.length >= 18) bonus += 1;
  if (/\p{Ll}/u.test(pw) && /\p{Lu}/u.test(pw)) bonus += 1;
  if (/[^\p{L}\d]/u.test(pw)) bonus += 1;
  if (distinct >= 8) bonus += 1;

  if (bonus <= 0) return 1;
  if (bonus <= 2) return 2;
  if (bonus <= 3) return 3;
  return 4;
}

/** Segment tint per score. Index 0 is "nothing filled". */
const meterTone: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-hairline',
  1: 'bg-danger',
  2: 'bg-warn',
  3: 'bg-strait',
  4: 'bg-success',
};

const labelTone: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'text-ink-muted',
  1: 'text-danger',
  2: 'text-warn',
  3: 'text-strait',
  4: 'text-success',
};

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'iconEnd'> {
  /** Accessible name of the toggle while the password is hidden, e.g. « Afficher le mot de passe ». */
  showPasswordLabel: string;
  /** Accessible name of the toggle while the password is visible, e.g. « Masquer le mot de passe ». */
  hidePasswordLabel: string;
  /** Hide the meter — for a login form, where scoring an existing password is noise. */
  showStrength?: boolean;
  /** The five strength words, indexed by score. Without them the meter stays purely visual. */
  strengthLabels?: readonly [string, string, string, string, string];
  /** Weak list (lower-cased) forwarded to {@link scorePassword}. */
  commonPasswords?: ReadonlySet<string>;
}

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    {
      showPasswordLabel,
      hidePasswordLabel,
      showStrength = true,
      strengthLabels,
      commonPasswords,
      className,
      containerClassName,
      value,
      defaultValue,
      onChange,
      ...props
    },
    ref,
  ) {
    const [revealed, setRevealed] = React.useState(false);
    const isControlled = value !== undefined;
    const [uncontrolledValue, setUncontrolledValue] = React.useState(() =>
      typeof defaultValue === 'string' ? defaultValue : '',
    );

    const currentValue = isControlled ? String(value ?? '') : uncontrolledValue;
    const score = React.useMemo(
      () => scorePassword(currentValue, commonPasswords),
      [currentValue, commonPasswords],
    );

    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        setUncontrolledValue(event.target.value);
        onChange?.(event);
      },
      [onChange],
    );

    return (
      <div className={cn('flex w-full flex-col gap-2', containerClassName)}>
        <Input
          ref={ref}
          type={revealed ? 'text' : 'password'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          defaultValue={defaultValue}
          onChange={handleChange}
          className={className}
          iconEnd={
            <IconButton
              size="sm"
              variant="ghost"
              aria-label={revealed ? hidePasswordLabel : showPasswordLabel}
              aria-pressed={revealed}
              tabIndex={props.disabled === true ? -1 : 0}
              disabled={props.disabled}
              onClick={() => {
                setRevealed((previous) => !previous);
              }}
              icon={revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            />
          }
          {...props}
        />

        {showStrength ? (
          <div className="flex flex-col gap-1.5">
            <div aria-hidden="true" className="flex gap-1.5">
              {[1, 2, 3, 4].map((segment) => (
                <span
                  key={segment}
                  className={cn(
                    'h-1 flex-1 rounded-pill transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                    segment <= score ? meterTone[score] : 'bg-hairline',
                  )}
                />
              ))}
            </div>
            {strengthLabels !== undefined && currentValue.length > 0 ? (
              <p role="status" aria-live="polite" className={cn('text-xs', labelTone[score])}>
                {strengthLabels[score]}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  },
);
