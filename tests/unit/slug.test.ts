import { describe, expect, it } from 'vitest';

import { isSlug, MAX_SLUG_LENGTH, slugify, uniqueSlug } from '@/lib/slug';

/**
 * Slugs (spec §10.1, §22).
 *
 * One canonical French slug per entity, for every locale. These tests pin the
 * three things a slug must never do: change shape when re-slugified, exceed the
 * database column width, or collide silently.
 */

describe('slugify — French', () => {
  it('strips accents and cedillas', () => {
    expect(slugify('Comptabilité générale')).toBe('comptabilite-generale');
    expect(slugify('Français : Ça va ?')).toBe('francais-ca-va');
    expect(slugify('Naïve façade — élève')).toBe('naive-facade-eleve');
    expect(slugify('Où êtes-vous ?')).toBe('ou-etes-vous');
  });

  it('expands the symbols a French course title actually contains', () => {
    expect(slugify('Développement Web & Mobile')).toBe('developpement-web-et-mobile');
    expect(slugify('Marketing Digital 100% pratique')).toBe(
      'marketing-digital-100-pourcent-pratique',
    );
    expect(slugify('Gestion de projet à 50 € par mois')).toBe('gestion-de-projet-a-50-eur-par-mois');
    expect(slugify('Œuvre & Æther, Straße')).toBe('oeuvre-et-aether-strasse');
  });

  it('collapses runs of punctuation and whitespace to a single hyphen', () => {
    expect(slugify('  Bureautique   &   IA  ')).toBe('bureautique-et-ia');
    expect(slugify('A---B___C')).toBe('a-b-c');
    expect(slugify('...Excel...')).toBe('excel');
  });

  it('returns an empty string when nothing usable survives', () => {
    expect(slugify('')).toBe('');
    expect(slugify('   ')).toBe('');
    expect(slugify('???')).toBe('');
    expect(slugify('---')).toBe('');
  });
});

describe('slugify — Arabic', () => {
  it('transliterates Arabic letters to a readable Latin slug', () => {
    expect(slugify('المحاسبة العامة')).toBe('almhasba-alaama');
    expect(slugify('التسويق الرقمي')).toBe('altswyq-alrqmy');
    expect(slugify('اللغة الفرنسية للمبتدئين')).toBe('allgha-alfrnsya-llmbtdyyn');
  });

  it('drops tashkeel and tatweel rather than encoding them', () => {
    expect(slugify('مَرْحَبًا بِكُمْ')).toBe('mrhba-bkm');
    expect(slugify('الــــمحاسبة')).toBe('almhasba');
    // Diacritics must not change the slug of the same word.
    expect(slugify('مَحَاسَبَة')).toBe(slugify('محاسبة'));
  });

  it('maps Arabic-Indic digits to Western digits', () => {
    expect(slugify('دورة ٢٠٢٦')).toBe('dwra-2026');
  });

  it('produces an ASCII-only slug that needs no percent-encoding', () => {
    const arabic = slugify('اللغة الفرنسية للمبتدئين');
    expect(arabic).toMatch(/^[a-z0-9-]+$/);
    expect(encodeURIComponent(arabic)).toBe(arabic);
  });
});

