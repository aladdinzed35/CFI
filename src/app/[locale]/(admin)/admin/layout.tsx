import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';

import { signOut } from '@/server/auth/config';
import { requirePageAdmin } from '@/server/auth/guards';
import { accountCounts } from '@/server/services/accounts/queries';
import { requestQueueCounts } from '@/server/services/enrollment/admin-queries';
import { isLocale, type Locale } from '@/i18n/routing';

import { AdminShell, type AdminNavGroup } from './admin-nav';

/**
 * The administration shell (§17 preamble).
 *
 * A Server Component on purpose: it is the layer that holds the guard, the
 * translations and the **real** pending-work count. Only the chrome that needs
 * state — the mobile drawer, the rail collapse, the avatar menu — is delegated
 * to a client component, which receives finished strings and numbers.
 *
 * The counter is not a stub. Milestone 1 owns exactly one queue, accounts
 * awaiting validation, so that is what it counts; payment requests, ungraded
 * submissions and flagged reviews join the same total when their milestones
 * land, and the shape here already sums a list rather than reading one number.
 */

type LocaleParams = { locale: string };

/** An administration panel has nothing to offer a crawler (§21). */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Never prerendered, and this must stay.
 *
 * The locale layout supplies `generateStaticParams`, so without this Next would
 * happily render `/fr/admin` at build time — with no cookie, therefore as the
 * anonymous redirect to the login page — and serve that shell to a logged-in
 * administrator. Every screen under this layout depends on who is asking and on
 * a live count; all of them are per-request by nature.
 */
export const dynamic = 'force-dynamic';

/** The queue the top-bar counter and the dashboard band both deep-link into. */
const PENDING_ACCOUNTS_HREF = '/admin/comptes?onglet=a-valider';

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  // Redirecting guard, not a throwing one: an administrator who let their
  // session lapse must land on the login page, not on an error boundary.
  const user = await requirePageAdmin(locale);

  const [tNav, tCommon, tA11y, tShell] = await Promise.all([
    getTranslations('admin.nav'),
    getTranslations('common'),
    getTranslations('a11y'),
    getTranslations('landing'),
  ]);

  // Both queues, in parallel: the rail shows what is waiting behind each entry,
  // and a `payment.verify`-less admin simply gets no number rather than an error.
  const [counts, requests] = await Promise.all([accountCounts(user), requestQueueCounts(user)]);
  const pendingAccounts = counts.ok ? counts.data.pendingApproval : 0;
  const pendingRequests = requests.ok ? requests.data.UNDER_REVIEW : 0;

  const groups: readonly AdminNavGroup[] = [
    {
      label: null,
      items: [{ href: '/admin', label: tNav('dashboard'), icon: 'dashboard', exact: true }],
    },
    {
      label: tNav('groupOperations'),
      items: [
        {
          href: '/admin/comptes',
          label: tNav('accounts'),
          icon: 'accounts',
          badge: pendingAccounts,
        },
        {
          href: '/admin/demandes',
          label: tNav('requests'),
          icon: 'requests',
          badge: pendingRequests,
        },
        { href: '/admin/paiements', label: tNav('payments'), icon: 'payments' },
      ],
    },
    {
      label: tNav('groupCatalog'),
      items: [
        { href: '/admin/formations', label: tNav('courses'), icon: 'courses' },
        { href: '/admin/contenu', label: tNav('cms'), icon: 'cms' },
      ],
    },
    {
      // Configuration and history: rarely opened, never hunted for at the top
      // of the rail, and last for exactly that reason.
      label: tNav('groupSystem'),
      items: [
        { href: '/admin/reglages', label: tNav('settings'), icon: 'settings' },
        { href: '/admin/journal', label: tNav('audit'), icon: 'audit' },
      ],
    },
  ];

  /**
   * Signing out revokes the `Session` row through the Auth.js `signOut` event,
   * so a token captured earlier stops resolving on the very next request.
   */
  async function signOutAction(): Promise<void> {
    'use server';
    await signOut({ redirectTo: `/${locale as Locale}/connexion` });
  }

  return (
    <AdminShell
      groups={groups}
      labels={{
        brand: tNav('title'),
        navLabel: tNav('sectionLabel'),
        openMenu: tA11y('openMenu'),
        close: tCommon('close'),
        collapse: tNav('collapse'),
        expand: tNav('expand'),
        pendingWork: tNav('pendingWork', { count: pendingAccounts }),
        pendingWorkLabel: tNav('pendingWorkLabel'),
        accountMenu: tNav('accountMenu'),
        backToSite: tNav('backToSite'),
        signOut: tNav('signOut'),
        language: tShell('languageLabel'),
        switchToLight: tShell('switchToLight'),
        switchToDark: tShell('switchToDark'),
      }}
      user={{ fullName: user.fullName, email: user.email }}
      pending={{ count: pendingAccounts, href: PENDING_ACCOUNTS_HREF }}
      signOutAction={signOutAction}
    >
      {children}
    </AdminShell>
  );
}
