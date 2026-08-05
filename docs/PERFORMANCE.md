# Performance

What has been measured, what was fixed, and what is still owed against §21's target of a
Lighthouse performance score ≥ 95.

Everything below was measured against a **production build** (`next build` + `next start`),
with Lighthouse's mobile defaults — 4× CPU throttling, simulated slow 4G, 360 px viewport.

> **Measure on a quiet machine.** An early reading of this app showed TBT 1 360–2 290 ms and was
> discarded: background agents were competing for CPU. The same build on an idle box measured
> 410–650 ms. Before trusting any number here, check the process list. The composite score still
> varies by roughly ±10 points run to run on a developer laptop; treat individual metrics (FCP,
> LCP, main-thread time) as more reliable than the score.

---

## Baseline, 2026-08-04

| Page | perf | a11y | FCP | LCP | TBT | CLS |
| --- | --- | --- | --- | --- | --- | --- |
| `/fr` | 63 | 100 | 2.3 s | 4.8 s | 470 ms | 0 |
| `/fr/formations` | 68 | 99 | 2.3 s | 5.1 s | 410 ms | 0.001 |
| `/fr/formations/[slug]` | 67 | 100 | 2.1 s | 4.8 s | 530 ms | 0 |

Accessibility and CLS are where they should be, and **must not be traded** for a performance
point. Every change below was checked against both.

---

## Fixed

### The brand fonts were never actually subset

`public/fonts/README.md` said the Latin faces were "self-hosted and subset". They were
self-hosted. They were also the three largest assets on the homepage.

Geist Mono earned its 71 KB rendering digits: `[data-numeric]` maps to `--font-mono` and appears
127 times on the homepage alone — prices, seat counts, ratings, references — so the face cannot be
dropped. It can stop carrying 1 159 glyphs to draw « 3 900 DH ».

```
geist-mono   71 368 → 32 432   −55 %
geist        69 652 → 36 464   −48 %
chillax      55 640 → 46 744   −16 %
             ─────────────────────────
             196 660 → 115 640   saved 81 020 B
```

Reproduce with `npm run fonts:subset`. Re-run it after replacing any brand binary.

The subset is verified glyph-by-glyph **against the originals**, not against a wish list — the
first pass silently dropped À, Ç, É, Î, Ô, Ù, · and œ from the mono face to save under 2 KB, and a
second dropped the curly double quotes. The `wght` axis is asserted too: a subset that flattened
the variable weights to Regular would be worse than the bytes it saved.

### The whole message catalogue was shipped to every browser

`NextIntlClientProvider` serialises whatever `messages` it receives into the RSC flight payload of
every page beneath it. The root layout handed it all of `fr.json`, so a visitor to the homepage
downloaded and parsed the administration vocabulary and the e-mail templates.

The tell was `Annulé le` — a certificate-revocation string — in the homepage HTML.

| namespace | share of `fr.json` | reachable from a public page? |
| --- | --- | --- |
| `admin` | 32 % | no |
| `emails` | 7 % | no (but yes from the admin drawer) |
| `seo` | 3 % | no — read only in `generateMetadata` |

The root provider now withholds all three; the admin layout re-provides its own superset.
`emails` travels with `admin` rather than with `seo`, because the §17.3 verification drawer labels
a `REMINDER_SENT` timeline node with `emails.receiptReminder.subject` and that drawer is a Client
Component.

```
/fr document   457 271 → 402 551 B   (113 827 → 97 208 transferred)
```

**This split is only safe because it is guarded.** An omitted namespace does not fail to compile
and does not fail the build — it throws `MISSING_MESSAGE` in the browser, on the one screen that
needed it. `npm run messages:check` walks the import graph from every `'use client'` entry point
and checks each against the provider that wraps it.

### The public pages were not statically rendered

The project described itself as shipping 142 static pages. It shipped **8**:

```
node -e "console.log(Object.keys(require('./.next/prerender-manifest.json').routes).length)"
```

`(public)/layout.tsx` called `getCurrentUser()` to decide one header link, and the homepage called
it again for one button label. Reading cookies on the server opts the whole route out of static
generation, so every marketing page was rendered per request and served `Cache-Control: private,
no-cache, no-store` — which is also, exactly, **both** of the back/forward-cache blockers
Lighthouse reported.

