import { Check, Star } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import {
  CATALOG_DURATION_BANDS,
  CATALOG_PRICE_BANDS,
  DELIVERY_MESSAGE_KEY,
  LEVEL_MESSAGE_KEY,
  clearFilters,
  hasActiveFilters,
  isFilterActive,
  serializeFilters,
  toggleFilter,
  type CatalogDimension,
  type CatalogFilters,
} from '@/server/services/catalog/filters';
import type { CatalogFacets, FacetOption } from '@/server/services/catalog/queries';

/**
 * The catalogue's filters (§12.3) — one implementation, two containers.
 *
 * `FilterGroups` is the body. `FilterRail` is the desktop left rail that wraps
 * it; `FilterSheet` (its own file, the only client component in the catalogue)
 * is the mobile bottom sheet that wraps the very same element. There is no
 * second set of filter markup and no `useMediaQuery`: the sheet receives this
 * Server Component as `children`, so both containers are guaranteed to offer
 * the same options, the same counts and the same links.
 *
 * ## Every option is a link
 * Not a checkbox, not a piece of client state — an `<a>` pointing at the URL
 * that applying the filter produces, built by `toggleFilter` +
 * `serializeFilters`. That buys four things at once: the catalogue works with
 * JavaScript disabled, the back button undoes exactly one filter, a filtered
 * view can be pasted into WhatsApp, and a crawler can walk the facets. It is
 * also why this file ships no client JavaScript at all.
 *
 * The selected state is carried by `aria-current="true"` plus a checkmark —
 * a shape, never colour alone (§7).
 *
 * ## Zero counts grey out, they never disappear
 * §12.3 is explicit, and it is the right call: an option that vanishes when it
 * reaches zero takes the user's mental model with it. A zero-count option
 * renders as an inert `<span aria-disabled>` in the same slot, at the same
 * height, so the group never reflows. A *selected* option is never disabled,
 * whatever its count — it has to stay removable.
 */

/* -------------------------------------------------------------------------- */
/* One option                                                                  */
/* -------------------------------------------------------------------------- */

const ROW_CLASSES =
  'flex min-h-11 w-full items-center gap-3 rounded-sm px-2 py-1.5 text-start text-sm';

interface OptionRowProps {
  readonly href: string;
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly disabled: boolean;
  /** Rendered before the label — the stars of the rating group. */
  readonly adornment?: React.ReactNode;
}

function OptionRow({
  href,
  label,
  count,
  active,
  disabled,
  adornment,
}: OptionRowProps): React.JSX.Element {
  const box = (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-sm border transition-colors duration-[120ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none',
        active ? 'border-strait bg-strait text-on-accent' : 'border-hairline bg-surface',
      )}
    >
      {active ? <Check className="size-3.5" strokeWidth={3} /> : null}
    </span>
  );

  const body = (
    <>
      {box}
      {adornment}
      <span className={cn('min-w-0 flex-1 truncate', active && 'font-medium text-ink')}>
        {label}
      </span>
      <span
        data-numeric
        dir="ltr"
        className="force-ltr shrink-0 text-xs tabular-nums text-ink-muted"
      >
        {count}
      </span>
    </>
  );

  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(ROW_CLASSES, 'cursor-not-allowed text-ink-muted/55')}>
        {body}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        ROW_CLASSES,
        'text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none',
        'hover:bg-raised hover:text-ink',
        active && 'text-ink',
      )}
    >
      {body}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* One group                                                                   */
/* -------------------------------------------------------------------------- */

interface GroupProps {
  readonly id: string;
  readonly label: string;
  readonly children: React.ReactNode;
}

