# Tests

Four layers, in order of how fast they tell you something is wrong.

| Layer | Command | What it protects |
|---|---|---|
| Static | `npm run typecheck`, `npm run lint`, `npm run rtl:check`, `npm run i18n:check` | Types, forbidden imports, physical CSS properties, translation parity |
| Unit | `npm test` | Money, phones, slugs, dates, rate limiting, the CTA state machine, i18n parity |
| End-to-end | `npm run test:e2e` | The guest journey, the public chrome, the catalogue URL contract |
| Accessibility | `npm run test:a11y` | axe over five public surfaces, in `fr` and `ar` |
| Performance | `npm run lighthouse` | The §21 budget on the homepage and a course page |

Nothing below sleeps. Every wait is a condition — a URL, an element, a state
change — because a suite with `waitForTimeout` in it is a suite that is slow on
a fast machine and flaky on a slow one.

---

## Running the end-to-end suite

### Against a server Playwright starts for you

```bash
npm run build
npm run test:e2e
```

`playwright.config.ts` starts `npm run start` on `PORT` (3000 by default) and
reuses one that is already listening. It deliberately does **not** start
`next dev`.

### Against a server that is already running

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3100 npm run test:e2e
```

Setting `PLAYWRIGHT_BASE_URL` disables the managed server entirely, so the same
command points the suite at a preview deployment, a colleague's machine or a
staging host. Nothing in the specs knows the origin: every navigation is
relative and every link is resolved against the page it was found on.

> **Run it against a production build, never `next dev`.**
> In dev mode Next compiles each route on first request and recompiles it
> whenever a file changes. Measured on this repository: the homepage takes about
> **38 seconds** to reach `load` in a cold browser under `next dev`, against
> **0.12 seconds** for the same page under `next start`. The suite's 30-second
> navigation timeout is not the problem; a compiler in the request path is. If a
> teammate is editing files while you run, dev-mode results are noise.
>
> When port 3000 is occupied by somebody's dev server, build into a scratch
> directory and serve it on another port, then point `PLAYWRIGHT_BASE_URL` at it.

### Useful invocations

```bash
npx playwright test --project=desktop-fr            # one form factor, one locale
npx playwright test --project=mobile-ar             # RTL, phone
npx playwright test -g "trial lesson"               # one journey
npx playwright test --ui                            # step through it
npx playwright show-report                          # the HTML report from the last local run
```

### The four projects

| Project | Viewport | Locale | Runs |
|---|---|---|---|
| `mobile-fr` | 390 × 844 | `fr-MA`, ltr | every spec |
| `desktop-fr` | 1440 × 900 | `fr-MA`, ltr | every spec |
| `mobile-ar` | 390 × 844 | `ar-MA`, rtl | specs tagged `@critical` |
| `desktop-ar` | 1440 × 900 | `ar-MA`, rtl | specs tagged `@critical` |

The Arabic projects are filtered to `@critical` by the config (§10.3 requires the
critical suite in both directions). **Everything in `tests/e2e` is currently
tagged `@critical`**, so all four projects run all of it — the tag is there so
that future, cheaper specs can opt out of the Arabic pass without anyone editing
the config.

A spec reads its locale, direction and form factor from `testInfo.project
.metadata` through the `cfi` fixture, so no spec branches on a project name.

---

## What the end-to-end specs cover

### `tests/e2e/flow-1-discovery.spec.ts` — the acceptance journey

E2E flow #1 of §22, which is also the guest half of §26's definition of done,
written as one continuous journey rather than a grid of page checks:

homepage → catalogue (via the hero's own link) → apply a category facet → clear
it → open course cards until one offers a trial lesson → read that lesson with
**no session** → reach registration with `?suivant=` still pointing at the
course.

Alongside it, four assertions that exist because the defect each one catches was
shipped in this repository and survived typecheck, lint *and* build:

1. **No raw message key is visible anywhere.** Matching
   `/\b(course|catalog|home|pages|auth|footer)\.[a-z]/` against the rendered
   text of the body. `t()` on a key that is a nested object — or on a message
   whose ICU argument was not supplied — renders the key path itself and every
   static check stays green. This shipped twice.
2. **The catalogue URL survives a filter click, a reload, back *and* forward**,
   with the same result set each time. That is the whole of §12.3's "shareable,
   back-button-safe".
3. **The guest CTA carries `?suivant=` back to that exact course**, on the
   sticky card and the mobile bottom bar, with exactly one of the two on screen.
4. **Zero horizontal overflow at 360 px** on the homepage, the catalogue and a
   course page, in both directions. Measured on
   `document.documentElement.scrollWidth` versus `clientWidth` — *never* on
   descendants, because the homepage's snap-scroll strips are supposed to
   overflow their own container; that is what makes them swipeable.

Plus: `html[lang]`/`html[dir]` per locale, exactly one `h1` per page, the trial
trigger labelled « Leçon d'essai » and never « Aperçu », the trial dialog
containing real prose rather than the locked-lesson notice, and the dialog's
previous/next walk between two trial lessons without closing.

Slugs are read off the rendered catalogue, never hardcoded, so renaming a seeded
course cannot fail the gate while a broken card still does. Message strings are
read out of `src/i18n/messages/<locale>.json` by the `cfi.t()` helper, which
**throws if the key is missing or resolves to a nested object** — a spec cannot
silently assert against a key that does not exist.

### `tests/e2e/chrome-links.spec.ts` — no dead links in the chrome

Crawls every same-origin `<a>` in the `header` and `footer` on the homepage and
on a course page, requests each one, and reports every URL answering 400 or
worse — all of them at once, not just the first. `mailto:`, `tel:`, `wa.me` and
the skip link's fragment are excluded.

This exists because three dead links (`/blog`, `/faq`, `/certificat`) shipped in
the chrome as string constants in a route array. TypeScript, ESLint and
`next build` were all perfectly happy; a human found them by clicking.

### `tests/e2e/a11y.spec.ts` — axe

`@axe-core/playwright` over the homepage, the catalogue, a course page, contact
and registration, in both locales and both form factors, asserting **zero**
violations against `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`.

`best-practice` rules are deliberately excluded: they are advisory, they change
between axe releases, and a gate that fails on advice is a gate people learn to
skip.

---

## Performance

```bash
npm run build && npm run lighthouse
```

`lighthouserc.json` encodes the §21 budget on the homepage and a course page, at
Lighthouse's **mobile** form factor and throttling:

| Assertion | Budget | Source |
|---|---|---|
| `categories:performance` | ≥ 0.95 | §21, §26 |
| `categories:accessibility` | ≥ 0.95 | §26 |
| `categories:best-practices` | ≥ 0.95 | §26 |
| `categories:seo` | = 1.00 | §26 |
| `largest-contentful-paint` | < 2000 ms | §21 |
| `cumulative-layout-shift` | < 0.05 | §21 |
| `total-blocking-time` | < 200 ms | lab proxy for INP |
| `max-potential-fid` | < 200 ms | lab proxy for INP |

**On INP.** §21 sets INP < 200 ms. Lighthouse only measures
`interaction-to-next-paint` in *timespan* mode, where a script drives real
interactions; in the navigation mode CI runs, the audit is not applicable. Total
Blocking Time and Max Potential FID are the lab proxies for the same property —
main-thread work that would delay a response — so both are asserted at the same
200 ms. Real INP still has to come from field data once there is traffic.

**Three audits are skipped on localhost**, and only because they cannot pass off
the production domain:

- `uses-http2` — the local server speaks HTTP/1.1.
- `canonical` — pages emit their production canonical URL, which Lighthouse
  correctly reports as a different origin.
- `is-crawlable` — `robots.txt` serves `Disallow: /` when the app is not running
  on its canonical host, which is the right staging behaviour and makes the SEO
  category unmeasurable locally.

Because of the last two, **an SEO score of 1.00 in CI is not evidence of an SEO
score of 1.00 in production.** Re-run Lighthouse against the deployed domain
before signing off §26's SEO line.

To point Lighthouse at a server that is already running:

```bash
npx lhci autorun --collect.startServerCommand= \
  --collect.url=http://localhost:3100/fr \
  --collect.url=http://localhost:3100/fr/formations/<slug>
