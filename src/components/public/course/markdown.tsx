import { Fragment, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The small Markdown subset the catalogue actually stores.
 *
 * `CourseTranslation.description` and `LessonTranslation.content` are declared
 * as MDX in the schema, but what the editors write — and what the seed contains
 * — is a deliberately narrow subset: paragraphs, `##` headings, ordered and
 * unordered lists, `**bold**`, `*italic*` and `` `code` ``. This renderer
 * covers exactly that.
 *
 * ## Why not a library
 * §4 keeps the dependency list short, and every markdown-to-HTML package ends
 * in `dangerouslySetInnerHTML`. This builds **React elements** instead, so
 * nothing an administrator pastes can ever become markup: an author who writes
 * `<script>` gets the literal text `<script>` on screen. That property is worth
 * more here than footnotes and tables, neither of which the content uses.
 *
 * ## Headings
 * The caller passes the level, because heading order is a hard accessibility
 * gate (§21): inside a `<section>` whose own title is an `<h2>`, a `##` in the
 * body must render as `<h3>`, and inside the preview modal — whose title is the
 * dialog heading — as `<h4>`.
 */

export type MarkdownHeadingLevel = 'h3' | 'h4' | 'h5';

const NEXT_LEVEL: Record<MarkdownHeadingLevel, MarkdownHeadingLevel> = {
  h3: 'h4',
  h4: 'h5',
  h5: 'h5',
};

const HEADING_CLASSES: Record<MarkdownHeadingLevel, string> = {
  h3: 'font-display text-heading font-medium text-ink',
  h4: 'font-display text-lead font-medium text-ink',
  h5: 'text-body font-medium text-ink',
};

export interface MarkdownProps {
  /** Raw source. Empty or blank renders nothing at all. */
  source: string;
  /** Level `##` maps to. `###` maps one step deeper. */
  headingLevel?: MarkdownHeadingLevel;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/* Inline                                                                      */
/* -------------------------------------------------------------------------- */

/** `**bold**`, `*italic*`, `` `code` `` — longest marker first so `**` wins over `*`. */
const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;

function renderInline(text: string, keyPrefix: string): ReactNode {
  const parts = text.split(INLINE_PATTERN).filter((part) => part !== '');

  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={key} className="font-medium text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="rounded-sm bg-raised px-1 py-0.5 font-mono text-sm text-ink">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

/* -------------------------------------------------------------------------- */
/* Block                                                                       */
/* -------------------------------------------------------------------------- */

type Block =
  | { readonly kind: 'heading'; readonly depth: 2 | 3; readonly text: string }
  | { readonly kind: 'ordered'; readonly items: readonly string[] }
  | { readonly kind: 'unordered'; readonly items: readonly string[] }
  | { readonly kind: 'quote'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string };

const ORDERED_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const UNORDERED_ITEM = /^\s*[-*+]\s+(.*)$/;
const HEADING = /^\s*(#{2,6})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

function parseBlocks(source: string): readonly Block[] {
  const chunks = source.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const blocks: Block[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;

    const first = lines[0];
    if (first === undefined) continue;

    const heading = HEADING.exec(first);
    if (heading !== null) {
      const hashes = heading[1] ?? '##';
      const label = (heading[2] ?? '').trim();
      if (label !== '') blocks.push({ kind: 'heading', depth: hashes.length === 2 ? 2 : 3, text: label });
      // A heading line never carries siblings in the same chunk in this corpus,
      // but if it does the remainder becomes its own paragraph.
      const rest = lines.slice(1).join(' ').trim();
      if (rest !== '') blocks.push({ kind: 'paragraph', text: rest });
      continue;
    }

    if (ORDERED_ITEM.test(first)) {
      const items = lines
        .map((line) => ORDERED_ITEM.exec(line)?.[1]?.trim() ?? line.trim())
        .filter((item) => item !== '');
      blocks.push({ kind: 'ordered', items });
      continue;
    }

    if (UNORDERED_ITEM.test(first)) {
      const items = lines
        .map((line) => UNORDERED_ITEM.exec(line)?.[1]?.trim() ?? line.trim())
        .filter((item) => item !== '');
      blocks.push({ kind: 'unordered', items });
      continue;
    }

    if (QUOTE.test(first)) {
      const text = lines
        .map((line) => QUOTE.exec(line)?.[1]?.trim() ?? line.trim())
        .join(' ')
        .trim();
      if (text !== '') blocks.push({ kind: 'quote', text });
      continue;
    }

    blocks.push({ kind: 'paragraph', text: lines.join(' ').trim() });
  }

  return blocks;
}

export function Markdown({
  source,
  headingLevel = 'h3',
  className,
}: MarkdownProps): React.JSX.Element | null {
  const blocks = parseBlocks(source);
  if (blocks.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-4 text-body text-pretty text-ink-muted', className)}>
      {blocks.map((block, index) => {
        const key = `block-${index}`;

        switch (block.kind) {
          case 'heading': {
            const level: MarkdownHeadingLevel =
              block.depth === 2 ? headingLevel : NEXT_LEVEL[headingLevel];
            // No cast: React 19 removed the global `JSX` namespace (it lives at
            // `React.JSX` now), and MarkdownHeadingLevel is already a union of
            // three intrinsic tags, so `ElementType` accepts it as written.
            const Heading: React.ElementType = level;
            return (
              <Heading key={key} className={cn('mt-2 text-balance first:mt-0', HEADING_CLASSES[level])}>
                {renderInline(block.text, key)}
              </Heading>
            );
          }

          case 'ordered':
            return (
              <ol key={key} className="flex list-decimal flex-col gap-2 ps-5 marker:text-ink-muted">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`} className="ps-1">
                    {renderInline(item, `${key}-${itemIndex}`)}
                  </li>
                ))}
              </ol>
            );

          case 'unordered':
            return (
              <ul key={key} className="flex list-disc flex-col gap-2 ps-5 marker:text-strait">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`} className="ps-1">
                    {renderInline(item, `${key}-${itemIndex}`)}
                  </li>
                ))}
              </ul>
            );

          case 'quote':
            return (
              <blockquote key={key} className="border-s-2 border-strait ps-4 text-ink italic">
                {renderInline(block.text, key)}
              </blockquote>
            );

          default:
            return <p key={key}>{renderInline(block.text, key)}</p>;
        }
      })}
    </div>
  );
}