function Group({ id, label, children }: GroupProps): React.JSX.Element {
  return (
    <section aria-labelledby={id} className="border-b border-hairline pb-5 last:border-b-0 last:pb-0">
      <h3 id={id} className="mb-2 text-sm font-medium text-ink">
        {label}
      </h3>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The body                                                                    */
/* -------------------------------------------------------------------------- */

export interface FilterGroupsProps {
  readonly filters: CatalogFilters;
  readonly facets: CatalogFacets;
  readonly locale: Locale;
  /**
   * Disambiguates the heading ids when the rail and the sheet are both in the
   * document. Pass a different value to each container.
   */
  readonly idPrefix: string;
}

export async function FilterGroups({
  filters,
  facets,
  locale,
  idPrefix,
}: FilterGroupsProps): Promise<React.JSX.Element> {
  const t = await getTranslations('catalog');

  const hrefFor = (dimension: CatalogDimension, value: string): string =>
    serializeFilters(toggleFilter(filters, dimension, value));

  const rows = (
    dimension: CatalogDimension,
    options: readonly FacetOption[],
    label: (option: FacetOption) => string,
    adornment?: (option: FacetOption) => React.ReactNode,
  ): React.JSX.Element[] =>
    options.map((option) => {
      const active = isFilterActive(filters, dimension, option.value);
      return (
        <li key={option.value}>
          <OptionRow
            href={hrefFor(dimension, option.value)}
            label={label(option)}
            count={option.count}
            active={active}
            disabled={option.count === 0 && !active}
            adornment={adornment?.(option)}
          />
        </li>
      );
    });

  /** « Moins de 1 000 DH », « De 1 000 à 3 000 DH », « Plus de 6 000 DH ». */
  const priceLabel = (id: string): string => {
    const band = CATALOG_PRICE_BANDS.find((entry) => entry.id === id);
    if (band === undefined) return id;
    if (band.maxMad === 0) return t('filters.price.free');
    const min = formatMoney(band.minMad * 100, locale, { decimals: 'never' });
    if (band.maxMad === null) return t('filters.price.over', { min });
    const max = formatMoney(band.maxMad * 100, locale, { decimals: 'never' });
    return band.minMad === 0
      ? t('filters.price.under', { max })
      : t('filters.price.between', { min, max });
  };

  const durationLabel = (id: string): string => {
    const band = CATALOG_DURATION_BANDS.find((entry) => entry.id === id);
    if (band === undefined) return id;
    if (band.maxHours === null) return t('filters.duration.over', { hours: band.minHours });
    return band.minHours === 0
      ? t('filters.duration.under', { hours: band.maxHours })
      : t('filters.duration.between', { min: band.minHours, max: band.maxHours });
  };

  return (
    <div className="flex flex-col gap-5">
      {facets.categories.length > 0 ? (
        <Group id={`${idPrefix}-categorie`} label={t('filters.category.label')}>
          {facets.categories.map((option) => {
            const active = isFilterActive(filters, 'categories', option.value);
            return (
              <li key={option.value}>
                <OptionRow
                  href={hrefFor('categories', option.value)}
                  label={option.name}
                  count={option.count}
                  active={active}
                  disabled={option.count === 0 && !active}
                />
              </li>
            );
          })}
        </Group>
      ) : null}

      <Group id={`${idPrefix}-prix`} label={t('filters.price.label')}>
        {rows('price', facets.prices, (option) => priceLabel(option.value))}
      </Group>

      <Group id={`${idPrefix}-niveau`} label={t('filters.level.label')}>
        {rows('levels', facets.levels, (option) =>
          t(`filters.level.${LEVEL_MESSAGE_KEY[option.value as keyof typeof LEVEL_MESSAGE_KEY]}`),
        )}
      </Group>

      <Group id={`${idPrefix}-format`} label={t('filters.delivery.label')}>
        {rows('deliveries', facets.deliveries, (option) =>
          t(
            `filters.delivery.${
              DELIVERY_MESSAGE_KEY[option.value as keyof typeof DELIVERY_MESSAGE_KEY]
            }`,
          ),
        )}
      </Group>

      <Group id={`${idPrefix}-duree`} label={t('filters.duration.label')}>
        {rows('duration', facets.durations, (option) => durationLabel(option.value))}
      </Group>

      <Group id={`${idPrefix}-note`} label={t('filters.rating.label')}>
        {rows(
          'rating',
          facets.ratings,
          (option) => t('filters.rating.from', { stars: Number(option.value) }),
          (option) => <StarRow value={Number(option.value)} />,
        )}
      </Group>

      <Group id={`${idPrefix}-langue`} label={t('filters.language.label')}>
        {rows('languages', facets.languages, (option) => t(`filters.language.${option.value}`))}
      </Group>

      <Group id={`${idPrefix}-options`} label={t('filters.features.label')}>
        {rows('features', facets.features, (option) => t(`filters.features.${option.value}`))}
      </Group>
    </div>
  );
}

/**
 * The stars beside « 4 étoiles et plus ». Purely decorative: the text next to
 * them already says it, and a star has no reading direction, so it is never
 * mirrored in Arabic (§10.3).
 */
function StarRow({ value }: { value: number }): React.JSX.Element {
  const full = Math.floor(value);
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center gap-0.5">
      {Array.from({ length: 5 }, (_unused, index) => (
        <Star
          key={index}
          className={cn(
            'size-3.5',
            index < full ? 'fill-brass stroke-brass' : 'fill-none stroke-ink-muted/60',
          )}
          strokeWidth={1.75}
        />
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* The desktop rail                                                            */
/* -------------------------------------------------------------------------- */

export interface FilterRailProps extends FilterGroupsProps {
  /** Hidden below `lg`, where `FilterSheet` takes over. */
  readonly className?: string;
}

/**
 * The left rail. `sticky` with its own scroll container so a long facet list
 * never traps the page scroll, and `hidden lg:block` because below `lg` the
 * same groups live in the bottom sheet instead.
 */
export async function FilterRail({
  filters,
  facets,
  locale,
  idPrefix,
  className,
}: FilterRailProps): Promise<React.JSX.Element> {
  const t = await getTranslations('catalog');
  const canClear = hasActiveFilters(filters);

  return (
    <aside
      aria-label={t('filters.title')}
      className={cn('hidden w-64 shrink-0 lg:block xl:w-72', className)}
    >
      <div className="sticky top-24 max-h-[calc(100dvh-8rem)] overflow-y-auto pe-2">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lead font-medium text-ink">{t('filters.title')}</h2>
          {canClear ? (
            <Link
              href={serializeFilters(clearFilters(filters))}
              className="shrink-0 rounded-sm text-sm text-strait underline-offset-4 hover:underline"
            >
              {t('filters.clear')}
            </Link>
          ) : null}
        </div>

        <FilterGroups filters={filters} facets={facets} locale={locale} idPrefix={idPrefix} />
      </div>
    </aside>
  );
}
