/**
 * The answer policy — where "100 % accurate" is turned into something a machine
 * can actually guarantee (§16.3, §16.4).
 *
 * ## The problem this file exists to solve
 * No generative model is 100 % accurate, and no amount of prompting makes one
 * so. What *is* achievable — and what the owner actually needs — is a system
 * that **never states something it cannot source**. A wrong price or a wrong
 * RIB costs this business a customer and a refund; "je ne trouve pas cette
 * information dans le contenu du centre, voulez-vous parler à un conseiller ?"
 * costs it nothing. So the policy is: answer exactly, answer with a citation,
 * or refuse. There is no fourth branch.
 *
 * ## The three tiers
 *
 * | Tier | Path | Who writes the words | Accuracy |
 * |---|---|---|---|
 * | 1 | **Curated** — an admin-approved Q&A pair matched by normalised text or retrieval | a human | exact, by construction |
 * | 2 | **Grounded** — retrieved chunks above the floor, every claim citable | the model, from the chunks | verifiable |
 * | 3 | **Refuse** — below the floor, or the answer could not be verified | nobody | no wrong answer possible |
 *
 * Tier 1 involves no model at all: the stored answer is returned byte for byte,
 * so there is no step at which it can be distorted. At a training centre most
 * real questions — price, schedule, bank transfer, how to enrol, what is
 * included, is there a certificate — are the same twenty questions, and they
 * belong in tier 1. That is what makes the deterministic path the *majority*
 * path rather than a fallback.
 *
 * ## Everything here is pure
 * No database, no network, no clock, no `env`. `classify` is a function of its
 * arguments and nothing else, which is what makes the tier boundaries testable
 * rather than aspirational. Retrieval (SQL, entitlement pre-filtering, fusion)
 * is M7's job and lives elsewhere; this module only decides what to do with the
 * candidates retrieval produced.
 *
 * @see docs/AI.md for the calibration procedure behind the constants below.
 */

import type { Locale } from '@/i18n/routing';

/* ────────────────────────────────────────────────────────────────────────────
 * The score space
 *
 * Every `score` reaching this module is a **normalised relevance in [0, 1]**,
 * not a raw cosine. That distinction is load-bearing: sentence-embedding models
 * of the E5 family compress their similarity range badly — two *unrelated*
 * multilingual sentences typically sit around 0.70–0.78 cosine, and genuinely
 * relevant pairs above ~0.82. A floor expressed as a raw cosine would therefore
 * mean something completely different from what it reads like, and would change
 * meaning the day the embedding model changes.
 *
 * `rescaleCosine` maps the model's usable band onto [0, 1] so the floors below
 * can be read, tuned and reasoned about as plain relevance percentages, and so
 * swapping the embedding model is a one-constant change here rather than a
 * re-tuning of every threshold in the codebase.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The cosine similarity below which `multilingual-e5-small` is saying nothing.
 * Measured as the level unrelated cross-language sentence pairs converge to;
 * re-measure and change this constant when the embedding model changes.
 */
export const COSINE_NOISE_FLOOR = 0.7;

