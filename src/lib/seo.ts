import { defaultLocale, locales, type Locale } from '@/i18n/routing';
import type { Metadata } from 'next';

/**
 * The SEO layer shared by every public page (§12, §21, §10.1).
 *
 * Two jobs, and they are deliberately in the same file because they answer the
 * same question — "what is the canonical identity of this page?":
 *
 * 1. `buildMetadata()` — title, description, canonical, the four `hreflang`
 *    alternates plus `x-default`, Open Graph and Twitter, from one call.
 * 2. The JSON-LD builders — `Organization`, `WebSite`, `Course`, `ItemList`,
 *    `BreadcrumbList`, `FAQPage`.
 *
 * ## Slugs are French in every locale
 * §10.1: a course keeps `/formations/marketing-digital` in Arabic. That is what
 * makes the alternate set mechanical — the path is locale-independent, only the
 * `/{locale}` prefix changes — and it is why `alternatesFor()` takes a single
 * path and derives all five links from it rather than being handed a map.
 *
 * ## `hreflang` values
 * Language-only tags (`fr`, `ar`, `en`, `es`), not the regionalised `fr-MA` /
 * `ar-MA` used for `<html lang>`. A regional tag narrows the audience Google
 * will serve the page to; `htmlLangFor()` narrows the *typography and number
 * formatting*, which is a different question. `x-default` points at `fr`, the
 * source language, exactly as §10.1 requires.
 *
 * ## Nothing invalid is ever emitted
 * Every builder returns `null` when its required facts are missing — a `Course`
 * without a name, an `ItemList` with no items, a `BreadcrumbList` with a single
 * crumb. Structured data that lies is worse than structured data that is
 * absent: Search Console penalises the first and ignores the second. Callers
 * render `jsonLdScript(...)`, which itself returns `null` when everything it was
 * given was `null`.
 */

/* -------------------------------------------------------------------------- */
/* Base URL                                                                    */
/* -------------------------------------------------------------------------- */

const LOCALHOST_FALLBACK = 'http://localhost:3000';

/**
 * The canonical origin, without a trailing slash.
 *
 * `NEXT_PUBLIC_APP_URL` is read literally (not through `clientEnv`) so this
 * module stays importable from `sitemap.ts` and `robots.ts`, which run before
 * any request context exists, and from client components, which must not pull
 * the server schema into their bundle.
 */
export function siteOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? LOCALHOST_FALLBACK;
  try {
    return new URL(raw).origin;
  } catch {
    return LOCALHOST_FALLBACK;
  }
}

/**
 * Normalise a locale-relative path to a leading slash with no trailing one.
 * `''` and `'/'` both mean "the locale home".
 */
export function normalizePath(path: string): string {
  if (path === '' || path === '/') return '';
  const withLeading = path.startsWith('/') ? path : `/${path}`;
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
}

/** Absolute URL of `path` in `locale`, e.g. `https://cfi.ma/ar/formations/marketing-digital`. */
export function absoluteUrl(locale: Locale, path = ''): string {
  return `${siteOrigin()}/${locale}${normalizePath(path)}`;
}

/* -------------------------------------------------------------------------- */
/* hreflang                                                                    */
/* -------------------------------------------------------------------------- */

/** The `x-default` key Google reserves for "no language matched". */
export const X_DEFAULT = 'x-default';

export interface Alternates {
  readonly canonical: string;
  /** Four locales plus `x-default`, all absolute. */
  readonly languages: Readonly<Record<string, string>>;
}

/**
 * The canonical URL of `path` in `active`, and the complete alternate set.
 *
 * The active locale is included in `languages` — that is required, not
 * redundant: a `hreflang` cluster in which page A does not point back at itself
 * is invalid, and Google drops the whole cluster rather than half of it.
 */
export function alternatesFor(active: Locale, path = ''): Alternates {
  const clean = normalizePath(path);
  const languages: Record<string, string> = {};

  for (const locale of locales) {
    languages[locale] = absoluteUrl(locale, clean);
  }
  languages[X_DEFAULT] = absoluteUrl(defaultLocale, clean);

  return { canonical: absoluteUrl(active, clean), languages };
}

/** Open Graph wants underscored locale identifiers, not the BCP-47 tags. */
const OG_LOCALE: Record<Locale, string> = {
  fr: 'fr_MA',
  ar: 'ar_MA',
  en: 'en_US',
  es: 'es_ES',
};

/* -------------------------------------------------------------------------- */
/* buildMetadata                                                               */
/* -------------------------------------------------------------------------- */

export interface OgImage {
  /** Absolute, or root-relative — `metadataBase` from the locale layout resolves it. */
  readonly url: string;
  readonly alt: string;
  readonly width?: number;
  readonly height?: number;
}

