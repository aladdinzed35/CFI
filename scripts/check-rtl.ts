/**
 * scripts/check-rtl.ts — logical-property guard (spec §10.3, §22).
 *
 * Arabic is a first-class locale, not an afterthought, so the codebase is
 * written with *logical* CSS properties only. This script fails the build when
 * a physical, direction-carrying Tailwind class sneaks into `src/**` — those
 * classes look right in French and silently break the Arabic layout.
 *
 * What it reports, as `file:line:column`, with the logical replacement:
 *   ml- mr- pl- pr-              → ms- me- ps- pe-
 *   left- right-                 → start- end-
 *   text-left text-right         → text-start text-end
 *   border-l border-r            → border-s border-e
 *   rounded-l rounded-r          → rounded-s rounded-e
 *   rounded-tl tr bl br          → rounded-ss se es ee
 *   float-left float-right       → float-start float-end
 *   float: left / float: right   → float: inline-start / inline-end
 *
 * Two escape hatches, both deliberate and both visible in review:
 *
 *   1. A per-line opt-out. Put `// rtl-allow: <reason>` (or
 *      `{/* rtl-allow: <reason> *\/}` inside JSX) on the offending line. The
 *      reason is mandatory — an empty one is itself an error.
 *   2. A documented path allow-list (`ALLOWED_PATHS` below). Media controls are
 *      left-to-right by convention in every locale (§10.3), so the player's
 *      control strip is exempt wholesale.
 *
 * To keep prose out of the results, a token only counts when it sits inside a
 * *class context*: a `className` / `class` attribute or property, a `cn()` /
 * `clsx()` / `cva()` call, or a string literal whose every token is shaped like
 * a Tailwind utility. Comments, imports, URLs and message strings never match.
 *
 * Exit code 1 on any unexplained violation, 0 with a one-line summary when
 * clean. `--verbose` additionally lists the exemptions that were honoured.
 * Zero dependencies: `node:fs` and `node:path` only. Run with `npm run rtl:check`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/* ------------------------------------------------------------------ config */

const ROOT = process.cwd();
const SCAN_ROOT = join(ROOT, 'src');
const EXTENSIONS = ['.ts', '.tsx'] as const;
const SKIP_DIRECTORIES = new Set(['node_modules', 'generated', '.next']);

interface PathException {
  /** Repository-relative glob, `/` separated. `*` matches one segment, `**` any. */
  readonly glob: string;
  readonly reason: string;
}

/**
 * The one documented exemption. §10.3: "Media controls are LTR by convention:
 * the video timeline, its scrubber, playback-speed order, and volume slider
 * stay left-to-right even in Arabic. Only the surrounding chrome flips."
 * Anything outside this directory justifies itself line by line instead.
 */
const ALLOWED_PATHS: readonly PathException[] = [
  {
    glob: 'src/components/player/controls/**',
    reason:
      '§10.3 — the media control strip (timeline, scrubber, playback speed, volume) stays LTR in every locale; only the chrome around the player flips.',
  },
];

const OPT_OUT_MARKER = 'rtl-allow';

/** `--verbose` lists the allow-list and every exemption that was honoured. */
const VERBOSE = process.argv.includes('--verbose');

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

/* -------------------------------------------------------------------- rules */

interface Replacement {
  readonly fixed: string;
  readonly rule: string;
}

const SPACING_PREFIXES: Readonly<Record<string, string>> = {
  ml: 'ms',
  mr: 'me',
  pl: 'ps',
  pr: 'pe',
};

const INSET_PREFIXES: Readonly<Record<string, string>> = {
  left: 'start',
  right: 'end',
};

const BORDER_SIDES: Readonly<Record<string, string>> = {
  l: 's',
  r: 'e',
};

const ROUNDED_CORNERS: Readonly<Record<string, string>> = {
  l: 's',
  r: 'e',
  tl: 'ss',
  tr: 'se',
  bl: 'es',
  br: 'ee',
};

