import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/cn';

/**
 * `cn` decides which utility survives a conflict, so a mistake here is invisible
 * — no error, no failing type, just a class quietly absent from the output and a
 * component rendering the wrong colour.
 *
 * That is not hypothetical: the design system's type scale (`text-lead`,
 * `text-title`, …) was read by tailwind-merge as a text COLOUR, so every
 * `size="lg"` button dropped the `text-on-accent` from its own variant and put
 * light ink on a bright teal fill at 1.42:1. These tests exist so it cannot
 * come back silently.
 */

describe('cn — the type scale is a size, not a colour', () => {
  it.each(['hero', 'display', 'title', 'heading', 'lead', 'body'])(
    'keeps a text colour alongside text-%s',
    (step) => {
      const result = cn('text-on-accent', `text-${step}`);
      expect(result).toContain('text-on-accent');
      expect(result).toContain(`text-${step}`);
    },
  );

  it('reproduces the exact button case that failed', () => {
    // bg-strait + text-on-accent from the primary variant, text-lead from size lg.
    const result = cn('bg-strait text-on-accent shadow-e1', 'h-14 px-7 text-lead');
    expect(result).toContain('text-on-accent');
    expect(result).toContain('text-lead');
  });

  it('still lets one type-scale step override another', () => {
    expect(cn('text-title', 'text-body')).toBe('text-body');
  });

  it('still lets the type scale conflict with Tailwind own sizes', () => {
    expect(cn('text-lead', 'text-sm')).toBe('text-sm');
    expect(cn('text-sm', 'text-lead')).toBe('text-lead');
  });

  it('still lets one text colour override another', () => {
    expect(cn('text-ink', 'text-ink-muted')).toBe('text-ink-muted');
  });
});

describe('cn — ordinary merging still behaves', () => {
  it('lets the last conflicting utility win', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('resolves conditional syntax', () => {
    expect(cn('a', false && 'b', undefined, ['c', null])).toBe('a c');
  });

  it('keeps non-conflicting utilities', () => {
    expect(cn('inline-flex items-center', 'gap-2')).toBe('inline-flex items-center gap-2');
  });
});