```

`lhci` writes its reports to `.lighthouseci/`, which is generated output and
should not be committed.

---

## Deliberately not covered yet

Naming the gaps is part of the gate. Everything here is a decision, not an
oversight.

**Later milestones.** §22 lists seven end-to-end flows. Only flow #1 exists,
because only flow #1 has an application behind it. Flows 2–7 — registration to
approval, the enrolment request and receipt upload, the player and quizzes and
certificates, admin approval from a phone, the AI assistant, the RTL sweep of
the player and admin — are written when the screens they exercise are.

**Integration tests against a test MySQL schema.** §22 asks for them
(registration → verification → approval; double-submit idempotency;
entitlement-filtered AI retrieval). They need a disposable schema and a CI
service container, and every flow they would cover belongs to M3 and later. The
unit suite currently carries the pure logic — the CTA state machine, money,
phones, slugs, i18n parity.

**Visual regression.** §22 asks for screenshots of ten screens × two themes ×
two locales, committed as baselines. `playwright.config.ts` already declares
`snapshotDir` and a 1 % pixel tolerance, but no baselines exist: the public
pages are still moving, and a baseline committed now would be re-approved on
every commit until people stop reading the diffs.

**The dark theme.** axe only sees the pixels painted at the moment of the scan,
which here is the light theme. §21 requires ≥ 4.5:1 in *both* themes and
specifically calls out the brass and teal accents. Until the suite scans both,
dark-theme contrast is a manual check.

**Keyboard operability and focus order.** The journey drives real clicks and the
trial dialog is walked with its own buttons, but nothing yet tabs through a page
asserting the focus ring and the reading order — which is exactly where a
mirrored RTL layout goes wrong. axe reporting zero is the floor, not the
ceiling.

**The WhatsApp FAB's `wa.me` href and the contact form submission.** Both are
part of §22's flow #1. The FAB's href is data-driven from `SiteSetting` and the
form writes a `ContactMessage` row and sends mail; asserting either properly
means owning the seeded settings and intercepting the mail, which arrives with
the flow #2 harness.

**Screen readers.** No automated tool substitutes for NVDA or VoiceOver on the
enrolment flow. That is a manual pass before launch.
