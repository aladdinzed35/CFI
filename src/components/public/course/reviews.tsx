import { getTranslations } from 'next-intl/server';
import { ChevronDown, MessageSquareReply, ShieldCheck, Star } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Rating } from '@/components/ui/rating';
import { formatDate, toDateTimeAttribute } from '@/lib/dates';
import type { Locale } from '@/i18n/routing';
import type { CourseReview, CourseReviews } from '@/server/services/catalog/course-detail';

/**
 * « Avis des apprenants » — approved reviews with the rating distribution
 * (§12.4).
 *
 * ## No JavaScript
 * The "show more" affordance is a native `<details>`, not client state. The
 * hidden reviews are in the DOM from the first byte, so they are crawlable and
 * findable with the browser's own text search, the control works before
 * hydration, and the section costs the mobile bundle nothing — which matters,
 * because M2's gate is Lighthouse ≥ 95 on a phone. `Rating` and `Avatar` are
 * the only client islands, and both are tiny primitives the page already ships.
 *
 * ## The distribution bars
 * Five rows, always all five, five stars first — a missing row reads as "no
 * data" rather than "nobody gave that score". Each bar carries its own
 * accessible name (« 4 étoiles ») and its own announced value (« 2 avis »), so
 * the shape of the distribution is available without seeing it. The proportion
 * is a real one: `count / total`, never a rounded-up minimum width, because a
 * visible sliver where there are zero reviews is a lie about the data.
 *
 * ## Empty
 * A course with no reviews yet says so and explains why — it has just opened.
 * It does not apologise and it offers no action, because there is nothing a
 * visitor can do about it (§11.5).
 */

/** Reviews shown before the disclosure. Enough to judge, short enough to scan. */
const VISIBLE_BEFORE_DISCLOSURE = 3;

export interface ReviewsProps {
  readonly locale: Locale;
  readonly reviews: CourseReviews;
}

export async function Reviews({ locale, reviews }: ReviewsProps): Promise<React.JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'course.reviews' });
  const tCommon = await getTranslations({ locale, namespace: 'common' });

  const { items, distribution, average, total } = reviews;

  const heading = (
    <>
      <h2 id="reviews" className="text-heading">
        {t('title')}
      </h2>
      <p className="mt-2 text-sm text-pretty text-ink-muted">{t('subtitle')}</p>
    </>
  );

  if (total === 0 || items.length === 0) {
    return (
      <section aria-labelledby="reviews">
        {heading}
        <div className="mt-4 rounded-lg border border-hairline bg-surface">
          <EmptyState
            illustration={<Star />}
            title={t('empty.title')}
            description={t('empty.body')}
            size="sm"
          />
        </div>
      </section>
    );
  }

  const averageLabel = t('average', { rating: average.toFixed(1) });
  const visible = items.slice(0, VISIBLE_BEFORE_DISCLOSURE);
  const hidden = items.slice(VISIBLE_BEFORE_DISCLOSURE);

  return (
    <section aria-labelledby="reviews">
      {heading}

      <div className="mt-5 grid gap-6 rounded-lg border border-hairline bg-surface p-5 sm:grid-cols-[auto_1fr] sm:gap-8">
        {/* The headline number. `brass` is the achievement accent (§11.2) and is
            already what the stars themselves are painted with. */}
        <div className="flex flex-col items-start gap-1.5 sm:items-center">
          <p data-numeric className="font-display text-title text-brass">
            {average.toFixed(1)}
          </p>
          <Rating value={average} size="md" label={averageLabel} />
          <p className="text-sm text-ink-muted">{t('count', { count: total })}</p>
        </div>

        <ul aria-label={t('distributionLabel')} className="flex flex-col gap-2">
          {distribution.map((bucket) => {
            const rowLabel = t('starsRow', { stars: bucket.stars });
            const shareLabel = t('starsShare', { count: bucket.count });

            return (
              <li key={bucket.stars} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-xs text-ink-muted sm:w-20">{rowLabel}</span>
                <ProgressBar
                  className="min-w-0 flex-1"
                  value={(bucket.count / total) * 100}
                  label={rowLabel}
                  valueText={shareLabel}
                  tone="brass"
                  size="sm"
                />
                <span
                  data-numeric
                  className="w-8 shrink-0 text-end text-xs text-ink-muted"
                  aria-hidden="true"
                >
                  {bucket.count}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <ul className="mt-5 flex flex-col gap-3">
        {visible.map((review) => (
          <ReviewCard key={review.id} review={review} locale={locale} t={t} />
        ))}
      </ul>

      {hidden.length === 0 ? null : (
        <details className="group mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-sm font-medium text-strait transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-strait-wash motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
            <span className="group-[[open]]:hidden">{t('showMore')}</span>
            <span className="hidden group-[[open]]:inline">{tCommon('showLess')}</span>
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform duration-200 ease-[var(--ease-out-strait)] group-[[open]]:rotate-180 motion-reduce:transition-none"
            />
          </summary>

          <ul className="mt-3 flex flex-col gap-3">
            {hidden.map((review) => (
              <ReviewCard key={review.id} review={review} locale={locale} t={t} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* One review                                                                  */
/* -------------------------------------------------------------------------- */

type ReviewTranslator = Awaited<ReturnType<typeof getTranslations>>;

interface ReviewCardProps {
  readonly review: CourseReview;
  readonly locale: Locale;
  readonly t: ReviewTranslator;
}

function ReviewCard({ review, locale, t }: ReviewCardProps): React.JSX.Element {
  return (
    <li className="flex flex-col gap-3 rounded-md border border-hairline bg-surface p-4">
      <div className="flex items-start gap-3">
        <Avatar name={review.authorName} src={review.avatarUrl} size="md" />

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{review.authorName}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            <time dateTime={toDateTimeAttribute(review.createdAt)}>
              {t('postedOn', { date: formatDate(review.createdAt, locale) })}
            </time>
          </p>
        </div>

        <Rating
          value={review.rating}
          size="sm"
          label={t('average', { rating: String(review.rating) })}
          className="shrink-0"
        />
      </div>

      {review.comment === null ? null : (
        <p className="text-body text-pretty text-ink-muted">{review.comment}</p>
      )}

      <Badge tone="success" icon={<ShieldCheck />} className="self-start">
        {t('verified')}
      </Badge>

      {review.adminReply === null ? null : (
        <div className="rounded-sm border-s-2 border-strait bg-raised p-3">
          <p className="flex items-center gap-2 text-xs font-medium text-strait">
            <MessageSquareReply className="size-3.5 shrink-0" aria-hidden="true" />
            {t('reply')}
          </p>
          <p className="mt-1.5 text-sm text-pretty text-ink-muted">{review.adminReply}</p>
        </div>
      )}
    </li>
  );
}