The header now ships all three account variants and CSS reveals one from a `data-chrome` attribute
written before the first paint, fed by a display-only cookie the middleware publishes. Middleware
already decrypts the token for the route policy, so the answer costs nothing there.

Doing it with state and an effect would have been a flash of the wrong call to action plus a
layout shift when it corrected itself. `display: contents` on the variants keeps the responsive
`hidden lg:flex` rule applying to the same box either way, so nothing moves.

```
Cache-Control   private, no-cache, no-store  →  s-maxage=31536000
prerendered     8 routes                     →  56
bf-cache        2 blockers                   →  pass
```

**The hint cannot be forged into a permission.** The middleware re-derives it from the real
session on every matched request, so a hand-set value is corrected before the document is parsed —
the first draft of `tests/e2e/header-account.spec.ts` set the cookie by hand, and its failure was
the feature. It is also written **only when it changes**: a response carrying `Set-Cookie` is a
hazard in front of a shared cache, so a returning visitor's request produces none.

### Result

| Page | perf | FCP | LCP | main-thread |
| --- | --- | --- | --- | --- |
| `/fr` | 63 → **66** (median of 3) | 2.3 → **1.7 s** | 4.8 → **4.3 s** | 5.7 → **4.3 s** |
| `/fr/tarifs` | → **78** | → **1.6 s** | → **4.1 s** | → **2.6 s** |
| `/fr/formations/[slug]` | 67 → **71** | 2.1 → **1.7 s** | 4.8 → **4.1 s** | — |

`/fr` still varies between 56 and 69 across runs on this machine. Believe the median, and believe
FCP and main-thread time over the composite.

---

## Still owed

### 1. Main-thread work, ~4.3 s under 4× throttle

The dominant remaining term. Contributors, measured:

- **Script evaluation ≈ 1.8 s.** Lighthouse attributes ~2.7 s of bootup to the document itself,
  which is the inline RSC payload being parsed. The catalogue split cut into this; the rest is the
  page's own server-rendered tree.
- **Style & layout ≈ 1.8 s**, driven by DOM size.

### 2. DOM size — 1 484 elements on `/fr` (Lighthouse flags > 1 400)

Attributed by section:

| section | elements |
| --- | --- |
| `home-featured` (course cards) | 323 |
| `home-proofs` (testimonials) | 209 |
| hero + lattice | 190 |
| `home-paths` | 141 |
| everything else | ~620 |

Also 91 `<svg>` and 143 `<path>` — mostly Lucide icons, one inline SVG each. `Rating` already
shows the pattern that fixes this class of cost (`<defs>` + `<use>`, see
`src/components/ui/rating.tsx`, which took the homepage from 139 SVGs to 91). A shared icon sprite
would generalise it, at the price of a design-system-wide change.

Trimming *sections* is a product decision and out of scope. Trimming *elements per unit of
content* is not.

### 3. The hero entrance animation costs ~0.4 s of LCP

`src/components/public/home/hero.tsx` reveals the hero with
`animation: cfi-hero-mask 620ms … both` and a per-step delay, starting from `opacity: 0` and
`clip-path: inset(0 0 100% 0)`. The `h1` is therefore invisible for ~710 ms after the animation
starts, and animating an LCP element in from `opacity: 0` is a known LCP anti-pattern.

Measured by disabling it and rebuilding: LCP 4.9 s → 4.5 s, perf 59 → 64.

Left in place deliberately: 0.4 s sits inside this machine's run-to-run noise, and removing a
deliberate design feature needs a firmer number than that. If §21's target is pursued, revisit it
with a stable measurement environment — the cheapest version is to keep the reveal for decorative
elements and let the `h1` and lead paragraph paint immediately.

---

## Not a defect: the SEO score on localhost

Lighthouse reports SEO 58–61 locally, from two failures — "Page is blocked from indexing" and
"Document does not have a valid `rel=canonical`". Both are artefacts of the host.

`src/app/robots.ts` deliberately returns `Disallow: /` for any host that does not look like
production, and the canonical is built from a build-time `NEXT_PUBLIC_APP_URL`. Pinned per host:

| host | indexable |
| --- | --- |
| `cfi.ma`, `www.cfi.ma` | yes |
| `localhost`, IP literals | no |
| `staging.cfi.ma`, `preview.cfi.ma` | no |

There is an explicit `SEO_ALLOW_INDEXING` override for the cases the heuristic gets wrong. Nothing
here needs fixing; do not "improve" it.
