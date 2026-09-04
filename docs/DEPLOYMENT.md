# Deployment — Hostinger Node.js Web App

Seven files reference this document, including the error message that greets a failed build. It did
not exist until the first deployment failed against it.

Everything below is verified against `src/lib/env.ts`, not summarised from the spec: the required
sets were established by running the validator with candidate environments until it passed.

---

## Why the first build failed

```
CFI — configuration d'environnement serveur invalide
15 variable(s) à corriger. Le processus s'arrête maintenant.
```

Not a compilation error. `next build` compiled and then, during **Collecting page data**, imported a
server module, which loaded `src/lib/env.ts`, which validated the environment and stopped the
process. In hPanel → Deployments → Settings, **Environment Variables** said `None`.

The validator runs at build time because the build *renders pages*: 56 routes are prerendered, and
rendering them executes the same server code a request would. There is no build that does not touch
the environment.

`NODE_ENV=production` is what makes it strict. The same variables are optional in development, where
`AUTH_SECRET` and `CRON_SECRET` fall back to values marked `dev-insecure-…`.

---

## The build settings

The defaults Hostinger fills in for the Next.js preset are already correct:

| Setting | Value | Note |
|---|---|---|
| Framework preset | Next.js | |
| Branch | `main` | |
| Node version | **22.x** | Must be 22 — `engines: >=22 <23` |
| Root directory | `./` | |
| Package manager | `npm` | |
| Output directory | `.next` | |
| Build command | `npm run build` | See *Migrations* below before the first deploy |

The only thing missing is the environment.

---

## Environment variables

Add these in **hPanel → Deployments → Environment variables**. They are read at build *and* at
runtime, so they must be set before the next deploy.

### Required — the build stops without them

```ini
APP_URL=https://your-domain.example
NEXT_PUBLIC_APP_URL=https://your-domain.example

DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DBNAME?connection_limit=5&pool_timeout=20

AUTH_SECRET=<48 random bytes, base64 — at least 32 characters>

SMTP_HOST=smtp.hostinger.com
SMTP_USER=contact@your-domain.example
SMTP_PASSWORD=<the mailbox password>
MAIL_FROM_NAME=CFI
MAIL_FROM_ADDRESS=contact@your-domain.example
MAIL_ADMIN_RECIPIENTS=contact@your-domain.example

STORAGE_DRIVER=s3
VIDEO_PROVIDER=bunny
AI_PROVIDER=none
AI_EMBEDDING_DTYPE=q8

CRON_SECRET=<24 random bytes, hex — at least 24 characters>
```

Generate the two secrets:

```bash
openssl rand -base64 48   # AUTH_SECRET
openssl rand -hex 24      # CRON_SECRET
```

`SMTP_PORT` and `SMTP_SECURE` are omitted above on purpose: they default to `465` and `true`, which
is what Hostinger's implicit-TLS mailbox wants. Set them only for a different provider.

`AUTH_SECRET` encrypts every session cookie. Changing it later signs every user out, so set it once
and keep it. `CRON_SECRET` is the only thing standing between the public internet and
`/api/cron/[job]`.

### Conditionally required

The validator demands these only when the choice above selects them:

