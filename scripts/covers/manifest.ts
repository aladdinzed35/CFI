/**
 * The seeded courses' and parcours' cover photographs — which photo, by whom,
 * published where, and how it is cropped.
 *
 * Chosen per course from Unsplash and Pexels (free licences only — Unsplash+
 * excluded) against one brief: the card must name its subject without its
 * title; sharp and contemporary; safe in both the 16 / 9 card and the square
 * centre crop of the compact card; no platform logos, watermarks or
 * US-specific details; people and places a learner in Morocco recognises
 * wherever the subject allows; one photo never serves two covers, and no model
 * appears on two. Each pick survived an independent reviewer asked to overturn
 * it.
 *
 * `npm run covers` turns this list into `public/brand/seed/**` and
 * `public/brand/seed/CREDITS.md`. The file names match the seed's cover keys
 * (`coverKeyFor` / `pathCoverKeyFor` in `prisma/seed/catalog.ts`);
 * `tests/unit/course-covers.test.ts` keeps the two in step.
 */

export type CoverKind = 'course' | 'path';

export interface CoverSource {
  readonly provider: 'unsplash' | 'pexels';
  /** Unsplash: the `photo-…` path on images.unsplash.com. Pexels: the numeric id. */
  readonly id: string;
  /** Pexels only: the file name under images.pexels.com/photos/<id>/. */
  readonly file?: string;
  readonly photographer: string;
  readonly photographerUrl: string;
  /** The photo's page on the provider — the licence travels with it. */
  readonly pageUrl: string;
}

export interface CoverEntry {
  readonly slug: string;
  readonly kind: CoverKind;
  readonly source: CoverSource;
  /**
   * Which part of the source survives the crop to 16 / 9 (sharp gravity).
   * Most sources are 3 : 2, so this picks the vertical band; `north` keeps a
   * standing subject's head.
   */
  readonly position: 'centre' | 'north' | 'south' | 'east' | 'west';
  /**
   * Optional region of the source to keep BEFORE the crop, as fractions of
   * its width and height — to bring an off-centre subject towards the middle,
   * where the compact card's square crop looks.
   */
  readonly region?: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
}

const unsplash = (
  id: string,
  slug: string,
  photographer: string,
  username: string,
): CoverSource => ({
  provider: 'unsplash',
  id,
  photographer,
  photographerUrl: `https://unsplash.com/@${username}`,
  pageUrl: `https://unsplash.com/photos/${slug}`,
});

const pexels = (id: string, page: string, photographer: string, profile: string): CoverSource => ({
  provider: 'pexels',
  id,
  file: `pexels-photo-${id}.jpeg`,
  photographer,
  photographerUrl: `https://www.pexels.com/@${profile}/`,
  pageUrl: `https://www.pexels.com/photo/${page}/`,
});

