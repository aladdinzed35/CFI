import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';

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
 * cover box keeps its exact reserved height (no shift), `bg-raised` shows
 * through as a clean surface, and assistive technology is told there is no
 * image to describe — which is true.
 */

/** A transparent 16 / 9 SVG. No colour, no request, no layout shift. */
const NO_COVER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='9'/%3E";

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
      // The bento's large card is half the viewport on desktop; the rest are a
      // third. Getting `sizes` right is most of the mobile image budget.
      sizes: isLarge
        ? '(max-width: 1023px) 85vw, 50vw'
        : '(max-width: 1023px) 85vw, 25vw',
    };
  }

  return (
    <section
      aria-labelledby="home-featured-title"
      className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
            {t('sectionLabel')}
          </p>
          <h2 id="home-featured-title" className="mt-4 max-w-[18ch] text-display">
            {t('title')}
          </h2>
          <p className="mt-5 max-w-[62ch] text-lead text-ink-muted">{t('subtitle')}</p>
        </div>

        <Link
          href="/formations"
          className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-hairline px-5 text-sm font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none"
        >
          {t('seeAll')}
          <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
        </Link>
      </div>

      {categories.length === 0 ? null : (
        <nav aria-label={t('chipsLabel')} className="mt-10">
          <ul role="list" className="flex flex-wrap gap-2">
            <li>
              <Link
                href="/formations"
                className="inline-flex min-h-11 items-center rounded-pill border border-strait bg-strait-wash px-4 text-sm font-medium text-strait transition-colors duration-[120ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none"
              >
                {t('chipAll')}
              </Link>
            </li>
            {categories.map((category) => (
              <li key={category.slug}>
                <Link
                  href={{ pathname: '/formations', query: { categorie: category.slug } }}
                  className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-hairline px-4 text-sm text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none"
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

      {courses.length === 0 ? (
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
        <>
          <ul
            role="list"
            aria-label={t('title')}
            className={cn(
              // Phone: a snap rail. The negative inline margin lets the first
              // and last card sit flush with the page gutter while the rail
              // itself scrolls edge to edge.
              '-mx-4 mt-12 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-p-4 px-4 pb-2 sm:-mx-6 sm:scroll-p-6 sm:px-6',
              // Desktop: the bento. Three columns, three rows, first card 2 × 2.
              'lg:mx-0 lg:grid lg:auto-rows-fr lg:grid-cols-3 lg:grid-rows-3 lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0',
            )}
          >
            {courses.slice(0, 6).map((course, index) => (
              <li
                key={course.id}
                className={cn(
                  'w-[85%] shrink-0 snap-start sm:w-[55%] md:w-[40%] lg:w-auto',
                  index === 0 ? 'lg:col-span-2 lg:row-span-2' : null,
                )}
              >
                <CourseCard {...cardProps(course, index)} className="h-full" />
              </li>
            ))}
          </ul>

          {/* Only meaningful while the list is a rail. */}
          <p className="mt-3 text-sm text-ink-muted lg:hidden">{t('scrollHint')}</p>
        </>
      )}
    </section>
  );
}
