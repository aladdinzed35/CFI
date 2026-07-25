import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { defaultLocale, locales, type Locale } from '@/i18n/routing';

/**
 * Translation parity (spec §10.2, §22).
 *
 * `fr` is the source language; `ar`, `en` and `es` mirror its shape exactly.
 * A missing key renders as the raw key path in production, and an ICU argument
 * that exists in one file but not another silently drops a number or a name out
 * of a sentence — Arabic is the worst case, with six plural categories.
 *
 * This is the same contract `scripts/check-i18n.ts` enforces in CI, asserted
 * here so a drifted message file fails the unit suite too.
 */

const MESSAGES_DIR = fileURLToPath(new URL('../../src/i18n/messages/', import.meta.url));

/* --------------------------------------------------------------- flattening */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface FlatMessages {
  readonly strings: Map<string, string>;
  readonly nonStrings: string[];
}

function flatten(value: unknown, prefix: string, out: FlatMessages): void {
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      flatten(value[key], prefix === '' ? key : `${prefix}.${key}`, out);
    }
    return;
  }
  if (typeof value === 'string') {
    out.strings.set(prefix, value);
    return;
  }
  out.nonStrings.push(prefix);
}

function load(locale: Locale): FlatMessages {
  const raw = readFileSync(`${MESSAGES_DIR}${locale}.json`, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    throw new Error(`${locale}.json must contain a JSON object at the root`);
  }
  const out: FlatMessages = { strings: new Map<string, string>(), nonStrings: [] };
  flatten(parsed, '', out);
  return out;
}

/* -------------------------------------------------------------- ICU scanner */

/**
 * Collect the ICU argument names of a message, mapped to their formatter type
 * (`''` for a bare `{name}`). A real scanner rather than a regex, so that the
 * bodies of `{count, plural, one {…} other {…}}` do not register as arguments.
 */
function icuArguments(message: string): Map<string, string> {
  const args = new Map<string, string>();
  const length = message.length;
  let index = 0;

  const at = (offset: number): string => message[offset] ?? '';

  const skipWhitespace = (): void => {
    while (index < length && /\s/.test(at(index))) index += 1;
  };

  const readIdentifier = (): string => {
    const start = index;
    while (index < length && /[A-Za-z0-9_$]/.test(at(index))) index += 1;
    return message.slice(start, index);
  };

  /** Consume an ICU-quoted literal such as `'{'` or `'{a, b}'`. */
  const skipQuoted = (): void => {
    const next = at(index + 1);
    if (next === "'") {
      index += 2;
      return;
    }
    if (next !== '{' && next !== '}' && next !== '#') {
      index += 1;
      return;
    }
    index += 2;
    while (index < length) {
      if (at(index) === "'") {
        if (at(index + 1) === "'") {
          index += 2;
          continue;
        }
        index += 1;
        return;
      }
      index += 1;
    }
  };

  const record = (name: string, type: string): void => {
    if (name === '') return;
    const existing = args.get(name);
    if (existing === undefined || existing === '') args.set(name, type);
  };

  const skipStyle = (): void => {
    let depth = 0;
    while (index < length) {
      const char = at(index);
      if (char === "'") {
        skipQuoted();
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') {
        if (depth === 0) return;
        depth -= 1;
      }
      index += 1;
    }
  };

  const parseOptions = (): void => {
    while (index < length) {
      skipWhitespace();
      if (at(index) === '}') return;
      if (at(index) === '=') index += 1;
      const selector = readIdentifier();
      if (selector === '' && at(index) !== '{') {
        index += 1;
        continue;
      }
      skipWhitespace();
      if (at(index) !== '{') return;
      index += 1;
      parseBody(true);
      if (at(index) === '}') index += 1;
    }
  };

  const parseArgument = (): void => {
    skipWhitespace();
    const name = readIdentifier();
    skipWhitespace();

    if (at(index) === '}') {
      record(name, '');
      index += 1;
      return;
    }

    if (at(index) !== ',') {
      record(name, '');
      skipStyle();
      if (at(index) === '}') index += 1;
      return;
    }

    index += 1;
    skipWhitespace();
    const type = readIdentifier();
    record(name, type);
    skipWhitespace();

    if (at(index) === '}') {
      index += 1;
      return;
    }

    if (at(index) === ',') {
      index += 1;
      if (type === 'plural' || type === 'select' || type === 'selectordinal') {
        parseOptions();
      } else {
        skipStyle();
      }
    }

    if (at(index) === '}') index += 1;
  };

  function parseBody(nested: boolean): void {
    while (index < length) {
      const char = at(index);
      if (char === "'") {
        skipQuoted();
        continue;
      }
      if (char === '}') {
        if (nested) return;
        index += 1;
        continue;
      }
      if (char === '{') {
        index += 1;
        parseArgument();
        continue;
      }
      index += 1;
    }
  }

  parseBody(false);
  return args;
}

/* ------------------------------------------------------------------- suites */

const loaded = new Map<Locale, FlatMessages>(locales.map((locale) => [locale, load(locale)]));

function messagesFor(locale: Locale): FlatMessages {
  const entry = loaded.get(locale);
  if (entry === undefined) throw new Error(`No message file loaded for ${locale}`);
  return entry;
}

const source = messagesFor(defaultLocale);

