/**
 * Guard: nothing a browser bundle reaches may lead to the database.
 *
 * §5 makes Prisma server-only, and ESLint enforces it — but only against a
 * DIRECT `@prisma/client` or `@/server/db` import from `src/app` or
 * `src/components`. It says nothing about a client component importing a
 * *service* that imports the database two hops down, which is the shape the
 * mistake actually takes.
 *
 * That shipped. The course editor's « Niveau » select needed to enumerate
 * `COURSE_LEVEL_VALUES`, imported it from `server/services/course-admin.ts`,
 * and dragged Prisma, `can()` and the audit log into a client bundle. `tsc`
 * passed. ESLint passed. `next build` failed with « You're importing a
 * component that needs next/headers » — pointing at the component, naming
 * neither the service nor the hop that did it.
 *
 * So this walks the real import graph from every `'use client'` entry point and
 * reports the whole chain, which is the part that makes it fixable:
 *
 *   infos-tab.tsx → @/server/services/course-admin → @/server/db
 *
 * ## What counts as reaching the database
 * A VALUE import. `import type { … }` and inline `type` specifiers are erased
 * before the bundler sees them, so they cross the boundary freely and are
 * skipped — otherwise every view model typed against a Prisma enum would be a
 * false positive, and a guard that cries wolf gets deleted.
 *
 * Server Actions are the sanctioned exception: `@/server/actions/*` modules are
 * `'use server'`, so importing one from the browser produces a network call
 * rather than a bundle. They are not followed.
 *
 *   npx tsx scripts/check-client-boundary.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const RESET = '[0m';

/** Reaching any of these from a browser bundle is the defect. */
const SERVER_ONLY = [/^@prisma\/client$/u, /^@\/server\/db(\/|$)/u, /^next\/headers$/u];

/** `'use server'` by contract: importing one is an RPC, not a bundle. */
const RPC_BOUNDARY = /^@\/server\/actions(\/|$)/u;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/u.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Is `'use client'` the first statement, after any leading comments?
 *
 * Scanned linearly rather than matched with a regex. The obvious pattern —
 * `/^\s*(?:\/\/.*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/` — backtracks
 * catastrophically on every file that does NOT match, and almost every file in
 * this repo opens with a long block comment. It did not fail; it ran for
 * minutes and looked like a hang.
 */
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

/**
 * Every module specifier this file imports FOR ITS VALUES.
 *
 * `export … from` re-exports too: a barrel that re-exports a server module
 * pulls it in exactly as an import would.
 */
function valueImports(source: string): string[] {
  const out: string[] = [];
  const pattern =
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/gu;

  for (const match of source.matchAll(pattern)) {
    const typeKeyword = match[1];
    const clause = match[2] ?? '';
    const specifier = match[3];
    if (specifier === undefined) continue;
    if (typeKeyword !== undefined) continue; // `import type { … } from` — erased

    // `import { type A, type B } from` is erased too; `import { type A, B }` is not.
    const named = clause.match(/\{([\s\S]*)\}/u)?.[1];
    if (named !== undefined && clause.replace(/\{[\s\S]*\}/u, '').trim() === '') {
      const specs = named
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      if (specs.length > 0 && specs.every((s) => s.startsWith('type '))) continue;
    }

    out.push(specifier);
  }

  // Bare `import 'x'` for side effects still executes the module.
  for (const match of source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/gu)) {
    const specifier = match[1];
    if (specifier !== undefined) out.push(specifier);
  }

  return out;
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/** `@/x` → an absolute file under `src`, or `null` for a package. */
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

const sources = new Map<string, string>();
function read(file: string): string {
  const cached = sources.get(file);
  if (cached !== undefined) return cached;
  const text = readFileSync(file, 'utf8');
  sources.set(file, text);
  return text;
}

function short(file: string): string {
  return relative(ROOT, file).replace(/\\/gu, '/');
}

const importCache = new Map<string, string[]>();
function importsOf(file: string): string[] {
  const cached = importCache.get(file);
  if (cached !== undefined) return cached;
  const list = valueImports(read(file));
  importCache.set(file, list);
  return list;
}

/**
 * The tail of a leaking chain, per module, memoised.
 *
 * Whether a module reaches the database does not depend on which component
 * imported it, so the answer is computed once and reused. Without this the walk
 * is entry-points × modules: the first version of this script took minutes on
 * this repo and looked like a hang.
 *
 * `null` = clean, `undefined` = not yet computed, `IN_PROGRESS` = we are inside
 * its own subtree. A cycle returns clean for the back-edge only; the module
 * that owns the cycle still gets its real answer from its other imports.
 */
const IN_PROGRESS = Symbol('in-progress');
const tailCache = new Map<string, string[] | null | typeof IN_PROGRESS>();

function leakTail(file: string): string[] | null {
  const cached = tailCache.get(file);
  if (cached === IN_PROGRESS) return null;
  if (cached !== undefined) return cached;
  tailCache.set(file, IN_PROGRESS);

  for (const specifier of importsOf(file)) {
    if (RPC_BOUNDARY.test(specifier)) continue;

    if (SERVER_ONLY.some((rule) => rule.test(specifier))) {
      const tail = [specifier];
      tailCache.set(file, tail);
      return tail;
    }

    const next = resolveSpecifier(specifier, file);
    if (next === null) continue; // a package, or a type-only path

    const deeper = leakTail(next);
    if (deeper !== null) {
      const tail = [short(next), ...deeper];
      tailCache.set(file, tail);
      return tail;
    }
  }

  tailCache.set(file, null);
  return null;
}

/** The full chain from a client entry point to the server-only module. */
function findLeak(entry: string): string[] | null {
  const tail = leakTail(entry);
  return tail === null ? null : [short(entry), ...tail];
}

const entries = walk(SRC).filter((file) => isClientEntry(read(file)));
const leaks: { readonly entry: string; readonly chain: string[] }[] = [];

for (const entry of entries) {
  const chain = findLeak(entry);
  if (chain !== null) leaks.push({ entry: short(entry), chain });
}

if (leaks.length > 0) {
  console.error(`${RED}✖ client boundary: ${leaks.length} browser bundle(s) reach server-only code${RESET}\n`);
  for (const leak of leaks) {
    console.error(`  ${RED}${leak.entry}${RESET}`);
    console.error(`    ${leak.chain.join('\n      → ')}\n`);
  }
  console.error(
    `${DIM}Each chain starts at a 'use client' component and ends at a module the\n` +
      `browser must never bundle. ESLint only forbids the FIRST hop, so a service\n` +
      `that imports the database two hops down passes every static check and fails\n` +
      `in 'next build'. Move the value the component needs into a neutral module\n` +
      `(see src/lib/course-enums.ts), or import it as a type.${RESET}`,
  );
  process.exit(1);
}

console.log(
  `${GREEN}✔ client boundary: ${entries.length} 'use client' entry point(s) reach no server-only module.${RESET}`,
);
