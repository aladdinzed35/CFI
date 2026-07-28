import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Info } from 'lucide-react';

import { getPublicChrome } from '@/server/services/public-chrome';
import { buildMetadata, jsonLdScript, webPageJsonLd } from '@/lib/seo';
import { isLocale, locales } from '@/i18n/routing';

import { VerifyCertificateForm } from './verify-form';

/**
 * `/[locale]/certificat` — public certificate verification (§12.5).
 *
 * ## The one page written for someone who does not trust us
 * Every other public page is addressed to a prospective student. This one is
 * addressed to an employer holding a printed certificate and wondering whether
 * it is genuine. That changes the design brief entirely: no marketing, no
 * illustration, no call to action — a field, a button, and an answer that states
 * plainly what it means. The page is narrow for the same reason a form is: there
 * is exactly one thing to do on it.
 *
 * ## What the check proves, said out loud
 * `scope` sits under the form because a verification tool that does not state
 * its own limits invites people to read more into it than it can support. It
 * confirms that the register contains a certificate carrying that code; it is
 * not an identity check and it is not a transcript.
 *
 * ## Everything below the field is the client's
 * The lookup runs through a server action rather than a route parameter, so the
 * page itself is static in all four locales and no code an employer types ever
 * lands in a URL, a referrer header or a server log line (§27). The only value
 * this component reads is the centre's WhatsApp number, which the two
 * unsuccessful states offer as the way to reach a human; when no number is
 * configured, the offer is absent rather than broken.
 */

type LocaleParams = { locale: string };

export function generateStaticParams(): LocaleParams[] {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'seo' });
  return buildMetadata({
    locale,
    path: '/certificat',
    title: t('certificate.title'),
    description: t('certificate.description'),
    image: { url: '/brand/og-default.png', alt: t('ogAlt.certificate') },
  });
}

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [t, tRoot, tSeo, chrome] = await Promise.all([
    getTranslations({ locale, namespace: 'pages.certificate' }),
    getTranslations({ locale }),
    getTranslations({ locale, namespace: 'seo.certificate' }),
    getPublicChrome(locale),
  ]);

  const whatsappHref =
    chrome.contact.whatsappNumber === null
      ? null
      : `https://wa.me/${chrome.contact.whatsappNumber}?text=${encodeURIComponent(
          tRoot('whatsapp.prefillCertificate'),
        )}`;

  const structuredData = jsonLdScript(
    webPageJsonLd({
      locale,
      path: '/certificat',
      name: t('title'),
      description: tSeo('description'),
    }),
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-3">
        <h1 className="text-title text-balance">{t('title')}</h1>
        <p className="text-lead text-pretty text-ink-muted">{t('lead')}</p>
      </header>

      <section
        aria-label={t('codeLabel')}
        className="mt-8 rounded-lg border border-hairline bg-surface p-6 sm:p-8"
      >
        <VerifyCertificateForm locale={locale} whatsappHref={whatsappHref} />
      </section>

      <p className="mt-6 flex items-start gap-3 text-sm text-pretty text-ink-muted">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{t('scope')}</span>
      </p>

      {structuredData === null ? null : (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      )}
    </div>
  );
}
