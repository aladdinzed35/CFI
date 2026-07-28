import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight, Clock, Mail, MapPin, Phone, ShieldCheck } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { getCentreFigures, getInstructors } from '@/server/services/public-pages';
import { getPublicChrome } from '@/server/services/public-chrome';
import { buildMetadata } from '@/lib/seo';
import { Link } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';

/**
 * `/[locale]/a-propos` — the centre's story, its team and its address (§12.5).
 *
 * ## Real rows, or nothing
 *
 * The address, the hours, the phone and the e-mail are `SiteSetting` values read
 * through `getPublicChrome`; the figures are `COUNT`s on real tables; the team is
 * `User` rows with at least one published course. A missing setting removes its
 * line, a zero figure removes its tile, and an empty team removes the whole
 * block — §12.2's rule about not inventing a proof, applied to an "about" page
 * where the temptation to round up is strongest.
 *
 * ## Why the story lives in the message catalogue
 *
 * It is copy, not data: it must exist in four locales, French is the source
 * (§10.2), and it has no row in the schema. It sits in `pages.about.story`
 * alongside the mission and the values, so a translator edits prose in one place
 * instead of chasing it through JSX.
 */

const VALUES = ['honesty', 'practice', 'proximity', 'followUp'] as const;
const STORY = ['p1', 'p2', 'p3'] as const;

/** How many faces the preview shows before deferring to `/formateurs`. */
const TEAM_PREVIEW = 4;

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

  const t = await getTranslations({ locale, namespace: 'seo.about' });
  return buildMetadata({
    locale,
    path: '/a-propos',
    title: t('title'),
    description: t('description'),
  });
}

