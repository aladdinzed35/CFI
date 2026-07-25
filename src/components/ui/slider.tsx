'use client';

import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/cn';

/**
 * A range slider — playback speed, volume, a price filter, the quiz passing
 * score in the admin.
 *
 * RTL is handled by Radix itself: pass `dir={dirFor(locale)}` and the range
 * fills from the right and the arrow keys swap meaning accordingly. Nothing
 * here is mirrored by hand.
 *
 * The thumb is 20px of paint inside a 44px hit area (transparent `::after`),
 * and it is a real focusable element, so the whole control is keyboard
 * operable: arrows step, Home/End jump, Page Up/Down take a larger step.
 * Give it a name with `aria-label` (single thumb) or `aria-labelledby`.
 */

export type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>;

export const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  SliderProps
>(function Slider({ className, value, defaultValue, ...props }, ref) {
  // One thumb per value: Radix renders exactly as many as it is given.
  const thumbCount = (value ?? defaultValue ?? [0]).length;

  return (
    <SliderPrimitive.Root
      ref={ref}
      value={value}
      defaultValue={defaultValue}
      className={cn(
        'relative flex w-full touch-none select-none items-center py-2.5',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-pill bg-raised">
        <SliderPrimitive.Range className="absolute h-full bg-strait" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }, (_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          className={cn(
            'relative block size-5 rounded-pill border-2 border-strait bg-surface shadow-e1',
            'transition-[box-shadow,border-color] duration-[120ms] ease-[var(--ease-out-strait)]',
            "after:absolute after:inset-0 after:-m-3 after:content-['']",
            'hover:shadow-e2',
            'data-[disabled]:border-ink-muted',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
});
