# Decision log

Append-only. Every non-obvious technical decision, dated, with the reasoning that produced it and
the alternatives that were considered and rejected. Never edit a past entry: if a decision is
reversed, add a new entry that supersedes it and say so explicitly.

Format for every entry: **Context** (what forced a choice) · **Decision** (what we do) ·
**Rationale** (why) · **Rejected alternatives** (what we did not do, and why not).

---

## 2026-07-25 — Four locales instead of the spec's two, with French kept as the source language

**Context.** The specification defines two locales, `fr` and `ar`, and a `Locale` enum with two
values. The owner requires four: French, Arabic, English and Spanish. Tanger's audience is not only
Moroccan — the city sits on a Spanish-facing strait, and the centre wants to be legible to
English-speaking prospects.

**Decision.** `locales = ['fr', 'ar', 'en', 'es'] as const`, `defaultLocale = 'fr'`,
`rtlLocales = ['ar'] as const`, exported from `src/i18n/routing.ts` as the single source of truth.
The Prisma enum becomes `enum Locale { fr ar en es }`. **French remains the source language:** all
copy is authored in French and the other three are translations of it. Only `ar` is RTL. The
fallback chain is `requested → fr → first available`, surfaced to the user with a visible
« Contenu disponible en français » pill rather than a silent language mix.

**Rationale.** French stays the source for two reasons that are not stylistic. First, the centre's
staff write, review and approve copy in French; making any other language the source would put the
people who own the content one translation removed from it. Second, the canonical strings in spec
§28.3 — particularly the 48-hour standard-transfer notice — are commercially and legally
load-bearing in their exact French wording, and the spec requires them verbatim. Widening the enum
rather than adding a parallel mechanism means every `*Translation` table, the completeness UI, the
fallback logic and the hreflang emission scale to four locales with no new code paths.

Adding `en` and `es` costs translation surface but almost no layout work, because every layout is
written with logical properties from the first line regardless of how many locales exist. The
expensive locale is `ar`, and it was already in scope.

**Rejected alternatives.**
- *Keep two locales and add the others later.* Rejected: widening `enum Locale` later is a
  migration that touches every translation table, and the locale count would have leaked into
  components as `'fr' | 'ar'` unions in the meantime.
- *Make English the source language.* Rejected for the two reasons above; it would also have meant
  translating the canonical French strings out and back, which is exactly how legally load-bearing
  wording drifts.
- *A free-form `String` locale column instead of an enum.* Rejected: the enum is what makes the
  `@@unique([parentId, locale])` constraints meaningful and gives the compiler a closed set to
  exhaustively switch over.
- *`isRtl` as `locale === 'ar'` inline at each site.* Rejected: a function over `rtlLocales` means a
  future RTL locale is one array entry, not a search across the codebase.

---

## 2026-07-25 — Tailwind v4 CSS-first tokens with `@theme inline`

**Context.** The design system has two full themes (dark default, light first-class), a
high-contrast accessibility mode, a print theme, and a user-controlled font scale. The theme must be
switchable at runtime, before paint, with no flash of the wrong theme, and without shipping two
stylesheets.

**Decision.** All tokens live in `src/styles/globals.css`. Raw values are declared once as `--raw-*`
custom properties under `:root`, re-declared under `:root[data-theme='light']`, under a
`prefers-color-scheme` media query for first visits, and under `[data-contrast='high']`. A single
`@theme inline { … }` block maps those custom properties onto Tailwind's token names
(`--color-abyss: var(--raw-bg-abyss)` and so on). `tailwind.config.ts` is not used for tokens at all.
No component ever writes a hex, `rgb()` or `hsl()` value — an ESLint rule fails the build on one.