/** Map a raw cosine similarity onto the normalised [0, 1] relevance scale. */
export function rescaleCosine(cosine: number): number {
  if (!Number.isFinite(cosine)) return 0;
  return clamp01((cosine - COSINE_NOISE_FLOOR) / (1 - COSINE_NOISE_FLOOR));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The constants that define the policy
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Relevance a curated Q&A pair must reach before its answer is served
 * **verbatim**, without a model.
 *
 * Set high on purpose. Serving a curated answer is committing to it word for
 * word, so a near-miss must not qualify: answering the price of the wrong
 * course with full confidence is the single worst failure mode this system has.
 * When a curated pair scores between {@link GROUNDING_FLOOR} and this value it
 * is not discarded — it falls through to tier 2 as an ordinary (highly boosted)
 * source, where the model must ground its answer in it and cite it.
 */
export const CURATED_FLOOR = 0.6;

/**
 * Relevance a retrieved chunk must reach to be usable as grounding at all.
 *
 * 0.28 on the normalised scale is the value spec §16.3 starts from, and it is
 * deliberately permissive: its job is not to guarantee a good answer, it is to
 * keep obvious noise out of the context window. The guarantee comes from the
 * citation requirement below — the model may only assert what a retained chunk
 * supports, and an answer that cites nothing is discarded. Tune against the
 * evaluation set; raising it trades recall for a higher refusal rate, which is
 * the safe direction to err in.
 */
export const GROUNDING_FLOOR = 0.28;

/**
 * How far the best chunk must beat the best chunk on a DIFFERENT subject before
 * the assistant is willing to answer at all.
 *
 * An absolute floor is not enough, and this was measured rather than guessed.
 * Asking « Do I get a certificate at the end? » in English against a French
 * corpus ranked the *payment* passage first at 0.463 rescaled, with the correct
 * certificate passage second at 0.445 — a gap of 0.018. Both clear
 * GROUNDING_FLOOR comfortably, so a floor-only policy would have answered a
 * question about certificates with the bank-transfer procedure, confidently and
 * with a citation.
 *
 * When the top two come from different sources and are this close, retrieval has
 * not actually identified a subject. Refusing and offering the hand-off is the
 * correct answer; guessing between two plausible passages is how a "100 %
 * accurate" assistant quietly becomes a liability.
 *
 * Chunks from the SAME source are exempt: two paragraphs of one lesson scoring
 * alike is corroboration, not ambiguity.
 */
export const DISAMBIGUATION_MARGIN = 0.06;

/**
 * A grounded answer must cite at least this many retrieved chunks.
 *
 * This is the structural half of "no unsourced claims". The prompt asks for
 * citations; {@link verifyCitations} *enforces* them, and an answer that comes
 * back with none is downgraded to a refusal rather than shown. A model that
 * ignores its instructions therefore produces silence, not a plausible
 * fabrication.
 */
export const MIN_CITATIONS = 1;

/** Chunks passed to the model. §16.3: top 6. */
export const MAX_GROUNDED_CHUNKS = 6;

/**
 * Character budget for the whole `<documents>` block. §16.3 caps it at ~3000
 * tokens; 8000 characters is that budget at the ~2.7 characters/token a
 * French/Arabic mix costs on a multilingual tokenizer. Characters rather than
 * tokens because this module must stay pure — it cannot load a tokenizer.
 */
export const MAX_GROUNDED_CHARS = 8_000;

/**
 * Queries shorter than this are not questions. Below it the retrieval scores
 * are meaningless and the curated matcher would fire on coincidences
 * ("prix" vs "prix ?" is fine; "ok" is not).
 */
export const MIN_QUERY_CHARS = 3;

/* ────────────────────────────────────────────────────────────────────────────
 * Candidates
 * ────────────────────────────────────────────────────────────────────────── */

/** Mirrors the Prisma `ChunkSource` enum, kept local so this module stays pure. */
export type CandidateSource =
  | 'COURSE'
  | 'LESSON'
  | 'TRANSCRIPT'
  | 'RESOURCE'
  | 'FAQ'
  | 'CURATED_ANSWER'
  | 'SITE_PAGE';

/** An admin-approved question/answer pair (`CuratedAnswer`, status `APPROVED`). */
export interface CuratedCandidate {
  readonly kind: 'curated';
  readonly id: string;
  readonly question: string;
  /** Returned to the student **unchanged** when this candidate wins. */
  readonly answer: string;
  readonly locale: Locale;
  readonly courseId: string | null;
  /** Normalised relevance in [0, 1]. */
  readonly score: number;
}

/** A retrieved `KnowledgeChunk`. */
export interface ChunkCandidate {
  readonly kind: 'chunk';
  readonly id: string;
  readonly source: CandidateSource;
  readonly locale: Locale;
  readonly heading: string | null;
  readonly content: string;
  readonly courseId: string | null;
  readonly lessonId: string | null;
  /** Transcript chunks carry their start second so a citation can deep-link. */
  readonly startSec: number | null;
  /** Normalised relevance in [0, 1]. */
  readonly score: number;
}

export type Candidate = CuratedCandidate | ChunkCandidate;

/* ────────────────────────────────────────────────────────────────────────────
 * The decision
 * ────────────────────────────────────────────────────────────────────────── */

/** Provenance shown to the student under a tier-1 answer. */
export interface CuratedSource {
  readonly curatedAnswerId: string;
  readonly question: string;
  readonly locale: Locale;
  readonly courseId: string | null;
}

export interface CuratedDecision {
  readonly kind: 'curated';
  /** Verbatim. Never rewritten, never summarised, never passed through a model. */
  readonly answer: string;
  readonly source: CuratedSource;
  readonly score: number;
  /** `true` when the normalised query matched the stored question exactly. */
  readonly exact: boolean;
}

export interface GroundedDecision {
  readonly kind: 'grounded';
  readonly chunks: readonly ChunkCandidate[];
  readonly topScore: number;
}

/**
 * Why the assistant declined. The UI maps these to a translated sentence plus
 * the WhatsApp hand-off; this module never produces user-facing prose.
 */
export type RefusalReason =
  /** Empty or shorter than {@link MIN_QUERY_CHARS}. */
  | 'query_too_short'
  /** Retrieval returned nothing at all — usually an out-of-scope subject. */
  | 'no_candidates'
  /** Candidates existed but none reached {@link GROUNDING_FLOOR}. */
  | 'below_floor'
  /** Above the floor, but nothing citable survived the context budget. */
  | 'no_citable_source'
  /**
   * Several unrelated passages scored almost identically, so the retrieval
   * cannot say which subject was asked about. See {@link DISAMBIGUATION_MARGIN}.
   */
  | 'ambiguous_candidates'
  /** A generated answer failed {@link verifyCitations} and was thrown away. */
  | 'unverified_answer';

export interface RefuseDecision {
  readonly kind: 'refuse';
  readonly reason: RefusalReason;
  /**
   * Best score seen, for the `À revoir` queue and the gap clustering (§16.6).
   * `0` when there were no candidates at all.
   */
  readonly topScore: number;
}

export type AnswerDecision = CuratedDecision | GroundedDecision | RefuseDecision;

export interface ClassifyOptions {
  /**
   * The student's locale. When given, tier 1 only serves curated answers in
   * that locale — a verbatim answer in a language the student did not ask in is
   * a wrong answer, however correct its content. Tier 2 keeps cross-locale
   * chunks, because there the model writes in the student's language and the
   * retrieval boost (§16.3) already favours the matching locale.
   */
  readonly locale?: Locale;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Text normalisation — the tier-1 matcher
 * ────────────────────────────────────────────────────────────────────────── */

const COMBINING_MARKS = /\p{M}+/gu;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;
const ARABIC_TATWEEL = /ـ/gu;

/** Arabic orthographic variants that carry no meaning for matching purposes. */
const ARABIC_FOLDING: ReadonlyArray<readonly [RegExp, string]> = [
  [/ة/gu, 'ه'], // ة → ه
  [/[ىي]/gu, 'ي'], // ى → ي
  [/[ٱٰ]/gu, 'ا'], // ٱ, dagger alef → ا
];

/** Arabic-Indic and extended Arabic-Indic digits → Western digits. */
function foldDigits(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660);
    else if (code >= 0x06f0 && code <= 0x06f9) out += String(code - 0x06f0);
    else out += character;
  }
  return out;
}

