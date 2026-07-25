import { describe, expect, it } from 'vitest';

import {
  formatPhoneDisplay,
  formatPhoneNational,
  isMoroccanMobile,
  isValidPhone,
  maskPhone,
  MOROCCO_COUNTRY_CODE,
  parsePhone,
  toWhatsAppNumber,
} from '@/lib/phone';

/**
 * Phone parsing (spec §9.1, §22).
 *
 * The contract: every shape a Moroccan student can type must collapse to one
 * E.164 string, so "has this person already registered?" stays a plain equality
 * check and the `wa.me` link never breaks.
 */

/** Every Moroccan spelling of the same mobile line. */
const MOROCCAN_MOBILE_FORMS: readonly string[] = [
  '0612345678',
  '06 12 34 56 78',
  '06-12-34-56-78',
  '06.12.34.56.78',
  '06/12/34/56/78',
  '  0612345678  ',
  '612345678',
  '+212612345678',
  '+212 6 12 34 56 78',
  '+212-612-345-678',
  '+212 (6) 12 34 56 78',
  '00212612345678',
  '00212 6 12 34 56 78',
  '212612345678',
];

describe('parsePhone — Moroccan normalisation', () => {
  it('normalises every accepted format to a single E.164 value', () => {
    for (const input of MOROCCAN_MOBILE_FORMS) {
      const parsed = parsePhone(input);
      expect(parsed, `expected ${JSON.stringify(input)} to parse`).not.toBeNull();
      expect(parsed?.e164, `wrong E.164 for ${JSON.stringify(input)}`).toBe('+212612345678');
      expect(parsed?.national).toBe('0612345678');
      expect(parsed?.isMoroccan).toBe(true);
    }
  });

  it('produces exactly one distinct E.164 value across all of them', () => {
    const canonical = new Set(MOROCCAN_MOBILE_FORMS.map((form) => parsePhone(form)?.e164));
    expect(canonical.size).toBe(1);
    expect([...canonical]).toEqual(['+212612345678']);
  });

  it('accepts the 7-prefix mobile range and the 5-prefix fixed lines', () => {
    expect(parsePhone('0712345678')?.e164).toBe('+212712345678');
    expect(parsePhone('0522334455')?.e164).toBe('+212522334455');
    expect(parsePhone('+212522334455')?.isMoroccan).toBe(true);
  });

  it('exposes the country code it normalises to', () => {
    expect(MOROCCO_COUNTRY_CODE).toBe('212');
    expect(parsePhone('0612345678')?.e164.startsWith(`+${MOROCCO_COUNTRY_CODE}`)).toBe(true);
  });
});

describe('parsePhone — foreign numbers', () => {
  it('accepts them but flags them for the admin queue', () => {
    const french = parsePhone('+33 6 12 34 56 78');
    expect(french).not.toBeNull();
    expect(french?.e164).toBe('+33612345678');
    expect(french?.national).toBe('612345678');
    expect(french?.isMoroccan).toBe(false);

    const spanish = parsePhone('0034 600 123 456');
    expect(spanish?.e164).toBe('+34600123456');
    expect(spanish?.isMoroccan).toBe(false);

    const american = parsePhone('+1 415 555 0132');
    expect(american?.e164).toBe('+14155550132');
    expect(american?.isMoroccan).toBe(false);
  });

  it('never marks a foreign number as Moroccan mobile', () => {
    expect(isMoroccanMobile('+33612345678')).toBe(false);
    expect(isValidPhone('+33612345678')).toBe(true);
  });
});

describe('parsePhone — rejection', () => {
  it('returns null for garbage rather than throwing', () => {
    const garbage = [
      '',
      '   ',
      'abc',
      'not a phone',
      '06 12 34 56 7A',
      '06123',
      '0612345',
      '06123456789',
      '0912345678', // 9 is not a Moroccan subscriber prefix
      '0412345678',
      '+212412345678',
      '+2126123456789',
      '+',
      '+212',
      '00',
      '0',
      '٠٦١٢٣٤٥٦٧٨', // Arabic-Indic digits are not a supported input form
    ];
    for (const value of garbage) {
      expect(parsePhone(value), `expected ${JSON.stringify(value)} to be rejected`).toBeNull();
      expect(isValidPhone(value)).toBe(false);
    }
  });

  it('rejects an E.164 number longer than 15 digits', () => {
    expect(parsePhone('+1234567890123456')).toBeNull();
  });
});

