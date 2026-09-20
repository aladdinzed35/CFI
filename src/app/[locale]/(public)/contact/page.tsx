import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Clock, Mail, MapPin, MessageCircle, Phone, type LucideIcon } from 'lucide-react';

import { LazyMap } from '@/components/public/home/lazy-map';
import { Button } from '@/components/ui/button';
import { getPublicChrome } from '@/server/services/public-chrome';
import { getCourseOptions } from '@/server/services/public-pages';
import { buildMetadata, jsonLdScript, webPageJsonLd } from '@/lib/seo';
import { cn } from '@/lib/cn';
import { isLocale, locales } from '@/i18n/routing';

import { PageHero } from '../parcours/_components/page-hero';

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

  const [chrome, courses, t, tFooter, tRoot, tSeo] = await Promise.all([
    getPublicChrome(locale),
    getCourseOptions(locale),
    getTranslations({ locale, namespace: 'pages.contact' }),
    getTranslations({ locale, namespace: 'footer' }),
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
    <>
      <PageHero
        id="contact-hero"
        eyebrow={tFooter('contactUs')}
        title={t('title')}
        lead={t('lead')}
        art={{ icon: MessageCircle, accents: [MapPin, Mail] }}
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        {/* The fastest route in, and the one the centre actually watches. */}
        {whatsappHref === null ? null : (
          <section
            aria-labelledby="contact-whatsapp"
            className="flex flex-col gap-5 rounded-lg border border-strait/30 bg-strait-wash p-6 sm:p-8 md:flex-row md:items-center md:justify-between md:gap-10"
          >
            <div className="flex min-w-0 items-start gap-4">
              <span
                aria-hidden="true"
                className="grid size-12 shrink-0 place-items-center rounded-md border border-strait/30 bg-surface text-strait shadow-e1"
              >
                <MessageCircle className="size-6" />
              </span>
              <div className="flex min-w-0 flex-col gap-2">
                <h2 id="contact-whatsapp" className="text-heading text-balance">
                  {t('whatsappTitle')}
                </h2>
                <p className="max-w-[60ch] text-body text-pretty text-ink-muted">
                  {t('whatsappBody')}
                </p>
              </div>
            </div>

            <Button asChild size="lg" className="w-full shrink-0 md:w-auto">
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                {t('whatsappCta')}
              </a>
            </Button>
          </section>
        )}

        <div
          className={cn(
            'grid gap-12 lg:items-start lg:gap-16',
            whatsappHref === null ? null : 'mt-12 sm:mt-16',
            hasCoordinates ? 'lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]' : null,
          )}
        >
          <section
            aria-labelledby="contact-form"
            className={cn(
              'flex min-w-0 flex-col gap-6 rounded-lg border border-hairline bg-surface p-5 shadow-e1 sm:p-8',
              // Alone on the row, a form stretched to 1100 px is unreadable.
              hasCoordinates ? null : 'lg:max-w-3xl',
            )}
          >
            <div className="flex flex-col gap-2">
              <h2 id="contact-form" className="text-heading text-balance">
                {t('formTitle')}
              </h2>
              <p className="text-body text-pretty text-ink-muted">{t('formLead')}</p>
            </div>

            <ContactForm locale={locale} courses={courses} whatsappHref={whatsappHref} />
          </section>

          {!hasCoordinates ? null : (
            <section
              aria-labelledby="contact-info"
              className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24"
            >
              <h2 id="contact-info" className="text-heading text-balance">
                {t('infoTitle')}
              </h2>

              {/* Two columns on a tablet, where the full width is a lot of
                  width for four short facts; one beside the form on a desktop. */}
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                {contact.address === null ? null : (
                  <ContactFact icon={MapPin} label={t('addressLabel')}>
                    <span className="text-pretty text-ink-muted">{contact.address}</span>
                  </ContactFact>
                )}

                {contact.hours === null ? null : (
                  <ContactFact icon={Clock} label={t('hoursLabel')}>
                    <span className="text-pretty text-ink-muted">{contact.hours}</span>
                  </ContactFact>
                )}

                {contact.phoneE164 === null || contact.phoneDisplay === null ? null : (
                  <ContactFact icon={Phone} label={t('phoneLabel')}>
                    {/* A number is Latin script and stays LTR inside Arabic (§10.3). */}
                    <a
                      href={`tel:${contact.phoneE164}`}
                      dir="ltr"
                      className="force-ltr inline-flex min-h-6 items-center text-ink underline-offset-4 hover:underline"
                    >
                      {contact.phoneDisplay}
                    </a>
                  </ContactFact>
                )}

                {contact.email === null ? null : (
                  <ContactFact icon={Mail} label={t('emailLabel')}>
                    <a
                      href={`mailto:${contact.email}`}
                      dir="ltr"
                      className="force-ltr inline-flex min-h-6 max-w-full items-center break-all text-ink underline-offset-4 hover:underline"
                    >
                      {contact.email}
                    </a>
                  </ContactFact>
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
      </div>

      {structuredData === null ? null : (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      )}
    </>
  );
}

/** One coordinate: an icon tile, the label, the value. */
function ContactFact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border border-hairline bg-surface p-4">
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-md bg-strait-wash text-strait"
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <dt className="text-sm font-medium text-ink">{label}</dt>
        <dd className="mt-0.5 text-sm">{children}</dd>
      </div>
    </div>
  );
}