/**
 * Fold a question down to the form the curated matcher compares.
 *
 * « Quel est le PRIX de la formation ? » and « quel est le prix de la
 * formation » must be the same key, and so must « ما هو السِّعر ؟ » and
 * « ما هو السعر ». Canonical NFD decomposition followed by stripping combining
 * marks handles French accents and Arabic tashkeel in one pass — `é` decomposes
 * to `e` + acute, `أ` to `ا` + hamza — after which only the Arabic letters that
 * have no decomposition need explicit folding.
 *
 * Exported because it is the single most test-worthy function in the tier-1
 * path: every false positive it produces is a confidently wrong answer.
 */
export function normaliseQuestion(value: string): string {
  let folded = foldDigits(value)
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(ARABIC_TATWEEL, '');
  for (const [pattern, replacement] of ARABIC_FOLDING) {
    folded = folded.replace(pattern, replacement);
  }
  return folded.toLowerCase().replace(NON_ALPHANUMERIC, ' ').trim();
}

/** `true` when a query and a curated question fold to the same key. */
export function isExactCuratedMatch(query: string, question: string): boolean {
  const left = normaliseQuestion(query);
  if (left.length < MIN_QUERY_CHARS) return false;
  return left === normaliseQuestion(question);
}

/* ────────────────────────────────────────────────────────────────────────────
 * classify
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Decide how — or whether — to answer.
 *
 * ```ts
 * const decision = classify(question, candidates, { locale });
 * switch (decision.kind) {
 *   case 'curated':  return send(decision.answer, decision.source); // no model
 *   case 'grounded': return stream(await generate(decision.chunks));
 *   case 'refuse':   return sendRefusal(decision.reason);           // + WhatsApp
 * }
 * ```
 *
 * @param query      the student's question, raw
 * @param candidates everything retrieval found, already entitlement-filtered
 *                   **in SQL** (§16.3 — this function cannot and must not be
 *                   the place access control happens)
 */