| If you set | You must also set |
|---|---|
| `STORAGE_DRIVER=s3` | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` |
| `STORAGE_DRIVER=local` | `LOCAL_STORAGE_PATH` |
| `VIDEO_PROVIDER=bunny` *(production only)* | `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_CDN_HOSTNAME`, `BUNNY_TOKEN_AUTH_KEY` |
| `AI_PROVIDER=openai-compatible` | `AI_BASE_URL` |

### Deploying before you have those accounts

You do not need Cloudflare R2 and Bunny on day one. This set passes validation in production and was
verified by running the validator against it:

```ini
STORAGE_DRIVER=local
LOCAL_STORAGE_PATH=/home/uXXXXXXX/cfi-storage   # OUTSIDE the deployed directory
VIDEO_PROVIDER=youtube                          # no credentials demanded
AI_PROVIDER=none
AI_EMBEDDING_DTYPE=q8
```

Three things to know before choosing it:

- **`LOCAL_STORAGE_PATH` must sit outside the deployment directory.** A deploy replaces the
  application tree; a path inside it takes every uploaded transfer receipt with it.
- `VIDEO_PROVIDER` has no "not configured" member. `youtube` is the honest placeholder while video
  hosting is unbuilt — nothing plays video yet, so nothing is degraded by it. Switch to `bunny` and
  add the four keys when M4 lands.
- **`local` storage is a way to get running, not the destination.** §27 keeps receipts, invoices and
  certificates off the application filesystem. Move to `s3` before real students upload real
  receipts.

`AI_PROVIDER=none` is fully supported, not a stub: embeddings run locally and the assistant answers
from curated content and grounded retrieval without an API key. `AI_EMBEDDING_DTYPE=q8` downloads a
~135 MB model on first use.

---

## Migrations

`npm run build` deliberately does **not** run them
([DECISIONS.md](DECISIONS.md)) — §24.2 allows for a build step that cannot reach the database, so
the migration is a separate act.

The schema must exist before the app serves a request. Two supported shapes:

**A — via SSH, after the deploy** (keeps the build pure):

```bash
cd ~/domains/your-domain.example/public_html
npm run db:deploy
```

**B — in the build command** (no SSH needed):

```
npm run db:deploy && npm run build
```

Shape B is the pragmatic one on Hostinger, where the build runs on the same infrastructure as the
database. It also makes the build *better*: see the next section.

---

## A build that cannot reach the database still succeeds — quietly

Worth knowing, because the failure is silent.

With a valid environment but an unreachable database, `next build` completes. It prerenders 44
routes instead of 56, and the homepage builds with **zero courses on it** — the catalogue, the
featured courses and the testimonials are all empty. Nothing in the build log says so.

The site then heals itself: the public pages carry `revalidate = 60`, so the first request after
deploy serves the empty page and the next one, within a minute, serves the real thing.

The consequence for deployment is small but real: **run migrations before the build** (shape B), so
the build prerenders a site with content in it rather than a shell that fills in a minute later.

---

## After the first successful deploy

1. **Think before seeding.** `npm run db:seed` writes demo accounts and a demo catalogue. It is for
   a fresh install you intend to demonstrate — never one that already has real students.

   > **The seed passwords are public.** They are literals in `prisma/seed.ts`, in a public
   > repository. A seeded production site has a `SUPER_ADMIN` whose password anyone can read. If you
   > seed production, change every password in the same session, or do not seed it at all and create
   > the administrator by hand.

2. **Sign in as the administrator and change the password immediately** — see the warning above.
   The seed prints its own credential table when it finishes.
3. **Fill the real settings** at `/admin/reglages`: bank details, WhatsApp, contact address, hours.
   The seeded bank details read `À REMPLACER` precisely so they cannot be mistaken for real ones.
4. **Check health**: `GET /api/health` returns

   ```json
   { "status": "ok", "db": "ok", "storage": "ok", "smtp": "…", "queuedJobs": 0 }
   ```

   Anything other than `ok` for `db` or `storage` means the corresponding credentials are wrong —
   and the environment validator cannot catch that, because a well-formed connection string for a
   database that refuses you is still well-formed.

---

## Scheduled jobs

`/api/cron/[job]` runs the queue. It answers `401` without the key, and `404` for an unknown job
even *with* it, so it never confirms which jobs exist.

Add these in hPanel → Advanced → Cron Jobs:

```bash
# every 5 minutes — sends queued mail
curl -fsS -H "Authorization: Bearer THE_CRON_SECRET" https://your-domain.example/api/cron/drain

# hourly — expires enrolment requests past their deadline
curl -fsS -H "Authorization: Bearer THE_CRON_SECRET" https://your-domain.example/api/cron/expire-requests

# daily — chases students who have not sent a receipt
curl -fsS -H "Authorization: Bearer THE_CRON_SECRET" https://your-domain.example/api/cron/reminders
```

The endpoint also accepts `?key=THE_CRON_SECRET` for schedulers that cannot send a header. Prefer
the header: a query string lands in access logs, a header does not.

Without `drain`, no e-mail ever leaves the queue: no verification links, no approval notices.

---

## Never set on the running server

`SKIP_ENV_VALIDATION` replaces every missing variable with an obviously fake placeholder so a build
or a CI run can proceed without production secrets. On a runtime server it converts a broken
configuration into a server that starts happily and fails at the first request that needs the thing
it silently faked.

If a build must run without the real secrets, set it **for the build step only** — and accept that
the result prerenders an empty site, because the placeholder `DATABASE_URL` points nowhere.