describe('isMoroccanMobile', () => {
  it('is true only for 6… and 7… Moroccan lines', () => {
    expect(isMoroccanMobile('0612345678')).toBe(true);
    expect(isMoroccanMobile('+212712345678')).toBe(true);
    expect(isMoroccanMobile('0522334455')).toBe(false); // fixed line
    expect(isMoroccanMobile('garbage')).toBe(false);
  });
});

describe('display grouping', () => {
  it('groups a Moroccan number the way Morocco writes it', () => {
    expect(formatPhoneDisplay('+212612345678')).toBe('+212 6 12 34 56 78');
    expect(formatPhoneDisplay('0612345678')).toBe('+212 6 12 34 56 78');
    expect(formatPhoneDisplay('00212612345678')).toBe('+212 6 12 34 56 78');
    expect(formatPhoneDisplay('+212522334455')).toBe('+212 5 22 33 44 55');
  });

  it('groups a foreign number in pairs after its country code', () => {
    expect(formatPhoneDisplay('+33612345678')).toBe('+33 61 23 45 67 8');
    expect(formatPhoneDisplay('+34600123456')).toBe('+34 60 01 23 45 6');
  });

  it('renders the national form a Moroccan expects on a form', () => {
    expect(formatPhoneNational('+212612345678')).toBe('06 12 34 56 78');
    expect(formatPhoneNational('0712345678')).toBe('07 12 34 56 78');
    expect(formatPhoneNational('0522334455')).toBe('05 22 33 44 55');
  });

  it('falls back to the international form for foreign numbers', () => {
    expect(formatPhoneNational('+33612345678')).toBe(formatPhoneDisplay('+33612345678'));
  });

  it('returns an unparseable legacy value unchanged rather than blanking the cell', () => {
    expect(formatPhoneDisplay('poste 42')).toBe('poste 42');
    expect(formatPhoneNational('poste 42')).toBe('poste 42');
  });

  it('emits only digits, spaces and a leading plus — safe inside force-ltr', () => {
    expect(formatPhoneDisplay('+212612345678')).toMatch(/^\+[0-9 ]+$/);
    expect(formatPhoneNational('+212612345678')).toMatch(/^[0-9 ]+$/);
  });
});

describe('toWhatsAppNumber', () => {
  it('returns bare digits for the wa.me path', () => {
    expect(toWhatsAppNumber('+212612345678')).toBe('212612345678');
    expect(toWhatsAppNumber('06 12 34 56 78')).toBe('212612345678');
    expect(toWhatsAppNumber('00212612345678')).toBe('212612345678');
    expect(toWhatsAppNumber('+33 6 12 34 56 78')).toBe('33612345678');
  });

  it('never contains a plus, a space or a separator', () => {
    for (const form of MOROCCAN_MOBILE_FORMS) {
      expect(toWhatsAppNumber(form)).toMatch(/^\d+$/);
    }
  });

  it('returns an empty string when the number cannot be parsed, so the CTA can be hidden', () => {
    expect(toWhatsAppNumber('garbage')).toBe('');
    expect(toWhatsAppNumber('')).toBe('');
  });

  it('builds a usable wa.me href', () => {
    const digits = toWhatsAppNumber('0612345678');
    expect(`https://wa.me/${digits}`).toBe('https://wa.me/212612345678');
  });
});

describe('maskPhone', () => {
  it('keeps only the operator digit and the last pair', () => {
    expect(maskPhone('+212612345678')).toBe('+212 6 •• •• •• 78');
    expect(maskPhone('0522334455')).toBe('+212 5 •• •• •• 55');
  });

  it('masks a foreign number too', () => {
    expect(maskPhone('+33612345678')).toBe('+33 6 •• •• •• 78');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(maskPhone('garbage')).toBe('');
  });

  it('never leaks the middle digits', () => {
    expect(maskPhone('+212612345678')).not.toContain('1234');
  });
});
