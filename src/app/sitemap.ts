import type { MetadataRoute } from 'next';

import { absoluteUrl, alternatesFor } from '@/lib/seo';
import { getSitemapIndex, type SitemapRecord } from '@/server/services/public-pages';
import { locales, type Locale } from '@/i18n/routing';

/**
 * `/sitemap.xml` (§21).
 *
 * ## One entry per locale, not one entry with four alternates
 * Every public route appears four times — `/fr/tarifs`, `/ar/tarifs`,
 * `/en/tarifs`, `/es/tarifs` — and each of those entries carries the *complete*
 * alternate set, including a self-reference and `x-default`. That is what the
 * `hreflang` specification requires: a cluster in which a page does not point
 * back at itself is invalid, and Google discards the cluster rather than
 * repairing it. Listing one URL with three alternates would leave three of the
 * four locales unlisted.
 *
 * ## Slugs are locale-independent
 * §10.1 keeps slugs French in every locale, so a route is one path and four
 * prefixes. `alternatesFor()` derives all five links from that single path,
 * which is why nothing here maintains a per-locale URL map that could drift.
 *
 * ## `lastModified` is real or absent
 * A course, a path, a blog post and a legal page each carry their own
 * `updatedAt`. The listing pages inherit the most recent timestamp of what they
 * list. The pages with no database backing — `/contact`, `/a-propos`,
 * `/notre-methode`, `/formateurs` — carry **no** `lastModified` at all rather
 * than `new Date()`, which would tell every crawler on every fetch that the page
 * changed a second ago and would train it to ignore the field.
 */

/** Cached for an hour: a crawler hitting this must not fan out to five queries. */
export const revalidate = 3600;

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;

interface RouteSpec {
  /** Locale-relative path. `''` is the locale home. */
  readonly path: string;
  readonly priority: number;
  readonly changeFrequency: ChangeFrequency;
  readonly lastModified?: Date;
}

/** The most recent timestamp of a record list, or `undefined` when empty. */
function latest(records: readonly SitemapRecord[]): Date | undefined {
  let newest: Date | undefined;
  for (const record of records) {
    if (newest === undefined || record.lastModified > newest) newest = record.lastModified;
  }
  return newest;
}

/** Expand one route into its four locale entries, each with the full cluster. */
function expand(spec: RouteSpec): MetadataRoute.Sitemap {
  const { languages } = alternatesFor('fr', spec.path);

  return locales.map((locale: Locale) => ({
    url: absoluteUrl(locale, spec.path),
    ...(spec.lastModified === undefined ? {} : { lastModified: spec.lastModified }),
    changeFrequency: spec.changeFrequency,
    priority: spec.priority,
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const index = await getSitemapIndex();

  const newestCourse = latest(index.courses);
  const newestPath = latest(index.paths);
  const newestPost = latest(index.blogPosts);

  const specs: RouteSpec[] = [
    { path: '', priority: 1, changeFrequency: 'weekly', ...(newestCourse === undefined ? {} : { lastModified: newestCourse }) },
    { path: '/formations', priority: 0.9, changeFrequency: 'daily', ...(newestCourse === undefined ? {} : { lastModified: newestCourse }) },
    { path: '/parcours', priority: 0.8, changeFrequency: 'weekly', ...(newestPath === undefined ? {} : { lastModified: newestPath }) },
    { path: '/tarifs', priority: 0.8, changeFrequency: 'weekly', ...(newestCourse === undefined ? {} : { lastModified: newestCourse }) },
    { path: '/notre-methode', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/a-propos', priority: 0.6, changeFrequency: 'monthly' },
    { path: '/formateurs', priority: 0.6, changeFrequency: 'monthly' },
    { path: '/contact', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/faq', priority: 0.6, changeFrequency: 'monthly' },
    { path: '/blog', priority: 0.6, changeFrequency: 'weekly', ...(newestPost === undefined ? {} : { lastModified: newestPost }) },
    { path: '/certificat', priority: 0.4, changeFrequency: 'yearly' },
  ];

  // Database-backed routes. Courses first: they are the pages that matter.
  for (const record of index.courses) {
    specs.push({
      path: record.path,
      priority: 0.9,
      changeFrequency: 'weekly',
      lastModified: record.lastModified,
    });
  }
  for (const record of index.paths) {
    specs.push({
      path: record.path,
      priority: 0.7,
      changeFrequency: 'monthly',
      lastModified: record.lastModified,
    });
  }
  for (const record of index.blogPosts) {
    specs.push({
      path: record.path,
      priority: 0.5,
      changeFrequency: 'monthly',
      lastModified: record.lastModified,
    });
  }
  for (const record of index.legalPages) {
    specs.push({
      path: record.path,
      priority: 0.3,
      changeFrequency: 'yearly',
      lastModified: record.lastModified,
    });
  }

  return specs.flatMap(expand);
}