**Rationale.** The `inline` keyword is the whole point: it keeps the `var()` reference *inside* the
generated utility class, so `bg-surface` compiles to `background-color: var(--raw-bg-surface)`
rather than to a resolved hex. Flipping `data-theme` on `<html>` therefore retints the entire
application instantly, with no class regeneration, no duplicate `dark:` variant on every element,
and no second stylesheet. The same mechanism gives high-contrast mode and the print theme for free —
each is just another place the `--raw-*` values are re-declared. An inline bootstrap script sets
`data-theme` before first paint, which is what removes the flash.

Declaring raw values separately from the Tailwind mapping also means the alpha washes can be
`color-mix(in oklab, var(--raw-accent-strait) 12%, transparent)` and follow the accent through a
theme switch automatically, instead of being four hardcoded values per theme.

**Rejected alternatives.**
- *Tailwind's `dark:` variant on every element.* Rejected: it doubles the class list on most
  components, cannot express a third mode (high contrast) or a fourth (print) without further
  variant explosion, and makes the light theme visibly an afterthought — the spec requires the
  opposite.
- *A JS theme provider that swaps a CSS-in-JS object.* Rejected: `styled-components` is explicitly
  forbidden, and any runtime style injection costs hydration time on the mid-range Android phones
  that are the primary target.
- *`@theme` without `inline`.* Rejected: Tailwind resolves the value at build time, producing a
  literal colour in the utility, which defeats runtime theme switching entirely.
- *Two separate compiled stylesheets, one per theme.* Rejected: doubles CSS payload and reintroduces
  the flash on switch.

---

## 2026-07-25 — `eslint .` with a flat config instead of `next lint`

**Context.** Spec §24.2 lists `"lint": "next lint"`. `next lint` is deprecated as of Next 15.5 and is
scheduled for removal in Next 16; it also wraps ESLint in a way that makes a custom flat config and
custom rules awkward to reach.

**Decision.** `"lint": "eslint ."`, driven by `eslint.config.mjs` in the ESLint 9 flat-config format,
extending `eslint-config-next` through `@eslint/eslintrc`'s `FlatCompat`. The config carries this
project's own hard rules: the banned physical-direction utilities (`ml-`, `mr-`, `pl-`, `pr-`,
`left-`, `right-`, `text-left`, `text-right`), the ban on raw colour literals inside components, and
the ban on `any`, `@ts-ignore` and non-null assertions.

**Rationale.** Deprecation aside, this project's lint rules *are* its correctness rules. RTL
correctness and token discipline are enforced in CI or they do not happen, and both need custom
rules that the flat config expresses directly. Running ESLint directly also means the same command
works locally, in CI and in any editor integration, with no Next-specific wrapper in between.

**Rejected alternatives.**
- *`next lint`.* Rejected: deprecated, and it obscures the config surface we need.
- *Waiting for Next 16 to migrate.* Rejected: the migration is cheap now and expensive once dozens of
  files depend on rules that were never enforced.
- *Enforcing RTL and colour discipline through code review only.* Rejected: a rule a human has to
  remember on every diff is a rule that will be broken in the third week.

---

## 2026-07-25 — Bootstrap with `npm install --ignore-scripts` plus an explicit `prisma generate`

**Context.** `package.json` declares `"postinstall": "prisma generate"`, as it must, so that the
Prisma client is always in sync after an install. During the initial scaffold, `prisma/schema.prisma`
does not exist yet at the moment dependencies are installed, so the `postinstall` hook fails and
takes the whole install with it. Lifecycle scripts from transitive dependencies also run arbitrary
code at install time.

**Decision.** The documented bootstrap sequence is
`npm install --ignore-scripts && npx prisma generate`. The `postinstall` hook stays in
`package.json` and runs normally for every subsequent `npm ci`, in CI and on the Hostinger host,
where the schema is present in the checkout.

**Rationale.** It separates "fetch dependencies" from "run code", which is both the fix for the
chicken-and-egg problem and a modest supply-chain hygiene improvement during the one install where
we are least able to reason about what is in the tree. The explicit `prisma generate` afterwards
makes the client generation a visible step rather than a hidden side effect, which is useful the
first time someone sets the project up and the failure mode is "why is `@prisma/client` empty".

