'use client';

import { ToastProvider, ToastViewport } from '@radix-ui/react-toast';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { useDirection } from '@/hooks/use-direction';

/**
 * Client providers for the whole app. Deliberately thin: a tooltip context and
 * the single toast region every `Toast` in the app portals into. No state
 * manager lives here — server state comes from RSC, form state from
 * react-hook-form, and nothing else is global.
 *
 * Mounted inside NextIntlClientProvider so `useDirection()` can resolve the
 * active locale: the toast swipe gesture has to follow the writing direction
 * (§10.3), which is the one place a physical value is unavoidable.
 */

export interface ProvidersProps {
  children: React.ReactNode;
  /**
   * Accessible name of the toast region, announced by screen readers before
   * each notification. Translated by the caller — primitives never hold copy.
   */
  toastLabel: string;
}

export function Providers({ children, toastLabel }: ProvidersProps): React.JSX.Element {
  const { isRtl } = useDirection();

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={300}>
      <ToastProvider
        label={toastLabel}
        duration={6000}
        swipeDirection={isRtl ? 'left' : 'right'}
        swipeThreshold={48}
      >
        {children}
        <ToastViewport className="safe-b fixed bottom-0 end-0 z-50 m-0 flex w-full max-w-[min(24rem,100vw)] list-none flex-col gap-2 p-4" />
      </ToastProvider>
    </TooltipProvider>
  );
}
