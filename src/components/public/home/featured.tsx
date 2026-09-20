import { getTranslations } from 'next-intl/server';
import { ArrowRight, BookOpen } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { CourseCard, type CourseCardProps } from '@/components/ui/course-card';
import { PriceTag } from '@/components/ui/price-tag';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDuration } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { HomeCategory, HomeCourse } from '@/server/services/home';
import type { Locale } from '@/i18n/routing';

/**
 * §12.2 §3 — « Formations à la une ».
 *
 * ## The bento is a grid, and the mobile rail is the same DOM
 *
 * One large card and five standard ones. On `lg` that is a 3 × 3 grid where the
 * first card occupies the 2 × 2 block at the inline start; below `lg` the same
 * list becomes a horizontal snap rail. Both come from a single element that
 * switches from `flex` to `grid` at the breakpoint — no duplicated markup, so a
 * screen reader and a crawler see six cards once, and the phone never downloads
 * a desktop copy it will not paint.
 *
 * The rail is scrolled by tabbing: every card's title is a link, and moving
 * focus into an off-screen card scrolls it into view natively. That is why there
 * are no arrow buttons here — they would be a client component, and a client
 * component in the second viewport is exactly what the Lighthouse budget cannot
 * afford for a control the platform already provides.
 *
 * ## Chips deep-link, they do not filter in place
 *
 * §12.2 asks the chips to "deep-link into the catalog". They are plain links to
 * `/formations?categorie=<slug>`, so they are crawlable, shareable and
 * back-button-safe, and the homepage stays free of filter state.
 *
 * ## Covers
 *
 * `HomeCourse.coverUrl` is `null` until a cover is uploaded *and* a public
 * storage base is configured. Rather than ship an invented illustration, the
 * card then gets a transparent 16 / 9 placeholder and an empty `alt`: the
 * cover box keeps its exact reserved height (no shift), and assistive
 * technology is told there is no image to describe — which is true.
 *
 * What shows through is no longer a flat beige box. Six of those in a bento
 * is what made the first production homepage look unfinished, so the cover
 * box of a card without a cover is painted with the brand's zellige star —
 * the same {8/2} octagram as the logo and the method glyphs — as a CSS mask
 * over a theme token. It is decoration, not a picture of the course: no
 * request, no `alt`, and it retints with the theme like everything else.
 *
 * ## A bento never has a hole
 *
 * The 3 × 3 bento needs exactly six cards. A catalogue with one to five
 * featured courses used to leave empty cells — a whole empty row at three.
 * The last cell is now a « see all » tile sized to whatever is left (one cell,
 * two cells across or two cells down), and the grid only asks for the rows it
 * fills. On the phone rail the same tile is simply the last card.
 */

/** A transparent 16 / 9 SVG. No colour, no request, no layout shift. */
const NO_COVER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='9'/%3E";

/** One octagram tile: the alpha channel of a mask, so its colour is irrelevant. */
const LATTICE_MASK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44' fill='none' stroke='black' stroke-width='1.2'%3E%3Crect x='14' y='14' width='16' height='16'/%3E%3Crect x='14' y='14' width='16' height='16' transform='rotate(45 22 22)'/%3E%3C/svg%3E\") 0 0 / 44px 44px repeat";

/*
  Hoisted and de-duplicated by React 19 (`href` + `precedence`), the technique
  hero.tsx uses for its keyframes. `.cfi-cover-fallback > div:first-child` is
  the cover box of `ui/course-card.tsx`; if that markup ever changes the rule
  simply stops matching and the card falls back to its plain `bg-raised`.
*/
const featuredStyles = `
.cfi-home-lattice,
.cfi-cover-fallback > div:first-child {
  isolation: isolate;
}
.cfi-cover-fallback > div:first-child {
  background-image: linear-gradient(135deg, var(--color-strait-wash), var(--color-raised) 72%);
}
.cfi-home-lattice::before,
.cfi-cover-fallback > div:first-child::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-color: var(--color-strait);
  opacity: 0.16;
  -webkit-mask: ${LATTICE_MASK};
  mask: ${LATTICE_MASK};
}
`;

/**
 * Where the « see all » tile goes in the desktop bento, for `count` cards.
 * The large card takes a 2 × 2 block and every other card one cell, so:
 * one card leaves column 3 empty on both rows, four leave two cells of the
 * third row, two and five leave exactly one cell, three and six fill it.
 */
function seeAllCell(count: number): string {
  if (count === 1) return 'lg:row-span-2';
  if (count === 4) return 'lg:col-span-2';
  if (count === 2 || count === 5) return '';
  return 'lg:hidden';
}

