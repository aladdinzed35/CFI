# Plan de construction — CFI

**Date:** 2026-07-25 · **Spec version:** 1.0 · Required by spec §0.1 and §30.1.

---

## 1. Understanding of the brief

CFI is an existing physical training centre in Tanger. It teaches in person today. This project is
its digital arm — and the important word in the brief is *arm*, not *platform*. We are not building
a marketplace; we are building the online extension of one institution that already has students,
instructors, classrooms and a reputation.

That distinction is not cosmetic. It changes the mechanics of almost every screen:

| A marketplace does this | CFI does this instead | Consequence for the build |
|---|---|---|
| Anyone signs up and is immediately a user | An administrator validates every account by hand | A real account state machine (`PENDING_EMAIL → PENDING_APPROVAL → ACTIVE`), a designed waiting screen, an approval queue that is somebody's daily job, and middleware that makes `PENDING_APPROVAL` genuinely inert |
| Card checkout, instant access | Bank transfer, a receipt photo, a human verification | The most load-bearing flow in the app: a three-step request modal, an upload pipeline that strips EXIF and detects duplicates, a request state machine, and a transactional approval that must be idempotent under a double click |
| Thousands of third-party instructors | The centre's own instructors and curriculum | No seller onboarding, no revenue split, no marketplace search ranking. Instead: an authoring experience good enough that the centre's own staff use it, and a curriculum builder that is not a developer tool |
| Generic English-first UI | French-first, Arabic a real translation, RTL complete | i18n is not a late pass. Every layout is written with logical properties from the first line, and Arabic is tested in CI, not eyeballed |
| Digital only | Hybrid: real classrooms, real cohorts, live sessions, cash at the centre | `DeliveryMode`, attendance, live sessions with reminders, and `ADMIN_GRANT` enrolments for students who paid cash at the reception desk |
| Self-service support | One tap to a human on WhatsApp | WhatsApp is a first-class product surface, not a footer link: a floating button on every public page with a context-aware prefilled message, and an escalation path from every dead end including the AI assistant's |

Three further constraints shape everything:

**The audience is on a mid-range Android phone over 4G.** Performance and mobile ergonomics are the
primary experience, not a responsive afterthought. We verify at 360 px. An administrator approving a
payment from their phone is a primary use case, not a nice-to-have.

**The host is a single Node process on Hostinger.** No Redis, no worker, no queue, no edge. Every
architectural instinct that assumes a serverless platform has to be replaced with something that
survives in one long-lived process backed by MySQL. Background work is a `jobs` table drained by a
cron-hit endpoint. Vector search is a Float32 matrix in memory. Rate limiting is an in-process token
bucket with a database table for durability across restarts.

**The first five seconds decide.** The owner's own definition of success is a prospect saying "this
looks better than the international platforms." That is a design brief with a measurable outcome,
and it is why §11 gets as much attention as §9.

---

## 2. Milestone plan (spec §25)

Each milestone ends with: a green `npm run build`, green tests for that scope, updated docs, and a
conventional commit pushed to `main`. No milestone starts before the previous one's *done when* is met.

