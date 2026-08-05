import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PUBLIC_CACHE_SECONDS } from '@/lib/cache-windows';

/**
 * The public segment's `revalidate` and `PUBLIC_CACHE_SECONDS` are the same
 * promise written twice, and they cannot be the same symbol.
 *
 * §17.5 tells an editor their save is live "within a minute", and
 * `PUBLIC_CACHE_SECONDS` is what the course actions report. The window that
 * actually delivers it is `export const revalidate` in
 * `app/[locale]/(public)/layout.tsx` — which Next reads *statically*, so
 * `export const revalidate = PUBLIC_CACHE_SECONDS` does not build. It fails the
 * entire build with « can't recognize the exported `config` field », naming
 * whichever route it happened to reach first, which is a genuinely confusing
 * error to be handed for this mistake.
 *
 * So the literal stays, and this reads it back out of the source. Raising one
 * without the other would leave the editor's promise quietly false.
 */

const LAYOUT = join(process.cwd(), 'src', 'app', '[locale]', '(public)', 'layout.tsx');

describe('the public pages revalidate as fast as §17.5 promises', () => {
  it('declares a literal revalidate window', () => {
    const source = readFileSync(LAYOUT, 'utf8');
    const match = source.match(/^export const revalidate = (\d+);$/mu);

    expect(match, 'the public layout exports a literal `revalidate`').not.toBeNull();
    expect(Number(match?.[1]), 'the window matches PUBLIC_CACHE_SECONDS').toBe(
      PUBLIC_CACHE_SECONDS,
    );
  });

  /**
   * Zero would opt the segment back out of static generation entirely, undoing
   * the change that made 56 routes prerender, and it is exactly what someone
   * reaches for when a staleness bug is reported.
   */
  it('is a real window, not a disguised opt-out', () => {
    expect(PUBLIC_CACHE_SECONDS).toBeGreaterThan(0);
    expect(PUBLIC_CACHE_SECONDS).toBeLessThanOrEqual(300);
  });
});
