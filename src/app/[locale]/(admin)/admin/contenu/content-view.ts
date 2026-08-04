import type { ActionErrorCode } from '@/server/auth/guards';
import { locales, type Locale } from '@/i18n/routing';

/**
 * The contract between `/admin/contenu` and its five tab components: the URL
 * parameter names, the tab list, the label maps and the view-model shapes.
 *
 * It carries **no directive on purpose**, exactly like `comptes/account-view.ts`.
 * A `'use client'` module exports client *references* into the server graph, and
 * a server module dragged into the browser bundle takes the Prisma client with
 * it. A neutral module is the only place both graphs can read the same constant.
 *
 * Nothing here touches the database, the environment or the DOM. Types that also
 * exist in `@/server/services/content-admin` are declared again rather than
 * imported: the shapes are structurally identical, so a drift between them fails
 * at the prop boundary in `page.tsx`, which is where it should fail.
 */

/* -------------------------------------------------------------------------- */
/* URL contract                                                                */
/* -------------------------------------------------------------------------- */

/** Search-parameter names. French, like every URL in this application (§10.1). */
export const PARAM = {
  tab: 'onglet',
} as const;

/**
 * The five tables an administrator edits here (§17.11).
 *
 * `labelKey` is relative to the `admin.cms` namespace. The homepage builder, the
 * media library and the announcements list are the other §17.11 surfaces; they
 * belong to other agents and other milestones, so they are absent rather than
 * present-and-dead (§8 of the brief: a later feature must not appear at all).
 */
export const CMS_TABS = [
  { key: 'pages', labelKey: 'sections.pages' },
  { key: 'faq', labelKey: 'sections.faq' },
  { key: 'temoignages', labelKey: 'sections.testimonials' },
  { key: 'blog', labelKey: 'sections.blog' },
  { key: 'categories', labelKey: 'sections.categories' },
] as const;

export type CmsTabKey = (typeof CMS_TABS)[number]['key'];

export const CMS_TAB_KEYS = CMS_TABS.map((tab) => tab.key) as [CmsTabKey, ...CmsTabKey[]];

export function isCmsTabKey(value: string): value is CmsTabKey {
  return (CMS_TAB_KEYS as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* Error mapping                                                               */
/* -------------------------------------------------------------------------- */

/** `ActionResult.error` → a key under `admin.actionError`. */
export const ACTION_ERROR_KEY: Record<ActionErrorCode, string> = {
  validation: 'validation',
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  csrf: 'csrf',
  rate_limited: 'rateLimited',
  not_found: 'notFound',
  conflict: 'conflict',
  server_error: 'server',
};

/* -------------------------------------------------------------------------- */
/* Localised fields                                                            */
/* -------------------------------------------------------------------------- */

/** One field in the four locales. `''` means "not translated", never `null`. */
export type LocalisedDraft = Record<Locale, string>;

/** French first — the source language every other column falls back to. */
export const EDITOR_LOCALES = locales;

export function emptyLocalised(): LocalisedDraft {
  return { fr: '', ar: '', en: '', es: '' };
}

/** How many of the four columns carry text. Drives the completeness indicator. */
export function translatedCount(value: LocalisedDraft): number {
  return EDITOR_LOCALES.filter((locale) => value[locale].trim() !== '').length;
}

/**
 * Percentage of the four locales that are filled, rounded.
 *
 * The editor shows this as a number next to a dot — the dot alone would be
 * colour carrying meaning, which §21 forbids.
 */
export function translatedPercent(...fields: readonly LocalisedDraft[]): number {
  if (fields.length === 0) return 0;
  const total = fields.length * EDITOR_LOCALES.length;
  const filled = fields.reduce((sum, field) => sum + translatedCount(field), 0);
  return Math.round((filled / total) * 100);
}

/* -------------------------------------------------------------------------- */
/* FAQ vocabulary                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `FaqItem.category` → the key of its label under the public `pages.faq.groups`
 * namespace. The admin deliberately shows the visitor-facing wording: an editor
 * filing a question needs to know which heading it will appear under on `/faq`.
 */
export const FAQ_CATEGORY_LABEL_KEY: Record<string, string> = {
  INSCRIPTION: 'inscription',
  PAIEMENT: 'paiement',
  FORMATIONS: 'formations',
  CERTIFICAT: 'certificat',
  TECHNIQUE: 'technique',
};

/** Fallback label key for a category the public page has no heading for. */
export const FAQ_CATEGORY_FALLBACK_KEY = 'other';

/* -------------------------------------------------------------------------- */
/* View models — built by the page, rendered by the client components          */
/* -------------------------------------------------------------------------- */

/** Dates arrive formatted: the browser never sees a timezone (§10.3). */
export interface PageItem {
  readonly id: string;
  readonly slug: string;
  readonly published: boolean;
  readonly title: LocalisedDraft;
  readonly body: LocalisedDraft;
  readonly seoTitle: string;
  readonly seoDescription: string;
  /** One of the four §12.5 documents: editable, never deletable. */
  readonly locked: boolean;
  readonly updatedAtLabel: string;
  readonly updatedAtIso: string;
}

export interface FaqItemView {
  readonly id: string;
  readonly category: string;
  readonly question: LocalisedDraft;
  readonly answer: LocalisedDraft;
  readonly published: boolean;
  readonly updatedAtLabel: string;
  readonly updatedAtIso: string;
}

export interface TestimonialItem {
  readonly id: string;
  readonly authorName: string;
  readonly authorRole: string;
  readonly rating: number;
  readonly quote: LocalisedDraft;
  readonly courseId: string | null;
  readonly featured: boolean;
  /** `Testimonial.isPublished` — the approval flag the public site filters on. */
  readonly published: boolean;
  readonly updatedAtLabel: string;
  readonly updatedAtIso: string;
}

/** What the blog list shows as a pill. Derived on the server, never from a client clock. */
export type BlogStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED';

export interface BlogItem {
  readonly id: string;
  readonly slug: string;
  readonly published: boolean;
  readonly status: BlogStatus;
  /** `YYYY-MM-DD`, or `''` when the post has never been dated. */
  readonly publishedOn: string;
  readonly publishedAtLabel: string;
  readonly title: LocalisedDraft;
  readonly excerpt: LocalisedDraft;
  readonly body: LocalisedDraft;
  readonly tags: string;
  readonly readMinutes: number;
  readonly updatedAtLabel: string;
  readonly updatedAtIso: string;
}

export interface CategoryItem {
  readonly id: string;
  readonly slug: string;
  readonly icon: string;
  readonly color: string;
  readonly isActive: boolean;
  readonly name: LocalisedDraft;
  readonly description: LocalisedDraft;
  readonly courseCount: number;
  readonly updatedAtLabel: string;
  readonly updatedAtIso: string;
}

/** A course a testimonial can point at. */
export interface CourseOption {
  readonly id: string;
  readonly title: string;
}

/* -------------------------------------------------------------------------- */
/* Shared editor vocabulary                                                    */
/* -------------------------------------------------------------------------- */

/** Colour tokens a category badge may carry (§3 — never a raw hex). */
export const CATEGORY_COLORS = ['strait', 'brass', 'success', 'warn', 'danger', 'ink'] as const;

export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export function isCategoryColor(value: string): value is CategoryColor {
  return (CATEGORY_COLORS as readonly string[]).includes(value);
}
