import { getTranslations } from 'next-intl/server';

import {
  breadcrumbListJsonLd,
  courseJsonLd,
  jsonLdScript,
  siteOrigin,
  type BreadcrumbEntry,
} from '@/lib/seo';
import type { Locale } from '@/i18n/routing';
import type { CourseDetail } from '@/server/services/catalog/course-detail';

/**
 * `Course` + `BreadcrumbList` structured data for `/formations/[slug]` (§12.4, §21).
 *
 * ## One source, so the two cannot drift
 * Every value comes from the same `CourseDetail` the page renders: the title in
 * the `<h1>`, the price in the purchase card, the breadcrumb in the `<nav>`,
 * the rating from the moderated reviews shown below. Nothing is re-queried and
 * nothing is re-derived, which is the only way structured data stays true after
 * someone edits the page.
 *
 * ## Nothing invalid is ever emitted
 * The builders in `@/lib/seo` return `null` when a required fact is missing —
 * a course with no name, a breadcrumb with a single crumb — and `jsonLdScript`
 * returns `null` when everything it was handed was `null`. This component then
 * renders no tag at all. Google penalises structured data that lies and simply
 * ignores structured data that is absent, so absence is the safe failure.
 *
 * ## The rating
 * `reviews.total` / `reviews.average` are computed from `APPROVED` rows only,
 * and `courseJsonLd` drops `aggregateRating` entirely when the count is zero.
 * A course with no reviews therefore advertises no score rather than a
 * fabricated one (§21).
 */

export interface CourseJsonLdProps {
  readonly locale: Locale;
  readonly course: CourseDetail;
  /** The centre's own name — `getPublicChrome(locale).brandFullName`. */
  readonly providerName: string;
}

export async function CourseJsonLd({
  locale,
  course,
  providerName,
}: CourseJsonLdProps): Promise<React.JSX.Element | null> {
  const t = await getTranslations({ locale, namespace: 'course' });

  const path = `/formations/${course.slug}`;

  // The same trail the page draws: catalogue → category → this course. The
  // visible breadcrumb has no « Accueil » crumb, so neither does this one.
  const crumbs: BreadcrumbEntry[] = [
    { name: t('breadcrumbCatalog'), path: '/formations' },
    ...(course.category === null
      ? []
      : [{ name: course.category.name, path: `/formations?categorie=${course.category.slug}` }]),
    { name: course.title },
  ];

  const payload = jsonLdScript(
    courseJsonLd({
      locale,
      path,
      name: course.title,
      description: course.seoDescription ?? course.subtitle ?? summarise(course.description),
      providerName,
      imageUrl: absoluteAsset(course.coverUrl),
      priceCentimes: course.priceCentimes,
      currency: 'MAD',
      deliveryMode: course.deliveryMode,
      durationIso: isoDuration(course.durationMinutes),
      contentLocale: course.contentLocale,
      ratingValue: course.reviews.total > 0 ? course.reviews.average : null,
      ratingCount: course.reviews.total,
    }),
    breadcrumbListJsonLd(locale, crumbs),
  );

  if (payload === null) return null;

  return (
    <script
      type="application/ld+json"
      // `jsonLdScript` escapes `<`, so a description containing `</script>`
      // cannot close the tag. The content is editorial, never visitor input.
      dangerouslySetInnerHTML={{ __html: payload }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Google wants an absolute image URL; `coverUrl` is root-relative for local seed assets. */
function absoluteAsset(url: string | null): string | null {
  if (url === null) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${siteOrigin()}${url.startsWith('/') ? url : `/${url}`}`;
}

/** `courseWorkload` is an ISO 8601 duration: 750 minutes → `PT12H30M`. */
function isoDuration(totalMinutes: number): string | null {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;

  const minutes = Math.round(totalMinutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `PT${rest}M`;
  if (rest === 0) return `PT${hours}H`;
  return `PT${hours}H${rest}M`;
}

/** Markers a description written in the editors' Markdown subset may carry. */
const MARKDOWN_NOISE = /^\s{0,3}(#{1,6}\s+|>\s?|\d+[.)]\s+|[-*+]\s+)/gm;
const MARKDOWN_EMPHASIS = /(\*\*|[*_`])/g;
const DESCRIPTION_LIMIT = 300;

/**
 * A description for machines: the MDX body flattened to one paragraph.
 *
 * Only used when the course has neither an SEO description nor a subtitle —
 * both of which are already plain prose written for exactly this purpose.
 */
function summarise(source: string): string {
  const flat = source
    .replace(/\r\n/g, '\n')
    .replace(MARKDOWN_NOISE, '')
    .replace(MARKDOWN_EMPHASIS, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (flat.length <= DESCRIPTION_LIMIT) return flat;

  const cut = flat.slice(0, DESCRIPTION_LIMIT);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
