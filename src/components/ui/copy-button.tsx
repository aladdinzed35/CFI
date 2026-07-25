'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * CopyButton — RIB, IBAN, beneficiary name and the request reference
 * `CFI-2026-000123` (§9.2). Those are the strings a student must retype into a
 * banking app, so getting them onto the clipboard reliably matters more here
 * than anywhere else in the product.
 *
 * `navigator.clipboard` is unavailable on insecure origins and in a few
 * in-app browsers, so there is a real fallback: a hidden textarea plus
 * `document.execCommand('copy')`. If both fail the button says so instead of
 * silently pretending it worked.
 *
 * The confirmation is announced: a polite live region carries `copiedLabel`
 * (« Copié »), so the feedback is not colour-and-icon only.
 */

export type CopyButtonSize = 'sm' | 'md';
export type CopyButtonVariant = 'ghost' | 'outline';

const sizeClasses: Record<CopyButtonSize, string> = {
  sm: 'min-h-9 min-w-9 gap-1.5 px-2 text-xs [&_svg]:size-3.5',
  md: 'min-h-11 min-w-11 gap-2 px-3 text-sm [&_svg]:size-4',
};

const variantClasses: Record<CopyButtonVariant, string> = {
  ghost: 'border-transparent bg-transparent hover:bg-raised',
  outline: 'border-hairline bg-surface hover:bg-raised',
};

const RESET_MS = 2000;

async function writeToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Permission denied or a non-secure context — fall through to the fallback.
    }
  }

  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export interface CopyButtonProps
  extends Omit<React.ComponentPropsWithRef<'button'>, 'onCopy' | 'children' | 'value'> {
  /** The exact string that lands on the clipboard. */
  value: string;
  /** Accessible name in the idle state, e.g. « Copier le RIB ». */
  label: string;
  /** Announced and shown after a successful copy, e.g. « Copié ». */
  copiedLabel: string;
  /** Announced when both the API and the fallback fail, e.g. « Copie impossible ». */
  errorLabel?: string;
  /** Show `label` next to the icon. Off by default: these sit beside a field. */
  showLabel?: boolean;
  size?: CopyButtonSize;
  variant?: CopyButtonVariant;
  /** Called after a successful copy — used to log the RIB copy event. */
  onCopied?: (value: string) => void;
}

export function CopyButton({
  value,
  label,
  copiedLabel,
  errorLabel,
  showLabel = false,
  size = 'md',
  variant = 'ghost',
  onCopied,
  className,
  disabled,
  ...props
}: CopyButtonProps): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleClick = useCallback(async (): Promise<void> => {
    const ok = await writeToClipboard(value);
    setState(ok ? 'copied' : 'error');
    if (ok) onCopied?.(value);

    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setState('idle');
      timeoutRef.current = null;
    }, RESET_MS);
  }, [onCopied, value]);

  const message = state === 'copied' ? copiedLabel : state === 'error' ? errorLabel : undefined;

  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          void handleClick();
        }}
        aria-label={showLabel ? undefined : label}
        data-state={state}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-sm border font-medium',
          'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
          sizeClasses[size],
          variantClasses[variant],
          state === 'copied' ? 'text-success' : state === 'error' ? 'text-danger' : 'text-ink-muted',
          className,
        )}
        {...props}
      >
        {state === 'copied' ? (
          <Check aria-hidden="true" strokeWidth={2.5} />
        ) : (
          <Copy aria-hidden="true" />
        )}
        {showLabel ? <span>{state === 'copied' ? copiedLabel : label}</span> : null}
      </button>

      {/* Live region: announces the transient confirmation without stealing focus. */}
      <span aria-live="polite" className="sr-only">
        {message}
      </span>
    </span>
  );
}
