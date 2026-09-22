# Brand assets

Owner-supplied. These are **blocking for launch**, not for development — the app runs
without them, but the first impression depends on them (spec §1, §29).

Drop the files here with exactly these names; the code already points at them.

| File | Used by | Notes |
|---|---|---|
| `logo-dark.svg` | header, footer, emails on dark | Full lockup, horizontal |
| `logo-light.svg` | header, footer on light theme | Same lockup, light-theme ink |
| `logo-mark.svg` | favicon source, PWA icon, certificate seal | Square mark only, no wordmark |
| `favicon.ico` | browsers | 16/32/48 multi-resolution |
| `icon-192.png` `icon-512.png` | `app/manifest.ts` | PWA, opaque background |
| `icon-maskable-192.png` `icon-maskable-512.png` | Android adaptive icons | Keep the mark inside the 80 % safe zone |
| `apple-touch-icon.png` | iOS home screen | 180×180, opaque |
| `og-default.png` | fallback Open Graph image | 1200×630 |
| `signature.png` | certificate PDF | Transparent PNG of the director's signature |
| `seal.svg` | certificate PDF | Center seal; the lattice fragment is generated per student |

## Rules

- SVG logos must have their text converted to outlines — the display font is not
  available inside a PDF or an email client.
- Icons are exported at their exact pixel size. Do not upscale a 192 into a 512.
- Nothing here is user-uploaded content. User uploads go to object storage
  (`docs/DEPLOYMENT.md`), never into the repository tree — the Hostinger filesystem is
  not durable across redeploys.

`seed/` holds the course and parcours cover photographs the seed points at. They are
produced by `npm run covers` from `scripts/covers/manifest.ts` — one photograph chosen per
course from Unsplash or Pexels (free licences), cropped to 1600 × 900 and kept under
500 KB. Credits live in `seed/CREDITS.md`, written by the same command. Edit the manifest
and re-run it; never edit the JPEGs by hand.
