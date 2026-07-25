'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * A square button whose only content is an icon.
 *
 * Two non-negotiables:
 *
 * 1. **It always has a name.** `aria-label` is a required prop, not an optional
 *    one — an icon-only control with no accessible name is invisible to a
 *    screen reader, and TypeScript is a better guard than a code review.
 *
 * 2. **The touch target is never smaller than 44×44px.** A dense toolbar wants
 *    a 36px button; a thumb wants 44px. Instead of shrinking the target we grow
 *    it: the `sm` size paints a 36px control and expands its hit area with a
 *    transparent `::after` pinned to `inset-0` and pulled outwards by a
 *    negative margin. Visual density and touch ergonomics both win.
 *
 * Icons are decorative here (`aria-hidden` on the wrapper) because the label is
 * carried by `aria-label`. Direction-carrying glyphs — arrows, chevrons, back —
 * must be mirrored by the caller with `rtl:-scale-x-100`.
 */

const iconButtonVariants = cva(
  [
    'relative inline-flex shrink-0 select-none items-center justify-center',
    'rounded-md',
    "after:absolute after:inset-0 after:content-['']",
    'transition-[background-color,border-color,color,box-shadow,translate] duration-[120ms] ease-[var(--ease-out-strait)]',
    'active:translate-y-px',
    'disabled:pointer-events-none disabled:opacity-55',
    'aria-[disabled=true]:pointer-events-none aria-[disabled=true]:opacity-55',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-strait text-on-accent shadow-e1 hover:bg-strait/90',
        secondary: 'border border-hairline bg-raised text-ink hover:bg-surface',
        ghost: 'text-ink-muted hover:bg-raised hover:text-ink',
        danger: 'bg-danger text-on-danger shadow-e1 hover:bg-danger/90',
        /** Money and achievement only — see the note on `Button`. */
        brass: 'bg-brass text-on-brass shadow-e1 hover:bg-brass/90',
      },
      size: {
        // 36px painted, 44px touchable: the ::after overflows by 4px per side.
        sm: 'size-9 after:-m-1 [&_svg]:size-4',
        md: 'size-11 [&_svg]:size-5',
        lg: 'size-12 [&_svg]:size-6',
      },
      shape: {
        square: 'rounded-md',
        round: 'rounded-pill after:rounded-pill',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
      shape: 'square',
    },
  },
);

export { iconButtonVariants };

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'>,
    VariantProps<typeof iconButtonVariants> {
  /** REQUIRED accessible name — what the press does, e.g. « Fermer la fenêtre ». */
  'aria-label': string;
  /** The glyph. Rendered decoratively; the name comes from `aria-label`. */
  icon: React.ReactNode;
  /** Swaps the glyph for a spinner, sets aria-busy and disables the control. */
  loading?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, shape, icon, loading = false, disabled, type, ...props },
  ref,
) {
  const isDisabled = disabled === true || loading;

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(iconButtonVariants({ variant, size, shape }), className)}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
      {...props}
    >
      <span aria-hidden="true" className="pointer-events-none inline-flex items-center">
        {loading ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            focusable="false"
            className="animate-spin"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.28" />
            <path
              d="M21 12a9 9 0 0 0-9-9"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          icon
        )}
      </span>
    </button>
  );
});
