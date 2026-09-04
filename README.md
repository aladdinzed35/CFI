# CFI — Centre de Formation Immersive

The digital arm of a real training centre in Meknès, Morocco. Not a marketplace: a single
institution's e-learning platform, where accounts are validated by hand, access is paid for by
bank transfer and verified by a human, and the courses are the centre's own.

The interface ships in **four locales** — French (default and source language), Arabic (full RTL),
English and Spanish. The whole product is designed mobile-first for mid-range Android phones on 4G,
and dark-first with a fully tested light theme.

- Full specification: `CFI-elearning-claude-code-prompt.md` (kept outside the repo).
- Plan, milestones and assumptions: [`docs/PLAN.md`](docs/PLAN.md)
- Architecture and business rules: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Owner-facing configuration values: [`docs/CONFIG.md`](docs/CONFIG.md)
- Dated decision log: [`docs/DECISIONS.md`](docs/DECISIONS.md)

---

## Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 15 — App Router, RSC, Server Actions | One Node process serves SSR and API; supported by Hostinger Web Apps |
| Runtime | Node 22 LTS (`engines: >=22 <23`) | Hostinger's current LTS offering |
| Language | TypeScript 5.7, `strict` + `noUncheckedIndexedAccess` | Indexed access is `T \| undefined`; handled explicitly, no `any`, no `!` |
| UI | React 19 | Server Components by default |
| Styling | Tailwind CSS v4, CSS-first tokens (`@theme inline`) | Runtime theme switching without regenerating classes |
| Primitives | Radix UI + our own layer in `src/components/ui` | Accessible by construction, no theme lock-in |
| Icons | lucide-react | Only direction-carrying icons mirror in RTL |
| Motion | `motion` (Framer Motion v11) | Global `prefers-reduced-motion` respect |
| Forms | react-hook-form + zod + `@hookform/resolvers` | Same zod schema on client and server |
| ORM | Prisma 6, `provider = "mysql"` | MySQL 8 on Hostinger |
| Auth | Auth.js v5 (`next-auth@beta`), Credentials + JWT + DB session table | Manual approval needs full control over the lifecycle |
| Passwords | argon2id via `@node-rs/argon2` | Native speed, no build step, no `bcrypt` pain |
| i18n | next-intl v3, locale-prefixed routes | `fr` `ar` `en` `es`; only `ar` is RTL |
| Email | Nodemailer + Hostinger SMTP, `@react-email/components` rendered server-side | Uses hosting already paid for |
| Storage | S3-compatible via `@aws-sdk/client-s3`, default Cloudflare R2 | Receipts, documents, avatars — never the app filesystem |
| Video | Bunny Stream behind a provider adapter | Video is never served from the app host |
| PDF | `@react-pdf/renderer` | Certificates and invoices, no headless browser |
| Tables | `@tanstack/react-table`, server-side pagination | Every list is a real server-paginated list |
| Charts | Recharts | Admin analytics |
| Dates | date-fns + date-fns-tz, `Africa/Casablanca` | Locales `fr`, `ar-MA`, `en`, `es` |
| Client data | SWR, for the few polled surfaces | RSC everywhere else |
| AI | Anthropic Messages API, streaming; Voyage `voyage-3-lite` embeddings with a local MiniLM fallback | The assistant « Nour » |
| Search | MySQL `FULLTEXT` (ngram parser for Arabic) + in-app cosine over Float32 `Bytes` | No Elasticsearch, no vector database |
| Logging | pino, structured JSON, redaction list | Sentry optional behind an env flag |
| Testing | Vitest, Playwright, axe-core | Unit, integration, e2e in every locale |
| Lint | ESLint 9 flat config, `eslint .` | `next lint` is deprecated in Next 15.5 |

**Explicitly forbidden:** `@vercel/*`, `next-auth@4`, `bcrypt`, `moment`, `axios`,
`styled-components`, any opinionated UI kit (MUI, Chakra, Ant), anything needing a headless
browser at runtime, anything needing Redis or a second process.

