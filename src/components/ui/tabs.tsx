'use client';

import { createContext, useContext } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { useDirection } from '@/hooks/use-direction';
import { cn } from '@/lib/cn';

/**
 * Tabs — Radix under the hood, three shapes on top.
 *
 * · `line`  — the default: an underlined strip for the course page and the admin.
 * · `pill`  — segmented control, for two or three short mutually exclusive views.
 * · `strip` — the mobile player's horizontal scroll strip (§14.1: *Contenu ·
 *             Programme · Notes · Transcription · Discussion · IA*). It scrolls
 *             on the inline axis with snap points, keeps a 44 px touch height,
 *             and never introduces a horizontal scrollbar on the page itself
 *             because the overflow is owned by the list.
 *
 * Direction is wired automatically: Radix needs an explicit `dir` for its
 * roving-focus arrow keys, and without it Arabic tabs would move focus the wrong
 * way. `useDirection()` supplies it, and an explicit `dir` prop still wins.
 */

export type TabsVariant = 'line' | 'pill' | 'strip';

const TabsVariantContext = createContext<TabsVariant>('line');

const listClasses: Record<TabsVariant, string> = {
  line: 'hairline-b flex w-full items-stretch gap-1 overflow-x-auto',
  pill: 'inline-flex items-stretch gap-1 rounded-pill border border-hairline bg-raised p-1',
  strip:
    'hairline-b flex w-full snap-x snap-mandatory items-stretch gap-1 overflow-x-auto overscroll-x-contain scroll-smooth',
};

const triggerClasses: Record<TabsVariant, string> = {
  line: cn(
    'relative -mb-px inline-flex min-h-11 shrink-0 items-center justify-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap',
    'text-ink-muted hover:text-ink',
    'data-[state=active]:border-strait data-[state=active]:text-ink',
  ),
  pill: cn(
    'inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-pill px-4 text-sm font-medium whitespace-nowrap',
    'text-ink-muted hover:text-ink',
    'data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-e1',
  ),
  strip: cn(
    'relative -mb-px inline-flex min-h-11 shrink-0 snap-start items-center justify-center gap-2 border-b-2 border-transparent px-4 text-sm font-medium whitespace-nowrap',
    'text-ink-muted hover:text-ink',
    'data-[state=active]:border-strait data-[state=active]:text-ink',
  ),
};

export interface TabsProps extends React.ComponentProps<typeof TabsPrimitive.Root> {
  variant?: TabsVariant;
}

export function Tabs({ variant = 'line', className, dir, ...props }: TabsProps): React.JSX.Element {
  const { dir: documentDir } = useDirection();

  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.Root
        dir={dir ?? documentDir}
        className={cn('flex w-full flex-col gap-4', className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
}

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>): React.JSX.Element {
  const variant = useContext(TabsVariantContext);

  return (
    <TabsPrimitive.List
      className={cn(
        listClasses[variant],
        // The scroll container must never bleed into the page's own scroll.
        (variant === 'line' || variant === 'strip') && 'max-w-full [scrollbar-width:none]',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>): React.JSX.Element {
  const variant = useContext(TabsVariantContext);

  return (
    <TabsPrimitive.Trigger
      className={cn(
        'touch-manipulation transition-colors duration-[120ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none',
        'disabled:pointer-events-none disabled:opacity-50',
        triggerClasses[variant],
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>): React.JSX.Element {
  return <TabsPrimitive.Content className={cn('min-w-0 outline-none', className)} {...props} />;
}
