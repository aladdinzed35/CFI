# Configuration values

Required by spec §3. These are the values that make the platform *this* centre's platform rather
than a generic one.

> **Every key below lives in the `SiteSetting` table and is editable from `/admin/reglages`.**
> None of them is ever hardcoded in a component, a constant file, or a translation message. A
> component that needs the WhatsApp number reads it from a service that reads `SiteSetting`; changing
> the number is an administrator's action, not a deployment.
>
> The defaults exist so nothing blocks during development. The `⚠️` rows are the owner's to-fill
> list — see §2 for the checklist.

**Configuration values are not environment variables.** Env vars (`docs/DEPLOYMENT.md`, §6 of the
spec) are infrastructure: database URL, SMTP credentials, API keys, secrets. Configuration values are
business content: the bank details, the WhatsApp number, the taglines. Infrastructure changes when the
hosting changes; business content changes when the owner decides something. Keeping them in different
places is what lets a non-technical administrator change the bank details safely.

---

## 1. The table

| Key | Default / placeholder | Notes |
|---|---|---|
| `brand.name` | CFI | Legal + display name |
| `brand.fullName` | Centre de Formation Immersive | Used in emails, certificates, footer |
| `brand.tagline.fr` | « La formation qui vous met en situation » | ⚠️ owner to confirm |
| `brand.tagline.ar` | «التكوين الذي يضعك في قلب الميدان» | ⚠️ |
| `brand.tagline.en` | — | Translated from the confirmed French |
| `brand.tagline.es` | — | Translated from the confirmed French |
| `contact.whatsapp` | `+212600000000` | ⚠️ **required** — drives every WhatsApp CTA |
| `contact.whatsappSecondary` | — | optional, for a second agent |
| `contact.phone` | ⚠️ | |
| `contact.email` | contact@cfi.ma | ⚠️ |
| `contact.address` | ⚠️ Meknès, Maroc | Shown on contact page + Google Maps embed |
| `contact.hours` | Lun–Sam · 09h00–19h00 | |
| `bank.holder` | ⚠️ | Beneficiary name shown in the transfer modal |
| `bank.name` | ⚠️ | |
| `bank.rib` | ⚠️ | 24-digit Moroccan RIB |
| `bank.iban` | ⚠️ | |
| `bank.swift` | ⚠️ | |
| `payment.instantNoticeHours` | 48 | Notice text for standard transfers |
| `payment.requestExpiryDays` | 7 | Unpaid/unverified request auto-expires |
| `locales` | `["fr","ar","en","es"]` | `fr` is default and fallback |
| `currency` | MAD | |
| `ai.assistantName` | Nour | Configurable; see §16 |
| `ai.enabled` | true | Kill switch |
| `social.*` | ⚠️ | Facebook / Instagram / LinkedIn / TikTok / YouTube |
| `seo.domain` | ⚠️ `https://cfi.ma` | |

### Deviation from the spec