---

## Local setup in six commands

```bash
git clone https://github.com/aladdinzed35/CFI.git && cd CFI
cp .env.example .env                       # then set DATABASE_URL and AUTH_SECRET
npm install --ignore-scripts && npx prisma generate
docker compose up -d                       # MySQL 8.4 on 3307 + Mailpit on 8025
npm run db:migrate                         # creates the schema
npm run db:seed                            # realistic French demo data
npm run dev                                # http://localhost:3000 → redirects to /fr
```

Two things worth knowing before the first run:

- **MySQL listens on 3307, not 3306.** `docker-compose.yml` moves it deliberately, because a
  developer machine running XAMPP already has 3306 taken and the resulting failure — connecting to
  the *wrong* MySQL — is far more confusing than a refused connection. Point `DATABASE_URL` at
  `localhost:3307`.
- **Never run `npm run dev` over a `next build` output.** The two write incompatible manifests into
  `.next/`, and the symptom is a 500 with `SyntaxError: Unexpected end of JSON input` on whichever
  route compiles first — which looks like an application bug and is not one. `rm -rf .next` and
  restart. (Going the other way, `build` then `start`, is fine.)

Notes:

- `AUTH_SECRET` — generate with `openssl rand -base64 48`. The app refuses to boot without it:
  `src/lib/env.ts` validates every variable with zod at module load and crashes on a missing or
  malformed value, rather than failing later inside a request.
