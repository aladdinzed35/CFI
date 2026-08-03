import AxeBuilder from '@axe-core/playwright';

import { catalogueSlugs, expect, test } from './fixtures/base';

/**
 * **axe over the public surfaces, in both directions** (§21, §22, §26).
 *
 * §26 requires zero axe violations on the key screens in both locales, and the
 * config already runs every spec under `fr` and `ar`, so this file lists the
 * screens once and the projects supply the direction. Right-to-left is not a
 * cosmetic variant here: a mirrored layout changes reading order, focus order
 * and every `aria-label` on the page.
 *
 * ## Which rules
 * WCAG 2.0/2.1/2.2 at levels A and AA — the standard §21 names. `best-practice`
 * is deliberately *not* included: it is advisory, it changes between axe
 * releases, and a gate that fails on advice is a gate people learn to skip.
 *
 * ## What axe cannot see
 * Colour contrast is checked, but only against what is painted at the moment of
 * the scan, so the light theme is what these runs cover; keyboard operability,
 * the visible focus ring and the reading order of a mirrored layout are checked
 * by the journey spec and by hand. axe reporting zero is the floor, not the
 * ceiling — `docs/TESTING.md` says so in as many words.
 *
 * ## Reading a failure
 * Violations are reduced to `rule — target` lines before the assertion, because
 * the raw axe result is several hundred lines of JSON per violation and the
 * useful part is which rule broke on which element.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

interface Screen {
  readonly label: string;
  readonly path: string;
}

test.describe('Accessibility', () => {
  test('@critical axe reports no violation on the public surfaces', async ({ page, cfi }) => {
    await page.goto(cfi.route('/formations'));
    const slugs = await catalogueSlugs(page, cfi.locale);
    const slug = slugs[0];
    expect(slug, 'the catalogue lists at least one course').toBeDefined();

    const screens: readonly Screen[] = [
      { label: 'homepage', path: '/' },
      { label: 'catalogue', path: '/formations' },
      { label: 'course', path: `/formations/${slug ?? ''}` },
      { label: 'contact', path: '/contact' },
      { label: 'registration', path: '/inscription' },
    ];

    const failures: string[] = [];

    for (const screen of screens) {
      await page.goto(cfi.route(screen.path));
      // The h1 is the last thing every one of these pages renders above the
      // fold; waiting on it beats waiting on a timer.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      // color-contrast is ON. It can measure our washes because they are
      // OPAQUE colours (see the note in globals.css): a color-mix against
      // transparent produced an oklab alpha that axe cannot evaluate, so it
      // reported violations it had never measured. Fixing the token removed the
      // need for a bespoke contrast checker entirely.
      const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();

      for (const violation of results.violations) {
        for (const node of violation.nodes) {
          failures.push(
            `${screen.label} (${cfi.locale}/${cfi.formFactor}) — ${violation.id}: ${node.target.join(' ')}`,
          );
        }
      }

    }

    expect(failures, 'accessibility violations').toEqual([]);
  });
});

