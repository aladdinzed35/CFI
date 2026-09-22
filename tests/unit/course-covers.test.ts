import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { seedCoverKeys } from '../../prisma/seed/catalog';
import { COVERS, coverKey } from '../../scripts/covers/manifest';

/**
 * The seed writes a cover key for every course and parcours; a committed
 * photograph must stand behind each one, and each photograph must say where it
 * came from. A key with no file is not an error at runtime — the card draws
 * its placeholder — which is exactly why it needs a test: nobody would notice.
 */
describe('seeded course covers', () => {
  const keys = seedCoverKeys();

  it('has one sourced cover per seeded course and parcours, and nothing else', () => {
    expect([...COVERS.map(coverKey)].sort()).toEqual([...keys].sort());
  });

  it.each(keys)('%s is a committed 1600 × 900 JPEG under 500 KB', async (key) => {
    const file = join(process.cwd(), 'public', 'brand', key);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThanOrEqual(500 * 1024);

    const meta = await sharp(file).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([1600, 900]);
  });

  it('credits every photograph to its photographer, on a free licence', () => {
    for (const cover of COVERS) {
      expect(cover.source.photographer.trim()).not.toBe('');
      expect(cover.source.pageUrl).toMatch(/^https:\/\/(unsplash\.com|www\.pexels\.com)\//u);
    }
  });
});