**Rejected alternatives.**
- *Drop `postinstall` entirely and always generate manually.* Rejected: it would break the Hostinger
  build, where `npm ci && npm run build` is the whole contract and no one is available to run an
  extra command.
- *Commit a placeholder `schema.prisma` so `postinstall` succeeds.* Rejected: a placeholder schema is
  exactly the kind of near-real artefact that survives into the repository and confuses the next
  reader.
- *`npm install --ignore-scripts` permanently, with generation only in `build`.* Rejected:
  developers would routinely run a stale client after pulling a schema change.

---

## 2026-07-25 — `prisma migrate deploy` runs as a deploy step, not inside `build`

**Context.** Spec §24.2 proposes `"build": "prisma generate && prisma migrate deploy && next build"`,
so that every deployment is self-migrating, and §24.2 explicitly acknowledges that if Hostinger's
build step cannot reach the database, the migration must move elsewhere and the choice must be
documented.

**Decision.** `"build": "prisma generate && next build"`. Migrations run separately via
`npm run db:deploy` (`prisma migrate deploy`). Both supported deployment shapes are documented in
`docs/DEPLOYMENT.md`:

- **Option A (default).** Run `npm run db:deploy` as a post-deploy command from the Hostinger Web App
  panel, or over SSH, immediately after the build and before the process is restarted.
- **Option B (fallback, when neither is available).** A one-off, secret-protected
  `POST /api/cron/migrate?key=$CRON_SECRET` route that runs `migrate deploy` in-process, is idempotent,
  and refuses to run when there are no pending migrations. Hit it once per deployment from the
  Hostinger cron entry, then check the response summary.

**Rationale.** Hostinger's build container is not guaranteed to be on the same network as the MySQL
instance, and a build step that reaches for a database it cannot see fails the *entire deployment* —
including the parts that would have worked. Keeping migration out of `build` means a network problem
degrades to "the new code is built but not yet migrated", which is recoverable in one command, rather
than "nothing deployed". It also makes the migration a deliberate, observable act with its own
output, which matters when the migration is the risky part of a release.

The cost is that a deployment is no longer atomically self-migrating, so the standing rule is:
migrations must be backward-compatible with the previous release (add columns before writing to
them, never drop in the same release that stops using them).

**Rejected alternatives.**
- *Keep `migrate deploy` in `build` as the spec proposes.* Rejected for the failure mode above. This
  entry is the documentation §24.2 asks for.
- *`prisma db push` on boot.* Rejected: it does not keep a migration history, and the spec forbids
  `db push` on a schema that already has migrations.
- *Migrating from a developer's laptop against production.* Rejected as the routine path — it is
  fine as a break-glass procedure and is documented as such, but it makes deployment depend on one
  person's machine.

---

## 2026-07-25 — `noUncheckedIndexedAccess` on top of `strict`

**Context.** `strict: true` is required by the spec. It does not cover indexed access: with `strict`
alone, `arr[0]` on an empty array is typed as the element type and crashes at runtime. This codebase
indexes into arrays and records constantly — locale message lookups, quiz answer options, watched
ranges, curriculum navigation, chart series, lattice tiles.

**Decision.** `noUncheckedIndexedAccess: true`, alongside `noImplicitOverride` and
`noFallthroughCasesInSwitch`. Indexed access yields `T | undefined` and every site handles it
explicitly. No `any`, no `@ts-ignore`, and no non-null `!` assertion on a value that can genuinely be
undefined.

**Rationale.** The two places this project is most likely to crash in production are exactly the
places this flag guards: locale/message lookups where a key is missing in one of four files, and
progress arithmetic over `watchedRanges` that may legitimately be empty. Both are silent
`undefined`s under plain `strict`. The flag costs a few lines of explicit narrowing per file and
removes a class of runtime error entirely.