export function classify(
  query: string,
  candidates: readonly Candidate[],
  options: ClassifyOptions = {},
): AnswerDecision {
  const normalised = normaliseQuestion(query);
  if (normalised.length < MIN_QUERY_CHARS) {
    return { kind: 'refuse', reason: 'query_too_short', topScore: 0 };
  }

  const curated: CuratedCandidate[] = [];
  const chunks: ChunkCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (candidate.kind === 'curated') curated.push(candidate);
    else chunks.push(candidate);
  }

  if (curated.length === 0 && chunks.length === 0) {
    return { kind: 'refuse', reason: 'no_candidates', topScore: 0 };
  }

  const tierOne = selectCurated(normalised, curated, options.locale);
  if (tierOne !== null) return tierOne;

  const tierTwo = selectGrounded(chunks);
  if (tierTwo === 'ambiguous') {
    return { kind: 'refuse', reason: 'ambiguous_candidates', topScore: highestScore(candidates) };
  }
  if (tierTwo !== null) return tierTwo;

  const topScore = highestScore(candidates);
  return { kind: 'refuse', reason: topScore > 0 ? 'below_floor' : 'no_candidates', topScore };
}

/**
 * Tier 1. An exact normalised match wins outright regardless of its retrieval
 * score — a human wrote that pair for that question, and no similarity metric
 * has standing to disagree.
 */
function selectCurated(
  normalisedQuery: string,
  curated: readonly CuratedCandidate[],
  locale: Locale | undefined,
): CuratedDecision | null {
  const eligible =
    locale === undefined ? curated : curated.filter((entry) => entry.locale === locale);
  if (eligible.length === 0) return null;

  for (const entry of eligible) {
    if (normaliseQuestion(entry.question) === normalisedQuery) {
      return { kind: 'curated', answer: entry.answer, source: sourceOf(entry), score: 1, exact: true };
    }
  }

  let best: CuratedCandidate | null = null;
  for (const entry of eligible) {
    if (best === null || clamp01(entry.score) > clamp01(best.score)) best = entry;
  }
  if (best === null) return null;

  const score = clamp01(best.score);
  if (score < CURATED_FLOOR) return null;

  return { kind: 'curated', answer: best.answer, source: sourceOf(best), score, exact: false };
}

function sourceOf(entry: CuratedCandidate): CuratedSource {
  return {
    curatedAnswerId: entry.id,
    question: entry.question,
    locale: entry.locale,
    courseId: entry.courseId,
  };
}

/**
 * Tier 2. Keep what clears the floor, best first, until the chunk count or the
 * character budget runs out. The single best chunk is always kept even if it
 * alone exceeds the budget — the context builder truncates it; dropping it
 * would turn a groundable question into a refusal for a formatting reason.
 */
