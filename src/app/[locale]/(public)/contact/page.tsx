import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Clock, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';

import { LazyMap } from '@/components/public/home/lazy-map';
import { Button } from '@/components/ui/button';
import { getPublicChrome } from '@/server/services/public-chrome';
import { getCourseOptions } from '@/server/services/public-pages';
import { buildMetadata, jsonLdScript, webPageJsonLd } from '@/lib/seo';
import { isLocale, locales } from '@/i18n/routing';

import { ContactForm } from './contact-form';

/**
 * `/[locale]/contact` — §12.5.
 *
 * ## WhatsApp first, the form second
 * The brief is explicit that the centre's real inbox is WhatsApp: « the main
 * Contact / Nous contacter buttons across the site open WhatsApp directly …
 * with the form as the secondary path for people who prefer email ». So the
 * WhatsApp panel comes first and is the primary call to action, and the form
 * — which is a real form, not a decoy — sits under it for everyone who would
 * rather write than chat. Neither one is hidden behind the other.
 *
 * ## Every fact comes from `SiteSetting`
 * The address, the hours, the phone number, the e-mail and the WhatsApp number
 * are read through `getPublicChrome`, which §12.1 requires: they are edited from
 * the admin (§17.12) and hardcoding any of them would mean a moved centre or a
 * changed number could only be fixed by a deploy. A value that is not
 * configured renders nothing rather than an empty line, and a WhatsApp number
 * that does not parse removes the panel entirely — a wrong number is worse than
 * no button.
 *
 * ## The map costs nothing until it is asked for
 * `LazyMap` renders a placeholder that reserves the final height and says
 * plainly where the embed comes from; Google's script and its cookies are
 * loaded only after a click. That is both the §21 performance budget and the
 * §20 « no third-party script the visitor did not ask for » posture. The plain
 * « Itinéraire » link works with no JavaScript, no consent and no embed.
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
    path: '/contact',
    title: t('contact.title'),
    description: t('contact.description'),
    image: { url: '/brand/og-default.png', alt: t('ogAlt.contact') },
  });
}

export default async function ContactPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [chrome, courses, t, tRoot, tSeo] = await Promise.all([
    getPublicChrome(locale),
    getCourseOptions(locale),
    getTranslations({ locale, namespace: 'pages.contact' }),
    getTranslations({ locale }),
    getTranslations({ locale, namespace: 'seo.contact' }),
  ]);

  const { contact } = chrome;

  const whatsappHref =
    contact.whatsappNumber === null
      ? null
      : `https://wa.me/${contact.whatsappNumber}?text=${encodeURIComponent(
          tRoot('whatsapp.prefillGeneric'),
        )}`;

  const hasCoordinates =
    contact.address !== null ||
    contact.hours !== null ||
    contact.phoneE164 !== null ||
    contact.email !== null;

  const structuredData = jsonLdScript(
    webPageJsonLd({
      locale,
      path: '/contact',
      name: t('title'),
      description: tSeo('description'),
      type: 'ContactPage',
    }),
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-3">
        <h1 className="text-title text-balance">{t('title')}</h1>
        <p className="max-w-2xl text-lead text-pretty text-ink-muted">{t('lead')}</p>
      </header>

      {/* The fastest route in, and the one the centre actually watches. */}
      {whatsappHref === null ? null : (
        <section
          aria-labelledby="contact-whatsapp"
          className="mt-8 flex flex-col gap-4 rounded-lg border border-strait/30 bg-strait-wash p-6 sm:p-8"
        >
          <div className="flex items-start gap-3">
            <MessageCircle className="mt-1 size-6 shrink-0 text-strait" aria-hidden="true" />
            <div className="flex flex-col gap-2">
              <h2 id="contact-whatsapp" className="text-heading text-balance">
                {t('whatsappTitle')}
              </h2>
              <p className="max-w-2xl text-body text-pretty text-ink-muted">{t('whatsappBody')}</p>
            </div>
          </div>

          <Button asChild size="lg" className="self-start">
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
              {t('whatsappCta')}
            </a>
          </Button>
        </section>
      )}

      <div className="mt-12 grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:items-start lg:gap-16">
        <section aria-labelledby="contact-form" className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 id="contact-form" className="text-heading text-balance">
              {t('formTitle')}
            </h2>
            <p className="text-body text-pretty text-ink-muted">{t('formLead')}</p>
          </div>

          <ContactForm locale={locale} courses={courses} whatsappHref={whatsappHref} />
        </section>

        {!hasCoordinates ? null : (
          <section aria-labelledby="contact-info" className="flex flex-col gap-6">
            <h2 id="contact-info" className="text-heading text-balance">
              {t('infoTitle')}
            </h2>

            <dl className="flex flex-col gap-4">
              {contact.address === null ? null : (
                <div className="flex items-start gap-3">
                  <MapPin className="mt-0.5 size-5 shrink-0 text-strait" aria-hidden="true" />
                  <div>
                    <dt className="text-sm font-medium text-ink">{t('addressLabel')}</dt>
                    <dd className="mt-0.5 text-sm text-pretty text-ink-muted">{contact.address}</dd>
                  </div>
                </div>
              )}

              {contact.hours === null ? null : (
                <div className="flex items-start gap-3">
                  <Clock className="mt-0.5 size-5 shrink-0 text-strait" aria-hidden="true" />
                  <div>
                    <dt className="text-sm font-medium text-ink">{t('hoursLabel')}</dt>
                    <dd className="mt-0.5 text-sm text-pretty text-ink-muted">{contact.hours}</dd>
                  </div>
                </div>
              )}

              {contact.phoneE164 === null || contact.phoneDisplay === null ? null : (
                <div className="flex items-start gap-3">
                  <Phone className="mt-0.5 size-5 shrink-0 text-strait" aria-hidden="true" />
                  <div>
                    <dt className="text-sm font-medium text-ink">{t('phoneLabel')}</dt>
                    <dd className="mt-0.5 text-sm">
                      {/* A number is Latin script and stays LTR inside Arabic (§10.3). */}
                      <a
                        href={`tel:${contact.phoneE164}`}
                        dir="ltr"
                        className="force-ltr text-ink underline-offset-4 hover:underline"
                      >
                        {contact.phoneDisplay}
                      </a>
                    </dd>
                  </div>
                </div>
              )}

              {contact.email === null ? null : (
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 size-5 shrink-0 text-strait" aria-hidden="true" />
                  <div>
                    <dt className="text-sm font-medium text-ink">{t('emailLabel')}</dt>
                    <dd className="mt-0.5 text-sm">
                      <a
                        href={`mailto:${contact.email}`}
                        dir="ltr"
                        className="force-ltr text-ink underline-offset-4 hover:underline"
                      >
                        {contact.email}
                      </a>
                    </dd>
                  </div>
                </div>
              )}
            </dl>

            {contact.address === null ? null : (
              <LazyMap
                address={contact.address}
                cta={t('mapCta')}
                notice={t('mapNotice')}
                frameTitle={t('mapTitle')}
                directionsLabel={t('directions')}
              />
            )}
          </section>
        )}
      </div>

      {structuredData === null ? null : (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      )}
    </div>
  );
}