/**
 * Maps a bare utility (variants, `!` and the negative `-` already stripped) to
 * its logical equivalent, or `null` when the utility is direction-neutral.
 */
function logicalFor(utility: string): Replacement | null {
  const spacing = /^(ml|mr|pl|pr)(-.+)$/u.exec(utility);
  if (spacing !== null) {
    const head = spacing[1] ?? '';
    const tail = spacing[2] ?? '';
    return { fixed: `${SPACING_PREFIXES[head] ?? head}${tail}`, rule: 'margin/padding' };
  }

  const inset = /^(left|right)(-.+)$/u.exec(utility);
  if (inset !== null) {
    const head = inset[1] ?? '';
    const tail = inset[2] ?? '';
    return { fixed: `${INSET_PREFIXES[head] ?? head}${tail}`, rule: 'inset' };
  }

  const align = /^text-(left|right)$/u.exec(utility);
  if (align !== null) {
    const head = align[1] ?? '';
    return { fixed: `text-${INSET_PREFIXES[head] ?? head}`, rule: 'text-align' };
  }

  // `border-lg` and `border-red-500` must not match: the side is followed by a
  // `-` or by the end of the token, never by another letter.
  const border = /^border-(l|r)(-.+)?$/u.exec(utility);
  if (border !== null) {
    const side = border[1] ?? '';
    const tail = border[2] ?? '';
    return { fixed: `border-${BORDER_SIDES[side] ?? side}${tail}`, rule: 'border-side' };
  }

  const rounded = /^rounded-(tl|tr|bl|br|l|r)(-.+)?$/u.exec(utility);
  if (rounded !== null) {
    const corner = rounded[1] ?? '';
    const tail = rounded[2] ?? '';
    return { fixed: `rounded-${ROUNDED_CORNERS[corner] ?? corner}${tail}`, rule: 'border-radius' };
  }

  const float = /^float-(left|right)$/u.exec(utility);
  if (float !== null) {
    const head = float[1] ?? '';
    return { fixed: `float-${INSET_PREFIXES[head] ?? head}`, rule: 'float' };
  }

  return null;
}

/** Strips Tailwind variants, the `!` important flag and the negative `-`. */
function bareUtility(token: string): string {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === '[' || char === '(') depth += 1;
    else if (char === ']' || char === ')') depth -= 1;
    else if (char === ':' && depth === 0) start = index + 1;
  }

  let bare = token.slice(start);
  if (bare.startsWith('!')) bare = bare.slice(1);
  if (bare.endsWith('!')) bare = bare.slice(0, -1);
  if (bare.startsWith('-')) bare = bare.slice(1);
  return bare;
}

/* -------------------------------------------------------------------- lexer */

interface Range {
  readonly start: number;
  readonly end: number;
}

interface Lexed {
  /** Content ranges of every string and template literal, quotes excluded. */
  readonly literals: readonly Range[];
  /** Source with comments *and* literal contents replaced by spaces. */
  readonly codeMask: string;
  /** Source with comments replaced by spaces, literals left intact. */
  readonly commentStripped: string;
}

function blank(chars: string[], start: number, end: number): void {
  for (let index = start; index < end && index < chars.length; index += 1) {
    const char = chars[index];
    if (char !== '\n' && char !== '\r') chars[index] = ' ';
  }
}

/** `/` starts a regular expression only in an operand position. */
function regexAllowed(previous: string): boolean {
  return previous === '' || '(,=:[!&|?{};+-*%~^<>'.includes(previous);
}

/**
 * A single pass that classifies comments, string literals, template literals
 * and regular expressions. Two safety valves keep a malformed guess from
 * derailing the rest of the file:
 *   • an unterminated quote that hits a newline is re-read as an ordinary
 *     character (this is what French apostrophes in JSX text look like);
 *   • brace depth never goes below zero.
 */
