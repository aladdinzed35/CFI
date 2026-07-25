/**
 * scripts/check-i18n.ts — translation parity guard (spec §10.2, §22).
 *
 * Loads `src/i18n/messages/{fr,ar,en,es}.json`, flattens every namespace to a
 * dotted key path and fails the build when the four locales have drifted apart.
 *
 * It reports, per locale:
 *   1. keys present in the source locale (`fr`) but missing here;
 *   2. keys present here but absent from `fr` (orphans — usually a rename that
 *      was only applied to one file);
 *   3. ICU argument mismatches — `fr` interpolates `{count}` and the locale does
 *      not, or the locale interpolates something `fr` never provides;
 *   4. ICU argument *type* drift — `fr` pluralises an argument and the locale
 *      treats it as a plain placeholder (silently breaks agreement in Arabic,
 *      which has six plural categories);
 *   5. structural drift — a path that is a string in one file and an object in
 *      another, or a value that is not a string at all.
 *
 * Exit code 1 on any finding, 0 with a one-line summary when clean.
 * Zero dependencies: `node:fs` and `node:path` only. Run with `npm run i18n:check`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/* ------------------------------------------------------------------ config */

const LOCALES = ['fr', 'ar', 'en', 'es'] as const;
type MessageLocale = (typeof LOCALES)[number];

/** French is the source of truth for copy; every other file mirrors its shape. */
const SOURCE_LOCALE: MessageLocale = 'fr';

const ROOT = process.cwd();
const MESSAGES_DIR = join(ROOT, 'src', 'i18n', 'messages');

/* ------------------------------------------------------------------ output */

const COLOUR_ENABLED = process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== '0';
const paint = (code: string, text: string): string =>
  COLOUR_ENABLED ? `[${code}m${text}[0m` : text;
const red = (text: string): string => paint('31', text);
const green = (text: string): string => paint('32', text);
const yellow = (text: string): string => paint('33', text);
const dim = (text: string): string => paint('2', text);
const bold = (text: string): string => paint('1', text);

const lines: string[] = [];
const emit = (text = ''): void => {
  lines.push(text);
};
const flush = (): void => {
  process.stdout.write(`${lines.join('\n')}\n`);
};

/* ------------------------------------------------------------- json loading */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface FlatMessages {
  /** dotted path → message string */
  readonly strings: Map<string, string>;
  /** dotted paths whose value is neither an object nor a string */
  readonly invalid: string[];
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
  out.invalid.push(prefix);
}

function loadLocale(locale: MessageLocale): FlatMessages {
  const file = join(MESSAGES_DIR, `${locale}.json`);
  if (!existsSync(file)) {
    emit(red(`✖ Missing message file: ${relative(ROOT, file)}`));
    emit(dim(`  Every locale in [${LOCALES.join(', ')}] needs its own JSON file.`));
    flush();
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    emit(red(`✖ ${relative(ROOT, file)} is not valid JSON`));
    emit(dim(`  ${detail}`));
    flush();
    process.exit(1);
  }

  if (!isPlainObject(parsed)) {
    emit(red(`✖ ${relative(ROOT, file)} must contain a JSON object at the root.`));
    flush();
    process.exit(1);
  }

  const out: FlatMessages = { strings: new Map<string, string>(), invalid: [] };
  flatten(parsed, '', out);
  return out;
}

/* --------------------------------------------------------------- ICU parser */

/**
 * Collects the argument names (and their formatter type) used by an ICU
 * message. A real scanner rather than a regex, so that plural/select option
 * bodies — `{count, plural, one {livre} other {livres}}` — do not register
 * `livre` and `livres` as arguments.
 */
