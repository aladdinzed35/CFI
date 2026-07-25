'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/cn';

/**
 * An on/off switch that commits immediately — preferences, feature flags, the
 * « publier » toggle. If the change needs a save button, use a `Checkbox`.
 *
 * RTL: the track is a symmetric pill and the thumb a circle, so mirroring the
 * whole control with `rtl:-scale-x-100` is invisible to the eye and makes the
 * thumb travel towards the left when switched on — which is what "on" looks
 * like in Arabic. This is the one legitimate use of a transform mirror on a
 * non-icon: the geometry itself carries direction.
 *
 * The state is exposed to assistive technology by Radix as `role="switch"` +
 * `aria-checked`; pair it with a `<label htmlFor>` so it also has a name.
 */

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-pill border border-hairline bg-raised px-0.5',
        'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
        // 28px tall painted, 44px touchable.
        "after:absolute after:inset-0 after:-my-2 after:content-['']",
        'hover:border-ink-muted/60',
        'data-[state=checked]:border-strait data-[state=checked]:bg-strait',
        'disabled:cursor-not-allowed disabled:opacity-55',
        'rtl:-scale-x-100',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-6 rounded-pill bg-ink shadow-e1',
          'transition-transform duration-[120ms] ease-[var(--ease-out-strait)]',
          'data-[state=checked]:translate-x-5 data-[state=checked]:bg-on-accent',
        )}
      />
    </SwitchPrimitive.Root>
  );
});
