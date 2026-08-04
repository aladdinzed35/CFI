import { describe, expect, it } from 'vitest';

import {
  CERTIFICATE_CODE_PATTERN,
  MAX_CERTIFICATE_CODE_LENGTH,
  normalizeCertificateCode,
} from '@/lib/certificate-code';

/**
 * These two rules decide whether a query runs at all, and three callers apply
 * them: the server action, the form's courtesy check, and the QR page at
 * `/certificat/[code]`. They were three hand-kept copies until they were
 * shared; a drift between them is a certificate that verifies on one path and
 * is called unknown on the other.
 *
 * The normaliser is not cosmetic. Every rule in it corresponds to a way an
 * honest person fails to reproduce a code they are reading off paper — and the
 * QR path adds a scanner that may hand back the URL-decoded, lower-cased form.
 */

const REAL = 'CFI-2026-4KX9TB';

describe('normalizeCertificateCode — how people actually mistype a printed code', () => {
  it('accepts the code exactly as printed', () => {
    expect(normalizeCertificateCode(REAL)).toBe(REAL);
  });

  it('upper-cases, which is what a QR scanner or a phone keyboard hands back', () => {
    expect(normalizeCertificateCode('cfi-2026-4kx9tb')).toBe(REAL);
  });

  it('strips the spaces someone types around the hyphens', () => {
    expect(normalizeCertificateCode(' CFI - 2026 - 4KX9TB ')).toBe(REAL);
  });

  it.each([
    ['non-breaking hyphen', 'CFI‐2026‐4KX9TB'],
    ['en dash', 'CFI–2026–4KX9TB'],
    ['em dash', 'CFI—2026—4KX9TB'],
    ['minus sign', 'CFI−2026−4KX9TB'],
    ['underscore', 'CFI_2026_4KX9TB'],
  ])('repairs a %s into a plain hyphen', (_label, typed) => {
    expect(normalizeCertificateCode(typed)).toBe(REAL);
  });

  /**
   * The reason this matters here and not elsewhere: a Moroccan phone set to
   * Arabic produces ٢٠٢٦ for what is printed on the certificate as 2026. The
   * holder is copying correctly and would still be told their certificate does
   * not exist.
   */
  it('converts Arabic-Indic digits', () => {
    expect(normalizeCertificateCode('CFI-٢٠٢٦-4KX9TB')).toBe(REAL);
  });

  it('converts Extended Arabic-Indic (Persian) digits', () => {
    expect(normalizeCertificateCode('CFI-۲۰۲۶-4KX9TB')).toBe(REAL);
  });

  it('applies NFKC, so full-width characters pasted from a document collapse', () => {
    expect(normalizeCertificateCode('ＣＦＩ-２０２６-４ＫＸ９ＴＢ')).toBe(REAL);
  });

  it('leaves an empty string empty rather than inventing a code', () => {
    expect(normalizeCertificateCode('   ')).toBe('');
  });
});

describe('CERTIFICATE_CODE_PATTERN — what may reach a database query', () => {
  it.each([REAL, 'CFI-2026-4KX9TB', 'AB-CD', 'ABCDEFGHIJKL', 'A1-B2-C3-D4-E5'])(
    'accepts the printed shape %s',
    (code) => {
      expect(CERTIFICATE_CODE_PATTERN.test(code)).toBe(true);
    },
  );

  it.each([
    ['empty', ''],
    ['a single character group', 'A'],
    ['lower case (the normaliser runs first)', 'cfi-2026-4kx9tb'],
    ['a group longer than twelve', 'ABCDEFGHIJKLM'],
    ['six groups', 'AB-CD-EF-GH-IJ-KL'],
    ['a trailing hyphen', 'CFI-2026-'],
    ['a leading hyphen', '-CFI-2026'],
    ['an underscore', 'CFI_2026'],
    ['whitespace', 'CFI 2026'],
    ['a SQL-ish payload', "CFI' OR '1'='1"],
    ['a wildcard', 'CFI-%'],
    ['a newline', 'CFI-2026\nX'],
  ])('refuses %s', (_label, code) => {
    expect(CERTIFICATE_CODE_PATTERN.test(code)).toBe(false);
  });

  /**
   * The pattern is applied to already-normalised input, and `test` on a
   * non-global regex holds no `lastIndex` state — but a future edit adding the
   * `g` flag would make every second call fail, silently and only under load.
   */
  it('gives the same answer when asked twice', () => {
    expect(CERTIFICATE_CODE_PATTERN.test(REAL)).toBe(true);
    expect(CERTIFICATE_CODE_PATTERN.test(REAL)).toBe(true);
  });
});

describe('the length ceiling', () => {
  it('is long enough for any real code and short enough to refuse a payload', () => {
    expect(MAX_CERTIFICATE_CODE_LENGTH).toBeGreaterThan(REAL.length * 2);
    expect(MAX_CERTIFICATE_CODE_LENGTH).toBeLessThanOrEqual(512);
  });

  /**
   * Guards the QR page, which truncates before normalising: `normalize('NFKC')`
   * on a megabyte of text is real work, and the page does it before any rate
   * limit could reject the result.
   */
  it('rejects an over-length string by pattern even if it were normalised', () => {
    const payload = 'A'.repeat(MAX_CERTIFICATE_CODE_LENGTH + 1);
    expect(CERTIFICATE_CODE_PATTERN.test(normalizeCertificateCode(payload))).toBe(false);
  });
});
