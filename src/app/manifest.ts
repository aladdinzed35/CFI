import type { MetadataRoute } from 'next';

/**
 * PWA manifest (§13.5 — installable, maskable icons, offline shell).
 *
 * A manifest is static JSON served once for the whole origin: it cannot be
 * localized per route and it cannot read CSS custom properties. So the two
 * colours below are written literally and must stay in sync with
 * `--raw-bg-abyss` (dark) in src/styles/globals.css, and the copy is in French,
 * the source language (§28.1). This is the documented exception to "no raw
 * colour values" — it is metadata, not a component.
 */

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'CFI — Centre de Formation Immersive',
    short_name: 'CFI',
    description:
      'Formations immersives du Centre de Formation Immersive de Meknès : cours vidéo, exercices et suivi de progression.',
    start_url: '/fr',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    lang: 'fr-MA',
    dir: 'ltr',
    categories: ['education'],
    // Mirrors --raw-bg-abyss (dark theme) so the splash screen never flashes.
    background_color: '#060a12',
    theme_color: '#060a12',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/brand/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/brand/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
