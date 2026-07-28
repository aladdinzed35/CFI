import { db } from '@/server/db';
import type { Locale } from '@/i18n/routing';

/**
 * Read model for `/[locale]/faq` (§12.5).
 *
 * ## Why a file of its own
 * `public-pages.ts` already exposes `getFaqEntries`, and the pricing page uses
 * it to pull one category into a section. That is a *flat* list, which is the
 * right shape for a slice of the FAQ embedded in another page. The FAQ page
 * itself needs the opposite: every published row, bucketed by category, in an
 * editorial order, with the group order decided here rather than by whatever
 * `ORDER BY category` happens to produce. Rather than bend one function into
 * two shapes, the page gets its own reader.
 *
 * ## The fallback is per item, not per field (§10.2)
 * `FaqItem` stores translations as denormalised columns — `questionFr`,
 * `questionAr`, `answerEn`… — where only the French pair is non-null in the
 * schema. Resolving the question and the answer independently would let an
 * Arabic question sit above a French answer the day someone translates half a
 * row. So the **answer decides** which locale the item is served in and the
 * question follows it, exactly as `getEditorialPage` does for `Page`.
 *
 * ## Group order is editorial, not alphabetical
 * `FaqItem.order` is scoped to a category (three items numbered 1–3 in
 * `INSCRIPTION`, three more numbered 1–3 in `PAIEMENT`), so it cannot order the
 * groups themselves. `FAQ_GROUP_ORDER` below is that missing information: the
 * order a visitor actually needs the answers in — how do I sign up, how do I
 * pay, how do the courses work, what about my certificate, and only then the
 * technical questions. A category that is not on the list is appended in a
 * stable alphabetical tail instead of being dropped.
 *
 * ## Nothing here throws
 * A marketing page must render even when a query fails; the reader logs once
 * and returns an empty list, which the page turns into an honest empty state.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** One published question/answer pair, already resolved to a single locale. */
export interface FaqQuestion {
  readonly id: string;
  /** The raw `FaqItem.category` value — the page maps it to a label. */
  readonly category: string;
  readonly question: string;
  readonly answer: string;
  /** The locale actually served — `fr` when the requested one was missing. */
  readonly resolvedLocale: Locale;
}

/** A category and the questions filed under it, in `FaqItem.order`. */
export interface FaqGroup {
  readonly category: string;
  readonly items: readonly FaqQuestion[];
}

/**
 * The categories the centre files its answers under, in reading order.
 * Adding one here is enough to place it; it also needs a label under
 * `pages.faq.groups` in the four message catalogues.
 */
export const FAQ_GROUP_ORDER = [
  'INSCRIPTION',
  'PAIEMENT',
  'FORMATIONS',
  'CERTIFICAT',
  'TECHNIQUE',
] as const;

export type FaqGroupKey = (typeof FAQ_GROUP_ORDER)[number];

/** Does this `FaqItem.category` have a place — and a label — of its own? */
export function isFaqGroupKey(category: string): category is FaqGroupKey {
  return (FAQ_GROUP_ORDER as readonly string[]).includes(category);
}

/* -------------------------------------------------------------------------- */
/* Column resolution                                                           */
/* -------------------------------------------------------------------------- */

type FaqRow = Awaited<ReturnType<typeof db.faqItem.findMany>>[number];

interface FaqColumns {
  readonly question: 'questionFr' | 'questionAr' | 'questionEn' | 'questionEs';
  readonly answer: 'answerFr' | 'answerAr' | 'answerEn' | 'answerEs';
}

/**
 * Named columns rather than a `row[`question${suffix}`]` lookup: this way the
 * compiler checks the column exists, and renaming one in the schema breaks the
 * build instead of quietly serving `undefined` to a visitor.
 */
const COLUMN: Record<Locale, FaqColumns> = {
  fr: { question: 'questionFr', answer: 'answerFr' },
  ar: { question: 'questionAr', answer: 'answerAr' },
  en: { question: 'questionEn', answer: 'answerEn' },
  es: { question: 'questionEs', answer: 'answerEs' },
};

/** A non-empty trimmed string, or `null`. An empty column is not a translation. */
function clean(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/** Resolve one row to a single locale, or drop it if French itself is empty. */
function resolveItem(row: FaqRow, locale: Locale): FaqQuestion | null {
  const requested = clean(row[COLUMN[locale].answer]);
  const resolvedLocale: Locale = requested === null ? 'fr' : locale;

  const answer = requested ?? clean(row.answerFr);
  const question = clean(row[COLUMN[resolvedLocale].question]) ?? clean(row.questionFr);
  if (answer === null || question === null) return null;

  return { id: row.id, category: row.category, question, answer, resolvedLocale };
}

/* -------------------------------------------------------------------------- */
/* Reader                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every published `FaqItem`, grouped by category, in `locale` with the French
 * fallback applied. Empty groups never appear; a failed read returns `[]`.
 */
export async function getFaqGroups(locale: Locale): Promise<readonly FaqGroup[]> {
  let rows: readonly FaqRow[];

  try {
    rows = await db.faqItem.findMany({
      where: { isPublished: true },
      // Matches @@index([isPublished, category, order]); `id` only breaks ties
      // so that two items sharing an order never swap between requests.
      orderBy: [{ category: 'asc' }, { order: 'asc' }, { id: 'asc' }],
    });
  } catch (cause) {
    console.warn('[faq] lecture impossible, repli sur une liste vide.', cause);
    return [];
  }

  const byCategory = new Map<string, FaqQuestion[]>();
  for (const row of rows) {
    const item = resolveItem(row, locale);
    if (item === null) continue;

    const bucket = byCategory.get(item.category);
    if (bucket === undefined) byCategory.set(item.category, [item]);
    else bucket.push(item);
  }

  // Known categories first, in reading order; anything else in a stable tail.
  const ordered: string[] = FAQ_GROUP_ORDER.filter((category) => byCategory.has(category));
  const extras = [...byCategory.keys()]
    .filter((category) => !isFaqGroupKey(category))
    .sort((a, b) => a.localeCompare(b));

  return [...ordered, ...extras].map((category) => ({
    category,
    items: byCategory.get(category) ?? [],
  }));
}

/** Total questions across every group — what the result count starts from. */
export function countFaqQuestions(groups: readonly FaqGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0);
}
