import { getTranslations } from 'next-intl/server';

import { CourseCard, type CourseCardBadge } from '@/components/ui/course-card';
import { PriceTag } from '@/components/ui/price-tag';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/dates';
import { MONEY_FORMATS } from '@/lib/money';
import type { Locale } from '@/i18n/routing';
import {
  DELIVERY_MESSAGE_KEY,
  LEVEL_MESSAGE_KEY,
  type CatalogView,
} from '@/server/services/catalog/filters';
import type { CatalogCourse } from '@/server/services/catalog/queries';

/**
 * The catalogue's results area (§12.3) — and the skeleton that stands in for it
 * while it streams.
 *
 * ## The skeleton is part of the contract
 * `ResultsGridSkeleton` is exported from this file, next to the grid it
 * replaces, and shares its wrapper classes through `gridClasses`. That is not
 * tidiness: §12.3 requires the placeholder to match the real card geometry so
 * nothing shifts when the data lands. Two files could not stay in step; one
 * cannot drift.
 *
 * ## Server Component, zero client JavaScript
 * A course card is a link, an image and some text. Nothing here has state, so
 * nothing here ships to the browser — which is most of how the catalogue keeps
 * its Lighthouse budget on a phone.
 *
 * ## Formatting happens here, once
 * `CourseCard` is deliberately i18n-agnostic (see its own docs): it renders
 * strings, it does not build them. This module is the seam where centimes
 * become « 1 200 DH » and minutes become « 4 h 25 min », because it is the only
 * place that holds both the locale and the raw row.
 */

/** A 1×1 transparent GIF. `next/image` leaves `data:` URLs unoptimised. */
export const BLANK_COVER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/*
 * ## A course without a cover still gets a cover
 * Most courses start life without a picture, and a grid of beige boxes reads
 * as a page that failed to load. The transparent GIF above keeps the card's
 * geometry; behind it, `.cfi-cover-fallback` paints the cover slot with the
 * site's own vocabulary — a zellige field and Bab Mansour's arch — tinted per
 * domain, from theme variables, so it follows light and dark like everything
 * else. The shapes are CSS masks (alpha only, no colour in them); the colour
 * is always a token.
 *
 * `--raw-*` rather than `--color-*`: the Tailwind aliases are inlined into
 * utilities and do not exist as runtime variables.
 */
const svgUrl = (svg: string): string => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

const TILE_MASK = svgUrl(
  "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'>" +
    "<g fill='none' stroke='black' stroke-opacity='0.5' stroke-width='1'><rect x='15' y='15' width='10' height='10' rx='1'/>" +
    "<rect x='15' y='15' width='10' height='10' rx='1' transform='rotate(45 20 20)'/></g>" +
    "<g fill='black' fill-opacity='0.3'><rect x='-3' y='-3' width='6' height='6' transform='rotate(45 0 0)'/>" +
    "<rect x='37' y='-3' width='6' height='6' transform='rotate(45 40 0)'/>" +
    "<rect x='-3' y='37' width='6' height='6' transform='rotate(45 0 40)'/>" +
    "<rect x='37' y='37' width='6' height='6' transform='rotate(45 40 40)'/></g></svg>",
);

const GATE_MASK = svgUrl(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 130'>" +
    // The frame, the arch cut out of it (even-odd), the sun and the keystone.
    "<path fill='black' fill-opacity='0.4' fill-rule='evenodd' d='M10 8h100v122H10z M27.6 130V71.6A34 34 0 1 1 92.4 71.6V130z'/>" +
    "<path fill='none' stroke='black' stroke-width='2.5' d='M27.6 130V71.6A34 34 0 1 1 92.4 71.6V130'/>" +
    "<circle cx='60' cy='98' r='13' fill='black'/>" +
    "<rect x='55' y='12' width='10' height='10' fill='black' transform='rotate(45 60 17)'/></svg>",
);