The exhaustive `switch` statements the spec requires for the state machines pair with
`noFallthroughCasesInSwitch`: adding a new enum member becomes a compile error at every switch that
does not handle it, which is precisely the safety net a load-bearing state machine needs.

**Rejected alternatives.**
- *`strict` only.* Rejected: it leaves the highest-risk access pattern in the codebase unchecked.
- *Enabling it later, once the code exists.* Rejected: retrofitting produces hundreds of errors at
  once and creates pressure to silence them with `!`, which is worse than never having enabled it.
- *Allowing `!` as an escape hatch.* Rejected: `!` is indistinguishable in review from a genuine
  invariant, so it becomes the default fix.

---

## 2026-07-25 — Fonts self-hosted, with graceful fallback stacks

**Context.** The type system pairs Chillax (display), Geist Sans (body), Geist Mono (data), IBM Plex
Sans Arabic (Arabic) and OpenDyslexic (accessibility). Some are licensed and their binaries cannot be
committed. A build that fails because a font file is missing is a build that blocks every contributor
who does not have the licence.

**Decision.** Every face is self-hosted from `public/fonts/`, subset (Latin + Latin-ext for the LTR
locales, Arabic for `ar`), `font-display: swap`, with only the display face preloaded and the Arabic
face `unicode-range`-scoped so it downloads only where it is needed. Every `@font-face` sits on top
of a real fallback stack in the `@theme` mapping:

- display → `'Chillax', 'Clash Display', 'Geist Sans', 'Inter Tight', ui-sans-serif, system-ui`
- sans → `'Geist Sans', 'Inter Tight', ui-sans-serif, system-ui, -apple-system, 'Segoe UI'`
- mono → `'Geist Mono', ui-monospace, 'SFMono-Regular', 'Cascadia Code', monospace`
- arabic → `'IBM Plex Sans Arabic', 'Almarai', 'Geist Sans', ui-sans-serif`

A missing `.woff2` produces a failed request and a system-face render. It never fails the build.

**Rationale.** Self-hosting is required regardless: no third party in the critical path, and Google
Fonts would add a DNS lookup and a connection on exactly the slow connections we are optimising for.
The fallback stacks make the licensed binaries an *enhancement* rather than a dependency, which means
a new contributor, a CI runner and a preview deployment all work without the licence, and the owner
can supply the files at any point without a code change. `swap` guarantees text is readable
immediately even when the binary is present but slow.

**Rejected alternatives.**
- *`next/font/google`.* Rejected: Chillax is not on Google Fonts, and the mechanism would introduce a
  build-time network dependency for the faces that are.
- *A single font family for everything.* Rejected: the display/body/mono separation is load-bearing —
  mono with tabular figures is what makes prices, RIBs, references and timers legible and non-jumpy.
- *Committing the binaries anyway.* Rejected: licence terms, and the spec forbids committing large
  media.
- *`font-display: block`.* Rejected: it hides text during the swap period, which on a 4G connection
  means a blank hero.

---

## 2026-07-25 — Embeddings stored as Float32 `Bytes` with in-app cosine search, no vector database

**Context.** The assistant needs semantic retrieval over course content in four locales. The database
is MySQL 8 with no `pgvector` equivalent, and the deployment constraint forbids a second process, a
message queue, Redis, and by extension any managed vector store that would become an availability
dependency.

**Decision.** Each chunk's embedding is stored as a Float32 buffer in a Prisma `Bytes` column
(1024 dimensions from `voyage-3-lite`, or the local MiniLM fallback). Retrieval is hybrid: a MySQL
`FULLTEXT` `MATCH` candidate set (with the `ngram` parser for Arabic) fused with a cosine-similarity
candidate set computed in application code, combined by Reciprocal Rank Fusion at `k = 60`, then
boosted (same lesson ×1.6, same course ×1.3, curated answer ×1.5, same locale ×1.2) and floored at a
tuned similarity threshold. **Entitlement filtering is a SQL pre-filter** — `courseId IN (accessible)`
`OR isPublic = true` — applied when candidate rows are selected, never after scoring. Per-course
Float32 matrices are loaded lazily and held in an in-process LRU capped around 50 MB, invalidated on
re-index. Query embeddings for the ~500 most recent distinct queries are cached in a second LRU.

