'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * The showcase's in-page navigation (§25 M0).
 *
 * Real anchor links, not buttons: `#buttons` is shareable, survives a reload and
 * works with the browser's own find-and-jump. `scroll-padding-block-start` in
 * globals.css already keeps this sticky bar from covering the heading it lands
 * on, so no scroll maths happens here.
 *
 * The active chip is derived from an IntersectionObserver over the section
 * headings rather than from `scroll` events: one callback per crossing instead
 * of one per frame. The bottom root-margin means "active" is the first section
 * whose heading has reached the top band of the viewport, which is what a reader
 * perceives as the section they are in.
 *
 * The strip scrolls on its own inline axis, so ten sections never widen the page
 * at 360 px, and every chip is a 44 px touch target.
 */

export const SHOWCASE_SECTION_IDS = [
  'colors',
  'typography',
  'buttons',
  'inputs',
  'feedback',
  'overlays',
  'data',
  'application',
  'motion',
  'rtl',
] as const;

export type ShowcaseSectionId = (typeof SHOWCASE_SECTION_IDS)[number];

export interface ShowcaseNavItem {
  readonly id: ShowcaseSectionId;
  readonly label: string;
}

export interface ShowcaseNavProps {
  items: readonly ShowcaseNavItem[];
  /** Accessible name of the navigation landmark. */
  label: string;
  className?: string;
}

export function ShowcaseNav({ items, label, className }: ShowcaseNavProps): React.JSX.Element {
  // Seeded with the first section so a chip is always marked current — including
  // at the top of the page, and in the rare engine without IntersectionObserver.
  const [active, setActive] = useState<ShowcaseSectionId | null>(() => items[0]?.id ?? null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    const targets = items
      .map((item) => document.getElementById(item.id))
      .filter((node): node is HTMLElement => node !== null);

    if (targets.length === 0) return;

    const onScreen = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onScreen.add(entry.target.id);
          else onScreen.delete(entry.target.id);
        }

        const first = items.find((item) => onScreen.has(item.id));
        if (first !== undefined) setActive(first.id);
      },
      // Top band only: a heading counts as "current" once it is under the bar
      // and before it leaves through the top.
      { rootMargin: '-88px 0px -55% 0px', threshold: 0 },
    );

    for (const target of targets) observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [items]);

  return (
    <nav
      aria-label={label}
      className={cn('surface-blur hairline-b sticky top-0 z-30 w-full', className)}
    >
      <ul className="flex w-full items-center gap-1 overflow-x-auto overscroll-x-contain py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const current = active === item.id;

          return (
            <li key={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                aria-current={current ? 'true' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-pill border px-3.5 text-sm font-medium whitespace-nowrap',
                  'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none',
                  current
                    ? 'border-strait bg-strait-wash text-ink'
                    : 'border-transparent text-ink-muted hover:bg-raised hover:text-ink',
                )}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