const coverFallbackCss = `
.cfi-cover-fallback > :first-child {
  background-image:
    radial-gradient(110% 80% at 50% 115%, color-mix(in oklab, var(--cfi-cover-tint) 22%, transparent), transparent 70%),
    linear-gradient(160deg, color-mix(in oklab, var(--cfi-cover-tint) 12%, var(--raw-bg-surface)), var(--raw-bg-raised));
}
.cfi-cover-fallback > :first-child::before {
  content: '';
  position: absolute;
  inset: 0;
  background-color: var(--cfi-cover-tint);
  opacity: 0.55;
  -webkit-mask-image: ${GATE_MASK}, ${TILE_MASK};
  mask-image: ${GATE_MASK}, ${TILE_MASK};
  -webkit-mask-position: 50% 100%, 0 0;
  mask-position: 50% 100%, 0 0;
  -webkit-mask-size: auto 78%, 40px 40px;
  mask-size: auto 78%, 40px 40px;
  -webkit-mask-repeat: no-repeat, repeat;
  mask-repeat: no-repeat, repeat;
}
.cfi-cover-tint-strait { --cfi-cover-tint: var(--raw-accent-strait); }
.cfi-cover-tint-brass { --cfi-cover-tint: var(--raw-accent-brass); }
`;

/**
 * The fallback cover's stylesheet. `ResultsGrid` renders it itself; any other
 * list of course cards (the course page's « similar courses ») renders this
 * once. React hoists and de-duplicates it by `href`.
 */
export function CoverFallbackStyle(): React.JSX.Element {
  return (
    <style href="cfi-cover-fallback" precedence="medium">
      {coverFallbackCss}
    </style>
  );
}

/** One tint per domain, stable across pages: the same category, the same colour. */
export function coverTintFor(slug: string | null): string {
  if (slug === null) return 'cfi-cover-tint-strait';
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 2 === 0 ? 'cfi-cover-tint-strait' : 'cfi-cover-tint-brass';
}

/** Below this many remaining seats the card starts saying so. */
const SEATS_WARNING_THRESHOLD = 5;

/**
 * Grid and list share one wrapper so the skeleton can reuse it verbatim.
 * `min-w-0` on the wrapper is what stops a long, unbreakable course title from
 * pushing the page sideways at 360 px.
 */
function gridClasses(view: CatalogView): string {
  // Two columns from `md` and never three: beside the filter rail the results
  // column is ~700–810 px wide on the site's `max-w-6xl` edge, and a third
  // column would set the card titles in 250 px — two words a line. One column
  // below `md`, because this project's `sm` is 480 px and two cards in 480 px
  // are thumbnails.
  return cn(
    'grid w-full min-w-0 gap-4 sm:gap-5',
    view === 'grille' ? 'md:grid-cols-2' : 'grid-cols-1',
  );
}

export interface ResultsGridProps {
  readonly courses: readonly CatalogCourse[];
  readonly view: CatalogView;
  readonly locale: Locale;
  /**
   * True on page 1 only. The first cover is then the LCP candidate and gets
   * `priority`; every other image stays lazy (§8).
   */
  readonly isFirstPage: boolean;
}

