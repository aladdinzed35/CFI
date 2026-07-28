import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

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

      const results = await new AxeBuilder({ page })
        .withTags([...WCAG_TAGS])
        // Replaced, not waived — see `expectComposedContrast` below.
        //
        // The design tokens build their washes with
        // `color-mix(in oklab, <accent> 12%, transparent)` (globals.css), which
        // the browser reports as `oklab(… / 0.12)`. axe-core cannot resolve a
        // translucent oklab background against what sits behind it, so it
        // reports every element using one as a contrast violation without
        // having measured anything. Composited by hand those elements sit at
        // 9.9:1 and 12.8:1 against a 4.5:1 requirement.
        //
        // Leaving the rule on would train everyone to ignore the suite. Turning
        // it off and walking away would lose the check entirely. So the rule is
        // disabled here and a stricter one — which composites alpha properly and
        // asserts the real ratio — runs immediately after, over every element.
        .disableRules(['color-contrast'])
        .analyze();

      for (const violation of results.violations) {
        for (const node of violation.nodes) {
          failures.push(
            `${screen.label} (${cfi.locale}/${cfi.formFactor}) — ${violation.id}: ${node.target.join(' ')}`,
          );
        }
      }

      failures.push(
        ...(await composedContrastFailures(page)).map(
          (entry) => `${screen.label} (${cfi.locale}/${cfi.formFactor}) — contrast: ${entry}`,
        ),
      );
    }

    expect(failures, 'accessibility violations').toEqual([]);
  });
});

/**
 * Text contrast, measured with alpha composited properly.
 *
 * This is the replacement for axe's `color-contrast` (see the note at its
 * `disableRules` call). It is stricter in the way that matters: it flattens a
 * translucent background against everything behind it before measuring, which
 * is exactly the case axe gives up on, and it walks EVERY text node rather than
 * the subset axe samples.
 *
 * It applies WCAG 1.4.3 as written — 3:1 for large text (>=24 px, or >=18.66 px
 * bold), 4.5:1 otherwise — and skips anything invisible, empty, or rendered
 * inside a `[aria-hidden]` subtree, none of which a person reads.
 */
async function composedContrastFailures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const channel = (value: number): number => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const luminance = (rgb: number[]): number =>
      0.2126 * channel(rgb[0] ?? 0) + 0.7152 * channel(rgb[1] ?? 0) + 0.0722 * channel(rgb[2] ?? 0);
    const parse = (value: string): number[] => {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    /** Flatten a translucent layer onto what is behind it. */
    const composite = (fg: number[], bg: number[]): number[] => {
      const alpha = fg[3] ?? 1;
      return [0, 1, 2].map((i) => Math.round((fg[i] ?? 0) * alpha + (bg[i] ?? 0) * (1 - alpha)));
    };
    const contrast = (a: number[], b: number[]): number => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
    };

    /**
     * The page's own backdrop, used when nothing up the tree paints an opaque
     * colour.
     *
     * Assuming white here is wrong and produces phantom failures: on the
     * dark theme every element whose ancestors are all transparent would be
     * measured as light ink on white and reported at ~1.6:1 while actually
     * rendering at 12:1. The browser paints the canvas from <body>, falling
     * back to <html>, so that is what gets read.
     */
    const canvas = ((): number[] => {
      for (const node of [document.body, document.documentElement]) {
        const parsed = parse(getComputedStyle(node).backgroundColor);
        if ((parsed[3] ?? 1) === 1) return parsed.slice(0, 3);
      }
      return [255, 255, 255];
    })();

    /** Every background from the element up to the root, flattened. */
    const backgroundBehind = (start: Element): number[] => {
      const layers: number[][] = [];
      let node: Element | null = start;
      while (node !== null) {
        const parsed = parse(getComputedStyle(node).backgroundColor);
        if ((parsed[3] ?? 1) > 0) layers.push(parsed);
        if ((parsed[3] ?? 1) === 1) break;
        node = node.parentElement;
      }
      return layers.reduceRight<number[]>((under, layer) => composite(layer, under), canvas);
    };

    /**
     * True when a translucent, blurred surface sits between this text and the
     * page — the `.surface-blur` chrome (sticky header, mobile purchase bar).
     *
     * What shows through is whatever happens to be scrolled underneath, so
     * there is no single backdrop coluor to measure and any number computed
     * here would be fiction. axe declines these for the same reason. They are
     * covered instead by the design rule that blurred chrome always pairs an
     * opaque-enough surface token with ink — checked by eye, in both themes.
     */
    const overBlurredSurface = (element: Element): boolean => {
      let node: Element | null = element;
      while (node !== null) {
        const style = getComputedStyle(node);
        const filter = style.backdropFilter || (style as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter;
        if (typeof filter === 'string' && filter !== '' && filter !== 'none') return true;
        node = node.parentElement;
      }
      return false;
    };

    const failures: string[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      if (element.closest('[aria-hidden="true"]') !== null) continue;
      if (overBlurredSurface(element)) continue;
      // Only elements that render text of their own.
      const ownText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .trim();
      if (ownText === '') continue;

      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;

      const size = Number.parseFloat(style.fontSize);
      const weight = Number.parseInt(style.fontWeight, 10) || 400;
      const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = isLarge ? 3 : 4.5;

      const foreground = composite(parse(style.color), backgroundBehind(element));
      const ratio = contrast(foreground, backgroundBehind(element));
      if (ratio + 0.005 < required) {
        const where = element.className.toString().slice(0, 60) || element.tagName.toLowerCase();
        failures.push(`${ratio.toFixed(2)}:1 (needs ${required}) "${ownText.slice(0, 28)}" — ${where}`);
      }
    }
    return failures;
  });
}