export interface BuildMetadataOptions {
  readonly locale: Locale;
  /** Locale-relative path, e.g. `/formations/marketing-digital`. `''` is the home. */
  readonly path?: string;
  /**
   * The page title, WITHOUT the brand suffix — the locale layout's
   * `%s · CFI` template appends it. Pass an already-suffixed string only for a
   * page that must override the template entirely.
   */
  readonly title: string;
  readonly description: string;
  /** Defaults to the shared brand image. */
  readonly image?: OgImage;
  /** `'article'` for a blog post, `'website'` everywhere else. */
  readonly type?: 'website' | 'article';
  /** Keeps a page out of the index while leaving its links crawlable. */
  readonly noIndex?: boolean;
  /** `article:published_time` / `article:modified_time`, ISO 8601. */
  readonly publishedTime?: string;
  readonly modifiedTime?: string;
}

const DEFAULT_OG_IMAGE_URL = '/brand/og-default.png';
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

/**
 * The single entry point for a public page's `generateMetadata`.
 *
 * ```ts
 * export async function generateMetadata({ params }) {
 *   const { locale } = await params;
 *   const t = await getTranslations({ locale, namespace: 'seo' });
 *   return buildMetadata({
 *     locale,
 *     path: '/tarifs',
 *     title: t('pricing.title'),
 *     description: t('pricing.description'),
 *     image: { url: '/brand/og-default.png', alt: t('ogAlt.pricing') },
 *   });
 * }
 * ```
 */
export function buildMetadata(options: BuildMetadataOptions): Metadata {
  const {
    locale,
    path = '',
    title,
    description,
    image,
    type = 'website',
    noIndex = false,
    publishedTime,
    modifiedTime,
  } = options;

  const { canonical, languages } = alternatesFor(locale, path);

  const ogImage = {
    url: image?.url ?? DEFAULT_OG_IMAGE_URL,
    alt: image?.alt ?? title,
    width: image?.width ?? OG_WIDTH,
    height: image?.height ?? OG_HEIGHT,
  };

  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: {
      type,
      url: canonical,
      title,
      description,
      locale: OG_LOCALE[locale],
      alternateLocale: locales.filter((other) => other !== locale).map((other) => OG_LOCALE[other]),
      images: [ogImage],
      ...(type === 'article' && publishedTime !== undefined ? { publishedTime } : {}),
      ...(type === 'article' && modifiedTime !== undefined ? { modifiedTime } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage.url],
    },
    robots: noIndex
      ? { index: false, follow: true }
      : { index: true, follow: true, googleBot: { index: true, follow: true } },
  };
}

/* -------------------------------------------------------------------------- */
/* JSON-LD                                                                     */
/* -------------------------------------------------------------------------- */

/** A JSON-serialisable value. Recursive, and free of `any` (§0.5). */
export type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonLdValue[]
  | { readonly [key: string]: JsonLdValue | undefined };

export interface JsonLdNode {
  readonly '@context': 'https://schema.org';
  readonly '@type': string;
  readonly [key: string]: JsonLdValue | undefined;
}

