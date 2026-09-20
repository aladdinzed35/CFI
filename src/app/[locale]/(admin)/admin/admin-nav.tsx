'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ChevronLeft,
  ExternalLink,
  FileCheck,
  GraduationCap,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  ScrollText,
  Settings,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { Link, usePathname } from '@/i18n/navigation';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ShellControls } from '@/components/system/shell-controls';

/**
 * The administration shell (§17 preamble, §11.4).
 *
 * Interactive chrome only — the layout that renders it is a Server Component and
 * keeps ownership of the guard, the translations and the real pending-work
 * count. Everything this file receives is already a string or a number, so no
 * message catalogue and no date library reaches the browser through it.
 *
 * Three things make it usable on a phone, which §11.4 calls a primary use case
 * rather than a nicety:
 *  - below `md` the sidebar becomes a drawer, and **every link closes it**, so
 *    tapping « Comptes » does not leave a panel covering the queue;
 *  - the pending-work counter sits in the top bar at every width, because it is
 *    the reason an administrator opens this panel at all;
 *  - every target is at least 44 px.
 *
 * From `md` up the sidebar is permanent and collapses to an icon rail. The
 * choice is remembered in `localStorage` — a display preference, never anything
 * a decision depends on — and read after mount so the server and the first
 * client render agree.
 */

export type AdminNavIcon =
  | 'dashboard'
  | 'accounts'
  | 'requests'
  | 'payments'
  | 'courses'
  | 'cms'
  | 'settings'
  | 'audit';

/**
 * One glyph per entry, and every one of them a *noun* the entry is about — a
 * cap for the catalogue, a template for the CMS, a scroll for the journal.
 * They are decorative (`aria-hidden`) and the label always travels with them,
 * because an icon rail collapsed to icons is a memory test, not a navigation.
 */
const NAV_ICONS: Record<AdminNavIcon, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  accounts: Users,
  requests: FileCheck,
  payments: Receipt,
  courses: GraduationCap,
  cms: LayoutTemplate,
  settings: Settings,
  audit: ScrollText,
};

export interface AdminNavItem {
  /** Locale-agnostic path, e.g. `/admin/comptes`. */
  readonly href: string;
  readonly label: string;
  readonly icon: AdminNavIcon;
  /** `true` when only an exact path match counts as active — the panel root. */
  readonly exact?: boolean;
  /**
   * Work waiting behind this entry. Omitted, or `0`, renders nothing.
   *
   * The top bar carries a single counter, and it counts accounts. Once requests
   * arrived there were two queues and one number, so an administrator could read
   * « Aucun compte à valider » while four transfers sat unverified. A count on
   * the entry itself keeps each queue honest about its own backlog.
   */
  readonly badge?: number;
}

export interface AdminNavGroup {
  /** `null` for the ungrouped items at the top of the rail. */
  readonly label: string | null;
  readonly items: readonly AdminNavItem[];
}

export interface AdminShellLabels {
  readonly brand: string;
  readonly navLabel: string;
  readonly openMenu: string;
  readonly close: string;
  readonly collapse: string;
  readonly expand: string;
  /** Already pluralised by the server, e.g. « 3 comptes à valider ». */
  readonly pendingWork: string;
  readonly pendingWorkLabel: string;
  readonly accountMenu: string;
  readonly backToSite: string;
  readonly signOut: string;
  readonly language: string;
  readonly switchToLight: string;
  readonly switchToDark: string;
}

export interface AdminShellProps {
  readonly groups: readonly AdminNavGroup[];
  readonly labels: AdminShellLabels;
  readonly user: { readonly fullName: string; readonly email: string };
  readonly pending: { readonly count: number; readonly href: string };
  /** Server action: revokes the session row and redirects to the login page. */
  readonly signOutAction: () => Promise<void>;
  readonly children: ReactNode;
}

const COLLAPSE_STORAGE_KEY = 'cfi.admin.nav.collapsed';
const SIGN_OUT_FORM_ID = 'cfi-admin-sign-out';

/**
 * The waiting count on a rail entry. Pushed to the end of the row so the
 * labels stay left-aligned, and marked `data-numeric dir="ltr"` like every
 * other figure in the panel — an Arabic reader still sees `12`, not `21`.
 */
function NavBadge({ count, className }: { count?: number; className?: string }): React.JSX.Element | null {
  if (count === undefined || count <= 0) return null;
  return (
    <Badge tone="warn" variant="solid" size="sm" className={cn('ms-auto min-w-6 justify-center', className)}>
      <span data-numeric dir="ltr" className="force-ltr">
        {count}
      </span>
    </Badge>
  );
}

/**
 * The same count, pinned to the corner of the icon when the rail is only icons
 * wide. A number on the glyph — the way a phone badges an app — rather than a
 * bare dot: « 3 » says how much is waiting, a dot only that something is.
 */