function parseIcuArguments(message: string): Map<string, string> {
  const args = new Map<string, string>();
  const length = message.length;
  let index = 0;

  const at = (offset: number): string =>
    offset >= 0 && offset < length ? (message[offset] ?? '') : '';

  const skipWhitespace = (): void => {
    while (index < length && /\s/.test(at(index))) index += 1;
  };

  const readIdentifier = (): string => {
    const start = index;
    while (index < length && /[A-Za-z0-9_$]/.test(at(index))) index += 1;
    return message.slice(start, index);
  };

  /** Consumes a quoted ICU literal such as `'{'` or `'{a, b}'`. */
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

  /** Skips a formatter style (`::currency/MAD`, `short`, …) up to its `}`. */
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

  /** Parses the `selector {body}` pairs of a plural/select argument. */
  const parseOptions = (): void => {
    while (index < length) {
      skipWhitespace();
      if (at(index) === '}' || index >= length) return;
      // selector: `one`, `other`, `=0`, `male`, …
      if (at(index) === '=') index += 1;
      const selector = readIdentifier();
      if (selector === '' && at(index) !== '{') {
        // Unexpected character — bail out rather than loop forever.
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
    // `index` sits just after the opening `{`.
    skipWhitespace();
    const name = readIdentifier();
    skipWhitespace();

    if (at(index) === '}') {
      record(name, '');
      index += 1;
      return;
    }

    if (at(index) !== ',') {
      // Malformed argument — skip to the closing brace.
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

  const parseBody = (nested: boolean): void => {
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
  };

  parseBody(false);
  return args;
}

/* ------------------------------------------------------------- comparison */

interface ArgumentIssue {
  readonly key: string;
  readonly missing: string[];
  readonly extra: string[];
  readonly typeDrift: Array<{ name: string; source: string; target: string }>;
}

interface LocaleReport {
  readonly locale: MessageLocale;
  readonly missing: string[];
  readonly orphans: string[];
  readonly argumentIssues: ArgumentIssue[];
  readonly invalid: string[];
}

function describeType(type: string): string {
  return type === '' ? 'plain' : type;
}

function compare(
  source: FlatMessages,
  target: FlatMessages,
  locale: MessageLocale,
  sourceArgs: Map<string, Map<string, string>>,
): LocaleReport {
  const missing: string[] = [];
  const orphans: string[] = [];
  const argumentIssues: ArgumentIssue[] = [];

  for (const key of source.strings.keys()) {
    if (!target.strings.has(key)) missing.push(key);
  }
  for (const key of target.strings.keys()) {
    if (!source.strings.has(key)) orphans.push(key);
  }

  for (const [key, expected] of sourceArgs) {
    const message = target.strings.get(key);
    if (message === undefined) continue;
    const actual = parseIcuArguments(message);

    const missingArgs: string[] = [];
    const typeDrift: Array<{ name: string; source: string; target: string }> = [];
    for (const [name, type] of expected) {
      const actualType = actual.get(name);
      if (actualType === undefined) {
        missingArgs.push(name);
        continue;
      }
      if (actualType !== type) {
        typeDrift.push({ name, source: describeType(type), target: describeType(actualType) });
      }
    }

    const extraArgs: string[] = [];
    for (const name of actual.keys()) {
      if (!expected.has(name)) extraArgs.push(name);
    }

    if (missingArgs.length > 0 || extraArgs.length > 0 || typeDrift.length > 0) {
      argumentIssues.push({ key, missing: missingArgs, extra: extraArgs, typeDrift });
    }
  }

  return {
    locale,
    missing: missing.sort(),
    orphans: orphans.sort(),
    argumentIssues: argumentIssues.sort((a, b) => a.key.localeCompare(b.key)),
    invalid: [...target.invalid].sort(),
  };
}

/* -------------------------------------------------------------------- main */

function main(): void {
  const loaded = new Map<MessageLocale, FlatMessages>();
  for (const locale of LOCALES) loaded.set(locale, loadLocale(locale));

  const source = loaded.get(SOURCE_LOCALE);
  if (source === undefined) {
    emit(red(`✖ Source locale "${SOURCE_LOCALE}" could not be loaded.`));
    flush();
    process.exit(1);
  }

  const sourceArgs = new Map<string, Map<string, string>>();
  for (const [key, message] of source.strings) {
    const args = parseIcuArguments(message);
    if (args.size > 0) sourceArgs.set(key, args);
  }

  const reports: LocaleReport[] = [];
  for (const locale of LOCALES) {
    if (locale === SOURCE_LOCALE) continue;
    const target = loaded.get(locale);
    if (target === undefined) continue;
    reports.push(compare(source, target, locale, sourceArgs));
  }

  const sourceInvalid = [...source.invalid].sort();
  let problems = sourceInvalid.length;
  for (const report of reports) {
    problems +=
      report.missing.length +
      report.orphans.length +
      report.argumentIssues.length +
      report.invalid.length;
  }

  if (problems === 0) {
    emit(
      green(
        `✔ i18n parity: ${source.strings.size} keys identical across ${LOCALES.join(', ')} ` +
          `(${sourceArgs.size} ICU messages checked).`,
      ),
    );
    flush();
    process.exit(0);
  }

  emit(bold('i18n parity check'));
  emit(dim(`source locale: ${SOURCE_LOCALE} · ${source.strings.size} keys · ${MESSAGES_DIR}`));
  emit();

  if (sourceInvalid.length > 0) {
    emit(red(`fr — ${sourceInvalid.length} value(s) that are not strings`));
    for (const key of sourceInvalid) emit(`  ${key}`);
    emit(dim('  Message values must be strings; use nested objects for namespaces.'));
    emit();
  }

  for (const report of reports) {
    const total =
      report.missing.length +
      report.orphans.length +
      report.argumentIssues.length +
      report.invalid.length;

    if (total === 0) {
      emit(green(`${report.locale} — in sync`));
      emit();
      continue;
    }

    emit(red(`${report.locale} — ${total} problem(s)`));

    if (report.missing.length > 0) {
      emit(yellow(`  missing (${report.missing.length}) — present in fr, absent here`));
      for (const key of report.missing) emit(`    ${key}`);
    }

    if (report.orphans.length > 0) {
      emit(yellow(`  orphan (${report.orphans.length}) — present here, absent from fr`));
      for (const key of report.orphans) emit(`    ${key}`);
    }

    if (report.argumentIssues.length > 0) {
      emit(yellow(`  ICU arguments (${report.argumentIssues.length})`));
      for (const issue of report.argumentIssues) {
        emit(`    ${issue.key}`);
        if (issue.missing.length > 0) {
          emit(`      missing: ${issue.missing.map((name) => `{${name}}`).join(', ')}`);
        }
        if (issue.extra.length > 0) {
          emit(`      unexpected: ${issue.extra.map((name) => `{${name}}`).join(', ')}`);
        }
        for (const drift of issue.typeDrift) {
          emit(`      {${drift.name}} is ${drift.source} in fr but ${drift.target} here`);
        }
      }
    }

    if (report.invalid.length > 0) {
      emit(yellow(`  non-string values (${report.invalid.length})`));
      for (const key of report.invalid) emit(`    ${key}`);
    }

    emit();
  }

  emit(red(`✖ ${problems} problem(s) across ${reports.length} locale(s).`));
  emit(dim('  Fix fr first, then mirror the exact key set into ar, en and es.'));
  flush();
  process.exit(1);
}

main();
