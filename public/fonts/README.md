# Fonts

Self-hosted and subset. `src/styles/globals.css` declares each `@font-face` with a
fallback further down the family stack, so a **missing file degrades gracefully** —
the app renders in the fallback face instead of failing the build. Ship the real
binaries before launch: the display face is a brand asset and the page reads
noticeably flatter without it.

| File | Family | Where to get it | Subset |
|---|---|---|---|
| `chillax-variable.woff2` | Chillax (display) | [Fontshare](https://fontshare.com/fonts/chillax) — free for commercial use | Latin + Latin-ext |
| `geist-variable.woff2` | Geist Sans (body/UI) | [vercel/geist-font](https://github.com/vercel/geist-font) — OFL | Latin + Latin-ext |
| `geist-mono-variable.woff2` | Geist Mono (prices, references, RIB, timers) | same repo — OFL | Latin, tabular figures |
| `ibm-plex-sans-arabic-400.woff2` | IBM Plex Sans Arabic | [IBM/plex](https://github.com/IBM/plex) — OFL | Arabic |
| `ibm-plex-sans-arabic-600.woff2` | IBM Plex Sans Arabic | same | Arabic |
| `open-dyslexic-regular.woff2` | OpenDyslexic (accessibility preference) | [opendyslexic.org](https://opendyslexic.org) — OFL | Latin |

## Subsetting

Keep the files small — a large share of the audience is on a mid-range Android phone
over 4G, and fonts sit on the critical path.

```bash
pip install fonttools brotli

# Latin faces: French needs Latin-ext for œ, à, é, ç, î, û…
pyftsubset geist-variable.ttf \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+2000-206F,U+20AC,U+2122,U+202F" \
  --layout-features="kern,liga,tnum" --flavor=woff2 --output-file=geist-variable.woff2

# Arabic face: Arabic block + presentation forms, and keep the shaping features.
pyftsubset IBMPlexSansArabic-Regular.ttf \
  --unicodes="U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF,U+0020-007E" \
  --layout-features="init,medi,fina,isol,rlig,liga,calt,mark,mkmk" \
  --flavor=woff2 --output-file=ibm-plex-sans-arabic-400.woff2
```

Do not drop `init/medi/fina/isol` from the Arabic subset — without them the letters
stop joining and the text becomes unreadable.

## Loading rules

- Only the **display** face is preloaded (`src/app/[locale]/layout.tsx`).
- The **Arabic** face is loaded only on `/ar` routes, via its `unicode-range` and a
  conditional preload.
- Every face uses `font-display: swap`.
- Never letter-space Arabic; `--leading-ar: 1.8` handles its optical size instead.

Licences: all six faces above are OFL or free for commercial use. If the center
supplies a licensed brand face instead, record the licence in `docs/DECISIONS.md`.
