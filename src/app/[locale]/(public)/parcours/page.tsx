import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight, Award } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';
import { PriceTag } from '@/components/ui/price-tag';
import { getPublishedPaths } from '@/server/services/public-pages';
import { buildMetadata } from '@/lib/seo';
import { formatDuration } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';

/**
 * `/[locale]/parcours` — the learning paths (§12.5).
 *
 * A path is a *sequence*, so it is drawn as a rail: numbered nodes joined by a
 * hairline, ending on the certificate. The rail runs on the block axis, which is
 * why it reads identically at 360 px and at 1440 px and flips wholesale in
 * Arabic — the marker column is positioned with `start-*`, never with `left-*`.
 *
 * ## The saving is arithmetic, not a claim
 *
 * `separatePriceCentimes` is the sum of the member courses' current prices;
 * `bundlePriceCentimes` is `Path.priceCentimes`, falling back to that same sum
 * when no bundle price is set. `PriceTag` refuses to strike through a reference
 * that does not beat the price, so a path priced at or above its parts shows one
 * price and the « vous économisez » line disappears on its own. Nothing here can
 * advertise a discount the catalogue does not contain.
 *
 * A path whose courses are all unpublished never reaches this page: the read
 * model drops it rather than render an offer nobody can buy.
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

  const t = await getTranslations({ locale, namespace: 'seo.paths' });
  return buildMetadata({
    locale,
    path: '/parcours',
    title: t('title'),
    description: t('description'),
  });
}

export default async function PathsPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [t, paths] = await Promise.all([
    getTranslations({ locale, namespace: 'pages.paths' }),
    getPublishedPaths(locale),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">{t('eyebrow')}</p>
        <h1 className="mt-4 max-w-[18ch] text-hero text-balance">{t('title')}</h1>
        <p className="mt-6 max-w-[62ch] text-lead text-pretty text-ink-muted">{t('lead')}</p>
      </header>

      {paths.length === 0 ? (
        <div className="mt-16">
          <EmptyState
            title={t('empty.title')}
            description={t('empty.body')}
            action={
              <Link
                href="/formations"
                className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-strait px-5 text-sm font-medium text-on-accent"
              >
                {t('empty.action')}
                <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            }
          />
        </div>
      ) : (
        <ul role="list" className="mt-12 grid gap-6 lg:grid-cols-3">
          {paths.map((path) => (
            <li
              key={path.id}
              className="flex flex-col rounded-lg border border-hairline bg-surface p-6 sm:p-8"
            >
              <h2 className="text-heading font-medium text-ink text-balance">
                <Link
                  href={`/parcours/${path.slug}`}
                  className="transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-strait motion-reduce:transition-none"
                >
                  {path.title}
                </Link>
              </h2>

              <p className="mt-3 text-sm text-pretty text-ink-muted">{path.description}</p>

              {/* The rail: course → course → certificate. */}
              <ol role="list" className="mt-6 flex flex-col">
                {path.courses.map((course, index) => (
                  <li key={course.slug} className="relative flex gap-3 pb-5">
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0 start-[0.6875rem] top-7 w-px bg-hairline"
                    />
                    <span
                      aria-hidden="true"
                      data-numeric
                      className="relative z-10 mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-pill border border-hairline bg-abyss text-xs text-ink-muted"
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 text-sm text-pretty text-ink">
                      <span className="sr-only">{`${t('stepLabel', { number: index + 1 })} : `}</span>
                      {course.title}
                    </span>
                  </li>
                ))}

                <li className="relative flex gap-3">
                  <span className="relative z-10 mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-pill border border-brass bg-brass-wash">
                    {/* A medal is symmetric: never mirrored. */}
                    <Award className="size-3.5 text-brass" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 text-sm font-medium text-brass">
                    {t('certificateStep')}
                  </span>
                </li>
              </ol>

              <dl className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-hairline pt-5 text-sm">
                <div className="flex items-baseline gap-2">
                  <dt className="text-ink-muted">{t('courseCount', { count: path.courses.length })}</dt>
                </div>
                {path.totalDurationMinutes === 0 ? null : (
                  <div className="flex items-baseline gap-2">
                    <dt className="text-ink-muted">{t('totalDuration')}</dt>
                    <dd className="text-ink" data-numeric>
                      <span className="force-ltr" dir="ltr">
                        {formatDuration(path.totalDurationMinutes, locale)}
                      </span>
                    </dd>
                  </div>
                )}
              </dl>

              <div className="mt-auto pt-6">
                <p className="text-xs uppercase tracking-wide text-ink-muted">{t('bundlePrice')}</p>
                <PriceTag
                  className="mt-2"
                  centimes={path.bundlePriceCentimes}
                  compareAtCentimes={path.separatePriceCentimes}
                  locale={locale}
                  size="lg"
                  compareAtSrLabel={t('separatePrice', {
                    price: formatMoney(path.separatePriceCentimes, locale),
                  })}
                />
                {path.savingCentimes > 0 ? (
                  <p className="mt-2 text-sm font-medium text-brass">
                    {t('saving', { amount: formatMoney(path.savingCentimes, locale) })}
                  </p>
                ) : null}

                <Link
                  href={`/parcours/${path.slug}`}
                  className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-pill border border-hairline px-5 text-sm font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none"
                >
                  {t('seeDetail')}
                  <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
