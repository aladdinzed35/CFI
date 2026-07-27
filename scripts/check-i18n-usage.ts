/**
 * Guard: every translation key a component asks for must exist.
 *
 * `scripts/check-i18n.ts` proves the four locales agree with each other. It
 * cannot prove they agree with the CODE — a page can reference a namespace
 * nobody ever wrote, all four files stay in perfect parity, and the guard is
 * happy. next-intl only *logs* `MISSING_MESSAGE` at render time, so
 * `next build` still exits 0 and the defect ships as raw keys on screen.
 *
 * That has already happened twice in this repo (`landing`, `accessDenied`).
 * This script closes the loop: it resolves each `t('key')` back to the
 * namespace its `t` was bound to, and checks the key against the SOURCE
 * locale (fr). Missing keys fail the build.
 *
 * Limits, deliberately: only statically analysable calls are checked. A
 * computed key (`t(someVariable)`) is skipped and counted, because proving
 * those correct needs real type analysis — see the summary line for how many
 * were skipped.
 *
 *   npx tsx scripts/check-i18n-usage.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const SOURCE_LOCALE = 'fr';
const MESSAGES = join(SRC, 'i18n', 'messages', `${SOURCE_LOCALE}.json`);

const GREEN = '[32m';
const RED = '[31m';
const YELLOW = '[33m';
const DIM = '[2m';
const RESET = '[0m';

type Json = { [key: string]: Json | string };

interface Violation {
  file: string;
  line: number;
  column: number;
  namespace: string;
  key: string;
  full: string;
  suggestion: string | undefined;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Flatten the catalogue to dotted paths so lookup is a single Set hit. */
function flatten(node: Json, prefix = '', out = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    out.add(path);
    if (typeof value === 'object' && value !== null) flatten(value, path, out);
  }
  return out;
}

/** Cheap edit distance, only to offer "did you mean" on a near miss. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 4) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let corner = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = prev[j] ?? 0;
      const left = prev[j - 1] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(above + 1, left + 1, corner + cost);
      corner = above;
      prev[j] = next;
    }
  }
  return prev[b.length] ?? 99;
}

function positionOf(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

const raw = JSON.parse(readFileSync(MESSAGES, 'utf8')) as Json;
const known = flatten(raw);

const files = walk(SRC);
const violations: Violation[] = [];
let checked = 0;
let dynamic = 0;

// `const t = useTranslations('ns')` / `const t = await getTranslations('ns')`
// / `const t = await getTranslations({ locale, namespace: 'ns' })`
const BINDING =
  /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*(?:'([^']+)'|"([^"]+)"|\{[^}]*namespace:\s*(?:'([^']+)'|"([^"]+)")[^}]*\})?\s*\)/g;

/** Any namespace requested in the file, however the result is captured. */
const AMBIENT_NAMESPACE =
  /(?:useTranslations|getTranslations)\s*\(\s*(?:'([^']+)'|\{[^}]*namespace:\s*'([^']+)'[^}]*\})/g;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (!/useTranslations|getTranslations/.test(source)) continue;

  // A name may be bound MORE THAN ONCE per file — two functions in the same
  // module commonly each declare `const t = getTranslations(...)` against
  // different namespaces. This scan is scope-blind, so the binding is recorded
  // as a SET of candidate namespaces and a key counts as found if it resolves
  // under any of them. That trades a little precision (a key valid under one
  // binding but used with the other still passes) for zero false positives,
  // which is the right trade for a guard that blocks the build.
  const bindings = new Map<string, Set<string>>();
  for (const match of source.matchAll(BINDING)) {
    const name = match[1];
    const ns = match[2] ?? match[3] ?? match[4] ?? match[5];
    // A `t` with no namespace is root-scoped: its keys are already full paths.
    if (name === undefined) continue;
    const set = bindings.get(name) ?? new Set<string>();
    set.add(ns ?? '');
    bindings.set(name, set);
  }
  if (bindings.size === 0) continue;

  // Namespaces requested ANYWHERE in the file, whether or not the call was of
  // the form `const t = getTranslations(…)`. A translator is commonly obtained
  // through a destructuring pattern the binding regex cannot see:
  //
  //   const [result, t] = await Promise.all([load(), getTranslations({…})]);
  //
  // Missing those made the guard resolve every key against the *other* binding
  // in the file and report a dozen keys that plainly existed. Adding them as
  // fallback candidates for every binding trades a little precision for zero
  // false positives — the same trade made above, and the right one for a check
  // that blocks the build.
  const ambient = new Set<string>();
  for (const match of source.matchAll(AMBIENT_NAMESPACE)) {
    const ns = match[1] ?? match[2];
    if (ns !== undefined) ambient.add(ns);
  }

  for (const [name, namespaces] of bindings) {
    // `t('key')`, `t.rich('key')`, `t.raw('key')`, `t.markup('key')`
    const call = new RegExp(`\\b${name}(?:\\.(?:rich|raw|markup|has))?\\s*\\(\\s*(['"\`])([^'"\`]*)\\1`, 'g');
    for (const match of source.matchAll(call)) {
      const key = match[2];
      if (key === undefined || key === '') continue;
      // Template literals with interpolation are computed keys.
      if (match[1] === '`' && key.includes('${')) {
        dynamic += 1;
        continue;
      }
      const candidates = [...namespaces, ...ambient].map((ns) =>
        ns === '' ? key : `${ns}.${key}`,
      );
      checked += 1;
      if (candidates.some((candidate) => known.has(candidate))) continue;

      // `t.has()` is an existence probe — a miss there is intentional.
      if (match[0].includes('.has(')) continue;

      // Report against the first binding; with one binding (the common case)
      // that is exact, and with several the message lists what was tried.
      const full = candidates[0] ?? key;
      const near = [...known].find((candidate) => distance(candidate, full) <= 2);
      const { line, column } = positionOf(source, match.index ?? 0);
      violations.push({
        file: relative(ROOT, file).replace(/\\/g, '/'),
        line,
        column,
        namespace: [...namespaces].join(' | '),
        key,
        full: candidates.length > 1 ? candidates.join(' | ') : full,
        suggestion: near,
      });
    }
  }
}

if (violations.length > 0) {
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    const list = byFile.get(v.file) ?? [];
    list.push(v);
    byFile.set(v.file, list);
  }

  console.error(
    `${RED}✖ i18n usage: ${violations.length} key(s) referenced in code but absent from ${SOURCE_LOCALE}.json${RESET}\n`,
  );
  for (const [file, list] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    console.error(`  ${file}`);
    for (const v of list) {
      const hint =
        v.suggestion === undefined
          ? `${DIM}add it to all four locales${RESET}`
          : `${YELLOW}did you mean ${v.suggestion}?${RESET}`;
      console.error(`    ${v.line}:${v.column}  ${RED}${v.full}${RESET}  ${hint}`);
    }
    console.error('');
  }
  console.error(
    `${DIM}next-intl only logs MISSING_MESSAGE at render time, so the build stays green and\n` +
      `users see the raw key. Add the missing keys to all four message files.${RESET}`,
  );
  process.exit(1);
}

const skipped = dynamic > 0 ? ` ${DIM}(${dynamic} computed key(s) skipped)${RESET}` : '';
console.log(`${GREEN}✔ i18n usage: ${checked} key reference(s) resolve against ${SOURCE_LOCALE}.json.${RESET}${skipped}`);
