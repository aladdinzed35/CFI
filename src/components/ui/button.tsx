'use client';

import * as React from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * The button. Every action in the product goes through it.
 *
 * Layout stability is the constraint that shapes the implementation: when
 * `loading` is set we do NOT swap the children out for a spinner (that would
 * collapse the button to spinner-width and shift everything around it). The
 * children stay in the flow and are made invisible — `text-transparent` covers
 * bare text nodes, `[&>*:not([data-spinner])]:invisible` covers element
 * children — while the spinner is absolutely centred on top. The button keeps
 * exactly the width it had.
 *
 * `asChild` renders the caller's element (a `<Link>`, usually) with these
 * styles. `Slottable` marks where the slotted element's own children belong, so
 * `iconStart` / `iconEnd` / the spinner still compose around them.
 */

const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap',
    'rounded-md font-medium',
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
        /**
         * Brass is the money-and-achievement accent (§11.2): pricing, payment
         * confirmation, certificates, invoices. Using it for an ordinary action
         * devalues it everywhere else — reach for `primary` instead.
         */
        brass: 'bg-brass text-on-brass shadow-e1 hover:bg-brass/90',
      },
      size: {
        // 44px, 48px, 56px — even the smallest button is a legal touch target.
        sm: 'h-11 px-3.5 text-sm',
        md: 'h-12 px-5 text-body',
        lg: 'h-14 px-7 text-lead',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      fullWidth: false,
    },
  },
);

export { buttonVariants };

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

/**
 * The spinner sits on a button whose text colour has been turned transparent,
 * so it cannot inherit `currentColor` — each variant names its own ink.
 */
const spinnerTone: Record<ButtonVariant, string> = {
  primary: 'text-on-accent',
  secondary: 'text-ink',
  ghost: 'text-ink',
  danger: 'text-on-danger',
  brass: 'text-on-brass',
};

const spinnerSize: Record<ButtonSize, string> = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Locks the current width, hides the label, shows a spinner, blocks input. */
  loading?: boolean;
  /** Decorative icon before the label. Never the only carrier of meaning. */
  iconStart?: React.ReactNode;
  /** Decorative icon after the label. */
  iconEnd?: React.ReactNode;
  /** Render the single child element instead of a `<button>`, keeping the styles. */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    fullWidth,
    loading = false,
    iconStart,
    iconEnd,
    asChild = false,
    disabled,
    type,
    children,
    ...props
  },
  ref,
) {
  const resolvedVariant: ButtonVariant = variant ?? 'primary';
  const resolvedSize: ButtonSize = size ?? 'md';
  const isDisabled = disabled === true || loading;

  const classes = cn(
    buttonVariants({ variant: resolvedVariant, size: resolvedSize, fullWidth }),
    loading && 'text-transparent [&>*:not([data-spinner])]:invisible',
    className,
  );

  /**
   * The pieces are an ARRAY, not a Fragment, and that is load-bearing.
   *
   * Radix's `Slot` clones its single child to merge props onto it. Wrapping
   * these in `<>…</>` makes that single child a Fragment, so `className` is
   * cloned onto the Fragment — React warns "Invalid prop `className` supplied
   * to `React.Fragment`" on every render, and the slotted element never
   * receives the button styles. `Slottable` only works when the children reach
   * `Slot` directly, which an array achieves and a Fragment does not.
   */
  const content = [
    loading ? (
      <span
        key="spinner"
        data-spinner=""
        className={cn('absolute inset-0 grid place-items-center', spinnerTone[resolvedVariant])}
      >
        <ButtonSpinner className={spinnerSize[resolvedSize]} />
      </span>
    ) : null,
    iconStart != null ? (
      <span key="icon-start" aria-hidden="true" className="inline-flex shrink-0 items-center">
        {iconStart}
      </span>
    ) : null,
    <Slottable key="children">{children}</Slottable>,
    iconEnd != null ? (
      <span key="icon-end" aria-hidden="true" className="inline-flex shrink-0 items-center">
        {iconEnd}
      </span>
    ) : null,
  ];

  // A slotted <a> has no `disabled` attribute; there, aria-disabled is the
  // contract — and the variant styles react to both.
  if (asChild) {
    return (
      <Slot
        ref={ref}
        className={classes}
        aria-disabled={isDisabled ? true : undefined}
        aria-busy={loading ? true : undefined}
        {...props}
      >
        {content}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
      {...props}
    >
      {content}
    </button>
  );
});

/**
 * Rotation carries no reading direction, so this is never mirrored in RTL.
 * `animate-spin` is neutralised by the reduced-motion rules in globals.css.
 */
function ButtonSpinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn('animate-spin', className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.28" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
