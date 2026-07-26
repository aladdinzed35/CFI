import { getTranslations } from 'next-intl/server';

/**
 * §12.2 §2 — « Notre méthode immersive ».
 *
 * Four tiles, explicitly **not** numbered: these are four properties of the same
 * method, not four steps (that is §5's job, and it *is* numbered). Each tile is
 * an icon, a short title and two lines of copy.
 *
 * ## The icons are the Lattice, not a stock set
 *
 * §11.2 restricts the lattice tessellation to three places and asks the method
 * tiles to carry "an icon drawn in the lattice geometry". So the four glyphs
 * here are built from the *same* octagram construction as `ui/lattice-grid.tsx`
 * — the {8/2} star from two squares at 45°, with inner radius R·cos45° — but
 * each one is a different operation on it: whole, quartered, doubled, split.
 * They read as a family because they are literally the same polygon, and they
 * cost nothing: four inline paths, no icon font, no client JavaScript.
 *
 * The glyphs are `aria-hidden`; the tile's meaning is entirely in its heading
 * and its copy, so nothing is lost when they are not rendered.
 */

/* The octagram, derived exactly as in `ui/lattice-grid.tsx`, on a 0…24 box. */
const R = 11;
const C = 12;
const B = R * Math.SQRT1_2;
const A = R - B;

function octagram(): string {
  const quarter: readonly (readonly [number, number])[] = [
    [R, 0],
    [B, A],
    [B, B],
    [A, B],
  ];

  const points: string[] = [];
  for (let turn = 0; turn < 4; turn += 1) {
    for (const [qx, qy] of quarter) {
      let x = qx;
      let y = qy;
      for (let step = 0; step < turn; step += 1) {
        const rotated = -y;
        y = x;
        x = rotated;
      }
      points.push(`${round(C + x)},${round(C + y)}`);
    }
  }
  return points.join(' ');
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

const STAR = octagram();

type GlyphId = 'whole' | 'quartered' | 'doubled' | 'split';

/**
 * One shared star, four operations on it. `clipPath` is what lets the split and
 * quartered variants stay a single polygon instead of four hand-drawn ones.
 */
function MethodGlyph({ id }: { id: GlyphId }): React.JSX.Element {
  const clipId = `cfi-method-clip-${id}`;

  return (
    <svg
      viewBox="0 0 24 24"
      className="size-7 text-strait"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {id === 'doubled' ? (
        <>
          <polygon points={STAR} transform="translate(-2.5 -2.5) scale(0.78) translate(3.4 3.4)" />
          <polygon
            points={STAR}
            transform="translate(2.5 2.5) scale(0.78) translate(3.4 3.4)"
            fill="currentColor"
            fillOpacity="0.16"
          />
        </>
      ) : (
        <>
          <defs>
            <clipPath id={clipId}>
              {id === 'quartered' ? <rect x="0" y="0" width="12" height="12" /> : null}
              {id === 'split' ? <rect x="12" y="0" width="12" height="24" /> : null}
              {id === 'whole' ? <rect x="0" y="0" width="24" height="24" /> : null}
            </clipPath>
          </defs>
          <polygon points={STAR} />
          <polygon
            points={STAR}
            fill="currentColor"
            fillOpacity={id === 'whole' ? 0.14 : 0.28}
            stroke="none"
            clipPath={`url(#${clipId})`}
          />
        </>
      )}
    </svg>
  );
}

const TILES: readonly { key: 'tile1' | 'tile2' | 'tile3' | 'tile4'; glyph: GlyphId }[] = [
  { key: 'tile1', glyph: 'whole' },
  { key: 'tile2', glyph: 'quartered' },
  { key: 'tile3', glyph: 'doubled' },
  { key: 'tile4', glyph: 'split' },
];

export async function HomeMethod(): Promise<React.JSX.Element> {
  const t = await getTranslations('home.method');

  return (
    <section aria-labelledby="home-method-title" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
        {t('sectionLabel')}
      </p>
      <h2 id="home-method-title" className="mt-4 max-w-[20ch] text-display">
        {t('title')}
      </h2>
      <p className="mt-5 max-w-[62ch] text-lead text-ink-muted">{t('subtitle')}</p>

      <ul role="list" className="mt-12 grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
        {TILES.map((tile) => (
          <li key={tile.key} className="flex flex-col gap-4 bg-surface p-6">
            <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-md bg-strait-wash">
              <MethodGlyph id={tile.glyph} />
            </span>
            <h3 className="text-heading font-medium text-ink">{t(`${tile.key}.title`)}</h3>
            <p className="text-sm text-ink-muted">{t(`${tile.key}.body`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