function NavBubble({ count, className }: { count?: number; className?: string }): React.JSX.Element | null {
  if (count === undefined || count <= 0) return null;
  return (
    <span
      data-numeric
      dir="ltr"
      className={cn(
        'force-ltr absolute -top-1.5 -end-2 inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-warn px-1',
        'text-[0.625rem] leading-none font-semibold text-on-brass ring-2 ring-surface',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/**
 * How the rail draws itself.
 *
 * Collapsed by the administrator: icons at every width. Otherwise icons from
 * `md` to `lg` — a 240 px rail on a 768 px tablet leaves the queues less than
 * two thirds of the screen — and the full rail from `lg` up. The preference
 * only ever narrows the rail; it never widens it where there is no room.
 */
function railClasses(collapsed: boolean): {
  readonly width: string;
  readonly group: string;
  readonly item: string;
  readonly label: string;
  readonly badge: string;
  readonly bubble: string;
} {
  if (collapsed) {
    return {
      width: 'w-[4.5rem]',
      group: 'hidden',
      item: 'justify-center px-0',
      label: 'sr-only',
      badge: 'hidden',
      bubble: '',
    };
  }
  return {
    width: 'w-[4.5rem] lg:w-60',
    group: 'hidden lg:block',
    item: 'justify-center px-0 lg:justify-start lg:px-3',
    label: 'sr-only lg:not-sr-only',
    badge: 'hidden lg:inline-flex',
    bubble: 'lg:hidden',
  };
}

function isActive(pathname: string, item: AdminNavItem): boolean {
  if (item.exact === true) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AdminShell({
  groups,
  labels,
  user,
  pending,
  signOutAction,
  children,
}: AdminShellProps): React.JSX.Element {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1');
    } catch {
      // A blocked storage API is not a reason to lose the panel.
    }
  }, []);

  const toggleCollapsed = useCallback((): void => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Preference is not persisted; the session still honours it.
      }
      return next;
    });
  }, []);

  const closeMenu = useCallback((): void => {
    setMenuOpen(false);
  }, []);

  const rail = railClasses(collapsed);

  return (
    <div className="flex min-h-dvh flex-col bg-abyss">
      <header className="surface-blur hairline-b sticky top-0 z-30 bg-surface/85">
        <div className="flex h-16 items-center gap-2 px-3 sm:px-4">
          {/* ── Phone: the sidebar as a drawer ──────────────────────────── */}
          <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
            <DrawerTrigger
              className={cn(
                'inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink-muted md:hidden',
                'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink',
              )}
              aria-label={labels.openMenu}
            >
              <Menu className="size-5" aria-hidden="true" />
            </DrawerTrigger>

            <DrawerContent side="start" size="md" closeLabel={labels.close}>
              <DrawerHeader>
                <DrawerTitle>{labels.brand}</DrawerTitle>
                <DrawerDescription>{labels.navLabel}</DrawerDescription>
              </DrawerHeader>
              <DrawerBody>
                <nav aria-label={labels.navLabel} className="flex flex-col gap-6">
                  {groups.map((group, index) => (
                    <div key={group.label ?? `group-${index}`} className="flex flex-col gap-1">
                      {group.label === null ? null : (
                        <p className="px-3 pb-1 font-mono text-xs uppercase tracking-[0.18em] text-ink-muted rtl:font-arabic rtl:text-sm rtl:tracking-normal">
                          {group.label}
                        </p>
                      )}
                      {group.items.map((item) => {
                        const Icon = NAV_ICONS[item.icon];
                        const active = isActive(pathname, item);
                        return (
                          <DrawerClose asChild key={item.href}>
                            <Link
                              href={item.href}
                              onClick={closeMenu}
                              aria-current={active ? 'page' : undefined}
                              className={cn(
                                'inline-flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium',
                                'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                                active
                                  ? 'bg-strait-wash text-ink'
                                  : 'text-ink-muted hover:bg-raised hover:text-ink',
                              )}
                            >
                              <Icon className="size-5 shrink-0" aria-hidden="true" />
                              <span>{item.label}</span>
                              <NavBadge count={item.badge} />
                            </Link>
                          </DrawerClose>
                        );
                      })}
                    </div>
                  ))}
                </nav>

                {/* The top bar drops the language and theme controls below `sm`
                    to keep the pending-work counter visible; on a phone they
                    live here instead, so they are never simply unreachable. */}
                <div className="hairline-t mt-6 pt-5 sm:hidden">
                  <ShellControls
                    languageLabel={labels.language}
                    switchToLightLabel={labels.switchToLight}
                    switchToDarkLabel={labels.switchToDark}
                  />
                </div>
              </DrawerBody>
            </DrawerContent>
          </Drawer>

          <Link
            href="/admin"
            className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-6 shrink-0 text-strait"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinejoin="round"
            >
              <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="1" />
              <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="1" transform="rotate(45 12 12)" />
            </svg>
            <span className="font-display text-body tracking-tight">{labels.brand}</span>
          </Link>

          <div className="flex flex-1 items-center justify-end gap-2">
            {/* ── The pending-work counter (§17 preamble) ──────────────── */}
            <Link
              href={pending.href}
              aria-label={labels.pendingWorkLabel}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-pill border px-3 text-sm font-medium',
                'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                pending.count > 0
                  ? 'border-warn/40 bg-warn-wash text-warn hover:bg-warn-wash/80'
                  : 'border-hairline bg-surface text-ink-muted hover:bg-raised hover:text-ink',
              )}
            >
              <Badge
                tone={pending.count > 0 ? 'warn' : 'neutral'}
                variant="solid"
                size="sm"
                className="min-w-6 justify-center"
              >
                <span data-numeric className="force-ltr" dir="ltr">
                  {pending.count}
                </span>
              </Badge>
              <span className="hidden lg:inline">{labels.pendingWork}</span>
            </Link>

            <ShellControls
              languageLabel={labels.language}
              switchToLightLabel={labels.switchToLight}
              switchToDarkLabel={labels.switchToDark}
              className="hidden sm:flex"
            />

            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={labels.accountMenu}
                className={cn(
                  'inline-flex size-11 shrink-0 items-center justify-center rounded-pill',
                  'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised',
                )}
              >
                <Avatar name={user.fullName} size="sm" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8}>
                <div className="flex flex-col gap-0.5 px-3 py-2">
                  <p className="text-sm font-medium text-ink">{user.fullName}</p>
                  <p className="force-ltr text-xs text-ink-muted" dir="ltr">
                    {user.email}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/">
                    <ExternalLink className="size-4" aria-hidden="true" />
                    <span>{labels.backToSite}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild variant="danger">
                  <button type="submit" form={SIGN_OUT_FORM_ID}>
                    <LogOut className="size-4 rtl:-scale-x-100" aria-hidden="true" />
                    <span>{labels.signOut}</span>
                  </button>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Lives outside the menu so the portal cannot detach it mid-submit. */}
            <form id={SIGN_OUT_FORM_ID} action={signOutAction} className="hidden" />
          </div>
        </div>
      </header>

      <div className="flex flex-1 items-stretch">
        {/* ── Tablet and desktop: the permanent rail ─────────────────────── */}
        <aside
          className={cn(
            'hairline-e sticky top-16 hidden h-[calc(100dvh-4rem)] shrink-0 flex-col gap-6 overflow-y-auto bg-surface px-2 py-4 md:flex',
            'transition-[width] duration-[160ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none',
            rail.width,
          )}
        >
          <nav aria-label={labels.navLabel} className="flex flex-col gap-6">
            {groups.map((group, index) => (
              <div key={group.label ?? `group-${index}`} className="flex flex-col gap-1">
                {group.label === null ? null : (
                  <p
                    className={cn(
                      'px-3 pb-1 font-mono text-xs uppercase tracking-[0.18em] text-ink-muted rtl:font-arabic rtl:text-sm rtl:tracking-normal',
                      rail.group,
                    )}
                  >
                    {group.label}
                  </p>
                )}
                {group.items.map((item) => {
                  const Icon = NAV_ICONS[item.icon];
                  const active = isActive(pathname, item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      // The only name an icon-wide rail can show on hover.
                      title={item.label}
                      className={cn(
                        'inline-flex min-h-11 items-center gap-3 rounded-md text-sm font-medium',
                        'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                        rail.item,
                        active
                          ? 'bg-strait-wash text-ink'
                          : 'text-ink-muted hover:bg-raised hover:text-ink',
                      )}
                    >
                      <span className="relative inline-flex shrink-0">
                        <Icon className="size-5" aria-hidden="true" />
                        <NavBubble count={item.badge} className={rail.bubble} />
                      </span>
                      <span className={rail.label}>{item.label}</span>
                      <NavBadge count={item.badge} className={rail.badge} />
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Only where the rail can actually be wide: below `lg` it is icons
              whatever the preference says, and a toggle that changes nothing
              is a broken control. */}
          <div className="mt-auto hidden lg:block">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? labels.expand : labels.collapse}
              title={collapsed ? labels.expand : labels.collapse}
              className={cn(
                'inline-flex min-h-11 w-full items-center gap-3 rounded-md text-sm text-ink-muted',
                'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink',
                collapsed ? 'justify-center px-0' : 'px-3',
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              )}
              <span className={collapsed ? 'sr-only' : undefined}>{labels.collapse}</span>
            </button>
          </div>
        </aside>

        <main id="contenu" className="min-w-0 flex-1 pb-16">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Back link shared by the pages under this shell — a direction-carrying chevron
 * that mirrors in Arabic, and a 44 px target.
 */
export function AdminBackLink({ href, label }: { href: string; label: string }): React.JSX.Element {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-ink"
    >
      <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}
