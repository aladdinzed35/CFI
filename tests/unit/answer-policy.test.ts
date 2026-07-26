import { describe, expect, it } from 'vitest';

import {
  CURATED_FLOOR,
  DISAMBIGUATION_MARGIN,
  GROUNDING_FLOOR,
  classify,
  normaliseQuestion,
  rescaleCosine,
  type ChunkCandidate,
  type CuratedCandidate,
} from '@/server/ai/answer-policy';

/**
 * The assistant's precision guarantee lives here, so these are not
 * illustrative tests — each one pins a decision that, if it flipped, would let
 * the assistant state something false to a student with a citation attached.
 */

function chunk(
  id: string,
  lessonId: string | null,
  score: number,
  content = 'Contenu de la leçon.',
): ChunkCandidate {
  return {
    kind: 'chunk',
    id,
    source: 'LESSON',
    locale: 'fr',
    heading: null,
    content,
    courseId: 'course-1',
    lessonId,
    startSec: null,
    score,
  };
}

function curated(id: string, question: string, answer: string, score: number): CuratedCandidate {
  // courseId null = a centre-wide answer (pricing, hours, transfer procedure),
  // which is what the curated tier mostly holds.
  return { kind: 'curated', id, locale: 'fr', question, answer, score, courseId: null };
}

describe('classify — tier 1, curated answers', () => {
  it('returns a human-written answer verbatim when the question matches exactly', () => {
    const decision = classify('Comment payer ma formation ?', [
      curated('faq-1', 'Comment payer ma formation ?', 'Par virement bancaire.', 0.99),
    ]);

    expect(decision.kind).toBe('curated');
    if (decision.kind !== 'curated') return;
    expect(decision.answer).toBe('Par virement bancaire.');
    expect(decision.exact).toBe(true);
  });

  it('matches regardless of accents, case and punctuation', () => {
    const decision = classify('COMMENT PAYER MA FORMATION', [
      curated('faq-1', 'Comment payer ma formation ?', 'Par virement bancaire.', 0.5),
    ]);
    expect(decision.kind).toBe('curated');
  });

  it('does not treat a merely similar curated pair as exact', () => {
    const decision = classify('Puis-je payer en plusieurs fois ?', [
      curated('faq-1', 'Comment payer ma formation ?', 'Par virement bancaire.', CURATED_FLOOR + 0.1),
    ]);
    if (decision.kind === 'curated') expect(decision.exact).toBe(false);
  });
});

describe('classify — the ambiguity guard', () => {
  /**
   * Measured against the real model, not invented. Asking « Do I get a
   * certificate at the end? » in English against a French corpus ranked the
   * PAYMENT passage first at 0.463 rescaled, with the correct certificate
   * passage second at 0.445. Both clear GROUNDING_FLOOR, so a floor-only policy
   * answers a question about certificates with the bank-transfer procedure.
   */
  it('refuses when two different subjects score within the margin', () => {
    const decision = classify('Do I get a certificate at the end?', [
      chunk('a', 'lesson-payment', 0.463),
      chunk('b', 'lesson-certificate', 0.445),
    ]);

    expect(decision.kind).toBe('refuse');
    if (decision.kind !== 'refuse') return;
    expect(decision.reason).toBe('ambiguous_candidates');
  });

  it('answers when the winner is clearly ahead', () => {
    const decision = classify('Comment payer ma formation ?', [
      chunk('a', 'lesson-payment', 0.599),
      chunk('b', 'lesson-certificate', 0.388),
    ]);
    expect(decision.kind).toBe('grounded');
  });

  it('treats two chunks of the SAME lesson as corroboration, not ambiguity', () => {
    const decision = classify('Comment payer ma formation ?', [
      chunk('a', 'lesson-payment', 0.599),
      chunk('b', 'lesson-payment', 0.595),
    ]);
    expect(decision.kind).toBe('grounded');
  });

  it('is exactly at the boundary, not approximately', () => {
    const justUnder = classify('question de test', [
      chunk('a', 'lesson-one', 0.5),
      chunk('b', 'lesson-two', 0.5 - DISAMBIGUATION_MARGIN + 0.001),
    ]);
    const justOver = classify('question de test', [
      chunk('a', 'lesson-one', 0.5),
      chunk('b', 'lesson-two', 0.5 - DISAMBIGUATION_MARGIN - 0.001),
    ]);

    expect(justUnder.kind).toBe('refuse');
    expect(justOver.kind).toBe('grounded');
  });
});

describe('classify — refusal rather than guessing', () => {
  it('refuses an empty or trivially short question', () => {
    const decision = classify('  ?  ', [chunk('a', 'lesson-one', 0.9)]);
    expect(decision.kind).toBe('refuse');
    if (decision.kind === 'refuse') expect(decision.reason).toBe('query_too_short');
  });

  it('refuses when retrieval returned nothing', () => {
    const decision = classify('Quelle est la capitale du Japon ?', []);
    expect(decision.kind).toBe('refuse');
    if (decision.kind === 'refuse') expect(decision.reason).toBe('no_candidates');
  });

  it('refuses when everything sits below the grounding floor', () => {
    const decision = classify('Quelle est la capitale du Japon ?', [
      chunk('a', 'lesson-one', GROUNDING_FLOOR - 0.01),
    ]);
    expect(decision.kind).toBe('refuse');
    if (decision.kind === 'refuse') expect(decision.reason).toBe('below_floor');
  });
});

describe('normaliseQuestion', () => {
  it('folds French accents and case', () => {
    expect(normaliseQuestion('Où est le CENTRE ?')).toBe(normaliseQuestion('ou est le centre'));
  });

  it('strips Arabic tashkeel and tatweel so a vowelled question still matches', () => {
    expect(normaliseQuestion('الدَّورة التدريبيـــة')).toBe(normaliseQuestion('الدورة التدريبية'));
  });

  it('folds Arabic-Indic digits onto ASCII', () => {
    expect(normaliseQuestion('٢٠٢٦')).toBe(normaliseQuestion('2026'));
  });
});

describe('rescaleCosine', () => {
  it('maps the noise floor to 0 and a perfect match to 1', () => {
    expect(rescaleCosine(0.7)).toBe(0);
    expect(rescaleCosine(1)).toBe(1);
  });

  it('clamps below the noise floor rather than going negative', () => {
    expect(rescaleCosine(0.2)).toBe(0);
  });

  it('spreads the band that raw cosine compresses', () => {
    // Raw 0.88 vs 0.82 looks like a 7 % difference; rescaled it is a real gap.
    const gap = rescaleCosine(0.88) - rescaleCosine(0.82);
    expect(gap).toBeGreaterThan(0.15);
  });
});
