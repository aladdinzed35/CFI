import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SiteFooter } from '@/components/public/site-footer';
import { SiteHeader } from '@/components/public/site-header';
import { WhatsAppFab } from '@/components/ui/whatsapp-fab';
import { getCurrentUser, isAdmin, AUTH_ROUTES } from '@/server/auth';
import { getPublicChrome } from '@/server/services/public-chrome';
import { isLocale } from '@/i18n/routing';

/**
 * The frame every public page sits in (§12.1).
 *
 * It owns the three things that must be identical on the homepage, the
 * catalogue, a course page, the blog and the legal pages: the sticky header, the
 * four-column footer, and the floating WhatsApp button. A public page below this
 * layout writes its own `<h1>` and nothing else about the chrome.
 *
 * ## Anonymous first
 * Every read here tolerates "no session". `getCurrentUser()` returns `null` for
 * a guest — it never redirects — because these pages exist precisely for people
 * who have no account yet. The only thing a session changes is the pair of
 * calls to action in the header, which collapses into a single link to the
 * visitor's own space.
 *
 * ## Where the data comes from
 * One call, `getPublicChrome(locale)`, resolves the brand strings, the contact
 * block, the social accounts and the real categories from `SiteSetting` and
 * `Category`, memoised for a minute. UI never touches Prisma directly (§5), and
 * §12.1 forbids hardcoding any of it.
 *
 * ## `<main id="contenu">`
 * The skip link installed by the locale layout points at this id, so it lives
 * here rather than in each page — one landmark, one target, no page able to
 * forget it.
 */

type LocaleParams = { locale: string };

export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [chrome, user, t] = await Promise.all([
    getPublicChrome(locale),
    getCurrentUser(),
    getTranslations({ locale }),
  ]);

  // A signed-in visitor gets one link instead of two calls to action. An
  // administrator is sent to the administration panel, everybody else to the
  // student space — which itself routes accounts that are still waiting for
  // their e-mail confirmation or for approval to the right screen (§9.1).
  const account =
    user === null
      ? null
      : isAdmin(user.role)
        ? { href: '/admin', label: t('nav.admin') }
        : { href: AUTH_ROUTES.home, label: t('nav.dashboard') };

  const whatsappMessage = t('whatsapp.prefillGeneric');

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        brandName={chrome.brandName}
        brandFullName={chrome.brandFullName}
        account={account}
      />

      <main id="contenu" className="flex-1">
        {children}
      </main>

      <SiteFooter
        brandFullName={chrome.brandFullName}
        tagline={chrome.tagline}
        contact={chrome.contact}
        socials={chrome.socials}
        categories={chrome.categories}
        whatsappMessage={whatsappMessage}
      />

      {/* §12.1 requires the button on every public page — but a wrong number is
          worse than no button, so it only mounts once one is configured and
          parseable. The bubble is shown on its first appearance per session. */}
      {chrome.contact.whatsappNumber === null ? null : (
        <WhatsAppFab
          phone={chrome.contact.whatsappNumber}
          message={whatsappMessage}
          label={t('whatsapp.fabLabel')}
          bubble={{ text: t('whatsapp.bubbleMessage'), dismissLabel: t('common.close') }}
        />
      )}
    </div>
  );
}
