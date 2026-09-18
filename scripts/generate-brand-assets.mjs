/**
 * Generate every raster brand asset the app references, from the logo's SVG.
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * Seven files under /brand/ were referenced — by the metadata, the web app
 * manifest and eight pages' Open Graph tags — and none of them existed: the
 * first production deployment had no favicon, no home-screen icon, and shared
 * to WhatsApp as a bare link with no preview. `public/brand/` held only a
 * README.
 *
 * They are generated rather than drawn once by hand, so the logo, the
 * palette and the hero illustration stay the single source of truth: change
 * the mark, run this, commit the PNGs. Raw hex is allowed here — this is a
 * build tool writing pixels, not a component reading tokens — and each value
 * mirrors the dark theme in src/styles/globals.css.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const OUT = join(process.cwd(), 'public', 'brand');

const C = {
  abyss: '#060a12',
  surface: '#0d1522',
  strait: '#2fe3be',
  deep: '#0e4c6b',
  brass: '#e7b463',
  ink: '#e8f0f4',
  muted: '#8da2b4',
  skyTop: '#07243a',
  skyHorizon: '#1c8f7f',
  sun: '#f0b860',
  silhouette: '#051726',
};

/** The zellige eight-point star — the logo — centred on (cx, cy). */
function star(cx, cy, size, attrs) {
  const h = size / 2;
  const r = size * 0.06;
  return `<g ${attrs}>
    <rect x="${cx - h}" y="${cy - h}" width="${size}" height="${size}" rx="${r}"/>
    <rect x="${cx - h}" y="${cy - h}" width="${size}" height="${size}" rx="${r}" transform="rotate(45 ${cx} ${cy})"/>
  </g>`;
}

/**
 * The app icon. `inset` is the fraction of the canvas the mark may occupy:
 * a maskable icon keeps it inside the 80 % safe zone, because Android crops
 * the corners into a circle or a squircle.
 */