**Rationale.** At this corpus size — a few thousand chunks for a single institution's catalogue — a
cosine pass over a contiguous Float32 matrix takes a few milliseconds, which is far below the latency
of the model call it feeds. A vector database would add an external service, a second failure mode, a
second set of credentials, a second consistency problem on re-index, and a monthly cost, in exchange
for a speedup that is invisible next to streaming generation. Keeping the vectors in MySQL also means
they are covered by the same backup and restore procedure as everything else.

The entitlement pre-filter is the part that must not be compromised for performance: a paid
transcript has to be *physically impossible* to retrieve for a non-enrolled user, which is only true
if the filter is in the query. There is a mandatory integration test for exactly this.

**Rejected alternatives.**
- *A hosted vector database (Pinecone, Qdrant, Weaviate).* Rejected: an external availability and
  cost dependency for a corpus that fits in memory, plus a second place entitlement rules would have
  to be enforced correctly.
- *MySQL 9 `VECTOR` type.* Rejected: Hostinger's standard offering is MySQL 8.
- *Storing embeddings as JSON arrays.* Rejected: roughly 8–10× the storage and a parse cost on every
  read; `Bytes` maps directly onto a `Float32Array` view with no deserialisation.
- *Full-text search alone.* Rejected: it fails on paraphrase, which is most of how students actually
  ask questions, and it degrades badly across four locales.
- *Vector search alone.* Rejected: it misses exact-term matches — a reference code, a product name, a
  specific French term — which is what RRF fusion exists to fix.

---

## 2026-07-25 — argon2id over bcrypt, and `@node-rs/argon2` over `node-argon2`

**Context.** Passwords need a modern memory-hard hash. The spec explicitly forbids `bcrypt`. The
deployment target is a Hostinger Node 22 process built with `npm ci`, where a native compilation step
during install is a realistic way to break every deployment.

**Decision.** argon2id with `memoryCost ≥ 19 MiB`, `timeCost 2`, `parallelism 1`, implemented with
`@node-rs/argon2`.

**Rationale.** argon2id is memory-hard, which is what defeats GPU and ASIC cracking; bcrypt is not,
and its 72-byte input truncation is a sharp edge nobody should have to remember. The chosen
parameters are the OWASP baseline and are affordable inside a single shared Node process — the
memory cost is per hash operation, and login is not a hot path.

`@node-rs/argon2` is a Rust implementation distributed as prebuilt platform binaries. `node-argon2`
compiles C at install time, which requires a toolchain on the build host. On Hostinger, "the build
needs a C compiler" is a failure discovered at deploy time, on the day of the deploy. Prebuilt
binaries remove that class of failure entirely, which is the same reasoning that rules out `bcrypt`.

**Rejected alternatives.**
- *`bcrypt`.* Rejected: explicitly forbidden, native build pain, not memory-hard.
- *`bcryptjs`.* Rejected: pure JS and therefore slow enough that the work factor has to be lowered to
  stay usable, which defeats the purpose.
- *`node-argon2`.* Rejected: install-time native compilation on a host we do not control.
- *scrypt via `node:crypto`.* Rejected: no native binary needed, which is attractive, but argon2id is
  the current recommendation and the tuning surface is better understood.
- *PBKDF2.* Rejected: not memory-hard.

---

## 2026-07-25 — `nodemailer` pinned to `^8` for the `next-auth` v5 peer range

