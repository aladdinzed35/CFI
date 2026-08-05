import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SiteFooter } from '@/components/public/site-footer';
import { SiteHeader } from '@/components/public/site-header';
import { WhatsAppFab } from '@/components/ui/whatsapp-fab';

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
 * ## This layout reads no session, and that is the point
 * It used to call `getCurrentUser()` to decide one header link. Reading cookies
 * on the server opts the entire route out of static generation, so every public
 * page — the homepage, the catalogue, the legal pages — was rendered per
 * request and served `Cache-Control: no-store`, which is also what blocked the
 * back/forward cache. Eight routes in the whole build were prerendered.
 *
 * The header now ships all three account variants and reveals one from a
 * `data-chrome` attribute written before the first paint (`ThemeScript`, fed by
 * a display-only cookie from the middleware). Nothing here is per-visitor, so
 * these pages prerender and can be served from an edge.
 *
 * Anything genuinely per-visitor still reads the session in its own page — the
 * course page's call to action, for instance, which legitimately depends on
 * whether you are already enrolled.
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

  const [chrome, t] = await Promise.all([getPublicChrome(locale), getTranslations({ locale })]);

  const whatsappMessage = t('whatsapp.prefillGeneric');

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader brandName={chrome.brandName} brandFullName={chrome.brandFullName} />

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