`locales` is `["fr","ar","en","es"]` rather than the spec's `["fr","ar"]`. The owner requires four
locales. `fr` remains the default, the fallback, and the source language for all copy; `ar` remains
the only RTL locale. The `brand.tagline.en` and `brand.tagline.es` rows are added for the same
reason. Full reasoning and every consequence: `docs/PLAN.md` §4 and
`docs/DECISIONS.md` (« Four locales instead of the spec's two »).

The `locales` setting controls which locales are *offered* — a locale can be present in the codebase
and switched off in `/admin/reglages → Localisation` while its translation is still incomplete, which
is the intended launch posture for `en` and `es` if their copy is not ready.

### Seeded state

`prisma/seed.ts` writes every row above with the defaults shown. The bank details are seeded as
`RIB: 000 000 0000000000000000 00 — À REMPLACER`, deliberately unmistakable, so a placeholder can
never be mistaken for real bank coordinates in a demo or on a staging site.

---

## 2. The owner's to-fill list

Every `⚠️` row from the table above, as a checklist. These block **launch**, not development.

**Contact**
- [ ] `contact.whatsapp` — the primary WhatsApp number, `+212…`. Nothing else in this list matters as
      much: it is the CTA on every public page, in every rejection email, and at the end of every
      path the AI assistant cannot answer.
- [ ] `contact.whatsappSecondary` — optional second agent
- [ ] `contact.phone`
- [ ] `contact.email`
- [ ] `contact.address` — as it should appear on the contact page and in the map embed
- [ ] `social.facebook` / `social.instagram` / `social.linkedin` / `social.tiktok` / `social.youtube`

**Bank details** — shown in the transfer modal with copy buttons, and on every invoice
- [ ] `bank.holder` — exactly as the bank prints the beneficiary name
- [ ] `bank.name`
- [ ] `bank.rib` — 24 digits
- [ ] `bank.iban`
- [ ] `bank.swift`

**Brand**
- [ ] `brand.tagline.fr` — confirm the default or replace it
- [ ] `brand.tagline.ar` — confirm the default or replace it
- [ ] Logo files (light and dark), favicon source, OG fallback image

**SEO**
- [ ] `seo.domain` — the final canonical origin, `https://…`, no trailing slash. This must match
      `APP_URL` and `NEXT_PUBLIC_APP_URL` in the environment, or canonical URLs and `hreflang`
      alternates will point at the wrong host.

Not in the §3 table but equally blocking, and collected in the same pass — see `docs/PLAN.md` §6:
the legal identity for invoices (raison sociale, ICE, RC, IF), the real course list with prices, and
the third-party accounts (Anthropic, Voyage, Bunny, Cloudflare R2, Hostinger with Node Web Apps and
MySQL).

---

## 3. Where these are edited

`/admin/reglages`, in grouped tabs. Every write is audited. Secrets are masked with a
reveal-on-click available to `SUPER_ADMIN` only.

| Tab | What it holds |
|---|---|
| `Identité` | Brand name, legal name, taglines per locale, logos light/dark, favicon, OG image, and colour choices limited to the token set |
| `Contact` | WhatsApp primary and secondary with a live `wa.me` test link, phone, email, address, map coordinates, hours, socials |
| **`Coordonnées bancaires`** | Holder, bank, RIB, IBAN, SWIFT, plus the exact instruction text shown in the request modal per locale — with a live preview of the modal as the student will see it |
| `Paiements` | Enabled transfer types, the standard-transfer notice text, request expiry days, instalments, invoice legal footer, ICE/RC/IF, invoice number prefix |
| `Inscriptions` | Open/closed, the require-admin-approval toggle (default on), the expected validation delay text, the disposable-domain blocklist |
| `E-mails` | SMTP config with a *Envoyer un e-mail de test* button, sender identity, admin recipients, per-template enable/disable and subject overrides, throttle |
| `Stockage` | Driver, bucket, public base URL, and a *Tester* button that round-trips a file |
| `Vidéo` | Provider, keys, signed-URL TTL, and a *Tester la lecture* button |
| `Localisation` | Enabled locales, default locale, numeral style (Western by default in `ar`), timezone, currency |
| `Certificats` | Template fields, signature image, seal, serial prefix, whether completion requires the final quiz |
| `Gamification` | XP values per action, badge criteria, leaderboard on/off |
| `Sécurité` | Session duration, 2FA required for admins, max login attempts, lockout duration, IP allow-list for `/admin`, password policy |
| `Fonctionnalités` | Feature flags: blog, parcours, live sessions, flashcards, leaderboard, referral, reviews, AI surfaces |
| `Maintenance` | Maintenance mode with a custom message and an admin bypass, cache purge, reindex all, *Exporter la base* |

Three of these tabs write values that appear on legal or financial documents — `Coordonnées
bancaires`, `Paiements` (ICE/RC/IF and the invoice footer) and `Identité` (the legal name). Those are
`SUPER_ADMIN`-only, every change is audited with a before/after diff, and the bank tab shows a live
preview of the transfer modal so a typo in a RIB is visible in the shape a student will actually read.