**Context.** Auth.js v5 (`next-auth@5.0.0-beta`) declares an optional peer dependency on
`nodemailer`. Its declared range does not admit nodemailer 7. Installing a version outside the range
produces a peer-dependency error under npm's default resolution — which is a failing `npm ci`, and
therefore a failing Hostinger build, not merely a warning.

**Decision.** `"nodemailer": "^8.0.5"` and `"@types/nodemailer": "^8.0.1"` in `package.json`.

**Rationale.** The alternative fixes all involve telling npm to ignore the constraint
(`--legacy-peer-deps`, an `overrides` block), and the Hostinger install command is fixed at
`npm ci` with no room for extra flags. Pinning to a version inside the declared range keeps the
install clean everywhere — locally, in CI, and on the host — with no special-case configuration to
remember. Nodemailer 8 is a drop-in for the transport API we use (Hostinger SMTP over implicit TLS on
port 465), and `@react-email/components` renders to HTML independently of the transport, so nothing
in the mail layer is coupled to the version.

This entry exists to be found when someone later tries to bump nodemailer and the install breaks.
When Auth.js v5 reaches stable and widens the range, this constraint can be revisited — with a new
entry, not an edit to this one.

**Rejected alternatives.**
- *`--legacy-peer-deps`.* Rejected: not expressible in the fixed Hostinger install command, and it
  silences every future peer conflict, not just this one.
- *An `overrides` block forcing a different version.* Rejected: it hides a real incompatibility
  signal, and `overrides` are easy to forget when the underlying constraint changes.
- *A different mail library.* Rejected: Nodemailer is specified, it is the right tool for Hostinger
  SMTP, and the problem is a version range rather than the library.
- *Dropping the Auth.js email provider.* Rejected: verification and password-reset mail is core to
  the account lifecycle. (Note that we send those through our own mail service rather than the
  Auth.js provider, but the peer constraint applies to the installed tree regardless.)

---

## 2026-07-25 — Two light-theme accents darkened from the values stated in the spec

**Context.** §11.2 fixes the palette by hex value, and §21 separately requires ≥4.5:1 contrast for
text and ≥3:1 for UI boundaries **in both themes**, calling out "the brass and teal accents
specifically". Measured in the browser against the real computed theme values, the light theme
missed on two of them:

| Token | Spec value | White on fill | Token as text on page bg |
|---|---|---|---|
| `--accent-brass` | `#A9702A` | **4.17:1** ✗ | 3.79:1 ✗ |
| `--accent-strait` | `#0A7F72` | 4.89:1 ✓ | **4.45:1** ✗ |

Both tokens are used as *text*, not only as fills — `PriceTag` renders the price in brass, and
section eyebrows render in strait — so the 4.5:1 text threshold is the binding one for each.

**Decision.** In the light theme only, `--accent-brass: #98621e` and `--accent-strait: #097468`.
Dark theme is untouched; it already passed with a wide margin (10.48:1 and 12.13:1). The two values
are duplicated in the `prefers-color-scheme: light` fallback block and must be changed together.

Measured after the change — all 22 token pairings pass in both themes:

| Token | White on fill | As text on page bg |
|---|---|---|
| `--accent-brass` | 5.12:1 ✓ | 4.66:1 ✓ |
| `--accent-strait` | 5.66:1 ✓ | 5.15:1 ✓ |

