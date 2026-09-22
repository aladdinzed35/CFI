import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  ArrowRight,
  Award,
  Clock,
  GraduationCap,
  Layers,
  MessageCircle,
  Route,
  Wallet,
} from 'lucide-react';

import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { PriceTag } from '@/components/ui/price-tag';
import { getPublicChrome } from '@/server/services/public-chrome';
import { getPublishedPaths, getSitemapIndex } from '@/server/services/public-pages';
import { breadcrumbListJsonLd, buildMetadata, jsonLdScript, webPageJsonLd } from '@/lib/seo';
import { formatDuration } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { dirFor, isLocale, locales } from '@/i18n/routing';

import { PageHero } from '../_components/page-hero';

/**
 * `/[locale]/parcours/[slug]` — one learning path, in full (§12.5).
 *
 * ## It did not exist
 * Every card on `/parcours`, the homepage band and the sitemap linked here, and
 * the URL fell through to the legal catch-all, which answers anything that is
 * not `/legal/*` with a 404. The copy had been written (`pages.paths.*` carries
 * the steps, the cumulative duration, the calls to action); the route had not.
 *
 * ## One read model, not two
 * The page is `getPublishedPaths(locale)` filtered by slug. The summary carries
 * everything the page shows — the courses in order with their duration and
 * price, the bundle and separate totals, the saving — so the index and the
 * detail cannot disagree on a price, and no second query exists to drift. A
 * path whose courses are all unpublished is dropped by that read model, so it
 * 404s here exactly as it disappears from the index.
 *
 * ## The saving is arithmetic
 * As on the index: `PriceTag` refuses to strike through a reference that does
 * not beat the price, and the « vous économisez » line only exists when
 * `savingCentimes > 0`. Otherwise the page says plainly that the bundle costs
 * the sum of its parts.
 *
 * ## Asking for it
 * Enrolment is per course (§9.2), so a path is requested on WhatsApp with the
 * path named in the message, and the page also offers the honest alternative:
 * start with the first course now. With no number configured the request goes
 * to the contact page instead of a dead button.
 */

type RouteParams = { locale: string; slug: string };

