'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';

import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { cn } from '@/lib/cn';
import { Link, usePathname } from '@/i18n/navigation';

/**
 * The phone-and-tablet half of the public header (§12.1): a hamburger that
 * opens a **full-screen sheet**, with the two authentication calls to action
 * pinned to the bottom above the safe-area inset.
 *
 * ## Why it is a `Drawer` and not a bespoke panel
 * The sheet has to trap focus, restore it to the hamburger on close, react to
 * `Esc`, lock body scroll, and raise the `data-overlay-open` flag that makes the
 * floating WhatsApp button stand down (§12.1). All five already exist, correct
 * and tested, inside the dialog family. Re-implementing them here would be four
 * accessibility bugs waiting to happen. `side="start"` also means the panel
 * slides in from the left in French and from the right in Arabic without a
 * single conditional: the primitive resolves the physical keyframe from the
 * document direction.
 *
 * `max-w-none` is the whole difference between the standard drawer and a
 * full-screen sheet — `cn()` merges it over the primitive's own `max-w`, so the
 * panel covers the viewport instead of stopping at 26 rem.
 *
 * ## Closing
 * A client-side navigation does not unmount the dialog by itself, so every link
 * is wrapped in `DrawerClose`: one tap both closes the sheet and navigates. The
 * `open` state is held here rather than left uncontrolled so that the sheet also
 * closes when the visitor taps the link for the page they are already on.
 */

export interface PublicNavItem {
  /** Locale-agnostic path, e.g. `/formations`. */
  readonly href: string;
  readonly label: string;
}

/** The authenticated shortcut, or the pair of guest calls to action. */
export interface PublicAccountLink {
  readonly href: string;
  readonly label: string;
}

export interface MobileNavProps {
  readonly items: readonly PublicNavItem[];
  /** Accessible name of the hamburger, e.g. « Ouvrir le menu ». */
  readonly openLabel: string;
  /** Accessible name of the close button, e.g. « Fermer le menu ». */
  readonly closeLabel: string;
  /** Accessible name of the navigation landmark, e.g. « Navigation principale ». */
  readonly navLabel: string;
  /** Title of the sheet — the brand name, never translated (§28.2). */
  readonly title: string;
  /** Present when a session exists: replaces the two guest calls to action. */
  readonly account: PublicAccountLink | null;
  readonly signInLabel: string;
  readonly signInHref: string;
  readonly registerLabel: string;
  readonly registerHref: string;
  readonly className?: string;
}

/** `true` when `href` is the current page or one of its descendants. */
function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileNav({
  items,
  openLabel,
  closeLabel,
  navLabel,
  title,
  account,
  signInLabel,
  signInHref,
  registerLabel,
  registerHref,
  className,
}: MobileNavProps): React.JSX.Element {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        aria-label={openLabel}
        className={cn(
          'inline-flex size-11 items-center justify-center rounded-pill border border-hairline bg-surface',
          'text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
          'hover:bg-raised hover:text-ink active:bg-raised',
          className,
        )}
      >
        {/* Three stacked bars carry no reading direction: never mirrored. */}
        <Menu className="size-5" aria-hidden="true" />
      </DrawerTrigger>

      <DrawerContent
        side="start"
        closeLabel={closeLabel}
        /* Full-screen: the primitive's max-width, rounding and edge border all
           go, so the sheet is the viewport. */
        className="max-w-none rounded-e-none border-e-0"
        /* The sheet is a navigation list; a description would only repeat the
           links. Stated explicitly so the dialog does not point at nothing. */
        aria-describedby={undefined}
      >
        <DrawerHeader>
          <DrawerTitle className="font-display text-heading tracking-tight">{title}</DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="py-2">
          <nav aria-label={navLabel}>
            <ul className="flex flex-col">
              {items.map((item) => {
                const current = isActive(pathname, item.href);

                return (
                  <li key={item.href} className="border-b border-hairline last:border-b-0">
                    <DrawerClose asChild>
                      <Link
                        href={item.href}
                        aria-current={current ? 'page' : undefined}
                        className={cn(
                          'flex min-h-14 items-center rounded-sm px-2 text-lead',
                          'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                          current ? 'font-medium text-strait' : 'text-ink hover:text-strait',
                        )}
                      >
                        {item.label}
                      </Link>
                    </DrawerClose>
                  </li>
                );
              })}
            </ul>
          </nav>
        </DrawerBody>

        {/* Pinned to the bottom, above the safe-area inset (§12.1). `flex-col`
            undoes the primitive's reversed row so the primary action is last in
            the DOM *and* last on screen — thumb-reachable, and read in the same
            order it is seen. */}
        <DrawerFooter
          className="flex-col gap-3 sm:flex-col"
          /* The safe-area inset is added to the footer's own padding rather
             than replacing it: `env()` resolves to 0 px on a device without a
             home indicator, and a utility class that lost that race would leave
             the primary action flush against the bottom edge. */
          style={{ paddingBlockEnd: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {account === null ? (
            <>
              <DrawerClose asChild>
                <Link
                  href={signInHref}
                  className={cn(
                    'inline-flex h-12 w-full items-center justify-center rounded-md px-5 text-body font-medium',
                    'text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                    'hover:bg-raised hover:text-ink',
                  )}
                >
                  {signInLabel}
                </Link>
              </DrawerClose>
              <DrawerClose asChild>
                <Link
                  href={registerHref}
                  className={cn(
                    'inline-flex h-12 w-full items-center justify-center rounded-md bg-strait px-5 text-body font-medium text-on-accent shadow-e1',
                    'transition-[background-color,translate] duration-[120ms] ease-[var(--ease-out-strait)]',
                    'hover:bg-strait/90 active:translate-y-px',
                  )}
                >
                  {registerLabel}
                </Link>
              </DrawerClose>
            </>
          ) : (
            <DrawerClose asChild>
              <Link
                href={account.href}
                className={cn(
                  'inline-flex h-12 w-full items-center justify-center rounded-md bg-strait px-5 text-body font-medium text-on-accent shadow-e1',
                  'transition-[background-color,translate] duration-[120ms] ease-[var(--ease-out-strait)]',
                  'hover:bg-strait/90 active:translate-y-px',
                )}
              >
                {account.label}
              </Link>
            </DrawerClose>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
