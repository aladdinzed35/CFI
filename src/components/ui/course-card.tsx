import Image from 'next/image';
import { Clock, Layers, Signal, Star } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';

/**
 * `CourseCard` (§11.3) — one implementation, three variants.
 *
 * - `grid`    the catalog and the bento on the homepage: cover on top, 16/9.
 * - `list`    the catalog's list mode and search results: cover beside the copy
 *             from `sm` upward, stacked below it on a 360 px phone.
 * - `compact` rails, "continuer", related courses: square thumbnail, one line
 *             of meta, no rating.
 *
 * The card renders. It does not fetch, does not translate, does not format:
 * every string arrives ready — prices through `@/lib/money`, durations through
 * `@/lib/dates`, labels through `next-intl` — because the same card is used by a
 * Server Component reading the database and by a client-side search result, and
 * only one of those can call a formatter.
 *
 * Zero CLS: the cover always lives in an explicit aspect-ratio box with
 * `next/image` `fill`, so the layout is final before the image byte one lands.
 */

export interface CourseCardMeta {
  /** Rendered text, already formatted and localized, e.g. « 4 h 25 min ». */
  value: string;
  /** Full accessible phrasing, e.g. « Durée : 4 heures 25 minutes ». */
  label: string;
}

export interface CourseCardImage {
  src: string;
  /** Never empty: a course cover carries meaning in a catalog. */
  alt: string;
  /** Base64 LQIP from the upload pipeline. Omitted → no blur placeholder. */
  blurDataURL?: string;
}

export interface CourseCardPrice {
  /** Formatted current price, e.g. « 1 200 MAD ». */
  current: string;
  /** Formatted compare-at price, struck through. */
  compareAt?: string;
  /** sr-only phrasing for the compare-at, e.g. « Prix initial ». */
  compareAtLabel?: string;
}

export interface CourseCardRating {
  /** Formatted score, e.g. « 4,8 ». */
  value: string;
  /** Formatted review count, e.g. « 126 ». */
  count?: string;
  /** Full accessible phrasing, e.g. « Note : 4,8 sur 5 — 126 avis ». */
  label: string;
}

export interface CourseCardProgress {
  /** 0…1. */
  ratio: number;
  /** Accessible name, e.g. « Progression dans la formation ». */
  label: string;
  /** Visible text, e.g. « 45 % ». */
  valueLabel: string;
}

export interface CourseCardBadge {
  text: string;
  /** `brass` is reserved for money and achievement (§11.2). */
  tone?: 'strait' | 'brass' | 'warn' | 'danger';
}

export type CourseCardVariant = 'grid' | 'list' | 'compact';

export interface CourseCardProps {
  /** Locale-relative href, e.g. `/formations/marketing-digital`. */
  href: string;
  title: string;
  image: CourseCardImage;
  variant?: CourseCardVariant;
  /** Category name, e.g. « Marketing ». */
  category?: string;
  level?: CourseCardMeta;
  duration?: CourseCardMeta;
  lessons?: CourseCardMeta;
  rating?: CourseCardRating;
  price?: CourseCardPrice;
  /**
   * Replaces the built-in price rendering. Drop a `<PriceTag />` here when the
   * caller already has the locale and the raw centimes: the card keeps its
   * i18n-agnostic contract and still gets the canonical money treatment.
   * Wins over `price` when both are given.
   */
  priceSlot?: React.ReactNode;
  /** Present only for an enrolled student — this is what makes the card "mine". */
  progress?: CourseCardProgress;
  badge?: CourseCardBadge;
  /** `next/image` sizes hint. Defaults are correct for the standard layouts. */
  sizes?: string;
  /** Set on the single above-the-fold cover only. */
  priority?: boolean;
  className?: string;
}

const BADGE_TONES: Record<NonNullable<CourseCardBadge['tone']>, string> = {
  strait: 'bg-strait text-on-accent',
  brass: 'bg-brass text-on-brass',
  warn: 'bg-warn-wash text-warn',
  danger: 'bg-danger text-on-danger',
};

const DEFAULT_SIZES: Record<CourseCardVariant, string> = {
  grid: '(max-width: 767px) 100vw, (max-width: 1279px) 50vw, 33vw',
  list: '(max-width: 639px) 100vw, 224px',
  compact: '96px',
};