export default async function AboutPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [t, tContact, tInstructors, tWhatsapp, chrome, figures, instructors] = await Promise.all([
    getTranslations({ locale, namespace: 'pages.about' }),
    getTranslations({ locale, namespace: 'pages.contact' }),
    getTranslations({ locale, namespace: 'pages.instructors' }),
    getTranslations({ locale, namespace: 'whatsapp' }),
    getPublicChrome(locale),
    getCentreFigures(),
    getInstructors(locale),
  ]);

  const team = instructors.slice(0, TEAM_PREVIEW);

  // A figure that is still zero is not a proof; it is an admission. Drop it.
  const figureTiles = (
    [
      { key: 'courses', value: figures.publishedCourses },
      { key: 'instructors', value: figures.instructors },
      { key: 'categories', value: figures.categories },
      { key: 'learners', value: figures.learners },
    ] as const
  ).filter((tile) => tile.value > 0);

  const numberFormat = new Intl.NumberFormat(locale);

  const whatsappHref =
    chrome.contact.whatsappNumber === null
      ? null
      : `https://wa.me/${chrome.contact.whatsappNumber}?text=${encodeURIComponent(
          tWhatsapp('prefillVisit'),
        )}`;

  const hasContactBlock =
    chrome.contact.address !== null ||
    chrome.contact.hours !== null ||
    chrome.contact.phoneE164 !== null ||
    chrome.contact.email !== null;

  return (
    <>
      {/* ------------------------------------------------------------ header */}
      <header className="mx-auto w-full max-w-6xl px-4 pb-4 pt-12 sm:px-6 sm:pb-8 sm:pt-20">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">{t('eyebrow')}</p>
        <h1 className="mt-4 max-w-[18ch] text-hero text-balance">{t('title')}</h1>
        <p className="mt-6 max-w-[62ch] text-lead text-pretty text-ink-muted">{t('lead')}</p>
      </header>

      {/* ------------------------------------------------- story and mission */}
      <section
        aria-labelledby="about-story"
        className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20"
      >
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:items-start">
          <div>
            <h2 id="about-story" className="text-display text-balance">
              {t('storyTitle')}
            </h2>
            <div className="mt-6 flex max-w-[62ch] flex-col gap-4 text-body text-pretty text-ink-muted">
              {STORY.map((paragraph) => (
                <p key={paragraph}>{t(`story.${paragraph}`)}</p>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-hairline bg-surface p-6 sm:p-8">
            <h2 className="text-heading font-medium text-ink">{t('missionTitle')}</h2>
            <p className="mt-4 text-body text-pretty text-ink-muted">{t('missionBody')}</p>
            {chrome.tagline === null ? null : (
              <p className="mt-6 border-t border-hairline pt-5 font-display text-lead text-strait text-pretty">
                {chrome.tagline}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- figures */}
      {figureTiles.length === 0 ? null : (
        <section aria-labelledby="about-figures" className="border-y border-hairline bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <h2 id="about-figures" className="text-display text-balance">
              {t('figuresTitle')}
            </h2>

            <dl className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {figureTiles.map((tile) => (
                <div
                  key={tile.key}
                  className="rounded-lg border border-hairline bg-abyss p-6 text-start"
                >
                  <dt className="text-sm text-ink-muted">{t(`figures.${tile.key}`)}</dt>
                  <dd className="mt-3 font-display text-title font-medium text-ink" data-numeric>
                    <span className="force-ltr" dir="ltr">
                      {numberFormat.format(tile.value)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ values */}
      <section
        aria-labelledby="about-values"
        className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20"
      >
        <h2 id="about-values" className="text-display text-balance">
          {t('valuesTitle')}
        </h2>

        <ul
          role="list"
          className="mt-10 grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-2"
        >
          {VALUES.map((value) => (
            <li key={value} className="bg-surface p-6 sm:p-8">
              <h3 className="text-heading font-medium text-ink text-balance">
                {t(`values.${value}.title`)}
              </h3>
              <p className="mt-3 text-body text-pretty text-ink-muted">{t(`values.${value}.body`)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* -------------------------------------------------------------- team */}
      {team.length === 0 ? null : (
        <section aria-labelledby="about-team" className="border-y border-hairline bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <h2 id="about-team" className="text-display text-balance">
              {t('teamTitle')}
            </h2>
            <p className="mt-5 max-w-[62ch] text-lead text-pretty text-ink-muted">{t('teamLead')}</p>

            <ul role="list" className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {team.map((instructor) => (
                <li
                  key={instructor.id}
                  className="flex flex-col items-start rounded-lg border border-hairline bg-abyss p-6"
                >
                  <Avatar name={instructor.fullName} src={instructor.avatarUrl} size="xl" />
                  <h3 className="mt-5 text-body font-medium text-ink">{instructor.fullName}</h3>
                  {instructor.headline === null ? null : (
                    <p className="mt-2 text-sm text-pretty text-ink-muted">{instructor.headline}</p>
                  )}
                  <div className="mt-auto pt-5">
                    <Badge tone="neutral" variant="outline">
                      {tInstructors('courseCount', { count: instructor.courseCount })}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-8">
              <Link
                href="/formateurs"
                className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-hairline px-5 text-sm font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none"
              >
                {t('teamCta')}
                <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------- premises */}
      <section
        aria-labelledby="about-centre"
        className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20"
      >
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <div>
            <h2 id="about-centre" className="text-display text-balance">
              {t('centerTitle')}
            </h2>
            <p className="mt-6 max-w-[62ch] text-body text-pretty text-ink-muted">
              {t('centerBody')}
            </p>
          </div>

          {hasContactBlock ? (
            <dl className="flex flex-col gap-5 rounded-lg border border-hairline bg-surface p-6 sm:p-8">
              {chrome.contact.address === null ? null : (
                <div className="flex items-start gap-3">
                  <MapPin className="mt-0.5 size-5 shrink-0 text-strait" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-sm font-medium text-ink">{tContact('addressLabel')}</dt>
                    <dd className="mt-0.5 text-sm text-pretty text-ink-muted">
                      {chrome.contact.address}
                    </dd>
                  </div>
                </div>
              )}

              {chrome.contact.hours === null ? null : (
                <div className="flex items-start gap-3">
                  <Clock className="mt-0.5 size-5 shrink-0 text-strait" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-sm font-medium text-ink">{tContact('hoursLabel')}</dt>
                    <dd className="mt-0.5 text-sm text-pretty text-ink-muted">
                      {chrome.contact.hours}
                    </dd>
                  </div>
                </div>
              )}

              {chrome.contact.phoneE164 === null || chrome.contact.phoneDisplay === null ? null : (
                <div className="flex items-start gap-3">
                  <Phone className="mt-0.5 size-5 shrink-0 text-strait" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-sm font-medium text-ink">{tContact('phoneLabel')}</dt>
                    <dd className="mt-0.5 text-sm">
                      {/* A phone number is Latin script and stays LTR (§10.3). */}
                      <a
                        href={`tel:${chrome.contact.phoneE164}`}
                        dir="ltr"
                        className="force-ltr text-ink underline-offset-4 hover:underline"
                      >
                        {chrome.contact.phoneDisplay}
                      </a>
                    </dd>
                  </div>
                </div>
              )}

              {chrome.contact.email === null ? null : (
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 size-5 shrink-0 text-strait" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-sm font-medium text-ink">{tContact('emailLabel')}</dt>
                    <dd className="mt-0.5 break-words text-sm">
                      <a
                        href={`mailto:${chrome.contact.email}`}
                        dir="ltr"
                        className="force-ltr text-ink underline-offset-4 hover:underline"
                      >
                        {chrome.contact.email}
                      </a>
                    </dd>
                  </div>
                </div>
              )}
            </dl>
          ) : null}
        </div>
      </section>

      {/* ---------------------------------------------------- accreditations */}
      <section
        aria-labelledby="about-accreditations"
        className="mx-auto w-full max-w-6xl px-4 pb-14 sm:px-6 sm:pb-20"
      >
        <h2 id="about-accreditations" className="text-heading font-medium text-ink">
          {t('accreditationsTitle')}
        </h2>
        <p className="mt-4 flex max-w-[62ch] items-start gap-3 rounded-lg border border-hairline bg-surface p-6 text-body text-pretty text-ink-muted">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ink-muted" aria-hidden="true" />
          <span>{t('accreditationsEmpty')}</span>
        </p>
      </section>

      {/* --------------------------------------------------------------- cta */}
      {whatsappHref === null ? null : (
        <section aria-labelledby="about-cta" className="texture-bathymetric hairline-t">
          <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
            <h2 id="about-cta" className="max-w-2xl text-title text-balance">
              {t('ctaTitle')}
            </h2>
            <p className="max-w-xl text-lead text-pretty text-ink-muted">{t('ctaBody')}</p>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-strait px-6 text-body font-medium text-on-accent shadow-e1 transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-strait/90 motion-reduce:transition-none"
            >
              {t('ctaAction')}
            </a>
          </div>
        </section>
      )}
    </>
  );
}
