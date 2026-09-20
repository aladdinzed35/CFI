'use client';

import { useState } from 'react';
import { ArrowRight, Menu } from 'lucide-react';

import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { cn } from '@/lib/cn';
import { Link, usePathname } from '@/i18n/navigation';

/**
 * The phone-and-tablet half of the public header (§12.1): a hamburger that
 * opens a **full-screen sheet** on a phone — a side sheet from `md` — with the
 * two authentication calls to action pinned to the bottom above the safe-area
 * inset.
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
 * panel covers the viewport instead of stopping at 26 rem. From `md` the header
 * keeps this menu up to `xl` (see `site-header.tsx`), and a sheet the width of a
 * landscape tablet holding six links is mostly empty space, so there it stops at
 * 26 rem again and the page stays visible behind the overlay.
 *
 * ## The look
 * The links are set large, numbered in brass, each with an arrow that mirrors in
 * Arabic because it points *forward*. Behind the list, a band of the same
 * zellige tilework as the hero's gate fades in from the bottom — drawn inline,
 * `aria-hidden`, no request.
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
  /** Optional line under the title — the centre's full name. */
  readonly caption?: string;
  /** Optional brand mark shown on a tile beside the title. Decorative. */
  readonly mark?: React.ReactNode;
  /**
   * All three variants are rendered; CSS reveals one from the `data-chrome`
   * attribute. Nothing here is conditional on the session, which is what keeps
   * the public pages statically renderable.
   */
  readonly studentLabel: string;
  readonly studentHref: string;
  readonly adminLabel: string;
  readonly adminHref: string;
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

/** Two-digit ordinal, e.g. `01`. Digits are not localised: they are ornament. */
function ordinal(index: number): string {
  return String(index + 1).padStart(2, '0');
}

const PRIMARY_CTA = cn(
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-pill bg-strait px-5 text-body font-medium text-on-accent shadow-e2',
  'transition-[background-color,translate] duration-[120ms] ease-[var(--ease-out-strait)]',
  'hover:bg-strait/90 active:translate-y-px',
);

const SECONDARY_CTA = cn(
  'inline-flex h-12 w-full items-center justify-center rounded-pill border border-hairline bg-surface px-5 text-body font-medium text-ink',
  'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
  'hover:bg-raised',
);

/**
 * The zellige band behind the list: the hero gate's pattern — the brand star in
 * the tile glaze, set in a lattice of accent diamonds — faded up from the
 * bottom. Theme-aware through the `--raw-art-*` illustration palette.
 */
function ZelligeBand(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-44 w-full opacity-30 [mask-image:linear-gradient(to_top,black,transparent)]"
    >
      <defs>
        <pattern id="cfi-mobile-nav-zellige" width="36" height="36" patternUnits="userSpaceOnUse">
          <g style={{ fill: 'var(--raw-art-tile)' }} opacity="0.7">
            <rect x="12.5" y="12.5" width="11" height="11" rx="0.6" />
            <rect x="12.5" y="12.5" width="11" height="11" rx="0.6" transform="rotate(45 18 18)" />
          </g>
          <g style={{ fill: 'var(--raw-art-tile-accent)' }} opacity="0.55">
            <rect x="-2.5" y="-2.5" width="5" height="5" transform="rotate(45 0 0)" />
            <rect x="33.5" y="-2.5" width="5" height="5" transform="rotate(45 36 0)" />
            <rect x="-2.5" y="33.5" width="5" height="5" transform="rotate(45 0 36)" />
            <rect x="33.5" y="33.5" width="5" height="5" transform="rotate(45 36 36)" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#cfi-mobile-nav-zellige)" />
    </svg>
  );
}

export function MobileNav({
  items,
  openLabel,
  closeLabel,
  navLabel,
  title,
  caption,
  mark,
  studentLabel,
  studentHref,
  adminLabel,
  adminHref,
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
        /* Full-screen on a phone: the primitive's max-width, rounding and edge
           border all go, so the sheet is the viewport. From `md`, a side sheet
           again (see the note above). */
        className="max-w-none rounded-e-none border-e-0 md:max-w-[26rem] md:rounded-e-lg md:border-e"
        /* The sheet is a navigation list; a description would only repeat the
           links. Stated explicitly so the dialog does not point at nothing —
           unless there is a caption, which is then what describes it. */
        {...(caption === undefined ? { 'aria-describedby': undefined } : {})}
      >
        <DrawerHeader className="flex-row items-center gap-3">
          {mark === undefined ? null : (
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-md border border-strait/25 bg-strait-wash text-strait shadow-e1"
            >
              {mark}
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <DrawerTitle className="font-display text-heading leading-none tracking-tight">
              {title}
            </DrawerTitle>
            {caption === undefined ? null : (
              <DrawerDescription className="mt-1 truncate text-xs text-ink-muted">
                {caption}
              </DrawerDescription>
            )}
          </span>
        </DrawerHeader>

        <DrawerBody className="relative isolate py-3">
          <ZelligeBand />
          <nav aria-label={navLabel}>
            <ul className="flex flex-col gap-1">
              {items.map((item, index) => {
                const current = isActive(pathname, item.href);

                return (
                  <li key={item.href}>
                    <DrawerClose asChild>
                      <Link
                        href={item.href}
                        aria-current={current ? 'page' : undefined}
                        className={cn(
                          'group flex min-h-14 items-center gap-4 rounded-md px-3',
                          'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                          current ? 'bg-strait-wash text-strait' : 'text-ink hover:bg-raised',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          dir="ltr"
                          className={cn(
                            'w-6 shrink-0 font-mono text-xs tabular-nums',
                            current ? 'text-strait' : 'text-brass',
                          )}
                        >
                          {ordinal(index)}
                        </span>
                        <span className="min-w-0 flex-1 font-display text-heading font-medium rtl:font-arabic">
                          {item.label}
                        </span>
                        {/* "Go there": points forward, so it mirrors in RTL. */}
                        <ArrowRight
                          aria-hidden="true"
                          className={cn(
                            'size-5 shrink-0 transition-[translate,color] duration-200 ease-[var(--ease-out-strait)] rtl:-scale-x-100',
                            current
                              ? 'text-strait'
                              : 'text-ink-muted/60 group-hover:translate-x-0.5 group-hover:text-ink rtl:group-hover:-translate-x-0.5',
                          )}
                        />
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
          className="flex-col gap-3 bg-surface sm:flex-col sm:justify-start"
          /* The safe-area inset is added to the footer's own padding rather
             than replacing it: `env()` resolves to 0 px on a device without a
             home indicator, and a utility class that lost that race would leave
             the primary action flush against the bottom edge. */
          style={{ paddingBlockEnd: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {/* Same three variants as the desktop slot, revealed by the same
              `data-chrome` rules. See `src/styles/globals.css`. */}
          <span className="cfi-chrome-guest">
            <DrawerClose asChild>
              <Link href={signInHref} className={SECONDARY_CTA}>
                {signInLabel}
              </Link>
            </DrawerClose>
            <DrawerClose asChild>
              <Link href={registerHref} className={PRIMARY_CTA}>
                {registerLabel}
                <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </DrawerClose>
          </span>

          <span className="cfi-chrome-student">
            <DrawerClose asChild>
              <Link href={studentHref} className={PRIMARY_CTA}>
                {studentLabel}
                <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </DrawerClose>
          </span>

          <span className="cfi-chrome-admin">
            <DrawerClose asChild>
              <Link href={adminHref} className={PRIMARY_CTA}>
                {adminLabel}
                <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </DrawerClose>
          </span>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