export const COVERS: readonly CoverEntry[] = [
  {
    // A hand sketching the social web — Friend, Chat, Share, Like — beside a laptop and phone.
    slug: 'marketing-digital-fondations',
    kind: 'course',
    source: pexels('6016365', 'women-planning-their-small-business-6016365', 'Arina Krasnikova', 'arina-krasnikova'),
    position: 'centre',
  },
  {
    // Paid-ads KPI tiles — CTR, Quality Score, cost per conversion.
    slug: 'publicite-en-ligne-meta-et-google-ads',
    kind: 'course',
    source: unsplash('photo-1526628953301-3e589a6a8b74', 'turned-on-monitoring-screen-qwtCeJ5cLYs', 'Stephen Dawson', 'dawson2406'),
    position: 'centre',
  },
  {
    // HTML and SVG markup in a navy editor.
    slug: 'developpement-web-html-css-javascript',
    kind: 'course',
    source: unsplash('photo-1542831371-29b0f74f9713', 'lines-of-html-codes-4hbJ-eymZ1o', 'Florian Olivo', 'florianolv'),
    position: 'centre',
  },
  {
    // A React project open beside its editor. The atom is the technology taught, not a platform brand.
    slug: 'react-et-next-js-applications-web',
    kind: 'course',
    source: unsplash('photo-1633356122544-f134324a6cee', 'a-computer-screen-with-a-logo-on-it-xkBaqlcqeb4', 'Lautaro Andreani', 'lautaroandreani'),
    position: 'centre',
    // Framed on the right of the source so the atom survives the compact
    // card's square centre crop, not just the 16 / 9 card.
    region: { left: 0.32, top: 0, width: 0.68, height: 1 },
  },
  {
    // A hand sketching a phone wireframe on a dark desk.
    slug: 'ui-ux-concevoir-des-interfaces-utilisables',
    kind: 'course',
    source: unsplash('photo-1698434156098-68e834638679', 'a-person-drawing-a-picture-on-a-piece-of-paper-ks0Z4oeFiOk', 'Kelly Sikkema', 'kellysikkema'),
    position: 'centre',
  },
  {
    // A creator filming himself on a phone held vertical on a gimbal.
    slug: 'montage-video-formats-courts',
    kind: 'course',
    source: pexels('8360497', 'man-filming-himself-using-a-smartphone-8360497', 'Ron Lach', 'ron-lach'),
    position: 'centre',
  },
  {
    // Invoices, a calculator and a spreadsheet on one desk: the books of a small business.
    slug: 'comptabilite-et-gestion-d-une-tpe',
    kind: 'course',
    source: unsplash('photo-1664575602276-acd073f104c1', 'a-person-sitting-at-a-table-with-a-laptop-oUbzU87d1Gc', 'Microsoft 365', 'microsoft365'),
    position: 'centre',
  },
  {
    // Signing the papers that bring a company into existence — the act the
    // course ends on. The owner asked for the deed rather than a Moroccan
    // scene, so nothing here places it.
    slug: 'creer-son-entreprise-au-maroc',
    kind: 'course',
    source: pexels('8730998', 'elegant-man-signing-documents-8730998', 'Mikhail Nilov', 'mikhail-nilov'),
    position: 'centre',
  },
  {
    // A woman in a hijab presenting to her colleagues — speaking up at work.
    slug: 'anglais-professionnel-prendre-la-parole',
    kind: 'course',
    source: pexels('8154798', 'a-woman-standing-in-front-of-her-colleagues-8154798', 'Cedric Fauntleroy', 'cedric-fauntleroy'),
    position: 'north',
  },
  {
    // Drafting by hand, then typing it up — writing at work.
    slug: 'francais-professionnel-ecrire-au-travail',
    kind: 'course',
    source: unsplash('photo-1622127800211-0181b285b5ad', 'person-in-black-and-white-long-sleeve-shirt-writing-on-white-paper-VlmpyIQ8GHw', 'TheStandingDesk', 'thestandingdesk'),
    position: 'centre',
  },
  {
    // Tables, heat maps and charts on a laptop — the analysis the course ends on.
    slug: 'excel-de-zero-a-l-analyse',
    kind: 'course',
    source: unsplash('photo-1504868584819-f8e8b4b6d7e3', 'turned-on-black-and-grey-laptop-computer-mcSDtbWXUZU', 'Lukas Blazek', 'goumbik'),
    position: 'centre',
  },
  {
    // An « Ask anything » prompt, no vendor mark: the assistant as a daily tool.
    slug: 'ia-generative-au-quotidien',
    kind: 'course',
    source: unsplash('photo-1762330470070-249e7c23c8c0', 'digital-interface-with-ask-anything-prompt--lZmnpignB8', 'Zulfugar Karimov', 'zulfugarkarimov'),
    position: 'centre',
    // Keeps « Ask anything » whole in the square crop; centred, it reads « …nything ».
    region: { left: 0, top: 0, width: 0.78, height: 1 },
  },
  {
    // A mixed team planning a campaign on a glass wall of sticky notes.
    slug: 'parcours-marketing-digital-complet',
    kind: 'path',
    source: unsplash('photo-1758691736843-90f58dce465e', 'diverse-team-collaborating-on-sticky-notes-Imk2h0pyOvo', 'Vitaly Gariev', 'silverkblack'),
    position: 'centre',
  },
  {
    // A developer at work among his monitors — who the parcours turns you into.
    slug: 'parcours-developpeur-web',
    kind: 'path',
    source: unsplash('photo-1719400471588-575b23e27bd7', 'a-man-sitting-in-front-of-three-computer-monitors-fdGTi4IcaJc', 'Abu Saeid', 'abusaeid01'),
    position: 'centre',
  },
  {
    // The owner in her own café — the end of the parcours.
    slug: 'parcours-creer-et-gerer-son-activite',
    kind: 'path',
    source: pexels('3906984', 'woman-wearing-an-apron-standing-by-the-shelves-3906984', 'Andrea Piacquadio', 'olly'),
    position: 'centre',
  },
];

export function coverKey(entry: CoverEntry): string {
  return `seed/${entry.kind === 'course' ? 'courses' : 'paths'}/${entry.slug}.jpg`;
}