**Rationale.** Where the spec contradicts itself, the accessibility requirement wins over the
decorative one: §21 states a measurable acceptance criterion that CI enforces via axe, while the
palette hex is a starting point for an intent ("brass = money and achievement", "strait = primary
action"). The correction is roughly a 9 % darkening — both accents remain unmistakably brass and
teal, and the dark theme, which is the default and carries the brand impression, is unchanged.

Shipping the stated values would have meant knowingly failing the §26 acceptance checklist
("axe reports zero violations on 12 key screens in both locales") on every screen showing a price.

**Rejected alternatives.**
- *Keep the hex values and accept the failure.* Rejected: §26 is a hard gate, and price text is on
  nearly every commercial screen.
- *Keep the fills and use dark ink on brass instead of white.* Rejected: light-theme brass is
  already mid-dark, so dark ink scores worse than white, and it would invert the ink direction
  between themes for one token only.
- *Use the failing values for fills and a separate darker token for text.* Rejected: two brasses is
  exactly the kind of token sprawl the design system exists to prevent, and it pushes the choice of
  which-brass onto every call site.
- *Enlarge all brass/strait text to 18.66px+ to qualify for the 3:1 large-text threshold.* Rejected:
  prices in dense tables and eyebrow labels cannot be large text.

---

## 2026-07-26 — A small open model behind an OpenAI-compatible endpoint, local embeddings, and a policy that refuses rather than guesses

**Context.** The specification builds the assistant on Anthropic for generation
(`ANTHROPIC_API_KEY`, a Haiku-class chat model, a Sonnet-class reasoning model) and on
Voyage for embeddings (`voyage-3-lite`, 1024 dims), with a local MiniLM only as a
fallback. The owner's requirement is different and explicit: *"a little open source model
that won't require much resources, contextual based only on the app and its data, fast
replies, 100 % precision and accuracy."*

Two things had to be reconciled. The first is commercial and operational: two API keys, a
per-call cost on every question and every re-index, a monthly bill that scales with
success, and two external services whose outage becomes CFI's outage — for a single
training centre in Tanger whose corpus is a few thousand chunks. The second is the harder
one: **100 % accuracy is not a property any generative model has**, and a plan that
depends on one behaving is not a plan. The requirement *behind* it — never be confidently
wrong about a price, a RIB or a transfer delay — is entirely achievable, but only if
correctness is structural rather than prompted.

**Decision.** Three changes, taken together.

1. **Embeddings run locally, in-process.** `Xenova/multilingual-e5-small` as
   int8-quantised ONNX via `@huggingface/transformers` (transformers.js v3): 384
   dimensions, ~135 MB on disk, ~150–200 MB resident, a few milliseconds per text on one
   CPU core, fr/ar/en/es in one vector space. Lazily loaded, cached for the process
   lifetime, batched at 16, and **serialised at concurrency 1** because CFI is one shared
   Node process and ONNX inference must never starve request handling. No API key, no
   per-call cost, no network at query time. `EMBEDDINGS_PROVIDER` and `VOYAGE_API_KEY` are
   retired, and the stored vector width drops from 1024 to 384 — a quarter of the corpus
   size and of the cosine pass.

2. **Generation goes behind one interface with an OpenAI-compatible implementation.**
   `AI_BASE_URL` + optional `AI_API_KEY` + `AI_MODEL_CHAT`, so the identical code runs
   against Ollama on the VPS (no key), or Groq / Together / OpenRouter, by changing a URL.
   Temperature 0, a hard output-token ceiling, an abort deadline kept distinct from a
   caller abort, a runaway-stream guard, and typed errors. Alongside it a **`'none'`
   provider** that is a first-class configuration, not an error state: with no model
   configured at all, curated answers and grounded retrieval still work, and that is what
   the app boots into. `ANTHROPIC_API_KEY` and `AI_MODEL_REASONING` are retired.

3. **The answer policy is three tiers, and refusing is one of them.** Tier 1: an
   admin-approved Q&A pair matched by normalised text (or by retrieval above a high floor)
   is returned **verbatim with its source, with no model involved**. Tier 2: retrieval from
   CFI's own content only, above a similarity floor, where every answer must cite the
   chunks it used — and `verifyCitations` / `enforceGrounding` *enforce* it, discarding an
   answer that cites nothing or cites something it was not given. Tier 3: refuse plainly
   and offer the WhatsApp hand-off. The tier logic is pure, dependency-free and
   unit-testable; the thresholds are named constants carrying their own reasoning.

**Rationale.** The three changes are one idea: *make the model the least load-bearing part
of the system.*

Locally, embeddings are free and private, and the corpus is far too small to justify a
vendor. The E5 family is trained for asymmetric retrieval — a short question against a long
passage — which is precisely this workload, and it outperforms the
`paraphrase-multilingual-MiniLM-L12-v2` the spec named as the local fallback at the same
size and dimension. Arabic is a first-class locale here, which is what rules out every fast
English-only small model regardless of how attractive their benchmarks look.

Speaking the OpenAI chat-completions format directly, rather than through any vendor SDK,
is what makes the model a swappable component. A self-hosted 3B model on a small VPS
becomes a legitimate production configuration rather than a degraded one, and moving to a
hosted endpoint later — for quality, or for speed — is a base URL, not a migration.

The tiering is the part that answers the accuracy requirement honestly. Tier 1 is exactly
100 % accurate because no model touches it: approved text is returned byte for byte, and at
a training centre the same twenty questions — price, schedule, RIB, transfer delay, how to
enrol, what is included, is there a certificate — are the majority of real traffic. Those
are precisely the questions where being wrong costs money, and precisely the ones a human
can answer once and have answered correctly forever. Tier 2 covers the long tail with
sources attached, and its guarantee holds *even when the model misbehaves*, because a
missing or fabricated citation is caught in code and turned into a refusal. Tier 3 makes
silence the default failure mode: a refusal costs a WhatsApp conversation the centre was
going to have anyway, while a confident wrong price costs a customer and a refund.

The by-product is a system that improves without retraining anything: every refusal is a
row in the content-gap backlog, and every gap an admin fills becomes a tier-1 answer. The
assistant genuinely gets more precise over time — through curation, which is auditable and
instant, rather than through fine-tuning, which is neither.

**Rejected alternatives.**
- *Keep Anthropic for generation and Voyage for embeddings, as specified.* Rejected: two
  keys, two bills, two availability dependencies and a per-question cost, for a corpus of a
  few thousand chunks — and it would not have improved accuracy in the way that matters,
  because a frontier model is still a generative model and still asserts things
  confidently. A stronger model raises tier-2 fluency; it does not create a guarantee.
- *Fine-tune a small model on CFI's content.* Rejected, and it is worth stating plainly
  since it is what "a model that learns" usually means to a non-engineer: fine-tuning bakes
  a snapshot of the curriculum into weights that cannot be corrected without retraining,
  cannot be audited, and will confidently teach last term's prices. Retrieval is cheaper,
  auditable, and correct the second an admin saves an edit.
- *Prompt-only grounding ("answer only from the context, and cite your sources").* Rejected
  as the sole mechanism: it is necessary and it is not sufficient. Any instruction a model
  follows most of the time is a guarantee that fails exactly when a student asks something
  unusual — the case that matters. The prompt asks; the code enforces.
- *No refusal path — always answer with the best available material.* Rejected: this is the
  single most damaging option on the list. It converts every gap in the content into a
  fabricated answer about a real business, at the exact moment a prospect is deciding
  whether to trust the centre with a bank transfer.
- *A larger open model (14B–70B) self-hosted for better Arabic.* Rejected for now on
  hardware grounds, and because the mitigation is better: Arabic quality on the
  commercially critical questions comes from curated Arabic answers written by a human, not
  from model size. The provider interface makes the upgrade a one-line change if that stops
  being true.
- *`EMBEDDINGS_PROVIDER=voyage|local` kept as a switch.* Rejected: two embedding spaces that
  are silently incompatible, one corpus, and a re-index nobody remembers to run after
  flipping it. One model, recorded per chunk in `KnowledgeChunk.embeddingModel`, with a
  length check that refuses a vector of the wrong width instead of reading garbage.
- *Making the assistant hard-fail when no model is configured.* Rejected: tiers 1 and 2 are
  useful with no model at all, and a deployment without an endpoint should get exact curated
  answers and cited sources, not a broken dock.