| # | Milestone | Deliverables | Done when |
|---|---|---|---|
| **M0** | Foundations | Next.js 15 + TS strict + Tailwind v4 + « Le Détroit » tokens + fonts + `env.ts` + Prisma schema + first migration + seed skeleton + i18n scaffold (4 locales, RTL) + 30+ `components/ui` primitives + CI + `docs/PLAN.md`, `docs/DECISIONS.md` | `npm run build` passes; the tokens/components showcase renders in both themes and both directions; CI green |
| **M1** | Auth & account lifecycle | Register, verify, login, logout, password reset, session management, middleware route guards, admin approval queue, emails 1–5, waiting screen, rate limiting, audit log | E2E flow #2 passes in all four locales |
| **M2** | Catalog & guest site | Homepage with the Lattice hero and all §12.2 sections, catalog with URL-driven filters, course detail with the state-aware CTA, playable preview lessons, contact form, WhatsApp FAB, legal pages, SEO/JSON-LD/sitemap, designed 404/500 | E2E flow #1 passes; Lighthouse ≥ 95 on homepage and course page (mobile) |
| **M3** | Enrollment requests & payments | The §9.2 three-step modal, receipt upload pipeline, request state machine, student timeline, admin verification drawer with the receipt viewer, transactional approval, invoice PDF, emails 6–12, duplicate detection, expiry cron | E2E flow #3 passes; the double-submit idempotency test passes |
| **M4** | Learning experience | Player (video, resume, heartbeat progress, chapters, transcript, captions, speed, PiP, shortcuts), curriculum navigation, drip and prerequisite gating, notes, bookmarks, resources, lesson discussions, student dashboard, mes-formations | E2E flow #4 passes up to the quiz |
| **M5** | Assessment & certification | Quiz builder and runner (all 7 types), server-authoritative timing and scoring, results with explanations, assignments and grading queue, completion rules, certificate PDF + public verification | E2E flow #4 passes fully |
| **M6** | Full administration | Every §17 module: dashboard analytics, accounts, requests, payments and invoices, course editor with curriculum builder and a translations tab, learning ops, grading, community moderation, leads, broadcasts, CMS, settings, audit and diagnostics | E2E flow #5 passes; a non-developer completes the §26 admin walkthrough unaided |
| **M7** | AI assistant « Nour » | Ingestion, chunking, embeddings, hybrid entitlement-aware retrieval, streaming chat with citations, all surfaces, memory, feedback/curation/gap loops, AI console, quotas, degraded mode | E2E flow #6 passes; the entitlement-leak test and the prompt-injection test pass |
| **M8** | Engagement & polish | Gamification (XP, badges, streaks, leaderboard), flashcards and spaced repetition, agenda and ICS, live sessions with QR attendance, referral, wishlist, notifications centre, weekly digests, PWA and offline, accessibility preferences | E2E flow #7 passes; axe clean on 12 screens × 4 locales |
| **M9** | Hardening & launch | Security headers and CSP, retention jobs, backup verification, full seed, visual-regression baselines, performance budget met, complete `docs/`, Hostinger deployment verified against the §24.3 checklist | The live site passes every item in §26 |

If time pressure forces a cut, cut in this order: leaderboard → blog → referral → live-session QR
attendance → flashcards. **Never cut:** account validation, the payment-verification flow, the
player, the admin panel, i18n.

### 2.1 M0 breakdown — what shipped in this pass

