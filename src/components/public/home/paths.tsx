import { getTranslations } from 'next-intl/server';
import { ArrowRight, Award } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { PriceTag } from '@/components/ui/price-tag';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoney } from '@/lib/money';
import { formatDuration } from '@/lib/dates';
import type { HomePath } from '@/server/services/home';
import type { Locale } from '@/i18n/routing';

/**
 * §12.2 §4 — « Parcours ».
 *
 * A path is a *sequence*, so it is drawn as a rail: numbered nodes joined by a
 * hairline, ending on the certificate. The rail runs on the block axis, which
 * means it works identically at 360 px and at 1440 px and — because the marker
 * column is positioned with `start-*` and the connector is `inset-inline-start`
 * — flips as a whole in Arabic without a single physical property.
 *
 * ## The saving is computed, never claimed
 *
 * `sumCentimes` is the real sum of the member courses' current prices and
 * `priceCentimes` the bundle price the admin entered. The struck-through
 * reference and the « −X % » pill come from `PriceTag`, which refuses to draw a
 * discount that does not exist, so a path priced at or above its parts simply
 * shows one price. Nothing here can advertise a saving the catalogue does not
 * actually contain.
 *
 * A path whose published courses number fewer than two never reaches this
 * component — the read model drops it, because a one-course "sequence" would be
 * a catalogue entry wearing a costume.
 */

export interface HomePathsProps {
  locale: Locale;
  paths: readonly HomePath[];
}

export async function HomePaths({ locale, paths }: HomePathsProps): Promise<React.JSX.Element> {
  const t = await getTranslations('home.paths');

  return (
    <section
      aria-labelledby="home-paths-title"
      className="border-y border-hairline bg-surface"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
              {t('sectionLabel')}
            </p>
            <h2 id="home-paths-title" className="mt-4 max-w-[18ch] text-display">
              {t('title')}
            </h2>
            <p className="mt-5 max-w-[62ch] text-lead text-ink-muted">{t('subtitle')}</p>
          </div>

          {paths.length === 0 ? null : (
            <Link
              href="/parcours"
              className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-hairline px-5 text-sm font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none"
            >
              {t('seeAll')}
              <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
            </Link>
          )}
        </div>

        {paths.length === 0 ? (
          <div className="mt-12">
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
            {paths.map((path) => {
              const bundle = path.priceCentimes ?? path.sumCentimes;
              const saving = path.sumCentimes - bundle;

              return (
                <li
                  key={path.id}
                  className="flex flex-col rounded-lg border border-hairline bg-abyss p-6"
                >
                  <h3 className="text-heading font-medium text-ink">
                    <Link
                      href={`/parcours/${path.slug}`}
                      className="transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-strait motion-reduce:transition-none"
                    >
                      {path.title}
                    </Link>
                  </h3>

                  <p className="mt-3 line-clamp-3 text-sm text-ink-muted">{path.description}</p>

                  {/* The rail. Numbered nodes, a hairline between them, the
                      certificate as the terminal node. */}
                  <ol role="list" className="mt-6 flex flex-col">
                    {path.steps.map((step, index) => (
                      <li key={step.slug} className="relative flex gap-3 pb-5">
                        <span
                          aria-hidden="true"
                          className="absolute bottom-0 start-[0.6875rem] top-7 w-px bg-hairline"
                        />
                        <span
                          aria-hidden="true"
                          className="relative z-10 mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-pill border border-hairline bg-surface text-xs text-ink-muted"
                          data-numeric
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 text-sm text-ink">
                          <span className="sr-only">{`${t('stepLabel', { number: index + 1 })} : `}</span>
                          {step.title}
                        </span>
                      </li>
                    ))}

                    <li className="relative flex gap-3">
                      <span className="relative z-10 mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-pill border border-brass bg-brass-wash">
                        {/* A medal is symmetric: not mirrored. */}
                        <Award className="size-3.5 text-brass" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 text-sm font-medium text-brass">
                        {t('certificateStep')}
                      </span>
                    </li>
                  </ol>

                  <dl className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-hairline pt-5 text-sm">
                    <div className="flex items-baseline gap-2">
                      <dt className="text-ink-muted">{t('courseCount', { count: path.steps.length })}</dt>
                    </div>
                    {path.durationMinutes > 0 ? (
                      <div className="flex items-baseline gap-2">
                        <dt className="text-ink-muted">{t('durationLabel')}</dt>
                        <dd className="text-ink" data-numeric>
                          <span className="force-ltr" dir="ltr">
                            {formatDuration(path.durationMinutes, locale)}
                          </span>
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  <div className="mt-auto pt-6">
                    <p className="text-xs uppercase tracking-wide text-ink-muted">
                      {t('bundleLabel')}
                    </p>
                    <PriceTag
                      className="mt-2"
                      centimes={bundle}
                      compareAtCentimes={path.sumCentimes}
                      locale={locale}
                      size="lg"
                    />
                    {saving > 0 ? (
                      <p className="mt-2 text-sm font-medium text-brass">
                        {t('savingLabel', { amount: formatMoney(saving, locale) })}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
