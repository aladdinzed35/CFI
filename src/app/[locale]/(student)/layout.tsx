import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Bell, LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LocaleSwitcher } from '@/components/ui/locale-switcher';
import { Popover, PopoverContent, PopoverHeader, PopoverTrigger } from '@/components/ui/popover';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { formatRelative, toDateTimeAttribute } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import { isLocale, type Locale } from '@/i18n/routing';
import { signOut } from '@/server/auth/config';
import { assertSameOrigin, getCurrentUser, requirePageUser } from '@/server/auth/guards';
import { ROUTES } from '@/server/auth/route-policy';
import {
  listNotifications,
  markAllRead,
  unreadCount,
  type NotificationPayload,
  type NotificationView,
} from '@/server/services/notifications';

/**
 * The authenticated student shell (§13) — collapsible sidebar on desktop, tab
 * bar on mobile, top bar with the notification bell, the language switcher, the
 * theme toggle and the account menu.
 *
 * ## A server component, on purpose
 * Everything here is either data (the identity, the unread count) or a link, and
 * both are cheaper and more reliable on the server. The two pieces that look
 * like they need client state do not:
 *
 * - **The sidebar remembers whether it is collapsed** through a cookie written
 *   by a server action, not through `localStorage`. The consequence is that the
 *   very first paint is already correct — no flash of an expanded rail that
 *   snaps shut after hydration — and the control keeps working with JavaScript
 *   disabled. The cost is one round trip per toggle, which is the right trade
 *   for a preference somebody changes twice a week.
 * - **Marking notifications read and signing out** are `<form>` submissions to
 *   server actions, for the same reason.
 *
 * Only the three primitives that genuinely need the browser — the popover, the
 * menu, the theme and locale controls — are client components, and they are
 * handed server-rendered children.
 *
 * ## What this layout does NOT decide
 * It requires *a session*, nothing more. The status gate lives in
 * `server/auth/route-policy.ts` (applied by the middleware) and in each page's
 * own guard, because §9.1 gives `/espace/profil` to accounts that are still
 * waiting for approval while the rest of `/espace` needs an approved one — a
 * distinction a layout cannot make, since it never learns which page it is
 * wrapping. Calling `requirePageUser` here is still load-bearing: it resolves
 * the session against the `Session` table, which is what makes a revoked
 * session or a suspension take effect on the next request rather than in thirty
 * days.
 */

type LocaleParams = { locale: string };

/** Which state of the rail is stored, in French like every other value we own. */
const SIDEBAR_COOKIE = 'cfi.sidebar';
const SIDEBAR_COLLAPSED = 'reduit';
const SIDEBAR_EXPANDED = 'deploye';
const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

/** How many rows the bell shows before deferring to the notifications page. */
const NOTIFICATION_PREVIEW = 6;

/** Id shared by the sign-out form and the menu entry that submits it. */
const SIGN_OUT_FORM = 'cfi-signout';