| Item | State | Notes |
|---|---|---|
| `package.json`, `engines: node >=22 <23`, script set | shipped | `build` is `prisma generate && next build`; migrations run as a separate deploy step |
| `tsconfig.json` — `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `@/*` alias | shipped | Indexed access yields `T \| undefined` and is handled at every site |
| `next.config.ts` — next-intl plugin, security headers, image `remotePatterns`, AVIF/WebP, `deviceSizes` from 360 px | shipped | No edge runtime anywhere; `eslint.ignoreDuringBuilds` and `typescript.ignoreBuildErrors` both false |
| `eslint.config.mjs` — flat config | shipped | Bans physical-direction utilities and raw colour literals in components |
| `.env.example` + `src/lib/env.ts` zod schema | shipped | Boots with `AI_ENABLED=false`, `EMBEDDINGS_PROVIDER=local`, `STORAGE_DRIVER=local` so nothing external is needed to run |
| `src/styles/globals.css` — the full token system | shipped | Palette (dark + light + high-contrast + print), type scale, radii, elevation, utilities, motion, Arabic typography |
| `src/i18n/routing.ts` — `locales`, `defaultLocale`, `rtlLocales`, `isRtl` | shipped | Four locales; `fr` default; `ar` the only RTL |
| `src/i18n/messages/{fr,ar,en,es}.json` | shipped | `fr` authored, the other three translated from it; parity enforced by `npm run i18n:check` |
| `prisma/schema.prisma` + first migration | shipped | `enum Locale { fr ar en es }`; every FK and list-sort column indexed |
| `prisma/seed.ts` skeleton | shipped | Idempotent `upsert` by natural key; `SiteSetting` rows with the §3 defaults and placeholder bank details marked `À REMPLACER` |
| `src/components/ui` primitives | shipped | Every one with default, hover, focus-visible, active, disabled, loading, error and empty states, in both themes and both directions; all copy arrives via props |
| `src/lib/cn.ts` | shipped | clsx + tailwind-merge |
| `.github/workflows/ci.yml` | shipped | install → typecheck → lint → i18n parity → RTL check → unit → build |
| `docs/PLAN.md`, `DECISIONS.md`, `CONFIG.md`, `ARCHITECTURE.md`, `README.md` | shipped | This set |
| `public/fonts/*.woff2` binaries | **owner** | Licensed faces. Their absence degrades to the fallback stack; it does not break the build |
| Tokens/components showcase route | M0 tail | Renders every primitive in every state × 2 themes × 2 directions; the visual-regression baseline source |
| Integration and e2e suites | M1+ | Vitest and Playwright are configured; the suites grow with each milestone's scope |

---

## 3. The design token system — « Le Détroit »

The identity is grounded in the centre's own world: Tanger, at the meeting point of two continents,
where the Atlantic meets the Mediterranean, and in Moroccan geometric craft — zellige tessellation,
Kufic construction — reinterpreted as a precise technical system. Immersive training is a controlled
environment where you practise for real, so the interface reads as **an instrument panel for
learning**: dark, calm, exact, with light used as information rather than decoration.

All of the below lives in `src/styles/globals.css`. Raw values are declared once as `--raw-*`
custom properties and mapped into Tailwind through `@theme inline`, which keeps the `var()`
reference inside the generated utility — that is what makes runtime theme switching retint the whole
app without regenerating a single class. **No component ever writes a hex, rgb or hsl value.**

### 3.1 Palette

| Token | Utility | Dark (default) | Light | Role |
|---|---|---|---|---|
| `--raw-bg-abyss` | `bg-abyss` | `#060A12` | `#F6F4EF` | Page background |
| `--raw-bg-surface` | `bg-surface` | `#0D1522` | `#FFFFFF` | Cards, panels |
| `--raw-bg-raised` | `bg-raised` | `#142031` | `#F0EDE6` | Popovers, elevated surfaces |
| `--raw-stroke-hairline` | `border-hairline` | `#1E2C3F` | `#DFDAD0` | 1 px separators |
| `--raw-ink-primary` | `text-ink` | `#E8F0F4` | `#0B1220` | Body text |
| `--raw-ink-muted` | `text-ink-muted` | `#8DA2B4` | `#5A6472` | Secondary text |
| `--raw-accent-strait` | `bg-strait` `text-strait` | `#2FE3BE` | `#0A7F72` | Primary action, progress, "live" |
| `--raw-accent-deep` | `bg-deep` | `#0E4C6B` | `#0E4C6B` | Depth, gradients, chart base |
| `--raw-accent-brass` | `bg-brass` `text-brass` | `#E7B463` | `#A9702A` | **Money and achievement only** |
| `--raw-signal-danger` | `bg-danger` `text-danger` | `#FF6076` | `#C0283C` | Rejection, errors |
| `--raw-signal-warn` | `bg-warn` `text-warn` | `#FFB454` | `#8A5A16` | Pending, awaiting verification |
| `--raw-signal-success` | `bg-success` `text-success` | `#4FD48A` | `#1D7A4C` | Approved, completed *(added — see §5)* |

Ink that sits **on** a filled accent, so filled buttons never rely on a guess:

| Token | Utility | Dark | Light |
|---|---|---|---|
| `--raw-on-accent` | `text-on-accent` | `#04231D` | `#FFFFFF` |
| `--raw-on-brass` | `text-on-brass` | `#2A1C05` | `#FFFFFF` |
| `--raw-on-danger` | `text-on-danger` | `#2B0207` | `#FFFFFF` |

Alpha washes for status backgrounds, computed with `color-mix(in oklab, … 12%, transparent)` so they
follow the accent through a theme switch: `bg-strait-wash`, `bg-brass-wash`, `bg-danger-wash`,
`bg-warn-wash`. The canonical status pattern is `bg-warn-wash text-warn` plus an icon and a text
label — never colour alone.

**Rules.** One accent per surface. `brass` is reserved for price, premium, certificate and
"best value"; it is never an ordinary button. `strait` carries the single primary action on a
screen. Every status colour is paired with an icon and a word. Contrast is verified at ≥ 4.5:1 for
text and ≥ 3:1 for UI boundaries **in both themes** — the brass and teal pairs specifically, since
they are the two that fail most easily. A `[data-contrast='high']` mode collapses `ink-muted` into
`ink` and strengthens hairlines, exposed to the student as an accessibility preference.

### 3.2 Type pairing

| Role | Face | Fallback stack | Usage |
|---|---|---|---|
| Display | **Chillax** (variable 200–700) | Clash Display → Geist Sans → Inter Tight → system | Hero, section titles, eyebrows, big numbers. Used with restraint |
| Body / UI | **Geist Sans** (variable 100–900) | Inter Tight → system | Everything else. Tight and neutral, legible at 14–16 px on cheap Android screens |
| Data / mono | **Geist Mono** (variable) | ui-monospace → SFMono → Cascadia | Prices, references `CFI-2026-000123`, RIB, timers, code. Applied via `[data-numeric]` with `tabular-nums` |
| Arabic | **IBM Plex Sans Arabic** (400/600) | Almarai → Geist Sans → system | Body and headings in `ar`. Structurally pairs with Geist. Loaded only on `ar` routes, `unicode-range`-scoped |
| Dyslexia | **OpenDyslexic** | Geist Sans | Opt-in accessibility preference, applied at `[data-dyslexia='true']` |

Every face is self-hosted, subset, `font-display: swap`, and sits above a real fallback stack — a
missing licensed binary degrades to system faces rather than breaking the build. Only the display
face is preloaded.

Arabic typography gets `--leading-ar: 1.8` on body and `1.35` on headings, tighter tracking on
headings, and never any letter-spacing. Latin runs inside Arabic text — references, RIB/IBAN, emails,
phone numbers, prices, code — are wrapped in `.force-ltr` with `unicode-bidi: isolate`.

Fluid scale, `clamp()` between 360 px and 1440 px, body base 16 px and never below 14 px anywhere:

| Token | Size | Line height |
|---|---|---|
| `text-hero` | `clamp(2.5rem, 6vw, 5.5rem)` | 1.02 |
| `text-display` | `clamp(2rem, 4.2vw, 3.5rem)` | 1.08 |
| `text-title` | `clamp(1.5rem, 2.6vw, 2.25rem)` | 1.15 |
| `text-heading` | `clamp(1.25rem, 1.8vw, 1.5rem)` | 1.25 |
| `text-lead` | `clamp(1.0625rem, 1.4vw, 1.25rem)` | 1.6 |
| `text-body` | `1rem` | 1.65 |
| `text-sm` | `0.875rem` | 1.55 |
| `text-xs` | `0.8125rem` | 1.45 |

The root font size is `calc(1rem * var(--font-scale))`, so the student's 90–130 % font-scale
preference rescales the entire fluid system instantly, without a reload.

### 3.3 Radii and elevation

| Radius | Value | Use |
|---|---|---|
| `rounded-sm` | 8 px | Inputs, chips, small controls |
| `rounded-md` | 14 px | Buttons, cards, list rows |
| `rounded-lg` | 22 px | Panels, modals, hero surfaces |
| `rounded-pill` | 999 px | Badges, avatars, filter chips, progress tracks |

No mixed rounding inside a single component.

| Elevation | Utility | Dark | Light |
|---|---|---|---|
| 1 | `shadow-e1` | `0 1px 2px rgb(2 8 20 / .32)` | `0 1px 2px rgb(24 20 12 / .06)` |
| 2 | `shadow-e2` | `0 4px 14px -4px rgb(2 8 20 / .42)` | `0 4px 14px -4px rgb(24 20 12 / .10)` |
| 3 | `shadow-e3` | `0 12px 34px -10px rgb(2 8 20 / .52)` | `0 12px 34px -10px rgb(24 20 12 / .14)` |
| 4 | `shadow-e4` | `0 28px 70px -18px rgb(2 8 20 / .62)` | `0 28px 70px -18px rgb(24 20 12 / .18)` |

Low opacity, large radius, cool-tinted. Depth is carried primarily by 1 px hairlines
(`.hairline-b/-t/-s/-e`, all logical) and generous space; shadows only separate genuinely floating
layers. Blur (`.surface-blur`) is used in exactly two places: the sticky header and the AI dock.

### 3.4 Signature element — the Lattice

A tessellated 8-point-star grid drawn as SVG from zellige geometry, **generated from real data** and
used in exactly three places, nowhere else:

1. **Homepage hero** — each tile is a real published course, glowing with `strait` at an intensity
   set by popularity; hovering reveals the title and price and links to the course. It is a live
   catalogue, not decoration. Under reduced motion it is static but still interactive.
2. **Student dashboard** — one tile per lesson in the active course, filling as lessons complete, so
   the shape of your progress is literally a piece of zellige you are completing. Tapping a tile
   jumps to that lesson.
3. **Certificate PDF** — a fragment of the completed lattice, seeded by the certificate serial so it
   is unique per student, printed as the seal motif.

Everything else stays quiet. One optional "bathymetric" texture — low-contrast contour lines derived
from the Strait's seabed — appears on the hero and footer at 3 % opacity (`.texture-bathymetric`),
and nowhere else.

### 3.5 Motion

Spring-based via `motion`, with `prefers-reduced-motion` honoured in two independent layers: a CSS
media query that flattens every animation and transition, and a `useReducedMotionSafe()` hook that
feeds JS-driven variants. Either alone leaves a gap. A `[data-reduce-motion='true']` attribute lets
the student's stored preference win even when the OS says otherwise.

- Hover: 120 ms, transform and border-colour only. No layout-shifting hovers.
- Page transitions: 180 ms, opacity plus an 8 px **inline-start** offset — which means it comes from
  the right in Arabic, because the direction is read from `useDirection()`, never hardcoded.
- Nothing exceeds 300 ms on navigation. Nothing loops infinitely, including the WhatsApp button's
  pulse ring, which runs three times and stops.
- Easing: `ease-[var(--ease-out-strait)]` = `cubic-bezier(.22, 1, .36, 1)`.
- Skeletons, not spinners, for anything with a known shape. Optimistic UI on note saving,
  bookmarking, quiz answers and upvotes.

### 3.6 Check against spec §11.1 — why this is none of the three clichés

The spec names three overused directions and the generic SaaS hero, and asks for an explicit check.

**(a) Cream background + high-contrast serif + terracotta accent.** Rejected on all three axes. The
default theme is dark (`#060A12`), and the light theme's `#F6F4EF` is a warm paper that exists to be
readable in Moroccan daylight, not to be the identity. There is **no serif anywhere** in the system —
display, body, mono and Arabic are all grotesque or geometric. There is no terracotta: the warm
accent is `brass`, and it is functionally locked to money and achievement rather than being a
decorative house colour.

**(b) Near-black + one acid accent + generic glow.** The background is not near-black-neutral; it is
a desaturated blue-black at the abyssal end of the Strait's own palette, and it works with two
further blues (`surface`, `raised`) plus `deep` `#0E4C6B` to build depth from hue rather than from
lightness alone. The system has **two** accents with strictly separated jobs — `strait` for action
and progress, `brass` for value and achievement — plus three signal colours. And there is no glow:
the explicit rule is hairlines and space, blur in two places only, no glassmorphism on cards, no
floating gradient blobs. Where light appears it encodes a value (lattice tile intensity is course
popularity; progress ring fill is real coverage), which is the opposite of ambient glow.

**(c) Broadsheet layout with hairline rules and zero radius.** We do use hairlines — but paired with
a four-step radius scale that starts at 8 px and reaches 22 px on panels, an elevation system, and
tessellated geometry rather than a column grid. The layout is dense and instrumental, not editorial:
progress rings, data tables, timelines, a curriculum rail, mono numerals with tabular figures.

**The generic SaaS hero** is avoided structurally, not stylistically. There is no centred
headline-subhead-two-buttons-floating-screenshot arrangement and no purple-to-blue gradient blob.
The hero's thesis is the Lattice — a live, interactive rendering of the actual catalogue, where
every tile is a real course you can hover and click. It cannot be templated because it is generated
from the database.

**Positively stated:** the direction is a dark instrument panel built from a real place and a real
craft tradition, where the single most prominent element on the homepage is a data visualisation of
the product itself.

---

## 4. The four-locale decision

**Deliberate change from the spec.** The spec specifies two locales, `fr` and `ar`. The owner
requires four:

| Locale | Direction | Role |
|---|---|---|
| `fr` | LTR | **Default and source language.** Every string is authored here first |
| `ar` | **RTL** | Full translation. The only RTL locale in the system |
| `en` | LTR | Full translation |
| `es` | LTR | Full translation |

French remains the source language for two reasons that are not negotiable: the centre's staff write,
review and approve copy in French, and the canonical strings in spec §28.3 — the 48-hour transfer
notice in particular — are legally and commercially load-bearing in their French wording. Adding
locales does not promote any of them to source; `en`, `es` and `ar` are translated **from** French,
and when a translation is missing the fallback chain is `requested → fr → first available`.

Only `ar` is RTL. `en` and `es` add translation surface but no layout work, because every layout was
written with logical properties from the first line regardless.

### What this changes, concretely

**Locale contract.** `src/i18n/routing.ts` is the single source of truth and everything imports from
it — no module re-declares the list:

```ts
export const locales = ['fr', 'ar', 'en', 'es'] as const;
export const defaultLocale = 'fr';
export const rtlLocales = ['ar'] as const;
export function isRtl(locale: Locale): boolean;
export type Locale = (typeof locales)[number];
```

**Prisma.** `enum Locale { fr ar en es }`. This enum is used by `User.locale`, `Course.contentLocale`
and every `*Translation` table's `locale` column, so widening it widens the whole domain-content
model at once. The `@@unique([<parent>Id, locale])` constraints are unchanged in shape but now admit
four rows per parent instead of two.

**Message files.** `src/i18n/messages/{fr,ar,en,es}.json`, same namespaces, same keys.
`npm run i18n:check` fails the build on any key-set divergence across all four — not just a pairwise
`fr`/`ar` comparison. ICU pluralisation rules differ per language (Arabic has six plural categories
against French's two, English's two and Spanish's two), so plural-bearing keys are authored with the
full category set and the checker validates the categories, not only the key names.

**Translation tables.** `CategoryTranslation`, `CourseTranslation`, `ModuleTranslation`,
`LessonTranslation`, `QuizTranslation`, `FaqTranslation`, `PageTranslation` and friends now hold up
to four rows per parent. The fallback pill — « Contenu disponible en français » — appears whenever the
requested locale falls back, which will be common for `en` and `es` at launch and is the honest
behaviour: a visible fallback beats silently mixed languages.

**hreflang and SEO.** Every public page emits four `hreflang` alternates plus `x-default` pointing at
`fr`. `sitemap.ts` multiplies every public URL by four locales. Slugs stay in French for all four
locales (`/es/formations/marketing-digital`) so links are stable and the canonical stays unambiguous.

**Locale switcher.** No longer a two-state segmented control. It becomes a four-item dropdown listing
each language in its own name — `Français` · `العربية` · `English` · `Español` — preserving the
current path and query, persisting to `User.locale` when authenticated and to the `NEXT_LOCALE`
cookie otherwise. Root `/` resolves in order: cookie → `Accept-Language` → `fr`.

**Direction handling.** `<html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'}>`. `isRtl` is a
function over `rtlLocales`, never an equality check against `'ar'`, so a future RTL locale needs one
array entry and no component changes. Arabic typography rules key off `[dir='rtl']` and `:lang(ar)`
rather than a locale list.

**Admin translation-completeness UI.** The course editor's *Traductions* tab shows one column per
locale with a per-field completion state and an overall percentage, so an administrator can see at a
glance that a course is 100 % `fr`, 100 % `ar`, 40 % `en`, 0 % `es`. The same completeness signal
drives the fallback pill on the public side and an admin dashboard card listing the courses with the
weakest coverage.

**Testing.** Playwright's critical suite runs per locale. The RTL-specific assertions (`dir="rtl"`,
no horizontal overflow at 360 px, mirrored navigation) run for `ar` only; the a11y and no-overflow
checks run for all four.

**Cost.** Arabic content translation is real editorial work (spec §28.2). If human Arabic review is
unavailable at launch, the `ar` locale is flagged `bêta` in the switcher rather than shipped
silently. The same rule applies to `en` and `es`.

---

## 5. Assumptions log

The ten assumed defaults from spec §29, plus the ones this build adds. Each is implemented as
stated and can be changed if the owner objects — none of them is hardcoded past the point of easy
reversal.

| # | Assumption | Rationale |
|---|---|---|
| 1 | Course access is **lifetime** unless a course sets `accessDurationDays` | The centre sells training, not a subscription. Expiry exists in the model for future cohort-based courses, and the dashboard warns 14 days before an expiry that does exist |
| 2 | Manual admin approval of accounts is **on**, behind a setting | It is a core requirement, but wiring it as a `SiteSetting` means the centre can relax it later without a deployment |
| 3 | Certificates require 100 % of mandatory lessons **plus** the final quiz at `Course.passingScore` | A certificate from a real training centre has to mean something. Configurable per §17.12 `Certificats` |
| 4 | Reviews are moderated before publication | Reputation risk on a single-institution site is asymmetric; one abusive review is not balanced by ten good ones |
| 5 | Instalments exist in the data model but are **off** in the UI | The payment policy has legal consequences the owner has not stated. Building the model now avoids a migration later; hiding the UI avoids promising something undecided |
| 6 | The leaderboard is **opt-in**, showing first name plus last initial | Publishing full names of paying students by default is a privacy problem under Law 09-08. Opting out removes the student entirely, not just their display |
| 7 | AI is available to guests in a **marketing-only** scope and to students in a **course-scoped tutoring** role | Guests must never be able to reach paid content through the assistant. The entitlement filter is a SQL pre-filter, not a post-filter |
| 8 | Arabic ships as a complete interface translation; course *content* is Arabic where translations exist and French otherwise, with a visible fallback pill | Interface parity is achievable at launch; content parity across a full catalogue is not. The pill is honest rather than silent |
| 9 | Video is hosted on **Bunny Stream**; no video is ever served from the app host | Cost, HLS support, signed URLs, and MENA latency. The adapter pattern means switching providers is a settings change |
| 10 | **No online card payment.** Bank transfer and cash at the centre only | The owner's stated business model. `PaymentMethod` stays an enum so a gateway is additive later |
| 11 | *(added)* A `success` colour token joins the §11.2 palette | The spec's palette has `danger` and `warn` but no positive signal, while the domain has many terminal-positive states (`APPROVED`, `ACTIVE`, `COMPLETED`, verified diagnostics). Reusing `strait` for both "primary action" and "this succeeded" would break the one-accent-per-surface rule. Contrast-verified in both themes |
| 12 | *(added)* Dark is the default theme; light follows `prefers-color-scheme` on a first visit with no stored preference | Stated in §11.2. Implemented with an inline bootstrap script that sets `data-theme` before paint, so there is no flash of the wrong theme |
| 13 | *(added)* Western Arabic numerals (`0123456789`) are the default in `ar` | What Moroccan users actually expect. Eastern numerals are available as a setting per §17.12 `Localisation` |
| 14 | *(added)* Every seeded account shares the password `Cfi-demo-2026`, overridable with `SEED_PASSWORD` | Demo data has to be trivially usable. The production procedure forces a password change on the first super-admin login, and the seeded bank details are marked `À REMPLACER` so they cannot be mistaken for real ones |
| 15 | *(added)* `prisma migrate deploy` runs as a **deploy step**, not inside `npm run build` | Hostinger's build container may not be able to reach the database. Both options are documented; the fallback is a one-off protected cron hit. See `docs/DECISIONS.md` |
| 16 | *(added)* The invoice number series is `CFI-{year}-{sequence}`, zero-padded to six digits, allocated inside the approval transaction | Moroccan accounting requires an unbroken sequence. Allocating it in the same transaction as the enrolment is what makes double-approval produce exactly one invoice |
| 17 | *(added)* Request references use the same shape (`CFI-2026-000123`) but a separate series | The student quotes the reference in the transfer motif before an invoice exists; conflating the two series would create gaps in the invoice sequence |
| 18 | *(added)* Retention: receipts and invoices 10 years, AI conversations 12 months, audit logs 24 months, sessions 90 days, rejected accounts anonymised after 12 months | The 10-year figure is the Moroccan accounting obligation; the others are GDPR-grade hygiene. Enforced by the `cleanup` cron, documented in `docs/SECURITY.md` |
| 19 | *(added)* Account deletion **anonymises** rather than hard-deletes | `fullName → "Compte supprimé"`, email hashed, phone removed, receipts purged, enrolments retained as anonymous aggregates. Hard deletion would break referential integrity and destroy accounting records the centre is legally required to keep |
| 20 | *(added)* The centre's timezone is `Africa/Casablanca` for every business computation | Streaks, weekly goals, daily AI budgets and cron windows all roll over at Moroccan midnight, not UTC midnight. Storage stays UTC |

---

## 6. Questions for the owner

Everything below blocks **launch**, not development. Development proceeds on the documented defaults.
Answer inline — this checklist is meant to be edited and returned.

### 6.1 Contact

- [ ] **WhatsApp number (primary)** — drives every WhatsApp CTA on the site. Format `+212…`
      → `_______________________`
- [ ] WhatsApp number (secondary, optional — a second agent) → `_______________________`
- [ ] Public phone number → `_______________________`
- [ ] Public email address (default `contact@cfi.ma`) → `_______________________`
- [ ] Postal address as it should appear on the contact page and the map
      → `_______________________`
- [ ] Opening hours (default `Lun–Sam · 09h00–19h00`) → `_______________________`
- [ ] Social profiles — Facebook / Instagram / LinkedIn / TikTok / YouTube
      → `_______________________`

### 6.2 Bank details — shown in the transfer modal

- [ ] Account holder / beneficiary name exactly as the bank prints it
      → `_______________________`
- [ ] Bank name → `_______________________`
- [ ] **RIB** (24 digits) → `_______________________`
- [ ] **IBAN** → `_______________________`
- [ ] **SWIFT / BIC** → `_______________________`
- [ ] Is cash payment at the centre enabled? → `oui / non`
- [ ] Are instalments allowed, and on what terms? → `_______________________`

### 6.3 Legal identity — printed on every invoice

- [ ] Raison sociale → `_______________________`
- [ ] **ICE** → `_______________________`
- [ ] **RC** (registre de commerce) + tribunal → `_______________________`
- [ ] **IF** (identifiant fiscal) → `_______________________`
- [ ] Patente / TP, if applicable → `_______________________`
- [ ] Registered address for invoices, if different from the public one
      → `_______________________`
- [ ] VAT treatment on training services — subject to TVA, exempt, or other?
      → `_______________________`
- [ ] Invoice legal footer text → `_______________________`

### 6.4 Brand assets

- [ ] Logo — SVG preferred, otherwise PNG at ≥ 1024 px, in **light and dark** variants
- [ ] Favicon source (a square mark, ≥ 512 px)
- [ ] An Open Graph fallback image, or approval to generate one from the logo
- [ ] Confirmation of the taglines, or replacements:
      - fr: « La formation qui vous met en situation » → `_______________________`
      - ar: «التكوين الذي يضعك في قلب الميدان» → `_______________________`
      - en / es: to be translated from the confirmed French
- [ ] Photographs of the physical centre for the *Le centre* homepage section — the single
      strongest differentiator against online-only platforms
- [ ] Instructor photographs and short bios
- [ ] Any agréments or accreditations that can be stated truthfully (the trust line only ships if
      it is true)

### 6.5 The real catalogue

- [ ] The actual course list, with for each one: title, category, level, delivery mode
      (en ligne / présentiel / hybride), duration, **price in DH**, and a compare-at price if there
      is a genuine one
- [ ] Which courses have Arabic content available, and which are French only
- [ ] Whether learning paths (`parcours`) exist, and how they are priced as a bundle
- [ ] Honest market price ranges for the comparison band on the homepage — labelled ranges, never
      named competitors

### 6.6 Infrastructure accounts

- [ ] Domain name, and whether it is already registered → `_______________________`
- [ ] Is a **Hostinger plan with Node.js Web Apps and a MySQL 8 database** already active?
      Which plan? → `_______________________`
- [ ] GitHub access to `aladdinzed35/CFI` for the deployment integration
- [ ] **Anthropic** account and API key — the assistant « Nour »
- [ ] **Voyage AI** account and API key — embeddings (the app runs on the local fallback without it,
      more slowly)
- [ ] **Bunny Stream** account, library, and token-authentication key — video
- [ ] **Cloudflare R2** account, bucket, and a scoped API token — receipts, documents, avatars
- [ ] Ability to add **SPF, DKIM and DMARC** DNS records. Without them, validation emails land in
      spam and the entire account flow fails silently — this is the single most common launch failure

### 6.7 Policy confirmations

- [ ] Expected account-validation delay to state on the waiting screen (default « sous 24 heures
      ouvrées ») → `_______________________`
- [ ] Unpaid request expiry (default 7 days) → `_______________________`
- [ ] Refund policy, for the CGU and the admin's refund action → `_______________________`
- [ ] Who receives administrative emails (`MAIL_ADMIN_RECIPIENTS`) → `_______________________`
- [ ] Confirmation that the assumed defaults in §5 above are acceptable, or which to change
