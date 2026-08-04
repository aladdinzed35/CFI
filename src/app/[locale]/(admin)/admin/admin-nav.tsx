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
function NavBadge({ count }: { count?: number }): React.JSX.Element | null {
  if (count === undefined || count <= 0) return null;
  return (
    <Badge tone="warn" variant="solid" size="sm" className="ms-auto min-w-6 justify-center">
      <span data-numeric dir="ltr" className="force-ltr">
        {count}
      </span>
    </Badge>
  );
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
                        <p className="px-3 pb-1 font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
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
            collapsed ? 'w-[4.5rem]' : 'w-60',
          )}
        >
          <nav aria-label={labels.navLabel} className="flex flex-col gap-6">
            {groups.map((group, index) => (
              <div key={group.label ?? `group-${index}`} className="flex flex-col gap-1">
                {group.label === null || collapsed ? null : (
                  <p className="px-3 pb-1 font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
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
                      title={
                        collapsed
                          ? item.badge !== undefined && item.badge > 0
                            ? `${item.label} (${item.badge})`
                            : item.label
                          : undefined
                      }
                      className={cn(
                        'inline-flex min-h-11 items-center gap-3 rounded-md text-sm font-medium',
                        'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                        collapsed ? 'justify-center px-0' : 'px-3',
                        active
                          ? 'bg-strait-wash text-ink'
                          : 'text-ink-muted hover:bg-raised hover:text-ink',
                      )}
                    >
                      <Icon className="size-5 shrink-0" aria-hidden="true" />
                      <span className={collapsed ? 'sr-only' : undefined}>{item.label}</span>
                      {/* Collapsed to an icon rail there is no room for a
                          number, and a bare dot would say "something" without
                          saying what — so the count rides the title instead. */}
                      {collapsed ? null : <NavBadge count={item.badge} />}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="mt-auto">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? labels.expand : labels.collapse}
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
