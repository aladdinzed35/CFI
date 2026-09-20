import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Award, BadgeCheck, Info, QrCode } from 'lucide-react';

import { getPublicChrome } from '@/server/services/public-chrome';
import { buildMetadata, jsonLdScript, webPageJsonLd } from '@/lib/seo';
import { isLocale, locales } from '@/i18n/routing';

import { PageHero } from '../parcours/_components/page-hero';

import { VerifyCertificateForm } from './verify-form';

/**
 * `/[locale]/certificat` — public certificate verification (§12.5).
 *
 * ## The one page written for someone who does not trust us
 * Every other public page is addressed to a prospective student. This one is
 * addressed to an employer holding a printed certificate and wondering whether
 * it is genuine. That changes the design brief entirely: no marketing, no call
 * to action — a field, a button, and an answer that states plainly what it
 * means. The form column is narrow for the same reason a form is: there is
 * exactly one thing to do on it.
 *
 * The header band is the one every secondary page shares, so the page is
 * recognisably the centre's. Beside the form, from a tablet up, sits a drawn
 * specimen of the certificate with the code picked out where it is printed —
 * not decoration: « where do I find the code » is the question a first-time
 * verifier actually has. It is `aria-hidden`; the field's own hint says the
 * same thing in words.
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
    <>
      <PageHero
        id="certificate-hero"
        title={t('title')}
        lead={t('lead')}
        art={{ icon: BadgeCheck, accents: [Award, QrCode] }}
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_15rem] md:items-start lg:grid-cols-[minmax(0,42rem)_19rem] lg:justify-between">
          <div className="min-w-0">
            <section
              aria-label={t('codeLabel')}
              className="rounded-lg border border-hairline bg-surface p-5 shadow-e1 sm:p-8"
            >
              <VerifyCertificateForm locale={locale} whatsappHref={whatsappHref} />
            </section>

            <p className="mt-6 flex items-start gap-3 text-sm text-pretty text-ink-muted">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{t('scope')}</span>
            </p>
          </div>

          <CertificateSpecimen code={t('codePlaceholder')} className="hidden md:block" />
        </div>
      </div>

      {structuredData === null ? null : (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      )}
    </>
  );
}

/**
 * A certificate, drawn: the star, a title, lines of text, the stamp — and the
 * code, ringed, exactly where the field's hint says it is (« en bas du
 * certificat, sous le tampon »). Theme tokens only, so it retints with the
 * theme; the code keeps its own direction inside Arabic like every code does.
 */
function CertificateSpecimen({
  code,
  className,
}: {
  code: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div aria-hidden="true" className={className}>
      <div className="relative rotate-[-2deg] rounded-lg border border-brass/40 bg-surface p-3 shadow-e3 motion-reduce:rotate-0 rtl:rotate-[2deg]">
        <div className="flex flex-col items-center rounded-md border border-brass/30 px-4 pb-4 pt-5">
          <span className="grid size-10 place-items-center rounded-pill border border-brass/40 bg-brass-wash text-brass">
            <Award className="size-5" strokeWidth={1.75} />
          </span>

          <span className="mt-4 h-2.5 w-3/4 rounded-pill bg-ink/70" />
          <span className="mt-2 h-1.5 w-1/2 rounded-pill bg-hairline" />

          <span className="mt-5 h-3 w-2/3 rounded-pill bg-brass/60" />
          <span className="mt-4 h-1.5 w-full rounded-pill bg-hairline" />
          <span className="mt-2 h-1.5 w-5/6 rounded-pill bg-hairline" />
          <span className="mt-2 h-1.5 w-2/3 rounded-pill bg-hairline" />

          <div className="mt-6 flex w-full items-end justify-between gap-3">
            <span className="h-1.5 w-1/3 rounded-pill bg-hairline" />
            <span className="grid size-12 shrink-0 place-items-center rounded-pill border-2 border-dashed border-strait/50 text-strait">
              <BadgeCheck className="size-5" strokeWidth={1.75} />
            </span>
          </div>

          <span
            dir="ltr"
            className="force-ltr mt-4 rounded-sm px-2 py-1 font-mono text-[0.6875rem] tracking-[0.08em] text-ink ring-2 ring-strait ring-offset-2 ring-offset-surface"
          >
            {code}
          </span>
        </div>
      </div>
    </div>
  );
}
