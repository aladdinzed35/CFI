# Architecture

How a request becomes a response, where business logic is allowed to live, and the rules that are
load-bearing enough to be written down rather than inferred from the code.

---

## 1. Layering

There are four layers and the dependency arrows only ever point downward.

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  UI            src/app/**  ·  src/components/**                      │
  │                RSC pages, layouts, client components, primitives      │
  │                Knows: props, translations, routing. Nothing else.     │
  └───────────────┬──────────────────────────────────┬───────────────────┘
                  │ reads (RSC only)                 │ mutations
                  ▼                                  ▼
  ┌──────────────────────────────┐   ┌──────────────────────────────────┐
  │  ENTRY POINTS                │   │  src/server/actions/**           │
  │  src/app/**/page.tsx (RSC)   │   │  'use server' · zod · authz      │
  │  src/app/api/**/route.ts     │   │  revalidate · redirect           │
  └───────────────┬──────────────┘   └───────────────┬──────────────────┘
                  │                                  │
                  └──────────────┬───────────────────┘
                                 ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  SERVICES      src/server/services/**                                │
  │                All business logic. State machines. Transactions.     │
  │                Pure TypeScript — no Next.js import, no React import. │
  │                Unit-testable with a database and nothing else.       │
  └───────────────┬──────────────────────────────────┬───────────────────┘
                  ▼                                  ▼
  ┌──────────────────────────────┐   ┌──────────────────────────────────┐
  │  src/server/db.ts (Prisma)   │   │  storage/ video/ mail/ jobs/     │
  │  the only Prisma client      │   │  adapters over external systems  │
  └──────────────────────────────┘   └──────────────────────────────────┘
```

**The rule, stated as a prohibition:** a file under `src/components/` or `src/app/**/page.tsx` may
not import `@prisma/client`, may not import `src/server/db`, and may not construct a query. Pages
call services. Components receive data as props. This is enforced by an ESLint `no-restricted-imports`
rule, not by convention.

**Why it matters here specifically.** The permission model (`can()`), the access gate
(`canAccessLesson`), the request state machine and the approval transaction all live in services.
If a page could query directly, each of those would eventually be reimplemented slightly differently
at a call site, and the one that is slightly different is the one that leaks a paid transcript. One
implementation, many call sites, tested once.

`src/lib/**` sits beside all of this: framework-agnostic helpers (`money`, `phone`, `slug`, `crypto`,
`cn`, `rate-limit`, `validation/`, `env`) with no knowledge of the database or of React.

---

## 2. Request lifecycle

### 2.1 Read — an RSC page

```
GET /fr/formations/marketing-digital
  │
  ├─ middleware (Node runtime — never edge)
  │    · locale negotiation: path prefix → NEXT_LOCALE cookie → Accept-Language → 'fr'
  │    · session cookie → session lookup → actor
  │    · route guard by account status:
  │        PENDING_EMAIL     → /[locale]/verification-email
  │        PENDING_APPROVAL  → only /compte-en-attente, /espace/profil, public catalog, guest AI
  │        SUSPENDED         → /[locale]/compte-suspendu
  │        REJECTED          → /[locale]/compte-refuse
  │    · maintenance mode (admin bypass)
  │
  ├─ app/[locale]/layout.tsx
  │    · <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'}>
  │    · theme bootstrap script (sets data-theme before paint — no flash)
  │    · NextIntlClientProvider with the message bundle for this locale
  │
  ├─ page.tsx  (Server Component, async)
  │    · zod-parse params and searchParams (.strict())
  │    · const course = await courses.getPublicBySlug(slug, locale)   ← service
  │    · const viewerState = await enrollment.viewerStateFor(actor, course.id)
  │    · generateMetadata(): title, description, canonical,
  │      4 × hreflang + x-default → fr, OG image, JSON-LD
  │
  ├─ services/courses/*
  │    · Prisma query with an explicit `select`, translations joined for
  │      [locale, 'fr'] so the fallback is one query, not two
  │    · returns a plain DTO — never a Prisma model with lazy relations
  │
  └─ render
       · RSC streams the shell; heavy client widgets are dynamic-imported
         (player, TipTap, charts, pdf.js, the lattice, the AI dock)
       · client components receive DTOs and strings as props
```

Every user-facing string on the page comes from `next-intl`; every string inside a `components/ui`
primitive arrives as a prop (`label`, `placeholder`, `error`, `emptyLabel`, …). A primitive never
contains copy.

### 2.2 Write — a client form through a Server Action

```
client form  (react-hook-form + zodResolver, the same schema as the server)
  │  optimistic UI where it is safe: notes, bookmarks, upvotes, quiz answers
  ▼
server action   src/server/actions/enrollment/submitRequest.ts   'use server'
  │  1. action wrapper: assert Origin/Host (CSRF, on top of SameSite cookies
  │     and Next's built-in origin check)
  │  2. resolve the actor from the session — never trust a client-supplied id
  │  3. zod .strict() parse of the payload; unknown keys are a rejection
  │  4. rate limit (in-process token bucket + RateLimitEvent for durability)
  │  5. can(actor, 'enrollment.request', course)  ← authorization before any read
  ▼
service   src/server/services/enrollment/*
  │  6. load the current state, run the state machine's exhaustive switch
  │  7. do the work inside prisma.$transaction when more than one row changes
  │  8. recompute derived counters in the same transaction
  │  9. enqueue side effects as Job rows (email, PDF, re-index) — never inline
  │ 10. write an AuditLog entry
  ▼
db (MySQL 8, Prisma)
  ▼
back through the action
  │ 11. revalidateTag / revalidatePath for anything cached
  │ 12. return a typed result, or redirect
  ▼
client
     toast (aria-live), router refresh, or navigation
```

**Failures are values, not exceptions, across the action boundary.** A service throws a typed domain
error; the action wrapper maps it to a discriminated result the form can render as a field error or a
callout. An unexpected throw is logged with pino and surfaced as the generic French error copy — never
a stack trace, never a raw error code.

**Emails, PDFs and re-indexing are always jobs.** A student submitting a receipt gets their
confirmation screen in one round trip; the two emails, the admin notification and the duplicate check
are `Job` rows drained by `/api/cron/drain` every two minutes. A slow SMTP server can never make the
upload feel broken.

### 2.3 Route handlers

`src/app/api/**` exists only where a Server Action cannot do the job:

| Route | Why it is a route handler |
|---|---|
| `auth/[...nextauth]` | Auth.js owns it |
| `ai/chat` | Server-Sent Events streaming |
| `files/[...key]` | Binary response, plus an audit write per access |
| `video/token` | Short-TTL signed token minted for the player |
| `cron/[job]` | Called by Hostinger cron with a secret, not by a browser |
| `webhooks/*` | Called by the video provider |
| `health` | Uptime monitoring |

Every mutating route handler goes through the same wrapper as Server Actions: origin assertion, zod
parse, `can()`, rate limit. No route handler talks to Prisma directly.

---

## 3. The access gate

One predicate. Six call sites. Tested exhaustively against every role × enrolment state.

```ts
canAccessLesson(user, lesson) =
  lesson.isPreview                                        // guests & non-enrolled
  || user.role in [ADMIN, SUPER_ADMIN]
  || (user.role === INSTRUCTOR && ownsCourse(user, lesson))
  || (hasActiveEnrollment(user, lesson.course)
      && enrollmentNotExpired
      && moduleDripUnlocked(user, lesson.module)
      && prerequisitesMet(user, lesson))
```

Read in order, the clauses are: a preview lesson is the conversion tool and is open to everyone;
administrators see everything; an instructor sees their own course; otherwise you need a live
enrolment that has not expired, whose module's drip window has opened, and whose prerequisites you
have met.

`ACTIVE` account status is a precondition enforced earlier, in middleware — a `PENDING_APPROVAL`
user never reaches a lesson route at all. The gate does not re-check it, but the six call sites below
all run behind the same middleware, and the video-token and file-proxy endpoints re-assert it because
they are reachable by direct request.

### The six call sites

| # | Call site | What it protects | Failure mode |
|---|---|---|---|
| 1 | `app/[locale]/(student)/espace/apprendre/[courseSlug]/[lessonId]/page.tsx` | The lesson page itself | Renders the *locked* state that explains **why** it is locked (not enrolled / expired / drips on 12 mars / finish lesson X first) with the right CTA |
| 2 | `app/api/video/token/route.ts` | Playback token minting | 403, no token. Without a token the CDN refuses the stream, so the gate holds even if the page were somehow rendered |
| 3 | `app/api/files/[...key]/route.ts` | The private file proxy — lesson attachments, transcripts | 403, and the attempt is written to `AuditLog`. Receipts have their own stricter rule: `ADMIN`+ only, or the student who owns the request |
| 4 | `services/courses/resources.ts` — resource download | Downloadable PDFs, worksheets, datasets | Omitted from the list entirely, then re-checked at download time |
| 5 | `services/assessment/startAttempt.ts` — quiz start | Creating a `QuizAttempt` | 403 before any attempt row exists, so a locked quiz cannot be started and abandoned to poison the attempt count |
| 6 | `services/ai/retrieval.ts` — **AI retrieval scope** | The chunk pre-filter | The accessible-course set is resolved from this predicate and injected into the SQL `WHERE`. A non-enrolled user's query can never select a paid chunk row. Mandatory integration test |

Call site 6 is the one that must never be relaxed for performance. Entitlement filtering happens in
the query, never after scoring — a paid transcript has to be physically unreachable, not merely
unranked.

---

## 4. State machines

Implemented in `src/server/services/*` as explicit, exhaustive `switch` statements over the status
enum — not as scattered `if` blocks in route handlers. With `noFallthroughCasesInSwitch` and a
closed enum, adding a status becomes a compile error at every switch that does not handle it.

### 4.1 Account lifecycle

```
                ┌──────────────┐
 register  ──▶  │PENDING_EMAIL │
                └──────┬───────┘
        clicks email link │
                ┌────────▼─────────┐        admin rejects      ┌─────────┐
                │PENDING_APPROVAL  │ ────────────────────────▶ │REJECTED │
                └────────┬─────────┘                           └─────────┘
        admin approves   │                                          │ can re-apply
                ┌────────▼─────┐   admin suspends    ┌───────────┐  │ after fix
                │    ACTIVE    │ ──────────────────▶ │ SUSPENDED │◀─┘
                └──────────────┘ ◀────────────────── └───────────┘
                                     reinstates
```

| From | Event | To | Side effects |
|---|---|---|---|
| — | registration submitted | `PENDING_EMAIL` | 64-byte token (SHA-256 stored, 24 h TTL), email #1 « Confirmez votre adresse e-mail », redirect to the masked-email screen |
| `PENDING_EMAIL` | verification link used | `PENDING_APPROVAL` | `emailVerifiedAt`, email #2 to the student, email #3 to `MAIL_ADMIN_RECIPIENTS` with a deep link, redirect to `/compte-en-attente` |
| `PENDING_APPROVAL` | admin approves | `ACTIVE` | `approvedAt`, `approvedById`, email #4, in-app notification, `AuditLog` |
| `PENDING_APPROVAL` | admin rejects | `REJECTED` | `rejectionReason`, email #5 with the reason and a WhatsApp CTA, `AuditLog` |
| `REJECTED` | admin reactivates | `PENDING_APPROVAL` | Reason cleared, `AuditLog` |
| `ACTIVE` | admin suspends | `SUSPENDED` | `suspendedUntil`, sessions revoked, `AuditLog` |
| `SUSPENDED` | admin reinstates / `suspendedUntil` passes | `ACTIVE` | `AuditLog` |

`PENDING_APPROVAL` users can log in, but middleware confines them to the waiting screen, their
profile, the public catalogue and the guest-scope AI assistant. The waiting screen polls its own
status, so it flips to the dashboard by itself the moment an administrator approves — no email round
trip, no manual refresh.

### 4.2 Enrollment request and bank-transfer verification

The operational heart of the business. The student's path:

```
student opens a locked course
        │
        ▼
[Demander l'accès]  ──▶ Modal step 1: Prix & conditions
        │                 · price (struck-through compare price if any)
        │                 · what's included (X modules, Y h de vidéo, ressources, certificat)
        │                 · coupon field (optional)
        │                 · transfer type radio:
        │                     ○ Virement instantané (recommandé) — activation le jour même
        │                     ○ Virement standard (48 h) — ⚠ activation à réception des fonds
        │                     ○ Paiement au centre (espèces) — if enabled in settings
        │                 · bank details block with copy buttons (RIB / IBAN / bénéficiaire)
        │                 · generated reference CFI-2026-000123 + "à indiquer dans le motif"
        ▼
Modal step 2: Justificatif de virement
        │   drag & drop / camera capture (mobile) upload box
        │   accepted: JPG, PNG, WEBP, PDF · max 5 MB · client-side compression
        │   preview with zoom, replace, remove
        │   declared transfer date (date picker, ≤ today, ≥ today-30d)
        │   optional bank reference + message to the admin
        │   checkbox: "Je confirme que le virement a bien été effectué"
        ▼
Modal step 3: Confirmation
        │   "Votre demande est en cours de traitement"
        │   reference, amount, submitted-at, expected review delay
        │   timeline widget (see below) + "Contacter sur WhatsApp" + "Voir mes demandes"
        ▼
EnrollmentRequest(status = UNDER_REVIEW)
        │
        ├──▶ email to student: "Demande reçue — en cours de vérification"
        └──▶ email to admins:  "Nouvelle demande de paiement à vérifier" (+ deep link)
```

The state machine:

| From | Event | To | Side effects |
|---|---|---|---|
| — | student submits step 2 | `UNDER_REVIEW` | Timeline event, 2 emails, admin notification, `expiresAt = now + 7d` |
| — | student saves without a receipt | `AWAITING_RECEIPT` | Reminder email at +24 h and +72 h |
| `UNDER_REVIEW` | admin asks for a better receipt | `INFO_REQUESTED` | Email with the admin's message; the student re-uploads → back to `UNDER_REVIEW` |
| `UNDER_REVIEW` / `INFO_REQUESTED` | admin approves | `APPROVED` | Create `Payment(receivedAt)`, create `Enrollment(ACTIVE)`, allocate the invoice number and generate the PDF, increment `Course.enrollmentCount` / `seatsTaken`, consume the coupon, email + notification, `AuditLog`, queue the AI welcome message |
| `UNDER_REVIEW` / `INFO_REQUESTED` | admin rejects | `REJECTED` | Email with the reason + WhatsApp CTA, `AuditLog` |
| `AWAITING_RECEIPT` / `INFO_REQUESTED` | `expiresAt` passes | `EXPIRED` | `expire-requests` cron, notification; the student may re-submit freely |
| any non-final | student cancels | `CANCELLED` | `AuditLog` |

**The nine hard rules, and where they live in the code:**

1. **One non-final request per course per student.** A partial unique index plus a service-level
   check; a second attempt returns the student to the existing request's status page rather than
   creating a duplicate.
2. **Approval is idempotent and transactional.** Request status, `Payment`, `Enrollment`, the invoice
   number and the counters commit together or not at all. `Enrollment(userId, courseId)` is unique and
   `Enrollment.requestId` is unique — those constraints are the safety net under the transaction, so a
   double-clicked *Activer* produces exactly one enrolment and one invoice. There is a dedicated
   double-submit test.
3. **`priceCentimes` is snapshotted at request creation.** A later price change never alters a pending
   request.
4. **The 48-hour notice appears verbatim** (spec §28.3 French copy) in the modal, on the confirmation
   screen, and in the "request received" email. It is a canonical string, not paraphrasable copy.
5. **Receipts are private.** The only path to one is an authenticated `ADMIN`+ request through
   `/api/files/...`, which verifies the role, writes an `AuditLog` entry, and returns a five-minute
   signed URL. A student may view their own receipt and no one else's.
6. **Duplicate detection.** `receiptSha256` is computed over the uploaded bytes. A collision flags the
   new request in the admin queue with a red « Justificatif déjà utilisé » badge linking to the
   original. It never auto-rejects — a family sharing one transfer is a legitimate case for a human.
7. **Uploads are re-encoded server-side.** sharp strips EXIF and GPS, caps the long edge at 2000 px,
   and converts to WebP. PDFs are stored as-is after magic-byte validation. The client's declared MIME
   type is never trusted.
8. **Free courses skip the flow entirely** — one click creates `Enrollment(source: FREE_COURSE)`.
9. **Admins can grant an enrolment** with no request (`ADMIN_GRANT`), requiring a reason and fully
   audited — this is how a student who paid cash at the reception desk gets access.

**The student-facing timeline** (`/espace/demandes` and inside the confirmation modal) has four
nodes — *Demande envoyée* → *Justificatif reçu* → *Vérification en cours* → *Accès activé* — with
timestamps read from `RequestEvent`, an animated connector, and the current node pulsing. On
`INFO_REQUESTED` node 3 turns amber and carries the administrator's message with an inline re-upload
box; on `REJECTED` it turns red with the reason and a WhatsApp CTA. Every state is paired with an
icon and a sentence, never colour alone.

---

## 5. Derived values

Some values are expensive to compute and are read on almost every page. They are **persisted and
recomputed inside the same transaction as the mutation that invalidates them** — never computed on
page load, and never left to a nightly job to eventually fix.

| Value | Owner | Recomputed when |
|---|---|---|
| `Course.durationMinutes` | `services/courses` | A lesson's duration changes; a lesson is added, removed or reordered |
| `Course.lessonCount` | `services/courses` | A lesson is added, removed or soft-deleted |
| `Course.ratingAvg`, `Course.ratingCount` | `services/community` | A review is approved, edited, unapproved or deleted |
| `Course.enrollmentCount`, `Course.seatsTaken` | `services/enrollment` | An enrolment is created (request approval, admin grant, free course) or revoked |
| `Enrollment.progressPercent`, `Enrollment.completedLessons` | `services/progress` | A lesson's completion state flips, in either direction |
| `Thread.replyCount`, `Thread.lastReplyAt` | `services/community` | A reply is posted, edited or deleted |

**Why in-transaction rather than eventually.** A student who finishes a lesson and sees their
progress ring unchanged concludes the platform lost their work. A seat counter that lags produces
oversold cohorts. Recomputing inside the transaction that caused the change means the value is never
observably wrong, and it makes the derived value a function of the same lock the mutation already
holds — no separate consistency mechanism.

Counters use a targeted recount (`groupBy` / `count` scoped to the affected parent), not a blind
`increment`, so a retried job or a manual database fix converges instead of drifting.

The nightly `recompute` cron is a **safety net, not the mechanism**: it recomputes every counter,
rating, streak (in `Africa/Casablanca`, so the day boundary is Moroccan midnight), leaderboard
snapshot and at-risk flag, and logs any value it had to correct. A non-empty correction log is a bug
report.

Streaks, XP totals and leaderboard positions are the exception to the in-transaction rule: they are
time-window aggregates with no single owning mutation, so they are snapshotted nightly and read from
the snapshot.

---

## 6. Caching

There is no Redis and there is no edge. Everything below runs inside the one Node process or in
MySQL.

| Surface | Strategy | Invalidation |
|---|---|---|
| Public catalogue, course detail, learning paths, blog, FAQ, legal pages | `revalidate: 60` plus cache tags (`course:<id>`, `catalog`, `category:<id>`) | `revalidateTag` on publish, unpublish, price change, translation save |
| Anything authenticated — dashboard, player, requests, admin | `no-store`, always | n/a — never cached |
| Expensive aggregates (homepage proof numbers, admin dashboard KPIs, rating distributions) | `unstable_cache` with explicit tags and a short TTL | Tag invalidation from the mutation that changes them |
| Static assets, fonts, `next/image` output | Immutable, content-hashed, long `max-age` | Filename hash |
| PWA service worker | App-shell precache; stale-while-revalidate for course metadata and images | Version bump on deploy |
| Per-course embedding matrices | In-process LRU, ~50 MB cap, `Float32Array` views over the stored `Bytes` | Dropped on re-index of that course |
| Recent AI query embeddings | In-process LRU, ~500 distinct queries | TTL only — a query embedding cannot go stale |
| Rate-limit buckets | In-process token bucket, `RateLimitEvent` rows for durability across restarts | Window expiry; `cleanup` cron prunes old rows |

**Two rules that come from the deployment shape.** First, every in-process cache must be *correct*
when empty and *bounded* when full — a restart is routine and memory is shared with the request path.
Second, no cache may be the only copy of anything: the process can be restarted at any moment by the
host.

**Database-level performance** is treated as part of caching strategy, because it is what makes the
`no-store` authenticated pages fast enough to not need a cache: no N+1 (deliberate `include`/`select`,
`groupBy` for counters), `select` only the columns a list actually renders, cursor pagination on long
tables, every foreign key and every list-sort column indexed, and a dev-only query-count assertion on
the five heaviest pages.

---

## 7. Recommendation ranking

Powers *Continuer à apprendre* on the student dashboard — three courses, chosen by explicit rules.
**No model, no collaborative filtering, no opaque score.** With a single institution's catalogue,
rule-based ranking is more accurate than anything learned, and — more importantly — an administrator
can be told exactly why a course was recommended.

**Candidate set.** All `PUBLISHED` courses, minus: courses the student is enrolled in (any status),
courses with a non-final `EnrollmentRequest`, courses whose prerequisites the student has not met,
and courses with no seats left.

**Score.** Additive, computed over the candidate set:

| Signal | Weight | Rationale |
|---|---|---|
| Same category as a course the student **completed** | +50 | The strongest available signal of demonstrated interest |
| Same category as a course the student is **in progress** on | +30 | Interested, but not yet proven |
| Named as a follow-on of a completed course (`Course.nextCourseIds`) | +45 | The centre's own curriculum design beats any inference |
| Belongs to a `Path` the student has started | +40 | They already committed to the sequence |
| All prerequisites satisfied *and* the course has prerequisites | +15 | Rewards a course the student is specifically ready for, over one anybody could take |
| Same `contentLocale` as `User.locale` | +12 | A course in a language they read comfortably |
| Popularity — `enrollmentCount` percentile within its category | +0 … +10 | Tiebreak, capped so it cannot dominate |
| Rating — `ratingAvg` scaled, only when `ratingCount ≥ 5` | +0 … +8 | Ignored below five ratings: three five-star reviews are noise |
| Published or substantially updated in the last 60 days | +6 | Freshness nudge |
| Featured by an administrator | +20 | The centre must be able to put its thumb on the scale |
| Same category as a course the student **rejected** (dismissed a recommendation) | −40 | An explicit "not this" is respected |

Ties break on `enrollmentCount` descending, then `createdAt` descending, for a stable order across
renders.

**Diversity.** At most two of the three slots may share a category, so the panel never becomes three
variations of one thing.

**Cold start** — a brand-new active student with no completions and no progress: the dashboard shows
the onboarding checklist instead, plus the catalogue highlights (featured courses, then best-rated
with `ratingCount ≥ 5`, then newest). No fabricated personalisation.

**Cost.** The candidate set for one institution is small enough to score in a single query plus an
in-process sort. The result is cached per student for the length of the request only — recommendations
must reflect an enrolment that happened thirty seconds ago.

**Auditability.** Every recommendation stores the signals that produced it, so the admin AI/analytics
console can answer "why was this shown" with a list of weights rather than a shrug.