function iconSvg(size, { inset, rounded }) {
  const mark = size * inset;
  const radius = rounded ? size * 0.22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <radialGradient id="g" cx="0.5" cy="0.42" r="0.7">
        <stop offset="0" stop-color="${C.surface}"/>
        <stop offset="1" stop-color="${C.abyss}"/>
      </radialGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${radius}" fill="url(#g)"/>
    ${star(size / 2, size / 2, mark * 0.72, `fill="none" stroke="${C.strait}" stroke-width="${Math.max(1.5, size * 0.045)}" stroke-linejoin="round"`)}
  </svg>`;
}

async function png(svg, file) {
  const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(join(OUT, file), buffer);
  return buffer;
}

/**
 * A `.ico` holding PNG payloads — valid since Windows Vista and in every
 * browser. sharp cannot write ICO, and the format is a 6-byte header plus a
 * 16-byte directory entry per image, so it is written by hand.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

/**
 * The share image, 1200 × 630: the promise on the left, Bab Mansour on the
 * right — the same gate as the homepage hero, so a link shared on WhatsApp
 * looks like the page it opens.
 */
function ogSvg() {
  const W = 1200;
  const H = 630;
  // The gate, drawn at the hero's geometry and scaled into place.
  const gate = `<g transform="translate(724 42) scale(0.98)">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.skyTop}"/><stop offset="1" stop-color="${C.skyHorizon}"/>
      </linearGradient>
      <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="${C.sun}" stop-opacity="0.95"/>
        <stop offset="0.45" stop-color="${C.sun}" stop-opacity="0.45"/>
        <stop offset="1" stop-color="${C.sun}" stop-opacity="0"/>
      </radialGradient>
      <pattern id="tile" width="40" height="40" patternUnits="userSpaceOnUse">
        ${star(20, 20, 14, `fill="${C.brass}" opacity="0.75"`)}
        <g fill="${C.strait}" opacity="0.55">
          <rect x="-3" y="-3" width="6" height="6" transform="rotate(45 0 0)"/>
          <rect x="37" y="-3" width="6" height="6" transform="rotate(45 40 0)"/>
          <rect x="-3" y="37" width="6" height="6" transform="rotate(45 0 40)"/>
          <rect x="37" y="37" width="6" height="6" transform="rotate(45 40 40)"/>
        </g>
      </pattern>
      <clipPath id="arch"><path d="M110.3 512 L110.3 297.2 A138 138 0 1 1 369.7 297.2 L369.7 512 Z"/></clipPath>
    </defs>
    <rect x="62" y="24" width="356" height="512" rx="10" fill="${C.surface}" stroke="#1e2c3f" stroke-width="1.5"/>
    <rect x="62" y="24" width="356" height="512" rx="10" fill="url(#tile)"/>
    <rect x="80" y="42" width="320" height="494" rx="4" fill="none" stroke="${C.brass}" stroke-opacity="0.6" stroke-width="1.25"/>
    <g clip-path="url(#arch)">
      <rect x="100" y="100" width="280" height="420" fill="url(#sky)"/>
      <circle cx="240" cy="352" r="118" fill="url(#sun)"/>
      <circle cx="240" cy="352" r="40" fill="${C.sun}"/>
      <g fill="${C.silhouette}">
        <rect x="146" y="360" width="30" height="130"/><rect x="150" y="344" width="22" height="18"/>
        <rect x="157" y="330" width="8" height="16"/><circle cx="161" cy="326" r="4"/>
        <path d="M268 430 a34 34 0 0 1 68 0 z"/><rect x="266" y="428" width="72" height="62"/>
        <path d="M100 452 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 v-10 h12 v10 h14 V520 H100 Z"/>
      </g>
    </g>
    <path d="M110.3 512 L110.3 297.2 A138 138 0 1 1 369.7 297.2 L369.7 512 Z" fill="none" stroke="${C.brass}" stroke-width="3"/>
    <circle cx="240" cy="70" r="26" fill="${C.surface}" stroke="${C.brass}" stroke-width="1.25"/>
    ${star(240, 70, 24, `fill="${C.sun}"`)}
    <rect x="80" y="512" width="320" height="24" rx="2" fill="#142031"/>
  </g>`;

  const font = `font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <radialGradient id="bg" cx="0.72" cy="0.45" r="0.8">
        <stop offset="0" stop-color="#0b1e2a"/><stop offset="1" stop-color="${C.abyss}"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${star(88, 92, 36, `fill="none" stroke="${C.strait}" stroke-width="2.4" stroke-linejoin="round"`)}
    <text x="124" y="104" ${font} font-size="34" font-weight="500" fill="${C.ink}">CFI</text>
    <text x="72" y="196" ${font} font-size="15" letter-spacing="3.5" fill="${C.strait}">CENTRE DE FORMATION IMMERSIVE · MEKNÈS</text>
    <text ${font} font-size="54" font-weight="600" fill="${C.ink}" letter-spacing="-1">
      <tspan x="70" y="272">Des formations</tspan>
      <tspan x="70" y="336">immersives, encadrées</tspan>
      <tspan x="70" y="400">par des professionnels</tspan>
    </text>
    <text x="72" y="468" ${font} font-size="22" fill="${C.muted}">En ligne et au centre · Suivi humain · Certificat vérifiable</text>
    <rect x="72" y="514" width="214" height="54" rx="27" fill="${C.strait}"/>
    <text x="179" y="548" ${font} font-size="20" font-weight="600" fill="#04231d" text-anchor="middle">Voir les formations</text>
    ${gate}
  </svg>`;
}

async function main() {
  const written = [];

  await png(iconSvg(192, { inset: 0.86, rounded: true }), 'icon-192.png');
  await png(iconSvg(512, { inset: 0.86, rounded: true }), 'icon-512.png');
  // Maskable: full bleed, mark inside the 80 % safe zone.
  await png(iconSvg(192, { inset: 0.62, rounded: false }), 'icon-maskable-192.png');
  await png(iconSvg(512, { inset: 0.62, rounded: false }), 'icon-maskable-512.png');
  // iOS rounds the corners itself; a transparent corner would show as black.
  await png(iconSvg(180, { inset: 0.8, rounded: false }), 'apple-touch-icon.png');
  written.push('icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', 'apple-touch-icon.png');

  const sizes = [16, 32, 48];
  const faviconImages = await Promise.all(
    sizes.map(async (size) => ({
      size,
      data: await sharp(Buffer.from(iconSvg(size, { inset: 0.94, rounded: true }))).png().toBuffer(),
    })),
  );
  await writeFile(join(OUT, 'favicon.ico'), ico(faviconImages));
  written.push('favicon.ico');

  await png(ogSvg(), 'og-default.png');
  written.push('og-default.png');

  for (const file of written) {
    const { size } = await import('node:fs').then((fs) => fs.promises.stat(join(OUT, file)));
    console.log(`  ${file.padEnd(24)} ${(size / 1024).toFixed(1)} KB`);
  }
}

await main();