export default async function StudentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  setRequestLocale(locale);

  const user = await requirePageUser(locale);
  const t = await getTranslations({ locale, namespace: 'student.shell' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });
  const tMessages = await getTranslations({ locale });

  const [unread, notifications, cookieStore] = await Promise.all([
    unreadCount(user.id),
    listNotifications(user.id, { limit: NOTIFICATION_PREVIEW }),
    cookies(),
  ]);

  const collapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === SIDEBAR_COLLAPSED;

  /**
   * Flip the rail. No input to validate — the form carries no fields — so the
   * order §20 prescribes starts at its second step: prove who is asking, then
   * write. An anonymous caller is ignored rather than shown an error page:
   * there is nothing here worth an explanation.
   */
  async function toggleSidebar(): Promise<void> {
    'use server';
    await assertSameOrigin();
    const actor = await getCurrentUser();
    if (actor === null) return;

    const store = await cookies();
    const isCollapsed = store.get(SIDEBAR_COOKIE)?.value === SIDEBAR_COLLAPSED;
    store.set(SIDEBAR_COOKIE, isCollapsed ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED, {
      path: '/',
      sameSite: 'lax',
      maxAge: ONE_YEAR_IN_SECONDS,
      // Nothing in the browser reads it: the rail is rendered on the server.
      httpOnly: true,
    });

    // The rail lives in this layout, not in the page the action was submitted
    // from, so the layout is what has to be re-rendered.
    revalidatePath(`/${locale}${ROUTES.student}`, 'layout');
  }

  /** « Tout marquer comme lu ». The service scopes the write to the actor's own rows. */
  async function markNotificationsRead(): Promise<void> {
    'use server';
    await assertSameOrigin();
    const actor = await getCurrentUser();
    if (actor === null) return;
    await markAllRead(actor.id);
    // The badge is part of the shell, so the shell is what goes stale.
    revalidatePath(`/${locale}${ROUTES.student}`, 'layout');
  }

  /**
   * Sign out. `signOut` revokes the `Session` row through the Auth.js event in
   * `server/auth/config.ts` — the cookie is not merely dropped, the token stops
   * resolving to anything.
   */
  async function endSession(): Promise<void> {
    'use server';
    await assertSameOrigin();
    await signOut({ redirectTo: `/${locale}${ROUTES.signIn}` });
  }

  const destinations = navigationFor(user.status, tNav('dashboard'));

  return (
    <div className="flex min-h-dvh flex-col bg-abyss">
      <header className="sticky top-0 z-40 surface-blur hairline-b">
        <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
          <Link
            href={ROUTES.student}
            className="inline-flex items-center gap-2.5 rounded-md py-1"
            aria-label={t('brandHome')}
          >
            {/* Zellige eight-point star — symmetrical, never mirrored (§10.3). */}
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
            <span className="font-display text-heading leading-none tracking-tight text-ink">CFI</span>
          </Link>

          <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
            <NotificationBell
              locale={locale}
              unread={unread}
              items={notifications.items}
              action={markNotificationsRead}
              labels={{
                trigger: t('notifications.trigger', { count: unread }),
                title: t('notifications.title'),
                empty: t('notifications.empty'),
                markAllRead: t('notifications.markAllRead'),
                // ICU plural — omitting `count` throws FORMATTING_ERROR at
                // render time and 500s the whole authenticated shell.
                unread: t('notifications.unread', { count: unread }),
              }}
              translate={(key, values) => tMessages(key, values)}
            />

            <LocaleSwitcher label={t('language')} />

            <ThemeToggle
              switchToLightLabel={t('theme.toLight')}
              switchToDarkLabel={t('theme.toDark')}
              lightEnabledMessage={t('theme.lightEnabled')}
              darkEnabledMessage={t('theme.darkEnabled')}
            />

            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t('accountMenu')}
                className="inline-flex size-11 items-center justify-center rounded-pill border border-hairline bg-surface transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised data-[state=open]:bg-raised"
              >
                <Avatar name={user.fullName} size="sm" />
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="min-w-[15rem]">
                <DropdownMenuLabel className="normal-case">
                  <span className="block text-sm font-medium tracking-normal text-ink">
                    {user.fullName}
                  </span>
                  <span
                    dir="ltr"
                    className="force-ltr mt-0.5 max-w-full truncate text-xs font-normal tracking-normal text-ink-muted"
                  >
                    {user.email}
                  </span>
                </DropdownMenuLabel>

                <DropdownMenuSeparator />

                <DropdownMenuItem asChild variant="danger">
                  <button type="submit" form={SIGN_OUT_FORM}>
                    <LogOut className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
                    {tNav('logout')}
                  </button>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Outside the menu: the portalled menu content is not inside this form,
          so the entry references it by id — which is exactly what the HTML
          `form` attribute is for. */}
      <form id={SIGN_OUT_FORM} action={endSession} className="hidden" />

      <div className="flex flex-1">
        {destinations.length === 0 ? null : (
        <aside
          className={cn(
            'hairline-e sticky top-16 hidden h-[calc(100dvh-4rem)] shrink-0 flex-col gap-1 p-3 lg:flex',
            collapsed ? 'w-[4.75rem]' : 'w-64',
          )}
        >
          <nav aria-label={t('navLabel')} className="flex flex-col gap-1">
            {destinations.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-ink-muted',
                  'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                  'hover:bg-raised hover:text-ink',
                  collapsed && 'justify-center px-0',
                )}
              >
                <item.Icon className="size-5 shrink-0" aria-hidden="true" />
                <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
              </Link>
            ))}
          </nav>

          <form action={toggleSidebar} className="mt-auto">
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              fullWidth
              className={cn('justify-start', collapsed && 'justify-center px-0')}
              aria-label={collapsed ? t('expand') : t('collapse')}
              iconStart={
                collapsed ? (
                  // Direction-carrying: mirrored in Arabic (§10.3).
                  <PanelLeftOpen className="size-5 rtl:-scale-x-100" />
                ) : (
                  <PanelLeftClose className="size-5 rtl:-scale-x-100" />
                )
              }
            >
              <span className={cn(collapsed && 'sr-only')}>{t('collapse')}</span>
            </Button>
          </form>
        </aside>
        )}

        <main
          id="contenu"
          className={cn(
            'min-w-0 flex-1 px-4 pt-8 sm:px-6',
            destinations.length === 0 ? 'pb-12' : 'pb-28 lg:pb-12',
          )}
        >
          {children}
        </main>
      </div>

      {destinations.length === 0 ? null : (
      <nav
        aria-label={t('navLabel')}
        className="safe-b surface-blur hairline-t fixed inset-x-0 bottom-0 z-40 lg:hidden"
      >
        <ul
          className="grid"
          style={{ gridTemplateColumns: `repeat(${destinations.length}, minmax(0, 1fr))` }}
        >
          {destinations.map((item) => (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                className="flex min-h-14 flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-ink"
              >
                <item.Icon className="size-5 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

interface Destination {
  readonly href: string;
  readonly label: string;
  readonly Icon: typeof LayoutDashboard;
}

/**
 * The rail, built from what this account may actually open **today**.
 *
 * Two rules, and the second is the one that keeps the shell honest:
 *
 * 1. A destination this account would be bounced out of is not offered — a
 *    `PENDING_APPROVAL` student inside the shell (§9.1 lets them keep their
 *    profile up to date while they wait) is not shown a dashboard that would
 *    redirect them straight back to the waiting screen.
 * 2. A destination that does not exist yet is not offered either. `/espace`
 *    is the only student route Milestone 1 builds; *Mes formations*, *Mes
 *    demandes*, the profile and the rest arrive with the milestones that build
 *    them, and each is added here at the same time. The product ships no link
 *    that 404s.
 *
 * `status` is a plain string on purpose: a file under `src/app` may not import
 * `@prisma/client` (§5, enforced by ESLint), and the value flows in already
 * typed from the session.
 */
function navigationFor(status: string, dashboardLabel: string): readonly Destination[] {
  if (status !== 'ACTIVE') return [];
  return [{ href: ROUTES.student, label: dashboardLabel, Icon: LayoutDashboard }];
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

interface NotificationBellProps {
  readonly locale: Locale;
  readonly unread: number;
  readonly items: readonly NotificationView[];
  readonly action: () => Promise<void>;
  readonly labels: {
    readonly trigger: string;
    readonly title: string;
    readonly empty: string;
    readonly markAllRead: string;
    readonly unread: string;
  };
  /** Resolves a notification's `titleKey` against the full message catalogue. */
  readonly translate: (key: string, values: Record<string, string | number>) => string;
}

/**
 * The bell (§13.5).
 *
 * A notification row stores an i18n **key** and a payload, never a rendered
 * sentence (see `services/notifications`), so the whole history reads in the
 * language the student is using *now* — which is the point of storing it that
 * way. Titles are resolved here, at read time.
 *
 * Unread is never colour alone: the dot is decorative and the state is spelled
 * out for screen readers.
 */
function NotificationBell({
  locale,
  unread,
  items,
  action,
  labels,
  translate,
}: NotificationBellProps): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={labels.trigger}
        className="relative inline-flex size-11 items-center justify-center rounded-pill border border-hairline bg-surface text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink data-[state=open]:bg-raised data-[state=open]:text-ink"
      >
        <Bell className="size-5" aria-hidden="true" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            data-numeric
            className="absolute -top-1 -end-1 inline-flex min-w-5 items-center justify-center rounded-pill bg-strait px-1.5 py-0.5 text-xs font-medium text-on-accent"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(22rem,calc(100vw_-_1.5rem))]">
        <PopoverHeader>
          <p className="font-display text-body font-medium text-ink">{labels.title}</p>
        </PopoverHeader>

        {items.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">{labels.empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline">
            {items.map((item) => (
              <li key={item.id} className="py-2.5 first:pt-0">
                <NotificationRow
                  item={item}
                  locale={locale}
                  unreadLabel={labels.unread}
                  translate={translate}
                />
              </li>
            ))}
          </ul>
        )}

        {unread > 0 ? (
          <form action={action} className="hairline-t mt-2 pt-2">
            <Button type="submit" variant="ghost" size="sm" fullWidth>
              {labels.markAllRead}
            </Button>
          </form>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  item,
  locale,
  unreadLabel,
  translate,
}: {
  item: NotificationView;
  locale: Locale;
  unreadLabel: string;
  translate: (key: string, values: Record<string, string | number>) => string;
}): React.JSX.Element {
  const title = translate(item.titleKey, toMessageValues(item.payload));
  const isUnread = item.readAt === null;

  const body = (
    <>
      <span className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-pill',
            isUnread ? 'bg-strait' : 'bg-transparent',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">{title}</span>
          <time
            dateTime={toDateTimeAttribute(item.createdAt)}
            className="mt-0.5 block text-xs text-ink-muted"
          >
            {formatRelative(item.createdAt, locale)}
          </time>
          {isUnread ? <span className="sr-only">{unreadLabel}</span> : null}
        </span>
      </span>
    </>
  );

  if (item.link === null) {
    return <div className="px-1">{body}</div>;
  }

  return (
    <Link
      href={item.link}
      className="block rounded-sm px-1 transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-strait-wash"
    >
      {body}
    </Link>
  );
}

/**
 * A notification payload is JSON, so it can nest; an ICU placeholder cannot.
 * Anything that is not a scalar is dropped rather than stringified into
 * `[object Object]` in front of a student.
 */
function toMessageValues(payload: NotificationPayload): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' || typeof value === 'number') values[key] = value;
    else if (typeof value === 'boolean') values[key] = String(value);
  }
  return values;
}
