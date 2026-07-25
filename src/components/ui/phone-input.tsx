'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';
import { parsePhone, formatPhoneDisplay, MOROCCO_COUNTRY_CODE } from '@/lib/phone';
import type { InputSize } from '@/components/ui/input';

/**
 * Moroccan-first phone field.
 *
 * A fixed `+212` affix sits at the inline start and the student types the
 * national part, which is grouped as they go: `6 12 34 56 78`. Typing or
 * pasting anything international — a leading `+`, a leading `00`, or `212…` —
 * drops the affix and switches the field to free international entry, because
 * the centre does have students abroad (§9.1).
 *
 * Whatever the shape on screen, what leaves the component is E.164
 * (`+212612345678`), produced by `parsePhone` from `@/lib/phone` — the same
 * function the server validates with, so the two can never disagree. A hidden
 * input carries that canonical value when the field is used inside a plain
 * `<form>`.
 *
 * Direction: the number, the affix and the caret all stay LTR inside Arabic
 * (`dir="ltr"` + `.force-ltr`), per §10.3. Only the surrounding layout flips.
 */

const NATIONAL_MAX_DIGITS = 9;

const sizeClasses: Record<InputSize, { height: string; affix: string; text: string }> = {
  sm: { height: 'h-11', affix: 'px-3 text-sm', text: 'text-sm' },
  md: { height: 'h-12', affix: 'px-3.5 text-body', text: 'text-body' },
  lg: { height: 'h-14', affix: 'px-4 text-lead', text: 'text-lead' },
};

export interface PhoneValue {
  /** Canonical E.164, or `null` while the number is incomplete or invalid. */
  readonly e164: string | null;
  /** Exactly what is on screen, affix excluded. */
  readonly raw: string;
  /** `false` for a foreign number — the admin queue flags those (§9.1). */
  readonly isMoroccan: boolean;
}

export interface PhoneInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'defaultValue' | 'onChange' | 'size' | 'type'
  > {
  /** E.164 or any human form; re-formatted for display. Controlled usage. */
  value?: string;
  /** Same, for uncontrolled usage. */
  defaultValue?: string;
  /** Fired on every keystroke with the canonical result. */
  onValueChange?: (value: PhoneValue) => void;
  /** Name of the hidden field carrying the E.164 value in a plain form post. */
  name?: string;
  /** Control height, matched to `Input`. */
  inputSize?: InputSize;
  /** Puts the field in its error state and sets `aria-invalid`. */
  invalid?: boolean;
  /** Screen-reader-only explanation of the fixed prefix, e.g. « Indicatif du Maroc ». */
  countryPrefixLabel?: string;
  containerClassName?: string;
}

/** `612345678` → `6 12 34 56 78`. */
function groupNational(digits: string): string {
  if (digits === '') return '';
  const head = digits.slice(0, 1);
  const rest = digits.slice(1);
  const pairs: string[] = [];
  for (let index = 0; index < rest.length; index += 2) {
    pairs.push(rest.slice(index, index + 2));
  }
  return pairs.length === 0 ? head : `${head} ${pairs.join(' ')}`;
}

/** Keep only the 9 national digits, whatever the user pasted. */
function toNationalDigits(input: string): string {
  let digits = input.replace(/\D/gu, '');
  if (digits.startsWith(MOROCCO_COUNTRY_CODE)) digits = digits.slice(MOROCCO_COUNTRY_CODE.length);
  while (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, NATIONAL_MAX_DIGITS);
}

/** International entry is anything the user prefixed with `+` or `00`. */
function isInternational(input: string): boolean {
  const trimmed = input.trimStart();
  if (trimmed.startsWith('+')) return !trimmed.startsWith(`+${MOROCCO_COUNTRY_CODE}`);
  if (trimmed.startsWith('00')) return !trimmed.startsWith(`00${MOROCCO_COUNTRY_CODE}`);
  return false;
}

/**
 * `settled` is true only when the value comes from outside (initial render, a
 * form reset). While the user is typing we leave an international number
 * exactly as entered — re-grouping it under the caret would send the caret to
 * the end after every keystroke.
 */
function displayFor(input: string, settled: boolean): string {
  if (input === '') return '';
  if (isInternational(input)) {
    const parsed = parsePhone(input);
    if (settled && parsed !== null && !parsed.isMoroccan) return formatPhoneDisplay(parsed.e164);
    return input.replace(/[^\d+\s]/gu, '');
  }
  return groupNational(toNationalDigits(input));
}

function valueFor(display: string): PhoneValue {
  const candidate = isInternational(display)
    ? display
    : (() => {
        const digits = toNationalDigits(display);
        return digits === '' ? '' : `+${MOROCCO_COUNTRY_CODE}${digits}`;
      })();

  const parsed = parsePhone(candidate);
  return {
    e164: parsed?.e164 ?? null,
    raw: display,
    isMoroccan: parsed?.isMoroccan ?? !isInternational(display),
  };
}

export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  {
    value,
    defaultValue,
    onValueChange,
    name,
    inputSize = 'md',
    invalid = false,
    countryPrefixLabel,
    className,
    containerClassName,
    disabled,
    ...props
  },
  ref,
) {
  const [display, setDisplay] = React.useState(() => displayFor(value ?? defaultValue ?? '', true));
  const lastEmitted = React.useRef<string | null>(null);

  // Re-sync when the *outside* changes the value (a reset, a server default).
  // Our own emissions are remembered so they never fight the caret.
  React.useEffect(() => {
    if (value === undefined) return;
    const incoming = parsePhone(value)?.e164 ?? null;
    if (incoming !== null && incoming === lastEmitted.current) return;
    setDisplay(displayFor(value, true));
  }, [value]);

  const international = isInternational(display);
  const resolved = valueFor(display);
  const sizes = sizeClasses[inputSize];

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = displayFor(event.target.value, false);
      setDisplay(next);
      const result = valueFor(next);
      lastEmitted.current = result.e164;
      onValueChange?.(result);
    },
    [onValueChange],
  );

  return (
    <div
      className={cn(
        'flex w-full items-stretch overflow-hidden rounded-md border border-hairline bg-surface',
        'transition-[border-color,background-color] duration-[120ms] ease-[var(--ease-out-strait)]',
        'focus-within:border-strait',
        !international && 'hover:border-ink-muted/60',
        invalid && 'border-danger bg-danger-wash',
        disabled === true && 'cursor-not-allowed bg-raised opacity-55',
        sizes.height,
        containerClassName,
      )}
    >
      {!international ? (
        <span
          className={cn(
            'flex shrink-0 select-none items-center border-hairline border-e bg-raised text-ink-muted',
            sizes.affix,
          )}
        >
          {/* A dialling code is data, not copy: it never translates and never flips. */}
          <span className="force-ltr" dir="ltr" data-numeric="">
            +{MOROCCO_COUNTRY_CODE}
          </span>
          {countryPrefixLabel !== undefined ? (
            <span className="sr-only">{countryPrefixLabel}</span>
          ) : null}
        </span>
      ) : null}

      <input
        ref={ref}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        dir="ltr"
        disabled={disabled}
        value={display}
        onChange={handleChange}
        aria-invalid={invalid ? true : undefined}
        className={cn(
          'w-full min-w-0 bg-transparent px-4 text-ink text-start outline-none',
          'placeholder:text-ink-muted',
          'disabled:cursor-not-allowed',
          sizes.text,
          className,
        )}
        {...props}
      />

      {name !== undefined ? <input type="hidden" name={name} value={resolved.e164 ?? ''} /> : null}
    </div>
  );
});