function selectGrounded(chunks: readonly ChunkCandidate[]): GroundedDecision | 'ambiguous' | null {
  const above = chunks
    .map((chunk) => ({ chunk, score: clamp01(chunk.score) }))
    .filter((entry) => entry.score >= GROUNDING_FLOOR)
    .sort((left, right) => right.score - left.score);

  if (above.length === 0) return null;

  // Ambiguity guard. Compare the winner against the best candidate belonging to
  // a DIFFERENT subject — a different lesson, or a different course when the
  // chunk is not lesson-scoped. Two chunks of the same lesson agreeing is
  // corroboration; two unrelated lessons tying means retrieval has not resolved
  // the question, and answering would be a coin flip wearing a citation.
  const winner = above[0];
  if (winner !== undefined) {
    const subjectOf = (entry: (typeof above)[number]): string =>
      entry.chunk.lessonId ?? entry.chunk.courseId ?? entry.chunk.id;
    const winningSubject = subjectOf(winner);
    const rival = above.find((entry) => subjectOf(entry) !== winningSubject);
    if (rival !== undefined && winner.score - rival.score < DISAMBIGUATION_MARGIN) {
      return 'ambiguous';
    }
  }

  const kept: ChunkCandidate[] = [];
  let budget = MAX_GROUNDED_CHARS;
  for (const entry of above) {
    if (kept.length >= MAX_GROUNDED_CHUNKS) break;
    const cost = entry.chunk.content.length;
    if (kept.length > 0 && cost > budget) continue;
    kept.push(entry.chunk);
    budget -= cost;
  }

  if (kept.length < MIN_CITATIONS) return null;

  const top = above[0];
  return { kind: 'grounded', chunks: kept, topScore: top === undefined ? 0 : top.score };
}

function highestScore(candidates: readonly Candidate[]): number {
  let top = 0;
  for (const candidate of candidates) {
    const score = clamp01(candidate.score);
    if (score > top) top = score;
  }
  return top;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Citation enforcement — the structural half of the guarantee
 * ────────────────────────────────────────────────────────────────────────── */

export type CitationVerdict =
  | { readonly ok: true; readonly citedChunkIds: readonly string[] }
  | {
      readonly ok: false;
      readonly reason: 'missing_citation' | 'unknown_citation';
      /** The fabricated identifier, when the model invented one. */
      readonly offendingId: string | null;
    };

/**
 * Check a generated answer's citations against the chunks it was actually given.
 *
 * Two failures, both fatal. **No citation** means the model wrote from its own
 * weights rather than from the context — exactly the behaviour that produces a
 * confident wrong price. **Unknown citation** means it invented a source, which
 * is worse, because a fabricated citation reads as evidence.
 *
 * The caller must treat a failed verdict as a refusal; see
 * {@link enforceGrounding}.
 */
export function verifyCitations(
  citedChunkIds: readonly string[],
  offered: readonly { readonly id: string }[],
): CitationVerdict {
  const allowed = new Set(offered.map((chunk) => chunk.id));
  const cited: string[] = [];

  for (const id of citedChunkIds) {
    const trimmed = id.trim();
    if (trimmed.length === 0) continue;
    if (!allowed.has(trimmed)) {
      return { ok: false, reason: 'unknown_citation', offendingId: trimmed };
    }
    if (!cited.includes(trimmed)) cited.push(trimmed);
  }

  if (cited.length < MIN_CITATIONS) {
    return { ok: false, reason: 'missing_citation', offendingId: null };
  }
  return { ok: true, citedChunkIds: cited };
}

/**
 * Apply {@link verifyCitations} to a grounded decision after generation:
 * the same decision with only the cited chunks kept, or a refusal.
 *
 * Narrowing the chunks to the cited set is deliberate — the citation chips the
 * student sees must be the sources the answer actually used, not everything
 * that happened to be retrieved.
 */
export function enforceGrounding(
  decision: GroundedDecision,
  citedChunkIds: readonly string[],
): GroundedDecision | RefuseDecision {
  const verdict = verifyCitations(citedChunkIds, decision.chunks);
  if (!verdict.ok) {
    return { kind: 'refuse', reason: 'unverified_answer', topScore: decision.topScore };
  }
  const cited = new Set(verdict.citedChunkIds);
  return {
    kind: 'grounded',
    chunks: decision.chunks.filter((chunk) => cited.has(chunk.id)),
    topScore: decision.topScore,
  };
}

/**
 * `true` when the decision needs a language model to become an answer.
 *
 * The whole point of tier 1 is that this is `false` for most real traffic, and
 * the whole point of the `'none'` provider is that a `false` here still
 * produces a complete, useful assistant.
 */
export function requiresGeneration(decision: AnswerDecision): decision is GroundedDecision {
  return decision.kind === 'grounded';
}