export async function generateStaticParams(): Promise<RouteParams[]> {
  const { paths } = await getSitemapIndex();
  const slugs = paths
    .map((entry) => entry.path.replace(/^\/parcours\//, ''))
    .filter((slug) => slug !== '' && !slug.includes('/'));
  return locales.flatMap((locale) => slugs.map((slug) => ({ locale, slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};

  const paths = await getPublishedPaths(locale);
  const path = paths.find((entry) => entry.slug === slug);
  if (path === undefined) return {};

  return buildMetadata({
    locale,
    path: `/parcours/${path.slug}`,
    title: path.title,
    description: path.description,
    image: path.coverUrl === null ? undefined : { url: path.coverUrl, alt: path.title },
  });
}

export default async function PathPage({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<React.JSX.Element> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [paths, t, tCourse, tWhatsapp, chrome] = await Promise.all([
    getPublishedPaths(locale),
    getTranslations({ locale, namespace: 'pages.paths' }),
    getTranslations({ locale, namespace: 'course' }),
    getTranslations({ locale, namespace: 'whatsapp' }),
    getPublicChrome(locale),
  ]);

  const path = paths.find((entry) => entry.slug === slug);
  if (path === undefined) notFound();

  const firstCourse = path.courses[0];
  const contentLang = path.resolvedLocale === locale ? undefined : path.resolvedLocale;
  const contentDir = path.resolvedLocale === locale ? undefined : dirFor(path.resolvedLocale);

  const whatsappHref =
    chrome.contact.whatsappNumber === null
      ? null
      : `https://wa.me/${chrome.contact.whatsappNumber}?text=${encodeURIComponent(
          tWhatsapp('prefillPath', { pathTitle: path.title }),
        )}`;

  // Running total after each step: « Cumul après cette étape ».
  const cumulative: number[] = [];
  path.courses.reduce((total, course) => {
    const next = total + course.durationMinutes;
    cumulative.push(next);
    return next;
  }, 0);

  const structuredData = jsonLdScript(
    webPageJsonLd({
      locale,
      path: `/parcours/${path.slug}`,
      name: path.title,
      description: path.description,
    }),
    breadcrumbListJsonLd(locale, [{ name: t('title'), path: '/parcours' }, { name: path.title }]),
  );

  const actionBase =
    'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md px-5 text-center text-body font-medium transition-colors duration-[120ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none';

  return (
    <>
      <PageHero
        id="path-hero"
        eyebrow={t('eyebrow')}
        title={path.title}
        lead={path.description}
        contentLang={contentLang}
        contentDir={contentDir}
        art={{ icon: Route, accents: [Award, GraduationCap] }}
        before={
          <Breadcrumbs
            label={t('breadcrumbLabel')}
            items={[{ label: t('title'), href: '/parcours' }, { label: path.title }]}
          />
        }
      >
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
          <dl className="contents">
            <div className="flex items-center gap-2">
              <dt>
                <Layers className="size-4 shrink-0 text-strait" aria-hidden="true" />
                <span className="sr-only">{t('includedCourses')}</span>
              </dt>
              <dd className="text-ink">{t('courseCount', { count: path.courses.length })}</dd>
            </div>
            {path.totalDurationMinutes === 0 ? null : (
              <div className="flex items-center gap-2">
                <dt className="flex items-center gap-2 text-ink-muted">
                  <Clock className="size-4 shrink-0 text-strait" aria-hidden="true" />
                  {t('totalDuration')}
                </dt>
                <dd className="text-ink" data-numeric>
                  <span className="force-ltr" dir="ltr">
                    {formatDuration(path.totalDurationMinutes, locale)}
                  </span>
                </dd>
              </div>
            )}
          </dl>
          {path.savingCentimes === 0 ? null : (
            <p className="inline-flex items-center gap-2 rounded-pill border border-brass/30 bg-brass-wash px-3 py-1 font-medium text-brass">
              <Wallet className="size-4 shrink-0" aria-hidden="true" />
              {t('saving', { amount: formatMoney(path.savingCentimes, locale) })}
            </p>
          )}
        </div>
      </PageHero>

      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-16">
          <div className="flex min-w-0 flex-col gap-14">
            {path.outcome === null ? null : (
              <section aria-labelledby="path-outcome" lang={contentLang} dir={contentDir}>
                <h2 id="path-outcome" className="text-title text-balance">
                  {t('outcomeTitle')}
                </h2>
                <p className="mt-4 max-w-[65ch] text-lead text-pretty text-ink-muted">
                  {path.outcome}
                </p>
              </section>
            )}

            <section aria-labelledby="path-steps">
              <h2 id="path-steps" className="text-title text-balance">
                {t('stepsTitle')}
              </h2>

              {/* The rail runs on the block axis, so it reads the same at 360 px
                  and mirrors wholesale in Arabic: the marker column is placed
                  with `start-*`, never `left-*`. */}
              <ol role="list" className="mt-8 flex flex-col">
                {path.courses.map((course, index) => {
                  const after = cumulative[index] ?? 0;

                  return (
                    <li key={course.slug} className="relative flex gap-4 pb-6 sm:gap-6">
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 start-[1.375rem] top-11 w-px bg-hairline"
                      />
                      <span
                        aria-hidden="true"
                        data-numeric
                        className="relative z-10 inline-flex size-11 shrink-0 items-center justify-center rounded-pill border border-hairline bg-abyss text-sm text-strait"
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>

                      <div className="min-w-0 flex-1 rounded-lg border border-hairline bg-surface p-5 sm:p-6">
                        <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
                          {t('stepLabel', { number: index + 1 })}
                        </p>
                        <h3 className="mt-2 text-heading font-medium text-ink text-balance">
                          {course.title}
                        </h3>

                        <dl className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                          {course.durationMinutes === 0 ? null : (
                            <div className="flex items-center gap-2">
                              <dt>
                                <Clock
                                  className="size-4 shrink-0 text-ink-muted"
                                  aria-hidden="true"
                                />
                                <span className="sr-only">{tCourse('meta.duration')}</span>
                              </dt>
                              <dd className="text-ink" data-numeric>
                                <span className="force-ltr" dir="ltr">
                                  {formatDuration(course.durationMinutes, locale)}
                                </span>
                              </dd>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <dt className="sr-only">{tCourse('purchase.stickyPriceLabel')}</dt>
                            <dd className="font-medium text-brass" data-numeric>
                              <span className="force-ltr" dir="ltr">
                                {formatMoney(course.priceCentimes, locale)}
                              </span>
                            </dd>
                          </div>
                        </dl>

                        <div className="mt-5 flex flex-col gap-3 border-t border-hairline pt-4 sm:flex-row sm:items-center sm:justify-between">
                          {after === 0 || index === 0 ? (
                            <span className="hidden sm:block" />
                          ) : (
                            <p className="text-xs text-ink-muted">
                              {t('cumulativeAfter', { duration: formatDuration(after, locale) })}
                            </p>
                          )}
                          <Link
                            href={`/formations/${course.slug}`}
                            className="inline-flex min-h-11 items-center gap-2 self-start rounded-pill border border-hairline px-4 text-sm font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none sm:self-auto"
                          >
                            {t('seeCourse')}
                            <span className="sr-only">{` : ${course.title}`}</span>
                            <ArrowRight
                              className="size-4 shrink-0 rtl:-scale-x-100"
                              aria-hidden="true"
                            />
                          </Link>
                        </div>
                      </div>
                    </li>
                  );
                })}

                <li className="relative flex gap-4 sm:gap-6">
                  <span className="relative z-10 inline-flex size-11 shrink-0 items-center justify-center rounded-pill border border-brass bg-brass-wash">
                    {/* A medal is symmetric: never mirrored. */}
                    <Award className="size-5 text-brass" aria-hidden="true" />
                  </span>
                  <div className="flex min-h-11 min-w-0 flex-1 items-center rounded-lg border border-brass/30 bg-brass-wash px-5 py-4 sm:px-6">
                    <p className="text-body font-medium text-brass">{t('certificateStep')}</p>
                  </div>
                </li>
              </ol>
            </section>
          </div>

          {/* The offer. Sticky beside the steps on a desktop, after them on a
              phone — the steps are what the price buys. */}
          <aside
            aria-labelledby="path-offer"
            className="rounded-lg border border-hairline bg-surface p-6 shadow-e2 sm:p-8 lg:sticky lg:top-24"
          >
            <h2
              id="path-offer"
              className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted"
            >
              {t('bundlePrice')}
            </h2>
            <PriceTag
              className="mt-3"
              centimes={path.bundlePriceCentimes}
              compareAtCentimes={path.separatePriceCentimes}
              locale={locale}
              size="xl"
              compareAtSrLabel={t('separatePrice', {
                price: formatMoney(path.separatePriceCentimes, locale),
              })}
            />
            <p
              className={
                path.savingCentimes > 0
                  ? 'mt-3 text-sm font-medium text-brass'
                  : 'mt-3 text-sm text-pretty text-ink-muted'
              }
            >
              {path.savingCentimes > 0
                ? t('saving', { amount: formatMoney(path.savingCentimes, locale) })
                : t('savingNone')}
            </p>

            <div className="mt-6 flex flex-col gap-3">
              {whatsappHref === null ? (
                <Link
                  href="/contact"
                  className={`${actionBase} bg-strait text-on-accent shadow-e1 hover:bg-strait/90`}
                >
                  {t('cta')}
                </Link>
              ) : (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${actionBase} bg-strait text-on-accent shadow-e1 hover:bg-strait/90`}
                >
                  <MessageCircle className="size-5 shrink-0" aria-hidden="true" />
                  {t('ctaWhatsapp')}
                </a>
              )}

              {firstCourse === undefined ? null : (
                <Link
                  href={`/formations/${firstCourse.slug}`}
                  className={`${actionBase} border border-hairline bg-raised py-2.5 text-ink hover:bg-abyss`}
                >
                  <span className="min-w-0 text-pretty">
                    {t('ctaFirstCourse', { title: firstCourse.title })}
                  </span>
                </Link>
              )}
            </div>

            <p className="mt-5 border-t border-hairline pt-5 text-sm text-pretty text-ink-muted">
              {t('ctaNote')}
            </p>
          </aside>
        </div>
      </div>

      {structuredData === null ? null : (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      )}
    </>
  );
}