- `--ignore-scripts` then an explicit `prisma generate` — see
  [`docs/DECISIONS.md`](docs/DECISIONS.md#2026-07-25--bootstrap-with-npm-install---ignore-scripts-plus-an-explicit-prisma-generate).
  On a normal `npm ci` in CI or on the host, the `postinstall` hook runs `prisma generate` for you.
- `docker compose up -d` brings up MySQL 8.4 **and** Mailpit. Every e-mail the app sends in
  development is captured at <http://localhost:8025> instead of being delivered — that is where you
  read the verification links, the enrolment receipts and the approval notices.
- `AI_PROVIDER=none` in `.env.example`, so the whole app — including seeding the assistant's
  knowledge base — works without a single API key.
- Brand font binaries are not in the repo (licensed). Their absence is harmless: every
  `@font-face` in `src/styles/globals.css` sits on top of a real fallback stack, so the app renders
  correctly with system faces until `public/fonts/` is filled.



## Scripts

| Script | Command | What it does |
|---|---|---|
| `dev` | `next dev` | Development server on `PORT` (3000 by default) |
| `build` | `prisma generate && next build` | Production build. Migrations are **not** run here — see below |
| `start` | `next start` | The single long-lived process Hostinger starts. Needs `build` first |
| `postinstall` | `prisma generate` | Keeps the client in sync after any install |
| `db:migrate` | `prisma migrate dev` | Create and apply a migration in development |
| `db:deploy` | `prisma migrate deploy` | Apply pending migrations — the deploy step on Hostinger |
| `db:seed` | `tsx prisma/seed.ts` | Idempotent demo data (§23 of the spec) |
| `db:studio` | `prisma studio` | Inspect the database |
| `lint` | `eslint .` | Flat config; includes the RTL and no-raw-hex rules |
| `typecheck` | `tsc --noEmit` | `strict` + `noUncheckedIndexedAccess` |
| `test` | `vitest run` | Unit and integration |
| `test:watch` | `vitest` | Same, watching |
| `test:e2e` | `playwright test` | End-to-end, every locale, mobile and desktop |
| `verify` | all of the below + `typecheck`, `lint`, `test` | **The whole gate in one command** |
| `i18n:check` | `check-i18n.ts && check-i18n-usage.ts` | Identical key sets across `fr`/`ar`/`en`/`es`, and every key a component asks for exists |
| `rtl:check` | `tsx scripts/check-rtl.ts` | Fails on `ml-` `mr-` `pl-` `pr-` `left-` `right-` `text-left` `text-right` |
| `routes:check` | `tsx scripts/check-routes.ts` | Every declared route constant resolves against the App Router |
| `boundary:check` | `tsx scripts/check-client-boundary.ts` | No `'use client'` bundle reaches Prisma, even transitively |
| `messages:check` | `tsx scripts/check-client-messages.ts` | No client component can ask for a namespace its provider withholds |
| `reindex` | `tsx scripts/reindex.ts` | Rebuild the assistant's knowledge base |

`prisma migrate deploy` is deliberately **outside** `build`: Hostinger's build step may not be able
to reach the database. It runs as a separate deploy step. Rationale and the alternative in
[`docs/DECISIONS.md`](docs/DECISIONS.md#2026-07-25--prisma-migrate-deploy-runs-as-a-deploy-step-not-inside-build).

---

SISTANT.md SECURITY.md CONTENT.md
```

**The layering rule:** UI components never import Prisma and never call a service directly.
Reads flow `page.tsx (RSC) → server/services/* → server/db`. Mutations flow
`client form → server/actions/* → services → db`. Services stay unit-testable without Next.js.

---

## Non-negotiable constraints

These shape the architecture. Violating any one of them means the app cannot ship.

**Single long-lived Node process on Hostinger.** The app is started once by Hostinger Web Apps and
listens on `process.env.PORT`. There is no Vercel: no Edge Runtime, no Vercel KV/Blob/Cron, no
`@vercel/*` package, no Edge Middleware assumptions — middleware runs on the Node runtime. Build is
`npm ci && npm run build`, start is `npm run start`, and nothing else. No Redis, no worker process,
no message queue: background work is a `jobs` table drained by a cron-hit HTTP endpoint.
`sharp` is an explicit dependency because self-hosted image optimisation needs it.

**MySQL 8, via Prisma.** No PostgreSQL-only features: no `citext`, no array columns, no `pgvector`,
no partial indexes. Every foreign key is indexed, and every column used in a `WHERE`/`ORDER BY` on a
list screen is indexed. Vector search for the assistant runs in application code over Float32
buffers stored as `Bytes`, fused with MySQL `FULLTEXT`.

**The application filesystem is not durable.** Redeploys wipe it. Every user upload goes to object
storage. Nothing user-generated is ever written inside the repo tree or `.next`.

**Video is never served from the app host.** Serving MP4 from Hostinger would kill the process.
Video goes through a provider adapter — Bunny Stream by default, with Cloudflare Stream, private
Vimeo and unlisted YouTube adapters — playing HLS behind short-lived signed tokens.

**Money is integer centimes.** Currency is MAD, displayed `1 200 DH` in French and `1 200 د.م.` in
Arabic. Amounts are stored as `Int` centimes and all arithmetic is integer arithmetic. A price is
never a float and never round-tripped through `parseFloat`.

**Manual account approval and bank transfer.** There is no online payment gateway — no Stripe, no
PayPal. A prospect registers, confirms their email, and waits for an administrator to approve the
account. To enrol, they submit a bank-transfer receipt, and an administrator verifies it and
activates access. Both are core product requirements, implemented as explicit state machines, not
temporary workarounds. The payment layer stays abstracted behind a `PaymentMethod` enum so a
gateway can be added later without a rewrite.

**Privacy is a legal obligation.** Personal data of Moroccan residents falls under Law 09-08 / CNDP,
and some students may be in the EU. Receipts are financial documents: private storage only, signed
five-minute URLs, an audit trail on every access, and a defined retention schedule.

---

## Quality gates

CI blocks a merge on any of: TypeScript errors, ESLint errors, an `fr`/`ar`/`en`/`es` key-set
mismatch, a banned physical-direction utility, a failing unit, integration or e2e test, an axe
violation on the twelve key screens in every locale, or a Lighthouse budget regression
(LCP < 2.0 s, CLS < 0.05, INP < 200 ms, homepage JS < 180 KB gzipped, player < 320 KB).