describe('slugify — length cap', () => {
  const longTitle =
    'Formation avancée en comptabilité générale et gestion financière des entreprises marocaines';

  it('never exceeds MAX_SLUG_LENGTH', () => {
    const slug = slugify(longTitle);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.length).toBeGreaterThan(0);
  });

  it('cuts on a word boundary rather than mid-syllable', () => {
    expect(slugify(longTitle)).toBe(
      'formation-avancee-en-comptabilite-generale-et-gestion-financiere-des',
    );
  });

  it('never leaves a trailing hyphen after truncation', () => {
    const slug = slugify(`${'a'.repeat(78)} bcdefgh`);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('truncates a single unbroken word at the cap', () => {
    const slug = slugify('a'.repeat(200));
    expect(slug).toBe('a'.repeat(MAX_SLUG_LENGTH));
  });
});

describe('slugify — idempotence', () => {
  const samples: readonly string[] = [
    'Comptabilité générale',
    'Développement Web & Mobile',
    'Marketing Digital 100% pratique',
    'المحاسبة العامة',
    'مَرْحَبًا بِكُمْ',
    'Œuvre & Æther, Straße',
    'Formation avancée en comptabilité générale et gestion financière des entreprises marocaines',
    '  ---  ',
    '???',
    '',
  ];

  it('slugify(slugify(x)) === slugify(x)', () => {
    for (const sample of samples) {
      const once = slugify(sample);
      expect(slugify(once), `not idempotent for ${JSON.stringify(sample)}`).toBe(once);
    }
  });

  it('every non-empty result is a valid slug', () => {
    for (const sample of samples) {
      const slug = slugify(sample);
      if (slug === '') continue;
      expect(isSlug(slug), `${JSON.stringify(slug)} is not a valid slug`).toBe(true);
    }
  });
});

describe('isSlug', () => {
  it('accepts well-formed slugs', () => {
    expect(isSlug('comptabilite-generale')).toBe(true);
    expect(isSlug('excel')).toBe(true);
    expect(isSlug('formation-2026')).toBe(true);
  });

  it('rejects anything the router could not round-trip', () => {
    expect(isSlug('')).toBe(false);
    expect(isSlug('-leading')).toBe(false);
    expect(isSlug('trailing-')).toBe(false);
    expect(isSlug('double--hyphen')).toBe(false);
    expect(isSlug('Comptabilite')).toBe(false);
    expect(isSlug('comptabilité')).toBe(false);
    expect(isSlug('with space')).toBe(false);
    expect(isSlug('a'.repeat(MAX_SLUG_LENGTH + 1))).toBe(false);
  });
});

describe('uniqueSlug — collisions', () => {
  it('returns the base slug when nothing is taken', () => {
    expect(uniqueSlug('Comptabilité générale', [])).toBe('comptabilite-generale');
    expect(uniqueSlug('Comptabilité générale', ['autre-chose'])).toBe('comptabilite-generale');
  });

  it('appends -2, then -3, as collisions accumulate', () => {
    expect(uniqueSlug('Comptabilité générale', ['comptabilite-generale'])).toBe(
      'comptabilite-generale-2',
    );
    expect(
      uniqueSlug('Comptabilité générale', ['comptabilite-generale', 'comptabilite-generale-2']),
    ).toBe('comptabilite-generale-3');
    expect(
      uniqueSlug('Comptabilité générale', [
        'comptabilite-generale',
        'comptabilite-generale-2',
        'comptabilite-generale-3',
        'comptabilite-generale-4',
      ]),
    ).toBe('comptabilite-generale-5');
  });

  it('accepts a Set as well as an array', () => {
    expect(uniqueSlug('Comptabilité générale', new Set(['comptabilite-generale']))).toBe(
      'comptabilite-generale-2',
    );
  });

  it('takes the suffix budget out of the base so the cap still holds', () => {
    const longTitle =
      'Formation avancée en comptabilité générale et gestion financière des entreprises marocaines pour cadres';
    const base = slugify(longTitle);
    const candidate = uniqueSlug(longTitle, [base]);
    expect(candidate).not.toBe(base);
    expect(candidate.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(candidate.endsWith('-2')).toBe(true);
    expect(isSlug(candidate)).toBe(true);
  });

  it('produces a distinct slug on every call as the taken set grows', () => {
    const taken = new Set<string>();
    const produced: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const slug = uniqueSlug('Marketing Digital', taken);
      expect(taken.has(slug)).toBe(false);
      taken.add(slug);
      produced.push(slug);
    }
    expect(new Set(produced).size).toBe(12);
    expect(produced[0]).toBe('marketing-digital');
    expect(produced[1]).toBe('marketing-digital-2');
    expect(produced[11]).toBe('marketing-digital-12');
  });

  it('returns an empty string when the base slugifies to nothing', () => {
    expect(uniqueSlug('???', [])).toBe('');
    expect(uniqueSlug('', ['x'])).toBe('');
  });
});