describe('the ICU scanner this test relies on', () => {
  it('reads bare and typed arguments', () => {
    expect([...icuArguments('Bonjour {name}').keys()]).toEqual(['name']);
    expect(icuArguments('{total, number} DH').get('total')).toBe('number');
    expect(icuArguments('Le {date, date, long}').get('date')).toBe('date');
  });

  it('does not mistake plural option bodies for arguments', () => {
    const args = icuArguments('{count, plural, one {# formation} other {# formations}}');
    expect([...args.keys()]).toEqual(['count']);
    expect(args.get('count')).toBe('plural');
  });

  it('handles nested arguments and quoted braces', () => {
    const args = icuArguments(
      "{count, plural, one {{name} a une formation} other {{name} a # formations}}",
    );
    expect([...args.keys()].sort()).toEqual(['count', 'name']);
    expect(icuArguments("Chiffres entre accolades: '{'42'}'").size).toBe(0);
  });

  it('returns nothing for a message with no interpolation', () => {
    expect(icuArguments('Enregistrer').size).toBe(0);
    expect(icuArguments('').size).toBe(0);
  });
});

describe('message files', () => {
  it('exist for every declared locale', () => {
    expect(locales).toEqual(['fr', 'ar', 'en', 'es']);
    for (const locale of locales) {
      expect(messagesFor(locale).strings.size).toBeGreaterThan(0);
    }
  });

  it('contain only strings — namespaces are nested objects, never arrays or numbers', () => {
    for (const locale of locales) {
      expect(messagesFor(locale).nonStrings, `${locale}.json has non-string values`).toEqual([]);
    }
  });

  it('contain no empty or whitespace-only message', () => {
    for (const locale of locales) {
      const blanks = [...messagesFor(locale).strings.entries()]
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => key);
      expect(blanks, `${locale}.json has blank messages`).toEqual([]);
    }
  });
});

describe('key parity', () => {
  it('gives every locale the exact key set of the source locale', () => {
    const expected = [...source.strings.keys()].sort();
    for (const locale of locales) {
      if (locale === defaultLocale) continue;
      const actual = [...messagesFor(locale).strings.keys()].sort();
      expect(actual, `${locale}.json has drifted from ${defaultLocale}.json`).toEqual(expected);
    }
  });

  it('reports missing and orphan keys individually, so a failure names the key', () => {
    for (const locale of locales) {
      if (locale === defaultLocale) continue;
      const target = messagesFor(locale).strings;
      const missing = [...source.strings.keys()].filter((key) => !target.has(key));
      const orphans = [...target.keys()].filter((key) => !source.strings.has(key));
      expect(missing, `${locale}: keys present in ${defaultLocale} but missing here`).toEqual([]);
      expect(orphans, `${locale}: keys present here but absent from ${defaultLocale}`).toEqual([]);
    }
  });

  it('has a namespace layout deep enough to be organised, not a flat dump', () => {
    const namespaces = new Set(
      [...source.strings.keys()].map((key) => {
        const dot = key.indexOf('.');
        return dot === -1 ? key : key.slice(0, dot);
      }),
    );
    expect(namespaces.size).toBeGreaterThan(1);
    expect(namespaces.has('')).toBe(false);
  });
});

describe('ICU parameter parity', () => {
  const sourceArguments = new Map<string, Map<string, string>>();
  for (const [key, message] of source.strings) {
    const args = icuArguments(message);
    if (args.size > 0) sourceArguments.set(key, args);
  }

  it('has at least one interpolated message to check', () => {
    expect(sourceArguments.size).toBeGreaterThan(0);
  });

  it('interpolates the same argument names in every locale', () => {
    for (const locale of locales) {
      if (locale === defaultLocale) continue;
      const target = messagesFor(locale).strings;
      const problems: string[] = [];

      for (const [key, expectedArgs] of sourceArguments) {
        const message = target.get(key);
        if (message === undefined) continue;
        const actual = icuArguments(message);
        const expectedNames = [...expectedArgs.keys()].sort();
        const actualNames = [...actual.keys()].sort();
        if (expectedNames.join(',') !== actualNames.join(',')) {
          problems.push(`${key}: expected {${expectedNames.join(', ')}}, got {${actualNames.join(', ')}}`);
        }
      }

      expect(problems, `${locale}.json ICU argument drift`).toEqual([]);
    }
  });

  it('uses the same ICU formatter type for each argument in every locale', () => {
    for (const locale of locales) {
      if (locale === defaultLocale) continue;
      const target = messagesFor(locale).strings;
      const problems: string[] = [];

      for (const [key, expectedArgs] of sourceArguments) {
        const message = target.get(key);
        if (message === undefined) continue;
        const actual = icuArguments(message);
        for (const [name, type] of expectedArgs) {
          const actualType = actual.get(name);
          if (actualType === undefined) continue; // covered by the previous test
          if (actualType !== type) {
            problems.push(
              `${key}: {${name}} is "${type || 'plain'}" in ${defaultLocale} but "${actualType || 'plain'}" here`,
            );
          }
        }
      }

      expect(problems, `${locale}.json ICU type drift`).toEqual([]);
    }
  });

  it('never introduces an argument a locale invents on its own', () => {
    for (const locale of locales) {
      if (locale === defaultLocale) continue;
      const problems: string[] = [];
      for (const [key, message] of messagesFor(locale).strings) {
        const sourceMessage = source.strings.get(key);
        if (sourceMessage === undefined) continue;
        const expectedArgs = icuArguments(sourceMessage);
        for (const name of icuArguments(message).keys()) {
          if (!expectedArgs.has(name)) problems.push(`${key}: unexpected {${name}}`);
        }
      }
      expect(problems, `${locale}.json invents ICU arguments`).toEqual([]);
    }
  });
});
