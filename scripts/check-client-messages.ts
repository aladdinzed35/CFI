/**
 * Guard: every Client Component can reach the messages it asks for.
 *
 * `src/i18n/client-messages.ts` withholds namespaces from the browser so the
 * homepage stops shipping the administration vocabulary. That saves real bytes
 * and creates a real hazard: an omitted namespace does not fail to compile and
 * does not fail the build. It throws `MISSING_MESSAGE` in the browser, the
 * first time somebody opens the one screen that needed it — which, for a
 * namespace like `emails`, might be the first time a payment reminder is sent.
 *
 * So the split is verified rather than trusted. This walks the import graph
 * from every `'use client'` entry point, collects the namespaces reachable
 * from each, and checks them against the provider that actually wraps that
 * part of the tree.
 *
 * ## Bare `useTranslations()` is the awkward case
 * A component that calls `useTranslations()` with no namespace can reach any
 * key, so no static set describes it. Those are reported separately: the guard
 * extracts the literal key prefixes they pass to `t('…')` and checks THOSE,
 * which is the best that can be done without running the page.
 *
 *   npx tsx scripts/check-client-messages.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

import { PUBLIC_EXCLUDED_NAMESPACES, SERVER_ONLY_NAMESPACES } from '../src/i18n/client-messages';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const RESET = '[0m';

/** Which provider wraps a file, and what that provider withholds. */
const SCOPES = [
  { name: 'admin console', match: /[\\/]\(admin\)[\\/]/u, excluded: SERVER_ONLY_NAMESPACES },
  { name: 'everything else', match: /.*/u, excluded: PUBLIC_EXCLUDED_NAMESPACES },
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/u.test(entry)) out.push(full);
  }
  return out;
}

const cache = new Map<string, string>();
function read(file: string): string {
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  const text = readFileSync(file, 'utf8');
  cache.set(file, text);
  return text;
}

/** Linear, not a regex: the obvious pattern backtracks on leading block comments. */
function isClientEntry(source: string): boolean {
  let i = 0;
  const n = source.length;
  for (;;) {
    while (i < n && /\s/u.test(source[i] as string)) i += 1;
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      if (end === -1) return false;
      i = end + 1;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) return false;
      i = end + 2;
      continue;
    }
    break;
  }
  return source.startsWith("'use client'", i) || source.startsWith('"use client"', i);
}

const EXTENSIONS = ['.ts', '.tsx'];
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null;

  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep trying */
    }
  }
  for (const ext of EXTENSIONS) {
    const candidate = join(base, `index${ext}`);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;'"]*?from\s*['"]([^'"]+)['"]/gu;
const NAMESPACE = /useTranslations\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/gu;
/** A literal key handed to a translator: `t('errors.rateLimited')`. */
const LITERAL_KEY = /\bt[A-Za-z]*\(\s*'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)'/gu;

interface Reach {
  readonly namespaces: Set<string>;
  /** Files that call `useTranslations()` with no namespace. */
  readonly rootCallers: Set<string>;
  /** Top-level prefixes of literal keys seen in those files. */
  readonly literalTops: Set<string>;
}

function reachFrom(entry: string): Reach {
  const namespaces = new Set<string>();
  const rootCallers = new Set<string>();
  const literalTops = new Set<string>();
  const seen = new Set<string>();
  const stack = [entry];

  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = read(file);

    let usesRoot = false;
    for (const match of source.matchAll(NAMESPACE)) {
      const name = match[1] ?? match[2];
      if (name === undefined || name === '') usesRoot = true;
      else namespaces.add(name.split('.')[0] as string);
    }
    if (usesRoot) {
      rootCallers.add(file);
      // Only a root caller's literal keys tell us anything new: a namespaced
      // caller's keys are already covered by its namespace.
      for (const match of source.matchAll(LITERAL_KEY)) {
        const top = (match[1] as string).split('.')[0] as string;
        literalTops.add(top);
      }
    }

    for (const match of source.matchAll(IMPORT)) {
      if (match[1] !== undefined) continue; // `import type` — erased
      const next = resolveSpecifier(match[2] as string, file);
      if (next !== null) stack.push(next);
    }
  }

  return { namespaces, rootCallers, literalTops };
}

const entries = walk(SRC).filter((file) => isClientEntry(read(file)));

interface Violation {
  readonly entry: string;
  readonly scope: string;
  readonly namespace: string;
  readonly via: 'namespace' | 'literal key';
}

const violations: Violation[] = [];
let rootCallerCount = 0;

for (const entry of entries) {
  const scope = SCOPES.find((s) => s.match.test(entry));
  if (scope === undefined) continue;

  const reach = reachFrom(entry);
  rootCallerCount += reach.rootCallers.size;
  const withheld = new Set<string>(scope.excluded);

  for (const ns of reach.namespaces) {
    if (withheld.has(ns)) {
      violations.push({
        entry: relative(ROOT, entry).replace(/\\/gu, '/'),
        scope: scope.name,
        namespace: ns,
        via: 'namespace',
      });
    }
  }
  for (const top of reach.literalTops) {
    if (withheld.has(top)) {
      violations.push({
        entry: relative(ROOT, entry).replace(/\\/gu, '/'),
        scope: scope.name,
        namespace: top,
        via: 'literal key',
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `${RED}✖ client messages: ${violations.length} Client Component(s) need a namespace their provider withholds${RESET}\n`,
  );
  for (const v of violations) {
    console.error(`  ${RED}${v.namespace}${RESET} — withheld from "${v.scope}", reached by ${v.via}`);
    console.error(`    ${v.entry}\n`);
  }
  console.error(
    `${DIM}This throws MISSING_MESSAGE in the browser, not at build time: the page\n` +
      `renders until the moment that key is read. Either add the namespace to the\n` +
      `right provider in src/i18n/client-messages.ts, or move the string out of the\n` +
      `Client Component.${RESET}`,
  );
  process.exit(1);
}

console.log(
  `${GREEN}✔ client messages: ${entries.length} 'use client' entry point(s) can reach every namespace they use.${RESET}` +
    `${DIM} (${rootCallerCount} bare useTranslations() caller(s) checked by literal key)${RESET}`,
);