export function CourseCard({
  href,
  title,
  image,
  variant = 'grid',
  category,
  level,
  duration,
  lessons,
  rating,
  price,
  priceSlot,
  progress,
  badge,
  sizes,
  priority = false,
  className,
}: CourseCardProps): React.JSX.Element {
  const isCompact = variant === 'compact';
  const isList = variant === 'list';

  return (
    <article
      className={cn(
        'group relative flex overflow-hidden rounded-lg border border-hairline bg-surface',
        'transition-[border-color,box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)]',
        'hover:border-strait hover:shadow-e2 focus-within:border-strait',
        isCompact ? 'flex-row items-stretch gap-3 p-2' : null,
        isList ? 'flex-col sm:flex-row sm:items-stretch' : null,
        variant === 'grid' ? 'flex-col' : null,
        className,
      )}
    >
      <div
        className={cn(
          'relative shrink-0 overflow-hidden bg-raised',
          isCompact ? 'aspect-square w-20 rounded-md sm:w-24' : null,
          isList ? 'aspect-[16/9] w-full sm:aspect-[4/3] sm:w-56' : null,
          variant === 'grid' ? 'aspect-[16/9] w-full' : null,
        )}
      >
        <Image
          src={image.src}
          alt={image.alt}
          fill
          sizes={sizes ?? DEFAULT_SIZES[variant]}
          priority={priority}
          placeholder={image.blurDataURL === undefined ? 'empty' : 'blur'}
          blurDataURL={image.blurDataURL}
          className="object-cover transition-transform duration-[300ms] ease-[var(--ease-out-strait)] group-hover:scale-[1.03]"
        />
        {badge !== undefined && !isCompact ? (
          <span
            className={cn(
              'absolute start-3 top-3 rounded-pill px-2.5 py-1 text-xs font-medium shadow-e1',
              BADGE_TONES[badge.tone ?? 'strait'],
            )}
          >
            {badge.text}
          </span>
        ) : null}
      </div>

      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-2 text-start',
          isCompact ? 'justify-center py-1 pe-1' : 'p-4',
        )}
      >
        {category !== undefined ? (
          <p className="text-xs font-medium uppercase tracking-wide text-strait">{category}</p>
        ) : null}

        <h3
          className={cn(
            'font-display font-medium text-ink',
            isCompact ? 'line-clamp-2 text-sm' : 'line-clamp-2 text-heading',
          )}
        >
          {/* Stretched link: the whole card is the target, but only the title
              is the accessible name of the link. */}
          <Link
            href={href}
            className="outline-none after:absolute after:inset-0 after:rounded-lg after:content-['']"
          >
            {title}
          </Link>
        </h3>

        {level !== undefined || duration !== undefined || lessons !== undefined ? (
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
            {level === undefined ? null : (
              <MetaItem icon={<Signal className="size-3.5" aria-hidden="true" />} meta={level} />
            )}
            {duration === undefined ? null : (
              <MetaItem icon={<Clock className="size-3.5" aria-hidden="true" />} meta={duration} />
            )}
            {lessons === undefined ? null : (
              <MetaItem icon={<Layers className="size-3.5" aria-hidden="true" />} meta={lessons} />
            )}
          </ul>
        ) : null}

        {(rating !== undefined && !isCompact) || price !== undefined || priceSlot !== undefined ? (
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
            {rating !== undefined && !isCompact ? (
              <p className="inline-flex items-center gap-1.5 text-sm">
                <span className="sr-only">{rating.label}</span>
                {/* A star is symmetric and carries no direction: not mirrored. */}
                <Star className="size-4 fill-brass text-brass" aria-hidden="true" />
                <span aria-hidden="true" className="font-medium text-ink" data-numeric>
                  <span className="force-ltr" dir="ltr">
                    {rating.value}
                  </span>
                </span>
                {rating.count === undefined ? null : (
                  <span aria-hidden="true" className="text-ink-muted" data-numeric>
                    <span className="force-ltr" dir="ltr">
                      ({rating.count})
                    </span>
                  </span>
                )}
              </p>
            ) : (
              <span />
            )}

            {priceSlot !== undefined ? (
              priceSlot
            ) : price === undefined ? null : (
              <p className="inline-flex items-baseline gap-2">
                {price.compareAt === undefined ? null : (
                  <span className="text-sm text-ink-muted line-through" data-numeric>
                    {price.compareAtLabel === undefined ? null : (
                      <span className="sr-only">{price.compareAtLabel}</span>
                    )}
                    <span className="force-ltr" dir="ltr">
                      {price.compareAt}
                    </span>
                  </span>
                )}
                {/* Brass is the money colour, and only the money colour. */}
                <span
                  className={cn('font-semibold text-brass', isCompact ? 'text-sm' : 'text-lead')}
                  data-numeric
                >
                  <span className="force-ltr" dir="ltr">
                    {price.current}
                  </span>
                </span>
              </p>
            )}
          </div>
        ) : null}

        {progress === undefined ? null : (
          <div className="mt-1 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span>{progress.label}</span>
              <span data-numeric>
                <span className="force-ltr" dir="ltr">
                  {progress.valueLabel}
                </span>
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={progress.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={toPercent(progress.ratio)}
              aria-valuetext={progress.valueLabel}
              className="h-1.5 w-full overflow-hidden rounded-pill bg-raised"
            >
              <div
                className="h-full rounded-pill bg-strait transition-[inline-size] duration-[300ms] ease-[var(--ease-out-strait)]"
                style={{ inlineSize: `${toPercent(progress.ratio)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function MetaItem({
  icon,
  meta,
}: {
  icon: React.ReactNode;
  meta: CourseCardMeta;
}): React.JSX.Element {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className="sr-only">{meta.label}</span>
      {icon}
      <span aria-hidden="true">{meta.value}</span>
    </li>
  );
}

function toPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}