export interface HomeFeaturedProps {
  locale: Locale;
  courses: readonly HomeCourse[];
  categories: readonly HomeCategory[];
}

export async function HomeFeatured({
  locale,
  courses,
  categories,
}: HomeFeaturedProps): Promise<React.JSX.Element> {
  const t = await getTranslations('home.featured');
  const tCard = await getTranslations('catalog.card');
  const tMeta = await getTranslations('course.meta');
  const tLevel = await getTranslations('course.level');
  const tPurchase = await getTranslations('course.purchase');
  const numberFormat = new Intl.NumberFormat(locale);

  function cardProps(course: HomeCourse, index: number): CourseCardProps {
    const durationText = formatDuration(course.durationMinutes, locale);
    const isLarge = index === 0;

    return {
      href: `/formations/${course.slug}`,
      title: course.title,
      image: {
        src: course.coverUrl ?? NO_COVER,
        // Empty on purpose when there is no cover: describing an absent image
        // would be a lie, and the title right below already names the course.
        alt: course.coverUrl === null ? '' : course.title,
      },
      variant: 'grid',
      category: course.categoryName ?? undefined,
      level: {
        value: tLevel(course.level),
        label: `${tMeta('level')} : ${tLevel(course.level)}`,
      },
      duration:
        course.durationMinutes > 0
          ? { value: durationText, label: `${tMeta('duration')} : ${durationText}` }
          : undefined,
      lessons:
        course.lessonCount > 0
          ? {
              value: numberFormat.format(course.lessonCount),
              label: tMeta('lessons', { count: course.lessonCount }),
            }
          : undefined,
      rating:
        course.ratingCount > 0
          ? {
              value: new Intl.NumberFormat(locale, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }).format(course.ratingAvg),
              count: numberFormat.format(course.ratingCount),
              label: `${tMeta('rating', {
                rating: course.ratingAvg.toFixed(1),
              })} — ${tMeta('ratingCount', { count: course.ratingCount })}`,
            }
          : undefined,
      priceSlot: (
        <PriceTag
          centimes={course.priceCentimes}
          compareAtCentimes={course.comparePriceCentimes}
          locale={locale}
          size={isLarge ? 'lg' : 'md'}
          freeLabel={tCard('free')}
          compareAtSrLabel={tPurchase('comparePrefix')}
        />
      ),
      badge: course.isNew ? { text: tCard('new'), tone: 'strait' } : undefined,
      // The bento's large card is two thirds of the container on desktop; the
      // rest are a third. Getting `sizes` right is most of the image budget.
      sizes: isLarge
        ? '(max-width: 1023px) 85vw, 740px'
        : '(max-width: 1023px) 85vw, 360px',
    };
  }

  const shown = courses.slice(0, 6);
  const count = shown.length;

  return (
    <section
      aria-labelledby="home-featured-title"
      data-home-band="plain"
      className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24"
    >
      <style href="cfi-home-featured" precedence="medium">
        {featuredStyles}
      </style>

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait rtl:font-arabic rtl:text-sm rtl:tracking-normal">
            {t('sectionLabel')}
          </p>
          <h2 id="home-featured-title" className="mt-4 max-w-[18ch] text-display text-balance">
            {t('title')}
          </h2>
          <p className="mt-5 max-w-[62ch] text-lead text-pretty text-ink-muted">{t('subtitle')}</p>
        </div>

        {count === 0 ? null : (
          <Link
            href="/formations"
            className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-hairline px-5 text-sm font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none"
          >
            {t('seeAll')}
            <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
          </Link>
        )}
      </div>

      {categories.length === 0 || count === 0 ? null : (
        <nav aria-label={t('chipsLabel')} className="mt-8 sm:mt-10">
          {/* One swipeable row on a phone — eight wrapped chips were four
              lines of buttons before the first course. From `sm` they wrap.
              The 4 px of block padding keep a chip's focus ring from being
              clipped by the scroller; the negative margin gives it back. */}
          <ul
            role="list"
            className="-mx-4 -my-1 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:mx-0 sm:my-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:py-0 [&::-webkit-scrollbar]:hidden"
          >
            <li className="shrink-0">
              <Link
                href="/formations"
                className="inline-flex min-h-11 items-center whitespace-nowrap rounded-pill border border-strait bg-strait-wash px-4 text-sm font-medium text-strait transition-colors duration-[120ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none"
              >
                {t('chipAll')}
              </Link>
            </li>
            {categories.map((category) => (
              <li key={category.slug} className="shrink-0">
                <Link
                  href={{ pathname: '/formations', query: { categorie: category.slug } }}
                  className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-pill border border-hairline bg-surface px-4 text-sm text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none"
                >
                  {category.name}
                  <span className="text-xs text-ink-muted" data-numeric>
                    <span className="force-ltr" dir="ltr">
                      {numberFormat.format(category.courseCount)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {count === 0 ? (
        /* A framed, explained state — not a sentence floating in a hole. */
        <div className="cfi-home-lattice relative mt-10 overflow-hidden rounded-lg border border-hairline bg-surface sm:mt-12">
          <EmptyState
            illustration={<BookOpen aria-hidden="true" />}
            tone="strait"
            title={t('empty.title')}
            description={t('empty.body')}
            // Clear in the middle, lattice at the edges: the pattern frames
            // the message without running through it.
            className="bg-[radial-gradient(closest-side,var(--color-surface)_62%,transparent)] sm:py-16"
            action={
              <Link
                href="/formations"
                className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-strait px-6 text-body font-medium text-on-accent shadow-e2 transition-[box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)] hover:shadow-e3 active:translate-y-px motion-reduce:transition-none"
              >
                {t('empty.action')}
                <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <ul
            role="list"
            aria-label={t('title')}
            /*
              Focusable because it scrolls. Below `lg` this rail overflows
              horizontally, and a region a mouse can pan but a keyboard cannot
              reach is exactly what axe's `scrollable-region-focusable` catches:
              a keyboard-only visitor could see the first two cards and had no
              way to reach the rest. tabIndex 0 makes the arrow keys work on it.
              Harmless above `lg`, where it becomes a grid and stops scrolling.
            */
            tabIndex={0}
            className={cn(
              // Phone: a snap rail. The negative inline margin lets the first
              // and last card sit flush with the page gutter while the rail
              // itself scrolls edge to edge; 85 % leaves a peek of the next.
              '-mx-4 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-p-4 px-4 pb-3 sm:-mx-6 sm:mt-10 sm:scroll-p-6 sm:px-6',
              // Desktop: the bento. Three columns, first card 2 × 2, and only
              // as many rows as the cards fill.
              'lg:mx-0 lg:grid lg:auto-rows-fr lg:grid-cols-3 lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0',
              count <= 3 ? 'lg:grid-rows-2' : 'lg:grid-rows-3',
            )}
          >
            {shown.map((course, index) => (
              <li
                key={course.id}
                className={cn(
                  'w-[85%] shrink-0 snap-start sm:w-[55%] md:w-[40%] lg:w-auto',
                  index === 0 ? 'lg:col-span-2 lg:row-span-2' : null,
                )}
              >
                <CourseCard
                  {...cardProps(course, index)}
                  className={cn(
                    'h-full',
                    course.coverUrl === null ? 'cfi-cover-fallback' : null,
                    // The large card is two rows tall; its cover takes the
                    // extra height instead of leaving it blank under the price.
                    index === 0
                      ? 'lg:[&>div:first-child]:aspect-auto lg:[&>div:first-child]:min-h-64 lg:[&>div:first-child]:grow'
                      : null,
                  )}
                />
              </li>
            ))}

            {/* The end of the rail, and whatever cells the bento has left. */}
            <li
              className={cn(
                'w-[62%] shrink-0 snap-start sm:w-[40%] md:w-[30%] lg:w-auto',
                seeAllCell(count),
              )}
            >
              <Link
                href="/formations"
                className="cfi-home-lattice group relative flex h-full min-h-56 flex-col justify-between gap-6 overflow-hidden rounded-lg border border-hairline bg-strait-wash p-6 transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait motion-reduce:transition-none"
              >
                <span className="inline-flex size-12 items-center justify-center rounded-pill bg-surface text-strait shadow-e1 transition-transform duration-[120ms] ease-[var(--ease-out-strait)] group-hover:translate-x-1 motion-reduce:transition-none rtl:group-hover:-translate-x-1">
                  <ArrowRight className="size-5 rtl:-scale-x-100" aria-hidden="true" />
                </span>
                <span className="font-display text-heading font-medium text-balance text-ink">
                  {t('seeAll')}
                </span>
              </Link>
            </li>
          </ul>

          {/* Only meaningful while the list is a rail. */}
          <p className="mt-3 text-sm text-ink-muted lg:hidden">{t('scrollHint')}</p>
        </>
      )}
    </section>
  );
}