export async function ResultsGrid({
  courses,
  view,
  locale,
  isFirstPage,
}: ResultsGridProps): Promise<React.JSX.Element> {
  const [t, tc] = await Promise.all([getTranslations('catalog'), getTranslations('course')]);
  const decimal = MONEY_FORMATS[locale].decimal;

  return (
    <ul className={gridClasses(view)}>
      <CoverFallbackStyle />
      {courses.map((course, index) => {
        const levelLabel = t(`filters.level.${LEVEL_MESSAGE_KEY[course.level]}`);
        const deliveryLabel = t(`filters.delivery.${DELIVERY_MESSAGE_KEY[course.delivery]}`);
        const hasCover = course.coverUrl !== null;

        return (
          <li key={course.id} className="flex min-w-0">
            <CourseCard
              className={cn(
                'w-full',
                hasCover ? undefined : ['cfi-cover-fallback', coverTintFor(course.categorySlug)],
              )}
              variant={view === 'grille' ? 'grid' : 'list'}
              href={`/formations/${course.slug}`}
              title={course.title}
              category={course.categoryName ?? undefined}
              image={{
                src: course.coverUrl ?? BLANK_COVER,
                // A missing cover carries no information, so it gets no
                // description: an empty alt hides a decorative box from a
                // screen reader instead of announcing a filename.
                alt: hasCover ? tc('media.coverAlt', { title: course.title }) : '',
              }}
              level={{ value: levelLabel, label: `${tc('meta.level')} : ${levelLabel}` }}
              duration={
                course.durationMinutes > 0
                  ? {
                      value: formatDuration(course.durationMinutes, locale),
                      label: `${tc('meta.duration')} : ${formatDuration(course.durationMinutes, locale)}`,
                    }
                  : undefined
              }
              lessons={
                course.lessonCount > 0
                  ? {
                      value: t('card.lessonCount', { count: course.lessonCount }),
                      label: t('card.lessonCount', { count: course.lessonCount }),
                    }
                  : undefined
              }
              rating={
                course.ratingCount > 0
                  ? {
                      value: course.ratingAvg.toFixed(1).replace('.', decimal),
                      count: t('card.ratingCount', { count: course.ratingCount }),
                      label: `${tc('meta.rating', {
                        rating: course.ratingAvg.toFixed(1).replace('.', decimal),
                      })} — ${t('card.ratingCount', { count: course.ratingCount })}`,
                    }
                  : undefined
              }
              priceSlot={
                <PriceTag
                  centimes={course.priceCentimes}
                  compareAtCentimes={course.comparePriceCentimes}
                  locale={locale}
                  size={view === 'grille' ? 'md' : 'lg'}
                  freeLabel={t('card.free')}
                  compareAtSrLabel={tc('purchase.comparePrefix')}
                />
              }
              badge={badgeFor(course, {
                full: t('card.full'),
                lastSeats: (count) => t('card.lastSeats', { count }),
                isNew: t('card.new'),
                featured: t('card.featured'),
                deliveryLabel,
              })}
              sizes={
                view === 'grille'
                  ? '(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 26rem'
                  : '(max-width: 479px) 100vw, 14rem'
              }
              priority={isFirstPage && index === 0}
            />
          </li>
        );
      })}
    </ul>
  );
}

interface BadgeLabels {
  readonly full: string;
  readonly lastSeats: (count: number) => string;
  readonly isNew: string;
  readonly featured: string;
  readonly deliveryLabel: string;
}

/**
 * One badge, chosen by urgency: a full session, then a nearly full one, then
 * novelty. Scarcity outranks marketing — a « Nouveau » ribbon on a session
 * nobody can join any more is how a catalogue loses trust.
 *
 * Brass is never used here: it is reserved for money and achievement (§11.2),
 * and a badge is neither.
 */
function badgeFor(course: CatalogCourse, labels: BadgeLabels): CourseCardBadge | undefined {
  if (course.seatsLeft === 0) return { text: labels.full, tone: 'danger' };
  if (course.seatsLeft !== null && course.seatsLeft <= SEATS_WARNING_THRESHOLD) {
    return { text: labels.lastSeats(course.seatsLeft), tone: 'warn' };
  }
  if (course.isNew) return { text: labels.isNew, tone: 'strait' };
  if (course.isFeatured) return { text: labels.featured, tone: 'strait' };
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                    */
/* -------------------------------------------------------------------------- */

export interface ResultsGridSkeletonProps {
  readonly view: CatalogView;
  readonly count?: number;
  /** Announced once, politely, instead of reading a dozen empty boxes. */
  readonly label: string;
}

/**
 * The placeholder the grid streams behind. Every box below mirrors a real one:
 * the 16/9 cover, the category line, two title lines, the meta row and the
 * price row — so the only thing that changes when the data arrives is the
 * content, never the layout.
 */
export function ResultsGridSkeleton({
  view,
  count = 6,
  label,
}: ResultsGridSkeletonProps): React.JSX.Element {
  const cards = Math.max(1, Math.round(count));
  const isList = view === 'liste';

  return (
    <div role="status" aria-live="polite" aria-busy="true" className="w-full min-w-0">
      <span className="sr-only">{label}</span>
      <div className={gridClasses(view)}>
        {Array.from({ length: cards }, (_unused, index) => (
          <div
            key={index}
            className={cn(
              'flex overflow-hidden rounded-lg border border-hairline bg-surface',
              isList ? 'flex-col sm:flex-row sm:items-stretch' : 'flex-col',
            )}
          >
            <Skeleton
              className={cn(
                'shrink-0 rounded-none',
                isList
                  ? 'aspect-[16/9] w-full sm:aspect-[4/3] sm:w-56'
                  : 'aspect-[16/9] w-full',
              )}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-14" />
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-24" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