function lex(source: string): Lexed {
  const codeChars = source.split('');
  const commentChars = source.split('');
  const literals: Range[] = [];
  const length = source.length;

  const at = (index: number): string => (index >= 0 && index < length ? (source[index] ?? '') : '');

  let index = 0;
  let previousSignificant = '';
  let mode: 'code' | 'template' = 'code';
  let chunkStart = 0;
  const modeStack: Array<'code' | 'template'> = [];
  const braceStack: number[] = [];
  let braceDepth = 0;

  const record = (start: number, end: number): void => {
    if (end > start) literals.push({ start, end });
    blank(codeChars, start, end);
  };

  while (index < length) {
    const char = at(index);

    if (mode === 'template') {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '`') {
        record(chunkStart, index);
        mode = modeStack.pop() ?? 'code';
        if (mode === 'template') chunkStart = index + 1;
        index += 1;
        continue;
      }
      if (char === '$' && at(index + 1) === '{') {
        record(chunkStart, index);
        modeStack.push('template');
        braceStack.push(braceDepth);
        braceDepth = 0;
        mode = 'code';
        index += 2;
        previousSignificant = '{';
        continue;
      }
      index += 1;
      continue;
    }

    // Line comment.
    if (char === '/' && at(index + 1) === '/') {
      const start = index;
      while (index < length && at(index) !== '\n') index += 1;
      blank(codeChars, start, index);
      blank(commentChars, start, index);
      continue;
    }

    // Block comment.
    if (char === '/' && at(index + 1) === '*') {
      const start = index;
      index += 2;
      while (index < length && !(at(index) === '*' && at(index + 1) === '/')) index += 1;
      index = Math.min(index + 2, length);
      blank(codeChars, start, index);
      blank(commentChars, start, index);
      continue;
    }

    // Regular expression literal — blanked so its braces cannot unbalance the mask.
    if (char === '/' && regexAllowed(previousSignificant)) {
      const start = index;
      let cursor = index + 1;
      let inClass = false;
      let terminated = false;
      while (cursor < length) {
        const current = at(cursor);
        if (current === '\\') {
          cursor += 2;
          continue;
        }
        if (current === '\n') break;
        if (current === '[') inClass = true;
        else if (current === ']') inClass = false;
        else if (current === '/' && !inClass) {
          terminated = true;
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      if (terminated) {
        while (cursor < length && /[a-z]/u.test(at(cursor))) cursor += 1;
        blank(codeChars, start + 1, cursor);
        index = cursor;
        previousSignificant = '/';
        continue;
      }
      // Not a regular expression after all: fall through as a division sign.
    }

    if (char === "'" || char === '"') {
      let cursor = index + 1;
      let terminated = false;
      while (cursor < length) {
        const current = at(cursor);
        if (current === '\\') {
          cursor += 2;
          continue;
        }
        if (current === '\n') break;
        if (current === char) {
          terminated = true;
          break;
        }
        cursor += 1;
      }
      if (terminated) {
        record(index + 1, cursor);
        index = cursor + 1;
        previousSignificant = char;
        continue;
      }
      // Unterminated on this line — an apostrophe in JSX text, not a string.
      index += 1;
      continue;
    }

    if (char === '`') {
      modeStack.push('code');
      mode = 'template';
      chunkStart = index + 1;
      index += 1;
      continue;
    }

    if (char === '{') {
      braceDepth += 1;
      previousSignificant = '{';
      index += 1;
      continue;
    }

    if (char === '}') {
      if (braceDepth === 0 && modeStack[modeStack.length - 1] === 'template') {
        modeStack.pop();
        braceDepth = braceStack.pop() ?? 0;
        mode = 'template';
        chunkStart = index + 1;
        index += 1;
        continue;
      }
      if (braceDepth > 0) braceDepth -= 1;
      previousSignificant = '}';
      index += 1;
      continue;
    }

    if (!/\s/u.test(char)) previousSignificant = char;
    index += 1;
  }

  if (mode === 'template') record(chunkStart, length);

  return {
    literals,
    codeMask: codeChars.join(''),
    commentStripped: commentChars.join(''),
  };
}

/* ---------------------------------------------------------- class contexts */

const CLASS_BINDING = /\b(?:className|class)\s*[=:]\s*/gu;
const CLASS_HELPER = /\b(?:cn|clsx|classNames|twMerge|twJoin|cva|tv)\s*\(/gu;

function matchBalanced(mask: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  for (let index = open; index < mask.length; index += 1) {
    const char = mask[index];
    if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return mask.length;
}

/** Regions of the source in which a string literal is unambiguously CSS classes. */
function classRegions(mask: string): Range[] {
  const regions: Range[] = [];

  CLASS_BINDING.lastIndex = 0;
  let binding = CLASS_BINDING.exec(mask);
  while (binding !== null) {
    const start = binding.index + binding[0].length;
    const char = mask[start] ?? '';
    if (char === '{') {
      regions.push({ start, end: matchBalanced(mask, start, '{', '}') });
    } else if (char === "'" || char === '"' || char === '`') {
      const close = mask.indexOf(char, start + 1);
      regions.push({ start, end: close === -1 ? mask.length : close + 1 });
    } else {
      const newline = mask.indexOf('\n', start);
      regions.push({ start, end: newline === -1 ? mask.length : newline });
    }
    binding = CLASS_BINDING.exec(mask);
  }

  CLASS_HELPER.lastIndex = 0;
  let helper = CLASS_HELPER.exec(mask);
  while (helper !== null) {
    const open = helper.index + helper[0].length - 1;
    regions.push({ start: open, end: matchBalanced(mask, open, '(', ')') });
    helper = CLASS_HELPER.exec(mask);
  }

  return regions;
}

/** Shape of a Tailwind token: lowercase-ish, no prose punctuation, no spaces. */
const CLASS_TOKEN_SHAPE = /^[a-z0-9!@:_./[\]()#%,+&>*~=-]+$/iu;

const UTILITY_PREFIXES = [
  'flex',
  'grid',
  'block',
  'inline',
  'hidden',
  'contents',
  'absolute',
  'relative',
  'fixed',
  'sticky',
  'static',
  'items-',
  'justify-',
  'content-',
  'place-',
  'self-',
  'order-',
  'col-',
  'row-',
  'gap-',
  'grow',
  'shrink',
  'basis-',
  'p[xytblrse]?-',
  'm[xytblrse]?-',
  'space-[xy]-',
  'w-',
  'h-',
  'size-',
  'min-',
  'max-',
  'text-',
  'font-',
  'leading-',
  'tracking-',
  'align-',
  'whitespace-',
  'break-',
  'truncate',
  'uppercase',
  'lowercase',
  'capitalize',
  'underline',
  'italic',
  'antialiased',
  'tabular-nums',
  'bg-',
  'border',
  'divide-',
  'outline',
  'ring',
  'rounded',
  'shadow',
  'opacity-',
  'mix-blend-',
  'backdrop-',
  'z-',
  'overflow-',
  'overscroll-',
  'object-',
  'aspect-',
  'table',
  'list-',
  'cursor-',
  'select-',
  'resize',
  'appearance-',
  'pointer-events-',
  'touch-',
  'scroll-',
  'snap-',
  'transition',
  'duration-',
  'delay-',
  'ease-',
  'animate-',
  'transform',
  'translate-',
  'rotate-',
  'scale-',
  'skew-',
  'origin-',
  'fill-',
  'stroke-',
  'sr-only',
  'not-sr-only',
  'container',
  'isolate',
  'ms-',
  'me-',
  'ps-',
  'pe-',
  'start-',
  'end-',
  'inset-',
  'top-',
  'bottom-',
  'left-',
  'right-',
  'float-',
  'ml-',
  'mr-',
  'pl-',
  'pr-',
] as const;

const VARIANT_PREFIX = '(?:(?:[a-z0-9@_-]+|\\[[^\\]]*\\]|\\([^)]*\\)):)*';
const UTILITY_HINT = new RegExp(`^${VARIANT_PREFIX}!?-?(?:${UTILITY_PREFIXES.join('|')})`, 'u');

/**
 * Fallback for class strings that live away from their `className` — variant
 * maps, `const base = '…'`, lookup tables. Every token must be shaped like a
 * utility and at least one must actually be a recognisable Tailwind utility,
 * which keeps import specifiers, URLs and message strings out.
 */
function looksLikeClassList(content: string): boolean {
  const tokens = content.split(/\s+/u).filter((token) => token.length > 0);
  if (tokens.length === 0) return false;
  if (!tokens.every((token) => CLASS_TOKEN_SHAPE.test(token))) return false;
  return tokens.some((token) => UTILITY_HINT.test(token));
}

/* ------------------------------------------------------------------- report */

interface Violation {
  readonly line: number;
  readonly column: number;
  readonly token: string;
  readonly fixed: string;
  readonly rule: string;
}

interface FileReport {
  readonly file: string;
  readonly violations: Violation[];
  readonly exemptions: number;
  readonly unexplained: number;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function locate(starts: readonly number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
}

/** `// rtl-allow: reason` or `{/* rtl-allow: reason *\/}` anywhere on the line. */
function exemptLines(source: string): { exempt: Set<number>; missingReason: number[] } {
  const exempt = new Set<number>();
  const missingReason: number[] = [];
  const sourceLines = source.split('\n');
  for (let index = 0; index < sourceLines.length; index += 1) {
    const text = sourceLines[index] ?? '';
    const marker = text.indexOf(OPT_OUT_MARKER);
    if (marker === -1) continue;
    const after = text.slice(marker + OPT_OUT_MARKER.length);
    const reason = /^\s*:\s*([^*}\n]*)/u.exec(after);
    const trimmed = (reason?.[1] ?? '').replace(/\*\/.*$/u, '').trim();
    if (trimmed.length === 0) missingReason.push(index + 1);
    else exempt.add(index + 1);
  }
  return { exempt, missingReason };
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*');
  return new RegExp(`^${escaped}$`, 'u');
}

const ALLOWED_MATCHERS = ALLOWED_PATHS.map((exception) => ({
  ...exception,
  matcher: globToRegExp(exception.glob),
}));

function pathException(posixPath: string): PathException | null {
  for (const exception of ALLOWED_MATCHERS) {
    if (exception.matcher.test(posixPath)) return exception;
  }
  return null;
}

/* -------------------------------------------------------------------- scan */

function collectFiles(directory: string, out: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      collectFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) out.push(full);
  }
}

function inRange(regions: readonly Range[], range: Range): boolean {
  return regions.some((region) => range.start >= region.start && range.end <= region.end);
}

function checkFile(absolute: string): FileReport {
  const posixPath = relative(ROOT, absolute).split(sep).join('/');
  const source = readFileSync(absolute, 'utf8');
  const starts = lineStarts(source);
  const { literals, codeMask, commentStripped } = lex(source);
  const regions = classRegions(codeMask);
  const { exempt, missingReason } = exemptLines(source);

  const raw: Violation[] = [];

  for (const literal of literals) {
    const content = source.slice(literal.start, literal.end);
    if (content.trim().length === 0) continue;
    if (!inRange(regions, literal) && !looksLikeClassList(content)) continue;

    let cursor = 0;
    while (cursor < content.length) {
      while (cursor < content.length && /\s/u.test(content[cursor] ?? '')) cursor += 1;
      const tokenStart = cursor;
      while (cursor < content.length && !/\s/u.test(content[cursor] ?? '')) cursor += 1;
      if (cursor === tokenStart) break;

      const token = content.slice(tokenStart, cursor);
      const replacement = logicalFor(bareUtility(token));
      if (replacement === null) continue;

      const { line, column } = locate(starts, literal.start + tokenStart);
      raw.push({ line, column, token, fixed: replacement.fixed, rule: replacement.rule });
    }
  }

  // `float: left` in a style object or an inline style string — the CSS form of
  // the same mistake, invisible to the class-token pass.
  const floatCss = /\bfloat\s*:\s*(['"]?)(left|right)\1/gu;
  let cssMatch = floatCss.exec(commentStripped);
  while (cssMatch !== null) {
    const side = cssMatch[2] ?? 'left';
    const { line, column } = locate(starts, cssMatch.index);
    raw.push({
      line,
      column,
      token: `float: ${side}`,
      fixed: `float: ${side === 'left' ? 'inline-start' : 'inline-end'}`,
      rule: 'float',
    });
    cssMatch = floatCss.exec(commentStripped);
  }

  for (const line of missingReason) {
    raw.push({
      line,
      column: 1,
      token: `${OPT_OUT_MARKER}:`,
      fixed: `${OPT_OUT_MARKER}: <reason>`,
      rule: 'opt-out without a reason',
    });
  }

  const allowed = pathException(posixPath);
  const deduped = new Map<string, Violation>();
  for (const violation of raw) {
    deduped.set(`${violation.line}:${violation.column}:${violation.token}`, violation);
  }

  const violations: Violation[] = [];
  let exemptions = 0;
  for (const violation of deduped.values()) {
    if (violation.rule !== 'opt-out without a reason' && exempt.has(violation.line)) {
      exemptions += 1;
      continue;
    }
    violations.push(violation);
  }
  violations.sort((a, b) => a.line - b.line || a.column - b.column);

  if (allowed !== null) {
    exemptions += violations.length;
    return { file: posixPath, violations, exemptions, unexplained: 0 };
  }

  return { file: posixPath, violations, exemptions, unexplained: violations.length };
}

/* -------------------------------------------------------------------- main */

function main(): void {
  if (!existsSync(SCAN_ROOT)) {
    emit(red(`✖ Nothing to scan: ${relative(ROOT, SCAN_ROOT)} does not exist.`));
    flush();
    process.exit(1);
  }

  const files: string[] = [];
  collectFiles(SCAN_ROOT, files);
  files.sort();

  const reports = files.map(checkFile);
  const offenders = reports.filter((report) => report.unexplained > 0);
  const exemptions = reports.reduce((total, report) => total + report.exemptions, 0);
  const problems = reports.reduce((total, report) => total + report.unexplained, 0);

  if (VERBOSE) {
    emit(bold('RTL logical-property check — verbose'));
    for (const exception of ALLOWED_PATHS) {
      emit(dim(`  allow-list ${exception.glob}`));
      emit(dim(`    ${exception.reason}`));
    }
    for (const report of reports) {
      if (report.exemptions === 0) continue;
      emit(dim(`  ${report.file} — ${report.exemptions} exemption(s) honoured`));
    }
    emit();
  }

  if (problems === 0) {
    const suffix = exemptions === 0 ? '' : ` (${exemptions} exemption(s) honoured)`;
    emit(
      green(
        `✔ RTL logical properties: ${files.length} file(s) under src clean of physical direction classes${suffix}.`,
      ),
    );
    flush();
    process.exit(0);
  }

  emit(bold('RTL logical-property check'));
  emit(dim(`${files.length} file(s) scanned under ${relative(ROOT, SCAN_ROOT)}`));
  emit();

  for (const report of offenders) {
    emit(red(`${report.file} — ${report.unexplained} violation(s)`));
    for (const violation of report.violations) {
      const where = `${report.file}:${violation.line}:${violation.column}`;
      emit(
        `  ${where}  ${yellow(violation.token)} → ${green(violation.fixed)}  ${dim(`(${violation.rule})`)}`,
      );
    }
    emit();
  }

  emit(red(`✖ ${problems} physical direction class(es) in ${offenders.length} file(s).`));
  emit(dim('  §10.3 — logical properties only: ms/me, ps/pe, start/end, text-start/text-end,'));
  emit(dim('  border-s/border-e, rounded-s/rounded-e. Physical classes break the Arabic layout.'));
  emit(dim(`  Justified exception? Append \`// ${OPT_OUT_MARKER}: <reason>\` to the line.`));
  flush();
  process.exit(1);
}

main();
