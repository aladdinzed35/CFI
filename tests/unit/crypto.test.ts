import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  constantTimeEquals,
  DEFAULT_TOKEN_BYTES,
  generateCertificateSerial,
  generateInvoiceNumber,
  generateReference,
  generateToken,
  generateVerifyCode,
  hashToken,
  sha256File,
  VERIFY_CODE_ALPHABET,
  VERIFY_CODE_LENGTH,
} from '@/lib/crypto';

/**
 * Crypto primitives and human-facing codes (spec §9.1, §9.2, §9.3, §22).
 *
 * Two invariants matter more than anything else here: a raw token must never be
 * recoverable from what we persist, and a reference code must have exactly the
 * shape printed on an invoice or typed into a bank transfer's motif field.
 */

const HEX_64 = /^[0-9a-f]{64}$/;

describe('hashToken', () => {
  it('is stable for the same input', () => {
    const token = 'DPZ0m0mSGnkC0S3Zx4TzHo7RJP7Ktr-mFq6y6XjfPqU';
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('produces 64 lowercase hex characters', () => {
    expect(hashToken('anything')).toMatch(HEX_64);
    expect(hashToken('')).toMatch(HEX_64);
    expect(hashToken('é ع 中')).toMatch(HEX_64);
  });

  it('matches the SHA-256 of the UTF-8 bytes', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashToken('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(hashToken('é')).toBe(createHash('sha256').update('é', 'utf8').digest('hex'));
  });

  it('is one-way — the digest reveals nothing of the token', () => {
    const token = generateToken();
    const digest = hashToken(token);
    expect(digest).not.toBe(token);
    expect(digest).not.toContain(token);
    expect(token).not.toContain(digest);
    expect(digest.length).toBe(64);
  });

  it('changes completely for a one-character difference', () => {
    const a = hashToken('token-a');
    const b = hashToken('token-b');
    expect(a).not.toBe(b);
    let shared = 0;
    for (let i = 0; i < 64; i += 1) {
      if (a[i] === b[i]) shared += 1;
    }
    // Two independent 64-char hex strings share ~4 positions by chance.
    expect(shared).toBeLessThan(32);
  });

  it('is the only value a caller needs to persist to verify a token later', () => {
    const raw = generateToken();
    const stored = hashToken(raw);
    expect(constantTimeEquals(hashToken(raw), stored)).toBe(true);
    expect(constantTimeEquals(hashToken(`${raw}x`), stored)).toBe(false);
  });
});

describe('constantTimeEquals', () => {
  it('is true for identical strings', () => {
    expect(constantTimeEquals('', '')).toBe(true);
    expect(constantTimeEquals('a', 'a')).toBe(true);
    expect(constantTimeEquals(hashToken('x'), hashToken('x'))).toBe(true);
  });

  it('is false for different strings of the same length', () => {
    expect(constantTimeEquals('abcd', 'abce')).toBe(false);
    expect(constantTimeEquals(hashToken('x'), hashToken('y'))).toBe(false);
  });

  it('is length-safe — never throws on mismatched lengths', () => {
    expect(() => constantTimeEquals('short', 'a-much-longer-candidate-value')).not.toThrow();
    expect(constantTimeEquals('short', 'a-much-longer-candidate-value')).toBe(false);
    expect(constantTimeEquals('', 'x')).toBe(false);
    expect(constantTimeEquals('x', '')).toBe(false);
    expect(constantTimeEquals('a'.repeat(1), 'a'.repeat(4096))).toBe(false);
  });

  it('is case- and whitespace-sensitive', () => {
    expect(constantTimeEquals('Token', 'token')).toBe(false);
    expect(constantTimeEquals('token ', 'token')).toBe(false);
  });

  it('distinguishes unicode that normalises to the same glyph', () => {
    expect(constantTimeEquals('é', 'é')).toBe(false);
  });
});

describe('generateToken', () => {
  it('is URL-safe base64 with no padding', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('carries the default 512 bits of entropy', () => {
    expect(DEFAULT_TOKEN_BYTES).toBe(64);
    // base64url of 64 bytes, padding stripped.
    expect(generateToken().length).toBe(86);
    expect(Buffer.from(generateToken(), 'base64url')).toHaveLength(DEFAULT_TOKEN_BYTES);
  });

  it('honours an explicit size and falls back on a nonsensical one', () => {
    expect(Buffer.from(generateToken(32), 'base64url')).toHaveLength(32);
    expect(Buffer.from(generateToken(0), 'base64url')).toHaveLength(DEFAULT_TOKEN_BYTES);
    expect(Buffer.from(generateToken(-8), 'base64url')).toHaveLength(DEFAULT_TOKEN_BYTES);
    expect(Buffer.from(generateToken(Number.NaN), 'base64url')).toHaveLength(DEFAULT_TOKEN_BYTES);
  });

  it('never repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateToken());
    expect(seen.size).toBe(500);
  });
});

describe('reference and serial shapes (spec §9.2, §9.3)', () => {
  it('mints a payment reference as CFI-2026-000123', () => {
    expect(generateReference(2026, 123)).toBe('CFI-2026-000123');
    expect(generateReference(2026, 1)).toBe('CFI-2026-000001');
    expect(generateReference(2026, 999_999)).toBe('CFI-2026-999999');
    expect(generateReference(2026, 123)).toMatch(/^CFI-\d{4}-\d{6}$/);
  });

  it('mints an invoice number as FAC-2026-0042', () => {
    expect(generateInvoiceNumber(2026, 42)).toBe('FAC-2026-0042');
    expect(generateInvoiceNumber(2026, 1)).toBe('FAC-2026-0001');
    expect(generateInvoiceNumber(2027, 9999)).toBe('FAC-2027-9999');
    expect(generateInvoiceNumber(2026, 42)).toMatch(/^FAC-\d{4}-\d{4}$/);
  });

  it('mints a certificate serial as CFI-CERT-2026-000042', () => {
    expect(generateCertificateSerial(2026, 42)).toBe('CFI-CERT-2026-000042');
    expect(generateCertificateSerial(2026, 1)).toBe('CFI-CERT-2026-000001');
    expect(generateCertificateSerial(2026, 42)).toMatch(/^CFI-CERT-\d{4}-\d{6}$/);
  });

  it('is injective in the sequence — a wide sequence widens rather than truncates', () => {
    expect(generateReference(2026, 1_234_567)).toBe('CFI-2026-1234567');
    expect(generateInvoiceNumber(2026, 12_345)).toBe('FAC-2026-12345');
    expect(generateReference(2026, 1_234_567)).not.toBe(generateReference(2026, 234_567));
  });

  it('is total for nonsense input rather than emitting "NaN" in a reference', () => {
    expect(generateReference(Number.NaN, 1)).toBe('CFI-0000-000001');
    expect(generateReference(2026, Number.NaN)).toBe('CFI-2026-000000');
    expect(generateReference(2026, -5)).toBe('CFI-2026-000000');
    expect(generateReference(2026, 12.9)).toBe('CFI-2026-000012');
  });

  it('keeps the three shapes distinguishable from one another', () => {
    const reference = generateReference(2026, 42);
    const invoice = generateInvoiceNumber(2026, 42);
    const serial = generateCertificateSerial(2026, 42);
    expect(new Set([reference, invoice, serial]).size).toBe(3);
    expect(reference.startsWith('CFI-CERT-')).toBe(false);
  });
});

describe('generateVerifyCode', () => {
  it('has the declared length and alphabet', () => {
    expect(VERIFY_CODE_LENGTH).toBe(10);
    expect(VERIFY_CODE_ALPHABET).toBe('23456789ABCDEFGHJKMNPQRSTUVWXYZ');
    const code = generateVerifyCode();
    expect(code).toHaveLength(VERIFY_CODE_LENGTH);
    expect(code).toMatch(/^[23456789A-HJKMNP-Z]{10}$/);
  });

  it('never emits a character a human confuses: 0, O, 1, I, L', () => {
    const forbidden = ['0', 'O', '1', 'I', 'L'];
    for (const character of forbidden) {
      expect(VERIFY_CODE_ALPHABET).not.toContain(character);
    }

    const observed = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      for (const character of generateVerifyCode()) observed.add(character);
    }
    for (const character of observed) {
      expect(VERIFY_CODE_ALPHABET, `unexpected character ${character}`).toContain(character);
      expect(forbidden).not.toContain(character);
    }
    // 500 × 10 draws over a 31-symbol alphabet: every symbol should appear.
    expect(observed.size).toBe(VERIFY_CODE_ALPHABET.length);
  });

  it('is unguessable enough that 2 000 draws do not collide', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) seen.add(generateVerifyCode());
    expect(seen.size).toBe(2_000);
  });
});

describe('sha256File', () => {
  const bytes = Uint8Array.from([0x43, 0x46, 0x49]); // "CFI"

  it('hashes the raw bytes, hex-encoded', () => {
    expect(sha256File(bytes)).toMatch(HEX_64);
    expect(sha256File(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('accepts Buffer, Uint8Array and ArrayBuffer interchangeably', () => {
    const buffer = Buffer.from(bytes);
    const arrayBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(arrayBuffer).set(bytes);
    expect(sha256File(buffer)).toBe(sha256File(bytes));
    expect(sha256File(arrayBuffer)).toBe(sha256File(bytes));
  });

  it('detects a duplicate receipt and separates a different one', () => {
    const original = Buffer.from('receipt-image-bytes');
    const duplicate = Buffer.from('receipt-image-bytes');
    const other = Buffer.from('receipt-image-byteS');
    expect(sha256File(duplicate)).toBe(sha256File(original));
    expect(sha256File(other)).not.toBe(sha256File(original));
  });

  it('hashes an empty file to the well-known empty digest', () => {
    expect(sha256File(Buffer.alloc(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