/** Drop `undefined` entries so the emitted graph has no empty properties. */
function compact(record: Record<string, JsonLdValue | undefined>): Record<string, JsonLdValue> {
  const out: Record<string, JsonLdValue> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** A non-empty, trimmed string, or `undefined`. Empty strings never reach the graph. */
function text(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Serialise nodes into the body of a `<script type="application/ld+json">`.
 *
 * `<` is escaped to `<` — without it, a course description containing
 * `</script>` would close the tag and turn structured data into an injection
 * vector. Returns `null` when every node was `null`, so the caller renders no
 * tag at all rather than an empty one.
 */
export function jsonLdScript(...nodes: readonly (JsonLdNode | null)[]): string | null {
  const present = nodes.filter((node): node is JsonLdNode => node !== null);
  if (present.length === 0) return null;

  const payload = present.length === 1 ? present[0] : present;
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

/* ── Organization / EducationalOrganization ──────────────────────────────── */

export interface OrganizationInput {
  readonly locale: Locale;
  readonly name: string;
  readonly description?: string | null;
  readonly logoUrl?: string | null;
  /** E.164. */
  readonly phone?: string | null;
  readonly email?: string | null;
  /** One free-form line, as stored in `SiteSetting`. */
  readonly address?: string | null;
  readonly addressLocality?: string | null;
  readonly addressCountry?: string;
  readonly sameAs?: readonly string[];
}

/**
 * §21 asks for `Organization` + `EducationalOrganization` with the real address.
 * `EducationalOrganization` is a subtype of `Organization`, so one node with the
 * more specific type says both — two nodes would only duplicate the entity.
 */
export function organizationJsonLd(input: OrganizationInput): JsonLdNode | null {
  const name = text(input.name);
  if (name === undefined) return null;

  const street = text(input.address);
  const address =
    street === undefined
      ? undefined
      : compact({
          '@type': 'PostalAddress',
          streetAddress: street,
          addressLocality: text(input.addressLocality),
          addressCountry: input.addressCountry ?? 'MA',
        });

  const sameAs = (input.sameAs ?? []).filter((href) => text(href) !== undefined);

  return {
    '@context': 'https://schema.org',
    '@type': 'EducationalOrganization',
    '@id': `${siteOrigin()}/#organization`,
    ...compact({
      name,
      url: absoluteUrl(input.locale),
      description: text(input.description),
      logo: text(input.logoUrl),
      telephone: text(input.phone),
      email: text(input.email),
      address,
      sameAs: sameAs.length > 0 ? sameAs : undefined,
    }),
  };
}

/* ── WebSite ─────────────────────────────────────────────────────────────── */

export interface WebSiteInput {
  readonly locale: Locale;
  readonly name: string;
  readonly description?: string | null;
  /**
   * Locale-relative path of the search page with `{search_term_string}` where
   * the query goes, e.g. `/formations?q={search_term_string}`. Omitted → no
   * `SearchAction`, which is correct until a real search endpoint exists.
   */
  readonly searchPath?: string | null;
}

export function webSiteJsonLd(input: WebSiteInput): JsonLdNode | null {
  const name = text(input.name);
  if (name === undefined) return null;

  const searchPath = text(input.searchPath);
  const potentialAction =
    searchPath === undefined
      ? undefined
      : {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${siteOrigin()}/${input.locale}${searchPath.startsWith('/') ? searchPath : `/${searchPath}`}`,
          },
          'query-input': 'required name=search_term_string',
        };

  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${siteOrigin()}/#website`,
    ...compact({
      name,
      url: absoluteUrl(input.locale),
      description: text(input.description),
      inLanguage: input.locale,
      publisher: { '@id': `${siteOrigin()}/#organization` },
      potentialAction,
    }),
  };
}

/* ── Course ──────────────────────────────────────────────────────────────── */

export type CourseDeliveryMode = 'EN_LIGNE' | 'PRESENTIEL' | 'HYBRIDE';

export interface CourseJsonLdInput {
  readonly locale: Locale;
  /** Locale-relative, e.g. `/formations/marketing-digital`. */
  readonly path: string;
  readonly name: string;
  readonly description?: string | null;
  readonly providerName: string;
  readonly imageUrl?: string | null;
  /** Integer centimes. `0` is a genuinely free course; `null` means "not priced". */
  readonly priceCentimes?: number | null;
  readonly currency?: string;
  readonly deliveryMode?: CourseDeliveryMode | null;
  /** ISO 8601 duration, e.g. `PT12H30M`. */
  readonly durationIso?: string | null;
  readonly contentLocale?: Locale | null;
  /** Only ever from moderated `Review` rows — never a fabricated score (§21). */
  readonly ratingValue?: number | null;
  readonly ratingCount?: number | null;
}

/** schema.org's `courseMode` vocabulary, mapped from the `DeliveryMode` enum. */
const COURSE_MODE: Record<CourseDeliveryMode, string> = {
  EN_LIGNE: 'online',
  PRESENTIEL: 'onsite',
  HYBRIDE: 'blended',
};

/**
 * A `Course` node with `offers` in MAD and a `hasCourseInstance` (§21).
 *
 * `hasCourseInstance` is not decoration: since 2023 Google drops `Course` rich
 * results that lack one. `aggregateRating` is emitted only when there is at
 * least one real approved review — a `ratingCount` of zero with a `ratingValue`
 * of zero is exactly the fabricated rating §21 forbids.
 */
export function courseJsonLd(input: CourseJsonLdInput): JsonLdNode | null {
  const name = text(input.name);
  const provider = text(input.providerName);
  if (name === undefined || provider === undefined) return null;

  const url = absoluteUrl(input.locale, input.path);
  const currency = input.currency ?? 'MAD';

  const price = input.priceCentimes;
  const offers =
    price === null || price === undefined || !Number.isFinite(price) || price < 0
      ? undefined
      : {
          '@type': 'Offer',
          price: (Math.round(price) / 100).toFixed(2),
          priceCurrency: currency,
          availability: 'https://schema.org/InStock',
          category: price === 0 ? 'Free' : 'Paid',
          url,
        };

  const mode = input.deliveryMode ?? null;
  const instance = compact({
    '@type': 'CourseInstance',
    courseMode: mode === null ? undefined : COURSE_MODE[mode],
    courseWorkload: text(input.durationIso),
    inLanguage: input.contentLocale ?? input.locale,
  });

  const ratingValue = input.ratingValue ?? 0;
  const ratingCount = input.ratingCount ?? 0;
  const aggregateRating =
    ratingCount > 0 && ratingValue > 0
      ? {
          '@type': 'AggregateRating',
          ratingValue: Math.round(ratingValue * 10) / 10,
          ratingCount,
          bestRating: 5,
          worstRating: 1,
        }
      : undefined;

  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    ...compact({
      '@id': `${url}#course`,
      name,
      url,
      description: text(input.description),
      image: text(input.imageUrl),
      inLanguage: input.contentLocale ?? input.locale,
      provider: compact({
        '@type': 'EducationalOrganization',
        '@id': `${siteOrigin()}/#organization`,
        name: provider,
      }),
      hasCourseInstance: instance,
      offers,
      aggregateRating,
    }),
  };
}

/* ── ItemList ────────────────────────────────────────────────────────────── */

export interface ItemListEntry {
  readonly name: string;
  /** Locale-relative path. */
  readonly path: string;
}

export interface ItemListInput {
  readonly locale: Locale;
  readonly name?: string | null;
  readonly items: readonly ItemListEntry[];
}

/** An empty list is not a list — a zero-result catalogue emits nothing. */
export function itemListJsonLd(input: ItemListInput): JsonLdNode | null {
  const entries = input.items
    .map((item, index) => {
      const name = text(item.name);
      if (name === undefined) return null;
      return {
        '@type': 'ListItem' as const,
        position: index + 1,
        name,
        url: absoluteUrl(input.locale, item.path),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (entries.length === 0) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    ...compact({
      name: text(input.name),
      numberOfItems: entries.length,
      itemListElement: entries,
    }),
  };
}

/* ── BreadcrumbList ──────────────────────────────────────────────────────── */

export interface BreadcrumbEntry {
  readonly name: string;
  /** Locale-relative path. The last crumb may omit it — it is the current page. */
  readonly path?: string;
}

/**
 * A one-crumb trail is not a trail: « Accueil » alone describes no hierarchy, so
 * it emits nothing rather than a degenerate list.
 */
export function breadcrumbListJsonLd(
  locale: Locale,
  crumbs: readonly BreadcrumbEntry[],
): JsonLdNode | null {
  const entries = crumbs
    .map((crumb, index) => {
      const name = text(crumb.name);
      if (name === undefined) return null;
      return compact({
        '@type': 'ListItem',
        position: index + 1,
        name,
        item: crumb.path === undefined ? undefined : absoluteUrl(locale, crumb.path),
      });
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (entries.length < 2) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: entries,
  };
}

/* ── FAQPage ─────────────────────────────────────────────────────────────── */

export interface FaqEntry {
  readonly question: string;
  readonly answer: string;
}

/**
 * `FAQPage` requires every entry to have both a question and an answer that are
 * *visible on the page*. Entries missing either are dropped; an empty result
 * emits nothing.
 */
export function faqPageJsonLd(entries: readonly FaqEntry[]): JsonLdNode | null {
  const questions = entries
    .map((entry) => {
      const question = text(entry.question);
      const answer = text(entry.answer);
      if (question === undefined || answer === undefined) return null;
      return {
        '@type': 'Question' as const,
        name: question,
        acceptedAnswer: { '@type': 'Answer' as const, text: answer },
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (questions.length === 0) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions,
  };
}

/* ── ContactPage / Article helpers used by the secondary pages ───────────── */

export interface WebPageInput {
  readonly locale: Locale;
  readonly path: string;
  readonly name: string;
  readonly description?: string | null;
  /** `ContactPage`, `AboutPage`, `CollectionPage`, … Defaults to `WebPage`. */
  readonly type?: string;
  /** ISO 8601 — the `Page` row's `updatedAt`, for a legal document. */
  readonly dateModified?: string | null;
}

export function webPageJsonLd(input: WebPageInput): JsonLdNode | null {
  const name = text(input.name);
  if (name === undefined) return null;

  const url = absoluteUrl(input.locale, input.path);

  return {
    '@context': 'https://schema.org',
    '@type': input.type ?? 'WebPage',
    ...compact({
      '@id': `${url}#webpage`,
      name,
      url,
      description: text(input.description),
      inLanguage: input.locale,
      dateModified: text(input.dateModified),
      isPartOf: { '@id': `${siteOrigin()}/#website` },
      publisher: { '@id': `${siteOrigin()}/#organization` },
    }),
  };
}
