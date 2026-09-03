/**
 * CFI — database seed (spec §23).
 *
 * Idempotent by construction: every row is upserted on its natural key
 * (`SiteSetting.key`, `Category.slug`, `User.email`, `Badge.code`, `Page.slug`,
 * `FeatureFlag.key`, and a stable hand-written `id` for the CMS rows that have
 * no other unique column). Running it twice changes nothing but `updatedAt`.
 *
 * Scope — milestones **M0** and **M2**. M0 seeds the data the rest of the build
 * depends on from day one: configuration, categories, the demo accounts, the
 * gamification catalogue and the public CMS content. M2 adds the catalogue
 * itself — courses, modules, lessons, parcours and moderated reviews — from
 * `prisma/seed/catalog.ts`. The payment requests, the learning activity, the
 * assessments and the AI corpus belong to later milestones; each has an honest
 * no-op function below that names its milestone, because an empty group is a
 * true statement about the build and a placeholder row is not.
 *
 * Usage
 *   npm run db:seed              # upsert everything
 *   npx tsx prisma/seed.ts --reset   # wipe first (refuses in production)
 *   npx tsx prisma/seed.ts --help
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { hash } from '@node-rs/argon2';
import { AccountStatus, Locale, type Prisma, PrismaClient, Role } from '@prisma/client';

import { parsePhone } from '../src/lib/phone';

import { seedCatalog } from './seed/catalog';
import { seedRequests } from './seed/requests';

// ═══════════════════════════════════════════════════════════════════════════
// Environment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `tsx prisma/seed.ts` is a bare Node process — unlike `next dev` and unlike
 * `prisma db seed`, nothing has read `.env` for us. Node 22 exposes
 * `process.loadEnvFile`, so we do it ourselves, `.env` first and `.env.local`
 * last so a developer's local override wins.
 */
function loadEnvFiles(): void {
  if (typeof process.loadEnvFile !== 'function') return;
  for (const file of ['.env', '.env.local']) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    try {
      process.loadEnvFile(path);
    } catch {
      // A malformed or unreadable dotenv file must not abort the seed: the
      // variables may already come from the real environment.
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════

interface CliOptions {
  readonly reset: boolean;
  readonly help: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  return {
    reset: argv.includes('--reset'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

const HELP_TEXT = `
CFI — seed (spec §23)

  npx tsx prisma/seed.ts [options]

Options
  --reset      Empty every table in foreign-key-safe order before seeding.
               Refuses to run when NODE_ENV=production.
  --help, -h   Show this message.

Reads DATABASE_URL from the environment, or from .env / .env.local.
`.trim();

// ═══════════════════════════════════════════════════════════════════════════
// Reporting
// ═══════════════════════════════════════════════════════════════════════════

interface GroupResult {
  readonly label: string;
  readonly created: number;
  readonly updated: number;
  /** Rows left untouched on purpose — operator-owned configuration. */
  readonly preserved: number;
  /** Set when the group is intentionally empty until a later milestone. */
  readonly deferredTo?: string;
}

class Tally {
  created = 0;
  updated = 0;
  preserved = 0;

  /** Record one upsert whose row either existed (`true`) or did not. */
  record(existed: boolean): void {
    if (existed) this.updated += 1;
    else this.created += 1;
  }

  toResult(label: string): GroupResult {
    return {
      label,
      created: this.created,
      updated: this.updated,
      preserved: this.preserved,
    };
  }
}

function deferred(label: string, milestone: string): GroupResult {
  return { label, created: 0, updated: 0, preserved: 0, deferredTo: milestone };
}

const log = {
  title(text: string): void {
    console.log(`\n${text}`);
  },
  step(text: string): void {
    console.log(`  · ${text}`);
  },
  done(result: GroupResult): void {
    if (result.deferredTo !== undefined) {
      console.log(`  ⏭  ${result.label} — reporté au jalon ${result.deferredTo}`);
      return;
    }
    console.log(
      `  ✓ ${result.label} — ${result.created} créé(s), ${result.updated} mis à jour` +
        (result.preserved > 0 ? `, ${result.preserved} préservé(s)` : ''),
    );
  },
  warn(text: string): void {
    console.log(`  ! ${text}`);
  },
};

/** Pad to a visual width; used by the summary and credentials tables. */
function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

// ═══════════════════════════════════════════════════════════════════════════
// Dates — one reference instant so a run is internally consistent
// ═══════════════════════════════════════════════════════════════════════════

const NOW = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function daysAhead(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS);
}

// ═══════════════════════════════════════════════════════════════════════════
// Passwords
// ═══════════════════════════════════════════════════════════════════════════

/**
 * §20: argon2id with `memoryCost` ≥ 19 MiB, `timeCost` 2, `parallelism` 1.
 *
 * `algorithm` is left at the library default, which *is* Argon2id: the
 * `Algorithm` enum in `@node-rs/argon2` is an ambient `const enum` and
 * `isolatedModules` forbids reading one at runtime. {@link hashPassword}
 * asserts the produced digest actually starts with `$argon2id$`, so a change of
 * default in the dependency would fail the seed instead of silently downgrading
 * every demo account to Argon2i.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} satisfies Parameters<typeof hash>[1];

async function hashPassword(plain: string): Promise<string> {
  const digest = await hash(plain, ARGON2_OPTIONS);
  if (!digest.startsWith('$argon2id$')) {
    throw new Error(
      `@node-rs/argon2 produced a non-argon2id digest (${digest.slice(0, 12)}…). ` +
        'Spec §4 and §20 require argon2id — refusing to seed weaker hashes.',
    );
  }
  return digest;
}

// ═══════════════════════════════════════════════════════════════════════════
// § 3 — SiteSetting defaults
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The placeholder RIB required verbatim by §23. Rendered in the transfer modal
 * as `RIB: 000 000 0000000000000000 00 — À REMPLACER`, which is impossible to
 * mistake for a real account and impossible to pay into by accident.
 */
const PLACEHOLDER_RIB = '000 000 0000000000000000 00 — À REMPLACER';
const PLACEHOLDER_IBAN = 'MA00 0000 0000 0000 0000 0000 0000 — À REMPLACER';
const PLACEHOLDER_SWIFT = 'XXXXMAMX — À REMPLACER';

interface SeedSetting {
  readonly key: string;
  readonly value: Prisma.InputJsonValue;
  readonly group: string;
  readonly isSecret?: boolean;
}

const SITE_SETTINGS: readonly SeedSetting[] = [
  // ── Identité ────────────────────────────────────────────────────────────
  { key: 'brand.name', value: 'CFI', group: 'brand' },
  { key: 'brand.fullName', value: 'Centre de Formation Immersive', group: 'brand' },
  {
    key: 'brand.tagline.fr',
    value: '« La formation qui vous met en situation »',
    group: 'brand',
  },
  {
    key: 'brand.tagline.ar',
    value: '«التكوين الذي يضعك في قلب الميدان»',
    group: 'brand',
  },
  {
    key: 'brand.tagline.en',
    value: '“Training that puts you in the real situation”',
    group: 'brand',
  },
  {
    key: 'brand.tagline.es',
    value: '«La formación que te pone en situación»',
    group: 'brand',
  },

  // ── Contact ─────────────────────────────────────────────────────────────
  { key: 'contact.whatsapp', value: '+212600000000', group: 'contact' },
  { key: 'contact.whatsappSecondary', value: '', group: 'contact' },
  { key: 'contact.phone', value: '+212600000000', group: 'contact' },
  { key: 'contact.email', value: 'contact@cfi.ma', group: 'contact' },
  { key: 'contact.address', value: 'Meknès, Maroc — À COMPLÉTER', group: 'contact' },
  { key: 'contact.hours', value: 'Lun–Sam · 09h00–19h00', group: 'contact' },

  // ── Coordonnées bancaires (§17.12) ──────────────────────────────────────
  { key: 'bank.holder', value: 'Centre de Formation Immersive — À REMPLACER', group: 'bank' },
  { key: 'bank.name', value: 'À REMPLACER', group: 'bank' },
  { key: 'bank.rib', value: PLACEHOLDER_RIB, group: 'bank' },
  { key: 'bank.iban', value: PLACEHOLDER_IBAN, group: 'bank' },
  { key: 'bank.swift', value: PLACEHOLDER_SWIFT, group: 'bank' },

  // ── Paiements ───────────────────────────────────────────────────────────
  { key: 'payment.instantNoticeHours', value: 48, group: 'payment' },
  { key: 'payment.requestExpiryDays', value: 7, group: 'payment' },

  // ── Localisation ────────────────────────────────────────────────────────
  { key: 'locales', value: ['fr', 'ar', 'en', 'es'], group: 'localization' },
  { key: 'currency', value: 'MAD', group: 'localization' },

  // ── Assistant IA (§16) ──────────────────────────────────────────────────
  { key: 'ai.assistantName', value: 'Nour', group: 'ai' },
  { key: 'ai.enabled', value: true, group: 'ai' },

  // ── Réseaux sociaux ─────────────────────────────────────────────────────
  { key: 'social.facebook', value: '', group: 'social' },
  { key: 'social.instagram', value: '', group: 'social' },
  { key: 'social.linkedin', value: '', group: 'social' },
  { key: 'social.tiktok', value: '', group: 'social' },
  { key: 'social.youtube', value: '', group: 'social' },

  // ── SEO ─────────────────────────────────────────────────────────────────
  { key: 'seo.domain', value: 'https://cfi.ma', group: 'seo' },
];

async function seedSiteSettings(tx: Prisma.TransactionClient): Promise<GroupResult> {
  const tally = new Tally();
  const existing = new Set(
    (await tx.siteSetting.findMany({ select: { key: true } })).map((row) => row.key),
  );

  for (const setting of SITE_SETTINGS) {
    const isSecret = setting.isSecret ?? false;
    const alreadyThere = existing.has(setting.key);

    await tx.siteSetting.upsert({
      where: { key: setting.key },
      create: {
        key: setting.key,
        value: setting.value,
        group: setting.group,
        isSecret,
      },
      // A row that already exists holds the owner's real configuration — the
      // bank details above all. Re-seeding refreshes the grouping metadata and
      // never overwrites `value`, so a second `npm run db:seed` can never put
      // the placeholder RIB back over a real one.
      update: { group: setting.group, isSecret },
    });

    if (alreadyThere) tally.preserved += 1;
    else tally.created += 1;
  }

  return tally.toResult('Réglages du site');
}

// ═══════════════════════════════════════════════════════════════════════════
// Feature flags (§17.12 « Fonctionnalités »)
// ═══════════════════════════════════════════════════════════════════════════

interface SeedFlag {
  readonly key: string;
  readonly isEnabled: boolean;
  readonly rollout: number;
  readonly note: string;
}

const FEATURE_FLAGS: readonly SeedFlag[] = [
  {
    key: 'feature.reviews',
    isEnabled: true,
    rollout: 100,
    note: 'Avis étudiants sur les formations, modérés avant publication (§12.4).',
  },
  {
    key: 'feature.aiAssistant',
    isEnabled: false,
    rollout: 100,
    note: "Surfaces de l'assistant Nour (§16) — livrées au jalon M7. Le coupe-circuit métier reste le réglage ai.enabled.",
  },
  {
    key: 'feature.paths',
    isEnabled: false,
    rollout: 100,
    note: 'Parcours multi-formations /parcours (§12.5) — activer quand un parcours est publié.',
  },
  {
    key: 'feature.blog',
    isEnabled: false,
    rollout: 100,
    note: 'Blog SEO /blog (§12.5) — activer quand le premier article est publié.',
  },
  {
    key: 'feature.liveSessions',
    isEnabled: false,
    rollout: 100,
    note: 'Sessions live et présentiel avec pointage QR (§13.4, M8).',
  },
  {
    key: 'feature.flashcards',
    isEnabled: false,
    rollout: 100,
    note: 'Flashcards et répétition espacée (§16.7, M8).',
  },
  {
    key: 'feature.leaderboard',
    isEnabled: false,
    rollout: 100,
    note: 'Classement public — opt-in par étudiant (§13.5, M8).',
  },
  {
    key: 'feature.referral',
    isEnabled: false,
    rollout: 100,
    note: 'Programme de parrainage par referralCode (M8).',
  },
];

async function seedFeatureFlags(tx: Prisma.TransactionClient): Promise<GroupResult> {
  const tally = new Tally();
  const existing = new Set(
    (await tx.featureFlag.findMany({ select: { key: true } })).map((row) => row.key),
  );

  for (const flag of FEATURE_FLAGS) {
    const alreadyThere = existing.has(flag.key);

    await tx.featureFlag.upsert({
      where: { key: flag.key },
      create: {
        key: flag.key,
        isEnabled: flag.isEnabled,
        rollout: flag.rollout,
        note: flag.note,
      },
      // `isEnabled` / `rollout` are operator state: an admin who turned a
      // feature on must not see it turned off by the next deployment's seed.
      // Only the explanatory note is refreshed.
      update: { note: flag.note },
    });

    if (alreadyThere) tally.preserved += 1;
    else tally.created += 1;
  }

  return tally.toResult('Feature flags');
}

// ═══════════════════════════════════════════════════════════════════════════
// Categories (§23) — six, translated into all four locales
// ═══════════════════════════════════════════════════════════════════════════

type LocalizedText = Readonly<Record<Locale, string>>;

interface SeedCategory {
  readonly slug: string;
  /** lucide-react icon name. */
  readonly icon: string;
  /** Design-token name from `globals.css` — never a raw hex (§11). */
  readonly color: string;
  readonly order: number;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
}

const CATEGORIES: readonly SeedCategory[] = [
  {
    slug: 'marketing-digital',
    icon: 'Megaphone',
    color: 'strait',
    order: 1,
    name: {
      fr: 'Marketing Digital',
      ar: 'التسويق الرقمي',
      en: 'Digital Marketing',
      es: 'Marketing Digital',
    },
    description: {
      fr: "Acquisition, réseaux sociaux, publicité en ligne et analytics — de la stratégie jusqu'à la campagne qui tourne vraiment.",
      ar: 'الاستقطاب، الشبكات الاجتماعية، الإعلانات الرقمية والتحليلات — من الاستراتيجية إلى حملة تشتغل فعلاً.',
      en: 'Acquisition, social media, online advertising and analytics — from strategy to a campaign that actually runs.',
      es: 'Captación, redes sociales, publicidad en línea y analítica — de la estrategia a la campaña que funciona de verdad.',
    },
  },
  {
    slug: 'developpement-web',
    icon: 'Code2',
    color: 'deep',
    order: 2,
    name: {
      fr: 'Développement Web',
      ar: 'تطوير الويب',
      en: 'Web Development',
      es: 'Desarrollo Web',
    },
    description: {
      fr: 'HTML, CSS, JavaScript, frameworks modernes et bases de données : construire de vraies applications et les mettre en ligne.',
      ar: 'HTML وCSS وJavaScript والأطر الحديثة وقواعد البيانات: بناء تطبيقات حقيقية ونشرها على الإنترنت.',
      en: 'HTML, CSS, JavaScript, modern frameworks and databases: build real applications and ship them.',
      es: 'HTML, CSS, JavaScript, frameworks modernos y bases de datos: crear aplicaciones reales y publicarlas.',
    },
  },
  {
    slug: 'design-creation',
    icon: 'Palette',
    color: 'warn',
    order: 3,
    name: {
      fr: 'Design & Création',
      ar: 'التصميم والإبداع',
      en: 'Design & Creation',
      es: 'Diseño y Creación',
    },
    description: {
      fr: "Identité visuelle, UI/UX, retouche photo et montage vidéo — les outils du métier et le regard qui va avec.",
      ar: 'الهوية البصرية، تجربة وواجهة المستخدم، معالجة الصور والمونتاج — أدوات المهنة والذوق الذي يرافقها.',
      en: "Brand identity, UI/UX, photo retouching and video editing — the craft's tools and the eye that goes with them.",
      es: 'Identidad visual, UI/UX, retoque fotográfico y edición de vídeo — las herramientas del oficio y la mirada que las acompaña.',
    },
  },
  {
    slug: 'langues',
    icon: 'Languages',
    color: 'success',
    order: 4,
    name: {
      fr: 'Langues',
      ar: 'اللغات',
      en: 'Languages',
      es: 'Idiomas',
    },
    description: {
      fr: "Français, anglais et espagnol professionnels : l'oral d'abord, à travers des mises en situation réelles.",
      ar: 'الفرنسية والإنجليزية والإسبانية المهنية: الشفوي أولاً، عبر وضعيات واقعية.',
      en: 'Professional French, English and Spanish: speaking first, through real-world scenarios.',
      es: 'Francés, inglés y español profesionales: primero la expresión oral, con situaciones reales.',
    },
  },
  {
    slug: 'gestion-entrepreneuriat',
    icon: 'Briefcase',
    color: 'deep',
    order: 5,
    name: {
      fr: 'Gestion & Entrepreneuriat',
      ar: 'التدبير وريادة الأعمال',
      en: 'Management & Entrepreneurship',
      es: 'Gestión y Emprendimiento',
    },
    description: {
      fr: "Comptabilité, gestion d'équipe, business plan et création d'entreprise dans le contexte marocain.",
      ar: 'المحاسبة، تدبير الفريق، خطة العمل وإحداث المقاولة في السياق المغربي.',
      en: 'Accounting, team management, business planning and company formation in the Moroccan context.',
      es: 'Contabilidad, gestión de equipos, plan de negocio y creación de empresa en el contexto marroquí.',
    },
  },
  {
    slug: 'bureautique-ia',
    icon: 'Sparkles',
    color: 'strait',
    order: 6,
    name: {
      fr: 'Bureautique & IA',
      ar: 'المكتبيات والذكاء الاصطناعي',
      en: 'Office Tools & AI',
      es: 'Ofimática e IA',
    },
    description: {
      fr: 'Word, Excel, PowerPoint et les assistants IA : reprendre des heures sur le travail quotidien.',
      ar: 'Word وExcel وPowerPoint ومساعدو الذكاء الاصطناعي: ربح ساعات من العمل اليومي.',
      en: 'Word, Excel, PowerPoint and AI assistants: win hours back on everyday work.',
      es: 'Word, Excel, PowerPoint y asistentes de IA: recuperar horas de trabajo diario.',
    },
  },
];

const ALL_LOCALES: readonly Locale[] = [Locale.fr, Locale.ar, Locale.en, Locale.es];

async function seedCategories(tx: Prisma.TransactionClient): Promise<GroupResult> {
  const tally = new Tally();
  const existing = new Set(
    (await tx.category.findMany({ select: { slug: true } })).map((row) => row.slug),
  );

  for (const category of CATEGORIES) {
    const alreadyThere = existing.has(category.slug);

    const row = await tx.category.upsert({
      where: { slug: category.slug },
      create: {
        slug: category.slug,
        icon: category.icon,
        color: category.color,
        order: category.order,
        isActive: true,
      },
      update: {
        icon: category.icon,
        color: category.color,
        order: category.order,
        isActive: true,
      },
      select: { id: true },
    });

    for (const locale of ALL_LOCALES) {
      await tx.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: row.id, locale } },
        create: {
          categoryId: row.id,
          locale,
          name: category.name[locale],
          description: category.description[locale],
        },
        update: {
          name: category.name[locale],
          description: category.description[locale],
        },
      });
    }

    tally.record(alreadyThere);
  }

  return tally.toResult('Catégories (× 4 locales)');
}

// ═══════════════════════════════════════════════════════════════════════════
// People (§23) — 1 SUPER_ADMIN, 1 ADMIN, 2 INSTRUCTOR, 12 students
// ═══════════════════════════════════════════════════════════════════════════

interface SeedUser {
  readonly fullName: string;
  readonly email: string;
  /** Typed the way a Moroccan student types it; normalised through parsePhone. */
  readonly phone: string;
  /** Demo password, printed in the credentials table at the end of the run. */
  readonly password: string;
  readonly role: Role;
  readonly status: AccountStatus;
  readonly locale: Locale;
  readonly city: string;
  readonly referralCode: string;
  readonly createdDaysAgo: number;
  readonly professionalStatus?: string;
  readonly headline?: string;
  readonly bio?: string;
  /** ISO `yyyy-mm-dd`. */
  readonly birthDate?: string;
  readonly rejectionReason?: string;
  readonly suspendedForDays?: number;
  readonly internalNote?: string;
  readonly tags?: string;
  readonly weeklyGoalMinutes?: number;
  readonly leaderboardOptIn?: boolean;
}

/** The account that approves the students, referenced as `approvedById`. */
const APPROVER_EMAIL = 'gestion@cfi.ma';

const STAFF: readonly SeedUser[] = [
  {
    fullName: 'Youssef El Amrani',
    email: 'admin@cfi.ma',
    phone: '06 61 00 00 01',
    password: 'Cfi!SuperAdmin2026',
    role: Role.SUPER_ADMIN,
    status: AccountStatus.ACTIVE,
    locale: Locale.fr,
    city: 'Meknès',
    referralCode: 'CFIYOUSSEF',
    createdDaysAgo: 240,
    professionalStatus: 'Directeur du centre',
    headline: 'Directeur — Centre de Formation Immersive',
    bio: "Fondateur du centre. Vingt ans de formation professionnelle à Meknès, dont douze passées à monter des dispositifs en alternance avec les entreprises agroalimentaires et les coopératives de la région.",
    birthDate: '1978-04-12',
    tags: 'direction,fondateur',
  },
  {
    fullName: 'Salma Bennani',
    email: APPROVER_EMAIL,
    phone: '06 61 00 00 02',
    password: 'Cfi!Gestion2026',
    role: Role.ADMIN,
    status: AccountStatus.ACTIVE,
    locale: Locale.fr,
    city: 'Meknès',
    referralCode: 'CFISALMA01',
    createdDaysAgo: 210,
    professionalStatus: 'Responsable pédagogique et administrative',
    headline: 'Responsable pédagogique',
    bio: "Suit les inscriptions de bout en bout : validation des comptes, vérification des virements, accompagnement des étudiants jusqu'au certificat.",
    birthDate: '1989-09-30',
    tags: 'administration,inscriptions',
  },
  {
    fullName: 'Karim Tazi',
    email: 'karim.tazi@cfi.ma',
    phone: '06 61 00 00 10',
    password: 'Cfi!Formateur2026',
    role: Role.INSTRUCTOR,
    status: AccountStatus.ACTIVE,
    locale: Locale.fr,
    city: 'Casablanca',
    referralCode: 'CFIKARIM01',
    createdDaysAgo: 180,
    professionalStatus: 'Consultant en acquisition digitale',
    headline: 'Formateur Marketing Digital & Acquisition',
    bio: "Consultant acquisition depuis 2013. A piloté les campagnes de plusieurs e-commerçants marocains ; enseigne le marketing digital comme il le pratique, tableur et compte publicitaire ouverts.",
    birthDate: '1987-02-18',
    tags: 'formateur,marketing',
  },
  {
    fullName: 'Nadia Ouazzani',
    email: 'nadia.ouazzani@cfi.ma',
    phone: '06 61 00 00 11',
    password: 'Cfi!Formateur2026',
    role: Role.INSTRUCTOR,
    status: AccountStatus.ACTIVE,
    locale: Locale.fr,
    city: 'Rabat',
    referralCode: 'CFINADIA01',
    createdDaysAgo: 175,
    professionalStatus: 'Développeuse full-stack',
    headline: 'Formatrice Développement Web',
    bio: "Développeuse full-stack JavaScript et formatrice. Convaincue qu'on apprend à coder en livrant : chaque module se termine par une application déployée et défendue devant le groupe.",
    birthDate: '1991-11-05',
    tags: 'formateur,developpement',
  },
];

const STUDENT_PASSWORD = 'Cfi!Etudiant2026';

const STUDENTS: readonly SeedUser[] = [
  // ── 6 × ACTIVE ──────────────────────────────────────────────────────────
  {
    fullName: 'Imane Chraibi',
    email: 'imane.chraibi@gmail.com',
    phone: '06 12 44 08 71',
    password: STUDENT_PASSWORD,
    role: Role.STUDENT,
    status: AccountStatus.ACTIVE,
    locale: Locale.fr,
    city: 'Meknès',
    referralCode: 'IMANE2601',
    createdDaysAgo: 96,
    professionalStatus: 'Salariée',
    birthDate: '1996-06-21',
    weeklyGoalMinutes: 240,
  },
  {
    fullName: 'Mehdi Berrada',
    email: 'mehdi.berrada@gmail.com',
    phone: '0655 31 09 24',
    password: STUDENT_PASSWORD,
    role: Role.STUDENT,
    status: AccountStatus.ACTIVE,
    locale: Locale.fr,
    city: 'Casablanca',
    referralCode: 'MEHDI2602',
    createdDaysAgo: 88,
    professionalStatus: 'Étudiant',
    birthDate: '2002-01-14',
  },
  {
    fullName: 'Sara El Fassi',
    email: 'sara.elfassi@outlook.com',
    phone: '+212 6 70 55 12 88',
    password: STUDENT_PASSWORD,
    role: Role.STUDENT,
    status: AccountStatus.ACTIVE,
    locale: Locale.ar,
    city: 'Rabat',
    referralCode: 'SARA2603',
    createdDaysAgo: 74,
    professionalStatus: 'Salariée',
    birthDate: '1994-03-09',
    weeklyGoalMinutes: 120,
  },
  {
    fullName: 'Anas Idrissi',
    email: 'anas.idrissi@gmail.com',
    phone: '07 62 18 40 33',
    password: STUDENT_PASSWORD,
    role: Role.STUDENT,
    status: AccountStatus.ACTIVE,
    locale: Locale.es,
    city: 'Fès',
    referralCode: 'ANAS2604',
    createdDaysAgo: 61,
    professionalStatus: 'Auto-entrepreneur',
    birthDate: '1993-08-27',
  },
  {
    fullName: 'Hajar Naciri',
    email: 'hajar.naciri@gmail.com',
    phone: '06.13.77.02.45',
    password: STUDENT_PASSWORD,
    role: Role.STUDENT,
    status: AccountStatus.ACTIVE,
    locale: Locale.ar,
    city: 'Meknès',
    referralCode: 'HAJAR2605',
    createdDaysAgo: 47,
    professionalStatus: "En recherche d'emploi",
    birthDate: '1999-12-02',
    weeklyGoalMinutes: 300,
  },
  {
    fullName: 'Othmane Sbai',
    email: 'othmane.sbai@gmail.com',
    phone: '0668-90-14-27',
    password: STUDENT_PASSWORD,
    role: Role.STUDENT,
    status: AccountStatus.ACTIVE,
    locale: Locale.fr,
    city: 'Fès',
    referralCode: 'OTHMANE2606',
    createdDaysAgo: 33,
    professionalStatus: 'Salarié',
    birthDate: '1990-05-16',
    leaderboardOptIn: false,
  },

  // ── 3 × PENDING_APPROVAL — la file de validation (§17.2) ────────────────
  {
    fullName: 'Yasmine Kadiri',
    email: 'yasmine.kadiri@gmail.com',
    phone: '06 45 22 71 09',
    password: STUDENT_PASSWORD,
    role: Role.STUDENT,
    status: AccountStatus.PENDING_APPROVAL,
    locale: Locale.en,
    city: 'Marrakech',
    referralCode: 'YASMINE2607',
    createdDaysAgo: 3,
    professionalStatus: 'Étudiante',
    birthDate: '2003-07-19',
  },
  {
    fullName: 'Reda Alaoui',
    email: 'reda.alaoui@gmail.com',
    phone: '0721 06 55 38',
    password: STUDENT_PASSWORD,
    role: Role.STUDENT,
    status: AccountStatus.PENDING_APPROVAL,
    locale: Locale.fr,
    city: 'Meknès',
    referralCode: 'REDA2608',
    createdDaysAgo: 2,
    professionalStatus: 'Salarié',
    birthDate: '1997-10-08',
  },
  {
    fullName: 'Fatima Zahra Belkacem',
    email: 'fatimazahra.belkacem@gmail.com',
    phone: '06 99 41 20 77',
    password: STUDENT_PASSWORD,
    role: Role.STUDENT,
    status: AccountStatus.PENDING_APPROVAL,
    locale: Locale.ar,
    city: 'Agadir',
    referralCode: 'FATIMA2609',
    createdDaysAgo: 1,
    professionalStatus: 'Étudiante',
    birthDate: '2001-02-23',
  },

  // ── 1 × PENDING_EMAIL — le lien de vérification n'a jamais été ouvert ───
  {
    fullName: 'Bilal Moutaouakil',
    email: 'bilal.moutaouakil@gmail.com',
    phone: '06 34 87 15 60',
    password: STUDENT_PASSWORD,
    role: Role.STUDENT,
    status: AccountStatus.PENDING_EMAIL,
    locale: Locale.fr,
    city: 'Oujda',
    referralCode: 'BILAL2610',
    createdDaysAgo: 1,
    professionalStatus: 'Étudiant',
    birthDate: '2000-09-11',
  },

  // ── 1 × REJECTED ────────────────────────────────────────────────────────
  {
    fullName: 'Soukaina Rhalmi',
    email: 'soukaina.rhalmi@gmail.com',
    phone: '06 27 63 94 12',
    password: STUDENT_PASSWORD,
    role: Role.STUDENT,
    status: AccountStatus.REJECTED,
    locale: Locale.fr,
    city: 'Kénitra',
    referralCode: 'SOUKAINA2611',
    createdDaysAgo: 26,
    professionalStatus: 'Salariée',
    birthDate: '1995-04-04',
    rejectionReason:
      "Le numéro de téléphone fourni ne répond pas et l'adresse e-mail rebondit. Le compte sera réactivé dès que des coordonnées joignables nous seront communiquées.",
    internalNote: "Deux tentatives d'appel, sans succès. Dossier à rouvrir sur simple demande.",
  },

  // ── 1 × SUSPENDED ───────────────────────────────────────────────────────
  {
    fullName: 'Hamza Lemseffer',
    email: 'hamza.lemseffer@gmail.com',
    phone: '07 05 38 62 41',
    password: STUDENT_PASSWORD,
    role: Role.STUDENT,
    status: AccountStatus.SUSPENDED,
    locale: Locale.fr,
    city: 'Salé',
    referralCode: 'HAMZA2612',
    createdDaysAgo: 120,
    professionalStatus: 'Salarié',
    birthDate: '1992-12-30',
    suspendedForDays: 21,
    internalNote:
      'Partage de compte constaté sur trois appareils simultanés. Suspension temporaire, entretien prévu avant réactivation.',
  },
];

const ALL_SEED_USERS: readonly SeedUser[] = [...STAFF, ...STUDENTS];

/**
 * E.164 phone, or a loud failure — a seed that writes junk numbers into the
 * column every WhatsApp CTA reads from is worse than one that stops.
 */
function toE164(user: SeedUser): string {
  const parsed = parsePhone(user.phone);
  if (parsed === null) {
    throw new Error(`Numéro de téléphone invalide pour ${user.email} : « ${user.phone} ».`);
  }
  if (!parsed.isMoroccan) {
    throw new Error(
      `Le jeu de démonstration n'utilise que des numéros marocains ; ${user.email} porte « ${user.phone} ».`,
    );
  }
  return parsed.e164;
}

interface Lifecycle {
  readonly emailVerifiedAt: Date | null;
  readonly phoneVerifiedAt: Date | null;
  readonly approvedAt: Date | null;
  readonly approvedById: string | null;
  readonly rejectionReason: string | null;
  readonly suspendedUntil: Date | null;
  readonly lastLoginAt: Date | null;
}

/** Lifecycle timestamps derived from the account status (§9.1). */
function lifecycleFor(user: SeedUser, approverId: string | null): Lifecycle {
  const createdAt = daysAgo(user.createdDaysAgo);
  const verifiedAt =
    user.status === AccountStatus.PENDING_EMAIL
      ? null
      : new Date(createdAt.getTime() + 20 * 60 * 1000);
  const reviewedAt =
    verifiedAt === null ? null : new Date(verifiedAt.getTime() + 4 * 60 * 60 * 1000);

  // ACTIVE and SUSPENDED accounts were approved once; SUSPENDED simply carries
  // an end date on top. PENDING_APPROVAL is exactly the state of never having
  // been reviewed, so it keeps no reviewer.
  const wasReviewed = user.status !== AccountStatus.PENDING_EMAIL &&
    user.status !== AccountStatus.PENDING_APPROVAL;
  const wasApproved =
    user.status === AccountStatus.ACTIVE || user.status === AccountStatus.SUSPENDED;

  return {
    emailVerifiedAt: verifiedAt,
    phoneVerifiedAt: user.status === AccountStatus.ACTIVE ? verifiedAt : null,
    approvedAt: wasApproved ? reviewedAt : null,
    approvedById: wasReviewed ? approverId : null,
    rejectionReason: user.rejectionReason ?? null,
    suspendedUntil: user.suspendedForDays === undefined ? null : daysAhead(user.suspendedForDays),
    lastLoginAt:
      user.status === AccountStatus.ACTIVE ? daysAgo(Math.min(user.createdDaysAgo, 2)) : null,
  };
}

async function upsertUser(
  tx: Prisma.TransactionClient,
  user: SeedUser,
  passwordHash: string,
  approverId: string | null,
  existingEmails: ReadonlySet<string>,
  tally: Tally,
): Promise<string> {
  const life = lifecycleFor(user, approverId);
  const birthDate = user.birthDate === undefined ? null : new Date(`${user.birthDate}T00:00:00Z`);

  const shared = {
    fullName: user.fullName,
    phone: toE164(user),
    // The credentials table is printed at the end of every run, so it has to
    // stay true: the hash is rewritten rather than preserved.
    passwordHash,
    role: user.role,
    status: user.status,
    locale: user.locale,
    city: user.city,
    country: 'MA',
    birthDate,
    professionalStatus: user.professionalStatus ?? null,
    bio: user.bio ?? null,
    headline: user.headline ?? null,
    internalNote: user.internalNote ?? null,
    tags: user.tags ?? null,
    weeklyGoalMinutes: user.weeklyGoalMinutes ?? 180,
    leaderboardOptIn: user.leaderboardOptIn ?? true,
    emailVerifiedAt: life.emailVerifiedAt,
    phoneVerifiedAt: life.phoneVerifiedAt,
    approvedAt: life.approvedAt,
    approvedById: life.approvedById,
    rejectionReason: life.rejectionReason,
    suspendedUntil: life.suspendedUntil,
    lastLoginAt: life.lastLoginAt,
  } satisfies Partial<Prisma.UserUncheckedCreateInput>;

  const row = await tx.user.upsert({
    where: { email: user.email },
    create: {
      ...shared,
      email: user.email,
      referralCode: user.referralCode,
      createdAt: daysAgo(user.createdDaysAgo),
    },
    // `createdAt` and `referralCode` are identity: a second run must not
    // renumber an account the admin has already seen in the validation queue.
    update: shared,
    select: { id: true },
  });

  tally.record(existingEmails.has(user.email));
  return row.id;
}

async function seedPeople(
  tx: Prisma.TransactionClient,
  hashes: ReadonlyMap<string, string>,
): Promise<GroupResult> {
  const tally = new Tally();
  const existingEmails = new Set(
    (await tx.user.findMany({ select: { email: true } })).map((row) => row.email),
  );

  function hashFor(email: string): string {
    const digest = hashes.get(email);
    if (digest === undefined) {
      throw new Error(`Empreinte de mot de passe manquante pour ${email}.`);
    }
    return digest;
  }

  // Staff first: every student row points at the admin through `approvedById`.
  let approverId: string | null = null;
  for (const member of STAFF) {
    const id = await upsertUser(
      tx,
      member,
      hashFor(member.email),
      approverId,
      existingEmails,
      tally,
    );
    if (member.email === APPROVER_EMAIL) approverId = id;
  }

  if (approverId === null) {
    throw new Error(`Le compte validateur ${APPROVER_EMAIL} est absent du jeu de données.`);
  }

  for (const student of STUDENTS) {
    await upsertUser(tx, student, hashFor(student.email), approverId, existingEmails, tally);
  }

  return tally.toResult('Comptes (staff + étudiants)');
}

// ═══════════════════════════════════════════════════════════════════════════
// Badges (§23) — 12, with machine-checkable criteria
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every badge is `metric >= threshold`, evaluated by the gamification service
 * against a single counter. No prose, no manual awarding: an admin editing a
 * badge in `/admin/reglages` (§17.12) can only pick a metric and a number, and
 * the checker is one comparison. `window` narrows the counter to a rolling
 * period where that is what the badge means.
 */
type BadgeMetric =
  | 'LESSONS_COMPLETED'
  | 'COURSES_COMPLETED'
  | 'QUIZZES_PASSED'
  | 'BEST_QUIZ_SCORE_PERCENT'
  | 'STREAK_DAYS'
  | 'WATCH_MINUTES'
  | 'CERTIFICATES_EARNED'
  | 'ACCEPTED_ANSWERS'
  | 'REVIEWS_APPROVED'
  | 'XP_TOTAL';

type BadgeCriteria = {
  readonly metric: BadgeMetric;
  readonly comparator: 'GTE';
  readonly threshold: number;
  readonly window?: 'ALL_TIME' | 'ROLLING_30_DAYS';
};

type BadgeTier = 'BRONZE' | 'SILVER' | 'GOLD';

interface SeedBadge {
  readonly code: string;
  /** lucide-react icon name. */
  readonly icon: string;
  readonly tier: BadgeTier;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly criteria: BadgeCriteria;
}

const BADGES: readonly SeedBadge[] = [
  {
    code: 'FIRST_LESSON',
    icon: 'Footprints',
    tier: 'BRONZE',
    name: {
      fr: 'Premier pas',
      ar: 'الخطوة الأولى',
      en: 'First step',
      es: 'Primer paso',
    },
    description: {
      fr: 'Terminer sa toute première leçon.',
      ar: 'إتمام أول درس على الإطلاق.',
      en: 'Complete your very first lesson.',
      es: 'Completar tu primera lección.',
    },
    criteria: { metric: 'LESSONS_COMPLETED', comparator: 'GTE', threshold: 1 },
  },
  {
    code: 'TEN_LESSONS',
    icon: 'BookOpen',
    tier: 'BRONZE',
    name: {
      fr: 'Dix leçons',
      ar: 'عشرة دروس',
      en: 'Ten lessons',
      es: 'Diez lecciones',
    },
    description: {
      fr: 'Terminer dix leçons, toutes formations confondues.',
      ar: 'إتمام عشرة دروس عبر جميع التكوينات.',
      en: 'Complete ten lessons across all your courses.',
      es: 'Completar diez lecciones en todas tus formaciones.',
    },
    criteria: { metric: 'LESSONS_COMPLETED', comparator: 'GTE', threshold: 10 },
  },
  {
    code: 'FIFTY_LESSONS',
    icon: 'Library',
    tier: 'SILVER',
    name: {
      fr: 'Cinquante leçons',
      ar: 'خمسون درساً',
      en: 'Fifty lessons',
      es: 'Cincuenta lecciones',
    },
    description: {
      fr: 'Terminer cinquante leçons — la régularité paie.',
      ar: 'إتمام خمسين درساً — الانتظام يؤتي أُكُله.',
      en: 'Complete fifty lessons — consistency pays off.',
      es: 'Completar cincuenta lecciones: la constancia da resultado.',
    },
    criteria: { metric: 'LESSONS_COMPLETED', comparator: 'GTE', threshold: 50 },
  },
  {
    code: 'FIRST_QUIZ',
    icon: 'CircleCheck',
    tier: 'BRONZE',
    name: {
      fr: 'Quiz réussi',
      ar: 'اختبار ناجح',
      en: 'Quiz passed',
      es: 'Cuestionario superado',
    },
    description: {
      fr: 'Réussir un premier quiz au-dessus du score de passage.',
      ar: 'اجتياز أول اختبار فوق درجة النجاح.',
      en: 'Pass your first quiz above the passing score.',
      es: 'Superar tu primer cuestionario por encima de la nota de aprobado.',
    },
    criteria: { metric: 'QUIZZES_PASSED', comparator: 'GTE', threshold: 1 },
  },
  {
    code: 'PERFECT_QUIZ',
    icon: 'Target',
    tier: 'GOLD',
    name: {
      fr: 'Sans faute',
      ar: 'بدون خطأ',
      en: 'Flawless',
      es: 'Sin fallos',
    },
    description: {
      fr: 'Obtenir 100 % à un quiz noté.',
      ar: 'الحصول على 100٪ في اختبار مُقيَّم.',
      en: 'Score 100 % on a graded quiz.',
      es: 'Obtener el 100 % en un cuestionario calificado.',
    },
    criteria: { metric: 'BEST_QUIZ_SCORE_PERCENT', comparator: 'GTE', threshold: 100 },
  },
  {
    code: 'QUIZ_MASTER',
    icon: 'Trophy',
    tier: 'SILVER',
    name: {
      fr: 'Maître des quiz',
      ar: 'سيّد الاختبارات',
      en: 'Quiz master',
      es: 'Maestro de los cuestionarios',
    },
    description: {
      fr: 'Réussir dix quiz notés.',
      ar: 'اجتياز عشرة اختبارات مُقيَّمة.',
      en: 'Pass ten graded quizzes.',
      es: 'Superar diez cuestionarios calificados.',
    },
    criteria: { metric: 'QUIZZES_PASSED', comparator: 'GTE', threshold: 10 },
  },
  {
    code: 'STREAK_7',
    icon: 'Flame',
    tier: 'BRONZE',
    name: {
      fr: 'Sept jours d’affilée',
      ar: 'سبعة أيام متتالية',
      en: 'Seven-day streak',
      es: 'Siete días seguidos',
    },
    description: {
      fr: 'Apprendre sept jours consécutifs.',
      ar: 'التعلّم سبعة أيام متتالية.',
      en: 'Study seven days in a row.',
      es: 'Estudiar siete días consecutivos.',
    },
    criteria: { metric: 'STREAK_DAYS', comparator: 'GTE', threshold: 7 },
  },
  {
    code: 'STREAK_30',
    icon: 'Flame',
    tier: 'GOLD',
    name: {
      fr: 'Trente jours d’affilée',
      ar: 'ثلاثون يوماً متتالية',
      en: 'Thirty-day streak',
      es: 'Treinta días seguidos',
    },
    description: {
      fr: 'Apprendre trente jours consécutifs.',
      ar: 'التعلّم ثلاثين يوماً متتالية.',
      en: 'Study thirty days in a row.',
      es: 'Estudiar treinta días consecutivos.',
    },
    criteria: { metric: 'STREAK_DAYS', comparator: 'GTE', threshold: 30 },
  },
  {
    code: 'TEN_HOURS',
    icon: 'Clock',
    tier: 'SILVER',
    name: {
      fr: 'Dix heures',
      ar: 'عشر ساعات',
      en: 'Ten hours',
      es: 'Diez horas',
    },
    description: {
      fr: 'Cumuler dix heures de visionnage effectif.',
      ar: 'تجميع عشر ساعات من المشاهدة الفعلية.',
      en: 'Accumulate ten hours of actual watch time.',
      es: 'Acumular diez horas de visionado efectivo.',
    },
    criteria: { metric: 'WATCH_MINUTES', comparator: 'GTE', threshold: 600 },
  },
  {
    code: 'FIRST_COURSE',
    icon: 'GraduationCap',
    tier: 'SILVER',
    name: {
      fr: 'Formation terminée',
      ar: 'تكوين مُنجَز',
      en: 'Course completed',
      es: 'Formación completada',
    },
    description: {
      fr: 'Terminer une formation à 100 %.',
      ar: 'إتمام تكوين بنسبة 100٪.',
      en: 'Finish a course at 100 %.',
      es: 'Terminar una formación al 100 %.',
    },
    criteria: { metric: 'COURSES_COMPLETED', comparator: 'GTE', threshold: 1 },
  },
  {
    code: 'CERTIFIED',
    icon: 'Award',
    tier: 'GOLD',
    name: {
      fr: 'Certifié',
      ar: 'حاصل على شهادة',
      en: 'Certified',
      es: 'Certificado',
    },
    description: {
      fr: 'Obtenir un certificat vérifiable du centre.',
      ar: 'الحصول على شهادة قابلة للتحقق من المركز.',
      en: 'Earn a verifiable certificate from the center.',
      es: 'Obtener un certificado verificable del centro.',
    },
    criteria: { metric: 'CERTIFICATES_EARNED', comparator: 'GTE', threshold: 1 },
  },
  {
    code: 'HELPFUL_PEER',
    icon: 'Handshake',
    tier: 'SILVER',
    name: {
      fr: 'Esprit d’entraide',
      ar: 'روح التعاون',
      en: 'Helpful peer',
      es: 'Espíritu de ayuda',
    },
    description: {
      fr: 'Voir trois de ses réponses acceptées dans les discussions.',
      ar: 'قبول ثلاث من إجاباتك في النقاشات.',
      en: 'Have three of your answers accepted in the discussions.',
      es: 'Que se acepten tres de tus respuestas en los debates.',
    },
    criteria: { metric: 'ACCEPTED_ANSWERS', comparator: 'GTE', threshold: 3 },
  },
];

async function seedBadges(tx: Prisma.TransactionClient): Promise<GroupResult> {
  const tally = new Tally();
  const existing = new Set(
    (await tx.badge.findMany({ select: { code: true } })).map((row) => row.code),
  );

  for (const badge of BADGES) {
    const shared = {
      icon: badge.icon,
      tier: badge.tier,
      nameFr: badge.name.fr,
      nameAr: badge.name.ar,
      nameEn: badge.name.en,
      nameEs: badge.name.es,
      descFr: badge.description.fr,
      descAr: badge.description.ar,
      descEn: badge.description.en,
      descEs: badge.description.es,
      criteria: badge.criteria satisfies Prisma.InputJsonValue,
    };

    await tx.badge.upsert({
      where: { code: badge.code },
      create: { code: badge.code, ...shared },
      update: shared,
    });

    tally.record(existing.has(badge.code));
  }

  return tally.toResult('Badges');
}

// ═══════════════════════════════════════════════════════════════════════════
// FAQ (§23) — 10 items, four locales
// ═══════════════════════════════════════════════════════════════════════════

interface SeedFaq {
  /** `FaqItem` has no natural unique column, so the id itself is the key. */
  readonly id: string;
  readonly category: string;
  readonly order: number;
  readonly question: LocalizedText;
  readonly answer: LocalizedText;
}

const FAQ_ITEMS: readonly SeedFaq[] = [
  {
    id: 'faq-inscription-creer-compte',
    category: 'INSCRIPTION',
    order: 1,
    question: {
      fr: 'Comment créer un compte ?',
      ar: 'كيف أُنشئ حساباً؟',
      en: 'How do I create an account?',
      es: '¿Cómo creo una cuenta?',
    },
    answer: {
      fr: "Cliquez sur « Créer un compte », renseignez votre nom complet, votre e-mail et votre numéro de téléphone marocain, puis choisissez un mot de passe. Vous recevez immédiatement un e-mail de vérification : ouvrez-le et confirmez votre adresse. Votre dossier part ensuite en validation auprès de l'équipe.",
      ar: 'اضغط على «إنشاء حساب»، وأدخل اسمك الكامل وبريدك الإلكتروني ورقم هاتفك المغربي، ثم اختر كلمة سر. ستصلك فوراً رسالة تحقق: افتحها وأكّد عنوانك. بعد ذلك يُحال ملفك إلى الفريق للمصادقة.',
      en: 'Click “Create an account”, enter your full name, e-mail and Moroccan phone number, then choose a password. You immediately receive a verification e-mail: open it and confirm your address. Your file then goes to the team for approval.',
      es: 'Haz clic en «Crear una cuenta», introduce tu nombre completo, tu correo y tu número de teléfono marroquí, y elige una contraseña. Recibirás de inmediato un correo de verificación: ábrelo y confirma tu dirección. Después, tu expediente pasa a validación del equipo.',
    },
  },
  {
    id: 'faq-inscription-validation',
    category: 'INSCRIPTION',
    order: 2,
    question: {
      fr: 'Pourquoi mon compte doit-il être validé par un administrateur ?',
      ar: 'لماذا يجب أن يصادق مسؤول على حسابي؟',
      en: 'Why does an administrator have to approve my account?',
      es: '¿Por qué un administrador debe validar mi cuenta?',
    },
    answer: {
      fr: "Le centre accompagne chaque étudiant individuellement : la validation nous permet de vérifier que vos coordonnées sont joignables, de vous orienter vers la bonne formation et de garder des groupes réels. C'est aussi ce qui protège la plateforme des inscriptions automatisées.",
      ar: 'يرافق المركز كل متدرّب بشكل فردي: تتيح لنا المصادقة التأكد من إمكانية الاتصال بك، وتوجيهك نحو التكوين المناسب، والحفاظ على مجموعات حقيقية. كما أنها تحمي المنصة من التسجيلات الآلية.',
      en: 'The center supports every student individually: approval lets us check that we can reach you, steer you toward the right course, and keep real cohorts. It is also what protects the platform from automated sign-ups.',
      es: 'El centro acompaña a cada estudiante de forma individual: la validación nos permite comprobar que podemos contactarte, orientarte hacia la formación adecuada y mantener grupos reales. También protege la plataforma de los registros automatizados.',
    },
  },
  {
    id: 'faq-inscription-delai',
    category: 'INSCRIPTION',
    order: 3,
    question: {
      fr: 'Combien de temps prend la validation de mon compte ?',
      ar: 'كم تستغرق المصادقة على حسابي؟',
      en: 'How long does account approval take?',
      es: '¿Cuánto tarda la validación de mi cuenta?',
    },
    answer: {
      fr: "En général quelques heures ouvrables, au maximum un jour ouvré. Vous recevez un e-mail dès que la décision est prise, et la page d'attente de votre espace affiche l'état en temps réel. Si le délai est dépassé, écrivez-nous sur WhatsApp : nous débloquons le dossier immédiatement.",
      ar: 'عادةً بضع ساعات عمل، وبحد أقصى يوم عمل واحد. ستصلك رسالة فور اتخاذ القرار، وتعرض صفحة الانتظار في فضائك الحالة في الوقت الفعلي. إذا تجاوزنا هذه المدة، راسلنا على واتساب وسنعالج الملف فوراً.',
      en: 'Usually a few working hours, at most one business day. You get an e-mail as soon as the decision is made, and the waiting page in your space shows the live status. If we go past that, message us on WhatsApp and we will unblock your file right away.',
      es: 'Normalmente unas horas laborables, como máximo un día hábil. Recibirás un correo en cuanto se tome la decisión, y la página de espera de tu espacio muestra el estado en tiempo real. Si se supera ese plazo, escríbenos por WhatsApp y desbloqueamos el expediente enseguida.',
    },
  },
  {
    id: 'faq-paiement-moyens',
    category: 'PAIEMENT',
    order: 1,
    question: {
      fr: 'Quels moyens de paiement acceptez-vous ?',
      ar: 'ما هي وسائل الأداء المقبولة؟',
      en: 'Which payment methods do you accept?',
      es: '¿Qué métodos de pago aceptáis?',
    },
    answer: {
      fr: "Le virement bancaire — instantané ou standard — et le règlement en espèces au centre. Il n'y a pas de paiement par carte en ligne : vous effectuez le virement depuis votre banque, puis vous déposez le justificatif sur la plateforme. Un membre de l'équipe le vérifie et votre accès s'ouvre.",
      ar: 'التحويل البنكي — فوري أو عادي — والأداء نقداً في المركز. لا يوجد أداء بالبطاقة عبر الإنترنت: تقوم بالتحويل من بنكك ثم ترفع الإشعار على المنصة. يتحقق منه أحد أعضاء الفريق ثم يُفتح ولوجك.',
      en: 'Bank transfer — instant or standard — and cash payment at the center. There is no online card payment: you make the transfer from your bank, then upload the receipt on the platform. A team member verifies it and your access opens.',
      es: 'Transferencia bancaria —instantánea o estándar— y pago en efectivo en el centro. No hay pago con tarjeta en línea: haces la transferencia desde tu banco y subes el justificante a la plataforma. Un miembro del equipo lo verifica y se abre tu acceso.',
    },
  },
  {
    id: 'faq-paiement-justificatif',
    category: 'PAIEMENT',
    order: 2,
    question: {
      fr: 'Comment envoyer mon justificatif de virement ?',
      ar: 'كيف أرسل إشعار التحويل؟',
      en: 'How do I send my transfer receipt?',
      es: '¿Cómo envío mi justificante de transferencia?',
    },
    answer: {
      fr: "Depuis la page de la formation, cliquez sur « Demander l'accès ». La fenêtre affiche nos coordonnées bancaires et une référence unique du type CFI-2026-000123 : recopiez-la dans le motif du virement. Vous déposez ensuite la photo ou le PDF du reçu, et vous suivez l'avancement dans « Mes demandes ».",
      ar: 'من صفحة التكوين، اضغط «طلب الولوج». تعرض النافذة معطياتنا البنكية ومرجعاً فريداً من نوع CFI-2026-000123: انسخه في خانة سبب التحويل. بعدها ترفع صورة الإشعار أو ملف PDF، وتتابع التقدم في «طلباتي».',
      en: 'From the course page, click “Request access”. The modal shows our bank details and a unique reference such as CFI-2026-000123: copy it into the transfer description. Then upload a photo or PDF of the receipt and follow the progress under “My requests”.',
      es: 'Desde la página de la formación, haz clic en «Solicitar acceso». La ventana muestra nuestros datos bancarios y una referencia única del tipo CFI-2026-000123: cópiala en el concepto de la transferencia. Después sube la foto o el PDF del recibo y sigue el avance en «Mis solicitudes».',
    },
  },
  {
    id: 'faq-paiement-plusieurs-fois',
    category: 'PAIEMENT',
    order: 3,
    question: {
      fr: 'Puis-je payer en plusieurs fois ?',
      ar: 'هل يمكنني الأداء على أقساط؟',
      en: 'Can I pay in instalments?',
      es: '¿Puedo pagar en varias veces?',
    },
    answer: {
      fr: "Oui, pour les formations qui le prévoient : la page de la formation indique alors le nombre de tranches et leur échéance. Vous réglez la première tranche pour ouvrir l'accès, et l'échéancier reste visible dans votre espace. Pour les autres formations, contactez-nous : nous étudions chaque situation.",
      ar: 'نعم، بالنسبة للتكوينات التي تتيح ذلك: تُبيّن صفحة التكوين عدد الأقساط وتواريخ استحقاقها. تؤدي القسط الأول لفتح الولوج، ويبقى الجدول الزمني ظاهراً في فضائك. أما التكوينات الأخرى فتواصل معنا وسندرس كل حالة على حدة.',
      en: 'Yes, for courses that offer it: the course page then states the number of instalments and their due dates. You pay the first instalment to open access, and the schedule stays visible in your space. For other courses, contact us — we look at each situation.',
      es: 'Sí, en las formaciones que lo prevén: la página de la formación indica el número de plazos y sus vencimientos. Pagas el primer plazo para abrir el acceso y el calendario queda visible en tu espacio. Para el resto, contáctanos: estudiamos cada caso.',
    },
  },
  {
    id: 'faq-formations-en-ligne',
    category: 'FORMATIONS',
    order: 1,
    question: {
      fr: 'Les formations sont-elles 100 % en ligne ?',
      ar: 'هل التكوينات عن بُعد بالكامل؟',
      en: 'Are the courses fully online?',
      es: '¿Las formaciones son 100 % en línea?',
    },
    answer: {
      fr: "Cela dépend de la formation : chaque fiche précise le mode — en ligne, en présentiel au centre, ou hybride. Les formations hybrides combinent des vidéos à votre rythme et des séances en direct ou au centre, dont les dates figurent dans votre agenda.",
      ar: 'يعتمد الأمر على التكوين: تحدد كل بطاقة النمط — عن بُعد، حضورياً بالمركز، أو مختلطاً. تجمع التكوينات المختلطة بين فيديوهات تتابعها بإيقاعك وحصص مباشرة أو حضورية تظهر تواريخها في أجندتك.',
      en: 'It depends on the course: each listing states the mode — online, on site at the center, or hybrid. Hybrid courses combine self-paced videos with live or on-site sessions, whose dates appear in your agenda.',
      es: 'Depende de la formación: cada ficha indica la modalidad —en línea, presencial en el centro o híbrida—. Las híbridas combinan vídeos a tu ritmo con sesiones en directo o presenciales, cuyas fechas aparecen en tu agenda.',
    },
  },
  {
    id: 'faq-formations-duree-acces',
    category: 'FORMATIONS',
    order: 2,
    question: {
      fr: "Pendant combien de temps ai-je accès à une formation ?",
      ar: 'إلى متى يبقى ولوجي إلى التكوين؟',
      en: 'How long do I keep access to a course?',
      es: '¿Durante cuánto tiempo tengo acceso a una formación?',
    },
    answer: {
      fr: "Par défaut l'accès est illimité dans le temps. Quand une formation prévoit une durée d'accès — parce qu'elle suit une session encadrée — la fiche l'indique clairement avant l'achat, et la date de fin apparaît dans « Mes formations ».",
      ar: 'الولوج غير محدود زمنياً بشكل افتراضي. وعندما يحدد تكوين مدة ولوج — لأنه يتبع دورة مؤطَّرة — تذكر البطاقة ذلك بوضوح قبل الشراء، ويظهر تاريخ الانتهاء في «تكويناتي».',
      en: 'Access is unlimited in time by default. When a course does set an access duration — because it follows a supervised cohort — the listing says so clearly before purchase, and the end date appears under “My courses”.',
      es: 'Por defecto el acceso es ilimitado en el tiempo. Cuando una formación fija una duración de acceso —porque sigue una sesión tutorizada—, la ficha lo indica claramente antes de la compra y la fecha de fin aparece en «Mis formaciones».',
    },
  },
  {
    id: 'faq-certificat-verification',
    category: 'CERTIFICAT',
    order: 1,
    question: {
      fr: 'Le certificat est-il vérifiable par un employeur ?',
      ar: 'هل يمكن لمشغِّل التحقق من الشهادة؟',
      en: 'Can an employer verify the certificate?',
      es: '¿Un empleador puede verificar el certificado?',
    },
    answer: {
      fr: "Oui. Chaque certificat porte un numéro de série et un code de vérification imprimés sur le PDF. N'importe qui peut saisir ce code sur la page publique de vérification du site pour voir le nom du titulaire, la formation et la date de délivrance — sans compte et sans exposer vos autres données.",
      ar: 'نعم. تحمل كل شهادة رقماً تسلسلياً ورمز تحقق مطبوعين على ملف PDF. يمكن لأي شخص إدخال هذا الرمز في صفحة التحقق العمومية بالموقع ليرى اسم صاحب الشهادة والتكوين وتاريخ التسليم — دون حساب ودون كشف باقي معطياتك.',
      en: 'Yes. Every certificate carries a serial number and a verification code printed on the PDF. Anyone can enter that code on the site’s public verification page to see the holder’s name, the course and the issue date — no account needed, and none of your other data exposed.',
      es: 'Sí. Cada certificado lleva un número de serie y un código de verificación impresos en el PDF. Cualquiera puede introducir ese código en la página pública de verificación del sitio para ver el nombre del titular, la formación y la fecha de emisión, sin cuenta y sin exponer el resto de tus datos.',
    },
  },
  {
    id: 'faq-technique-mobile',
    category: 'TECHNIQUE',
    order: 1,
    question: {
      fr: 'Puis-je suivre les cours depuis mon téléphone ?',
      ar: 'هل يمكنني متابعة الدروس من هاتفي؟',
      en: 'Can I follow the courses on my phone?',
      es: '¿Puedo seguir los cursos desde el móvil?',
    },
    answer: {
      fr: "Oui, la plateforme est conçue pour le mobile d'abord : lecteur vidéo tactile, reprise automatique à la seconde où vous vous êtes arrêté, et qualité vidéo adaptée à votre connexion. Vous pouvez aussi l'installer comme application depuis le menu de votre navigateur.",
      ar: 'نعم، فالمنصة مصمَّمة للهاتف أولاً: مشغّل فيديو باللمس، واستئناف تلقائي من الثانية التي توقفت عندها، وجودة فيديو تتكيّف مع اتصالك. كما يمكنك تثبيتها كتطبيق من قائمة متصفحك.',
      en: 'Yes — the platform is built mobile-first: a touch video player, automatic resume at the exact second you stopped, and video quality that adapts to your connection. You can also install it as an app from your browser menu.',
      es: 'Sí, la plataforma está diseñada para móvil primero: reproductor táctil, reanudación automática en el segundo exacto en que lo dejaste y calidad de vídeo adaptada a tu conexión. También puedes instalarla como aplicación desde el menú del navegador.',
    },
  },
];

async function seedFaq(tx: Prisma.TransactionClient): Promise<GroupResult> {
  const tally = new Tally();
  const existing = new Set(
    (await tx.faqItem.findMany({ select: { id: true } })).map((row) => row.id),
  );

  for (const item of FAQ_ITEMS) {
    const shared = {
      category: item.category,
      order: item.order,
      questionFr: item.question.fr,
      questionAr: item.question.ar,
      questionEn: item.question.en,
      questionEs: item.question.es,
      answerFr: item.answer.fr,
      answerAr: item.answer.ar,
      answerEn: item.answer.en,
      answerEs: item.answer.es,
      isPublished: true,
    };

    await tx.faqItem.upsert({
      where: { id: item.id },
      create: { id: item.id, ...shared },
      update: shared,
    });

    tally.record(existing.has(item.id));
  }

  return tally.toResult('FAQ (× 4 locales)');
}

// ═══════════════════════════════════════════════════════════════════════════
// Testimonials (§23) — 6
// ═══════════════════════════════════════════════════════════════════════════

interface SeedTestimonial {
  /** Same reasoning as the FAQ: the id is the natural key. */
  readonly id: string;
  readonly authorName: string;
  readonly authorRole: string;
  readonly rating: number;
  readonly order: number;
  readonly isFeatured: boolean;
  readonly quote: LocalizedText;
}

const TESTIMONIALS: readonly SeedTestimonial[] = [
  {
    id: 'testimonial-01-khadija',
    authorName: 'Khadija Amrani',
    authorRole: 'Chargée de communication, Meknès',
    rating: 5,
    order: 1,
    isFeatured: true,
    quote: {
      fr: "J'ai suivi la formation le soir après le travail. Ce qui change tout, c'est qu'on ne regarde pas des vidéos : on refait les exercices sur ses propres dossiers, et le formateur corrige.",
      ar: 'تابعتُ التكوين مساءً بعد العمل. ما يغيّر كل شيء هو أنك لا تكتفي بمشاهدة الفيديوهات: تعيد التمارين على ملفاتك الخاصة، والمكوِّن يصحّح لك.',
      en: 'I took the course in the evenings after work. What changes everything is that you do not just watch videos: you redo the exercises on your own files, and the trainer corrects them.',
      es: 'Hice la formación por las tardes después del trabajo. Lo que lo cambia todo es que no ves vídeos sin más: rehaces los ejercicios con tus propios archivos y el formador los corrige.',
    },
  },
  {
    id: 'testimonial-02-omar',
    authorName: 'Omar Benjelloun',
    authorRole: 'Gérant de commerce, Casablanca',
    rating: 5,
    order: 2,
    isFeatured: true,
    quote: {
      fr: "Je vendais déjà en ligne, mais au hasard. En six semaines j'ai appris à lire mes chiffres, à couper ce qui ne rapporte rien et à doubler mon budget sur ce qui marche.",
      ar: 'كنت أبيع عبر الإنترنت من قبل، لكن عشوائياً. في ستة أسابيع تعلّمت قراءة أرقامي، وإيقاف ما لا يجدي، ومضاعفة ميزانيتي على ما ينجح.',
      en: 'I was already selling online, but at random. In six weeks I learned to read my numbers, cut what earns nothing, and double the budget on what works.',
      es: 'Ya vendía en línea, pero al azar. En seis semanas aprendí a leer mis números, a cortar lo que no rinde y a doblar el presupuesto en lo que funciona.',
    },
  },
  {
    id: 'testimonial-03-salma',
    authorName: 'Salma Idrissi',
    authorRole: 'Étudiante en informatique, Fès',
    rating: 5,
    order: 3,
    isFeatured: true,
    quote: {
      fr: "Le module se termine par une application en ligne, pas par un QCM. C'est ce projet que j'ai montré en entretien, et c'est ce qui a fait la différence.",
      ar: 'تنتهي الوحدة بتطبيق منشور على الإنترنت، لا باختبار متعدد الاختيارات. هذا المشروع بالذات هو ما عرضته في المقابلة، وهو ما صنع الفرق.',
      en: 'The module ends with a live application, not a multiple-choice test. That project is what I showed in my interview, and it is what made the difference.',
      es: 'El módulo termina con una aplicación en línea, no con un test tipo test. Ese proyecto es lo que enseñé en la entrevista y lo que marcó la diferencia.',
    },
  },
  {
    id: 'testimonial-04-abdelilah',
    authorName: 'Abdelilah Ouhadi',
    authorRole: 'Comptable, Fès',
    rating: 4,
    order: 4,
    isFeatured: false,
    quote: {
      fr: "Les tableaux Excel du cours sont ceux qu'on utilise vraiment au bureau. J'aurais aimé plus d'exercices sur la paie, mais le reste est directement applicable.",
      ar: 'جداول Excel في الدورة هي نفسها التي نستعملها فعلاً في المكتب. كنت أتمنى تمارين أكثر حول الأجور، لكن الباقي قابل للتطبيق مباشرة.',
      en: 'The Excel workbooks in the course are the ones we actually use at the office. I would have liked more payroll exercises, but the rest is directly applicable.',
      es: 'Las hojas de Excel del curso son las que usamos de verdad en la oficina. Me habría gustado más ejercicios de nóminas, pero el resto es aplicable de inmediato.',
    },
  },
  {
    id: 'testimonial-05-nawal',
    authorName: 'Nawal Bouzidi',
    authorRole: 'Assistante de direction, Rabat',
    rating: 5,
    order: 5,
    isFeatured: false,
    quote: {
      fr: "J'avais peur de me perdre en cours d'anglais. Les mises en situation — un appel client, une réunion — m'ont fait parler dès la deuxième séance.",
      ar: 'كنت أخشى أن أضيع في دروس الإنجليزية. الوضعيات التطبيقية — مكالمة مع زبون، اجتماع — جعلتني أتكلّم منذ الحصة الثانية.',
      en: 'I was afraid of getting lost in the English course. The role-plays — a client call, a meeting — had me speaking from the second session.',
      es: 'Tenía miedo de perderme en las clases de inglés. Las simulaciones —una llamada con un cliente, una reunión— me hicieron hablar desde la segunda sesión.',
    },
  },
  {
    id: 'testimonial-06-mustapha',
    authorName: 'Mustapha El Khattabi',
    authorRole: 'Auto-entrepreneur, Agadir',
    rating: 5,
    order: 6,
    isFeatured: false,
    quote: {
      fr: "Le virement a été validé le matin même et l'accès s'est ouvert dans la foulée. Pour quelqu'un qui n'a pas de carte bancaire, c'est exactement ce qu'il fallait.",
      ar: 'تمت المصادقة على التحويل في صباح اليوم نفسه وانفتح الولوج مباشرة بعده. بالنسبة لشخص لا يملك بطاقة بنكية، هذا بالضبط ما كان مطلوباً.',
      en: 'The transfer was approved the same morning and access opened right after. For someone without a bank card, that is exactly what was needed.',
      es: 'La transferencia se validó esa misma mañana y el acceso se abrió justo después. Para alguien sin tarjeta bancaria, es justo lo que hacía falta.',
    },
  },
];

async function seedTestimonials(tx: Prisma.TransactionClient): Promise<GroupResult> {
  const tally = new Tally();
  const existing = new Set(
    (await tx.testimonial.findMany({ select: { id: true } })).map((row) => row.id),
  );

  for (const item of TESTIMONIALS) {
    const shared = {
      authorName: item.authorName,
      authorRole: item.authorRole,
      rating: item.rating,
      quoteFr: item.quote.fr,
      quoteAr: item.quote.ar,
      quoteEn: item.quote.en,
      quoteEs: item.quote.es,
      isFeatured: item.isFeatured,
      order: item.order,
      isPublished: true,
    };

    await tx.testimonial.upsert({
      where: { id: item.id },
      create: { id: item.id, ...shared },
      update: shared,
    });

    tally.record(existing.has(item.id));
  }

  return tally.toResult('Témoignages (× 4 locales)');
}

// ═══════════════════════════════════════════════════════════════════════════
// Legal pages (§12.5) — /legal/cgu, /legal/confidentialite, /legal/cookies
// ═══════════════════════════════════════════════════════════════════════════

interface SeedPage {
  readonly slug: string;
  readonly title: LocalizedText;
  readonly body: LocalizedText;
  readonly seoTitle: string;
  readonly seoDescription: string;
}

const LEGAL_PAGES: readonly SeedPage[] = [
  {
    slug: 'cgu',
    title: {
      fr: "Conditions générales d'utilisation",
      ar: 'الشروط العامة للاستعمال',
      en: 'Terms of use',
      es: 'Condiciones generales de uso',
    },
    seoTitle: "Conditions générales d'utilisation — CFI",
    seoDescription:
      "Règles d'accès et d'utilisation de la plateforme du Centre de Formation Immersive : compte, inscription aux formations, paiement par virement, accès aux contenus et résiliation.",
    body: {
      fr: [
        '## 1. Objet',
        '',
        "Les présentes conditions régissent l'accès à la plateforme du Centre de Formation Immersive (« CFI », « le centre ») et son utilisation. Créer un compte vaut acceptation sans réserve de ce document.",
        '',
        '## 2. Compte',
        '',
        "Le compte est personnel et nominatif. Vous vous engagez à fournir des informations exactes, à maintenir votre mot de passe confidentiel et à nous signaler sans délai tout usage non autorisé. Le partage d'identifiants entraîne la suspension du compte.",
        '',
        "Toute inscription est soumise à la validation d'un administrateur. Le centre peut refuser un compte dont les coordonnées sont injoignables ou manifestement erronées ; la décision est motivée et notifiée par e-mail.",
        '',
        '## 3. Inscription à une formation et paiement',
        '',
        "L'accès à une formation payante est ouvert après réception et vérification du règlement. Le paiement s'effectue par virement bancaire ou en espèces au centre ; aucun paiement par carte n'est traité en ligne. La demande d'accès expire automatiquement si aucun justificatif n'est déposé dans le délai indiqué lors de la demande.",
        '',
        'Les prix sont affichés en dirhams marocains, toutes taxes comprises. Une facture est émise pour chaque règlement encaissé.',
        '',
        '## 4. Accès aux contenus',
        '',
        "Sauf mention contraire sur la fiche de la formation, l'accès est accordé sans limite de durée pour un usage strictement personnel. Les vidéos, supports et exercices restent la propriété du centre et de ses formateurs : leur téléchargement non autorisé, leur rediffusion ou leur revente sont interdits.",
        '',
        '## 5. Comportement dans les espaces d’échange',
        '',
        "Les discussions et les avis sont modérés. Sont retirés sans préavis les contenus injurieux, discriminatoires, publicitaires ou portant atteinte à la vie privée d'autrui.",
        '',
        '## 6. Résiliation',
        '',
        "Vous pouvez demander la suppression de votre compte à tout moment depuis votre espace ou par e-mail. Le centre peut suspendre un compte en cas de manquement grave aux présentes conditions, après information de l'intéressé lorsque cela est possible.",
        '',
        '## 7. Droit applicable',
        '',
        'Les présentes conditions sont soumises au droit marocain. À défaut de résolution amiable, les tribunaux compétents sont ceux du ressort du siège du centre.',
      ].join('\n'),
      ar: [
        '## 1. الموضوع',
        '',
        'تُنظّم هذه الشروط الولوج إلى منصة مركز التكوين الغامر («المركز») واستعمالها. إنشاء حساب يعني القبول التام بهذه الوثيقة.',
        '',
        '## 2. الحساب',
        '',
        'الحساب شخصي واسمي. تلتزم بتقديم معلومات صحيحة، وبالحفاظ على سرية كلمة السر، وبإخبارنا فوراً بأي استعمال غير مرخّص. تقاسم بيانات الولوج يؤدي إلى توقيف الحساب.',
        '',
        'يخضع كل تسجيل لمصادقة مسؤول. يمكن للمركز رفض حساب تعذّر الاتصال بصاحبه أو كانت معطياته خاطئة بشكل بيّن؛ ويكون القرار معلَّلاً ومبلَّغاً عبر البريد الإلكتروني.',
        '',
        '## 3. التسجيل في تكوين والأداء',
        '',
        'يُفتح الولوج إلى تكوين مؤدّى عنه بعد التوصل بالمبلغ والتحقق منه. يتم الأداء عبر تحويل بنكي أو نقداً بالمركز؛ ولا تتم معالجة أي أداء بالبطاقة عبر الإنترنت. ينتهي طلب الولوج تلقائياً إذا لم يُرفع أي إشعار داخل الأجل المحدد عند الطلب.',
        '',
        'تُعرض الأسعار بالدرهم المغربي، شاملةً لجميع الرسوم. وتُصدر فاتورة عن كل مبلغ محصَّل.',
        '',
        '## 4. الولوج إلى المحتويات',
        '',
        'ما لم تنص بطاقة التكوين على خلاف ذلك، يُمنح الولوج دون تحديد مدة ولاستعمال شخصي محض. تبقى الفيديوهات والدعامات والتمارين ملكاً للمركز ولمكوِّنيه: يُمنع تحميلها دون ترخيص أو إعادة بثها أو بيعها.',
        '',
        '## 5. السلوك في فضاءات التبادل',
        '',
        'تخضع النقاشات والآراء للمراقبة. تُحذف دون إشعار مسبق المحتويات المسيئة أو التمييزية أو الإشهارية أو الماسّة بالحياة الخاصة للغير.',
        '',
        '## 6. إنهاء الحساب',
        '',
        'يمكنك طلب حذف حسابك في أي وقت من فضائك أو عبر البريد الإلكتروني. ويمكن للمركز توقيف حساب في حالة إخلال جسيم بهذه الشروط، بعد إخبار المعني بالأمر كلما كان ذلك ممكناً.',
        '',
        '## 7. القانون المطبَّق',
        '',
        'تخضع هذه الشروط للقانون المغربي. وفي غياب حل ودّي، تكون المحاكم المختصة هي محاكم دائرة مقر المركز.',
      ].join('\n'),
      en: [
        '## 1. Purpose',
        '',
        'These terms govern access to and use of the Centre de Formation Immersive (“CFI”, “the center”) platform. Creating an account constitutes full acceptance of this document.',
        '',
        '## 2. Account',
        '',
        'The account is personal and named. You undertake to provide accurate information, keep your password confidential, and report any unauthorised use without delay. Sharing credentials leads to suspension of the account.',
        '',
        'Every registration is subject to approval by an administrator. The center may refuse an account whose contact details are unreachable or clearly incorrect; the decision is explained and notified by e-mail.',
        '',
        '## 3. Course enrolment and payment',
        '',
        'Access to a paid course opens once payment has been received and verified. Payment is made by bank transfer or in cash at the center; no card payment is processed online. An access request expires automatically if no receipt is uploaded within the period stated when the request is made.',
        '',
        'Prices are displayed in Moroccan dirhams, all taxes included. An invoice is issued for every payment received.',
        '',
        '## 4. Access to content',
        '',
        'Unless the course listing states otherwise, access is granted with no time limit, for strictly personal use. Videos, materials and exercises remain the property of the center and its instructors: unauthorised downloading, redistribution or resale is prohibited.',
        '',
        '## 5. Conduct in community spaces',
        '',
        'Discussions and reviews are moderated. Abusive, discriminatory, promotional content, or content infringing another person’s privacy, is removed without notice.',
        '',
        '## 6. Termination',
        '',
        'You may request deletion of your account at any time from your space or by e-mail. The center may suspend an account in the event of a serious breach of these terms, after informing the person concerned where possible.',
        '',
        '## 7. Governing law',
        '',
        'These terms are governed by Moroccan law. Failing an amicable settlement, the competent courts are those of the jurisdiction of the center’s registered office.',
      ].join('\n'),
      es: [
        '## 1. Objeto',
        '',
        'Estas condiciones regulan el acceso a la plataforma del Centre de Formation Immersive («CFI», «el centro») y su uso. Crear una cuenta supone la aceptación sin reservas de este documento.',
        '',
        '## 2. Cuenta',
        '',
        'La cuenta es personal y nominativa. Te comprometes a facilitar información veraz, a mantener tu contraseña confidencial y a comunicarnos sin demora cualquier uso no autorizado. Compartir credenciales conlleva la suspensión de la cuenta.',
        '',
        'Todo registro está sujeto a la validación de un administrador. El centro puede rechazar una cuenta cuyos datos de contacto sean inaccesibles o manifiestamente erróneos; la decisión se motiva y se notifica por correo electrónico.',
        '',
        '## 3. Inscripción en una formación y pago',
        '',
        'El acceso a una formación de pago se abre tras la recepción y verificación del importe. El pago se realiza por transferencia bancaria o en efectivo en el centro; no se procesa ningún pago con tarjeta en línea. La solicitud de acceso caduca automáticamente si no se sube ningún justificante en el plazo indicado al realizarla.',
        '',
        'Los precios se muestran en dírhams marroquíes, impuestos incluidos. Se emite una factura por cada importe cobrado.',
        '',
        '## 4. Acceso a los contenidos',
        '',
        'Salvo indicación contraria en la ficha de la formación, el acceso se concede sin límite de duración y para uso estrictamente personal. Los vídeos, materiales y ejercicios son propiedad del centro y de sus formadores: se prohíbe su descarga no autorizada, su redifusión y su reventa.',
        '',
        '## 5. Comportamiento en los espacios de intercambio',
        '',
        'Los debates y las opiniones están moderados. Se retiran sin previo aviso los contenidos injuriosos, discriminatorios, publicitarios o que vulneren la privacidad de terceros.',
        '',
        '## 6. Resolución',
        '',
        'Puedes solicitar la supresión de tu cuenta en cualquier momento desde tu espacio o por correo electrónico. El centro puede suspender una cuenta en caso de incumplimiento grave de estas condiciones, informando previamente a la persona afectada cuando sea posible.',
        '',
        '## 7. Ley aplicable',
        '',
        'Estas condiciones se rigen por el derecho marroquí. A falta de acuerdo amistoso, serán competentes los tribunales de la jurisdicción del domicilio social del centro.',
      ].join('\n'),
    },
  },
  {
    slug: 'confidentialite',
    title: {
      fr: 'Politique de confidentialité',
      ar: 'سياسة الخصوصية',
      en: 'Privacy policy',
      es: 'Política de privacidad',
    },
    seoTitle: 'Politique de confidentialité — CFI',
    seoDescription:
      'Quelles données le Centre de Formation Immersive collecte, pourquoi, combien de temps il les conserve, et comment exercer vos droits au titre de la loi 09-08.',
    body: {
      fr: [
        '## Responsable du traitement',
        '',
        "Le Centre de Formation Immersive est responsable des traitements décrits ci-dessous. Ils sont réalisés conformément à la loi marocaine 09-08 relative à la protection des personnes physiques à l'égard du traitement des données à caractère personnel.",
        '',
        '## Données collectées',
        '',
        "- **Compte** : nom complet, e-mail, téléphone, ville, statut professionnel, date de naissance si vous la renseignez.",
        "- **Apprentissage** : formations suivies, progression, résultats aux quiz, devoirs rendus, notes personnelles.",
        "- **Paiement** : montant, référence, justificatif de virement déposé, facture émise. Aucune donnée de carte bancaire n'est collectée.",
        "- **Technique** : adresse IP, type d'appareil et journaux de connexion, conservés à des fins de sécurité.",
        '',
        '## Finalités',
        '',
        "Gérer votre compte et la validation de votre inscription, donner accès aux formations achetées, vérifier les paiements et éditer les factures, assurer le suivi pédagogique, vous envoyer les messages liés à votre parcours, et protéger la plateforme contre les abus.",
        '',
        '## Durées de conservation',
        '',
        "Les données de compte sont conservées tant que le compte existe, puis douze mois. Les pièces comptables sont conservées dix ans comme la loi l'exige. Les journaux techniques sont conservés douze mois.",
        '',
        '## Destinataires',
        '',
        "Vos données ne sont ni vendues ni louées. Elles sont accessibles à l'équipe du centre et à nos prestataires techniques — hébergement, envoi d'e-mails, diffusion vidéo — qui agissent sur nos instructions.",
        '',
        '## Vos droits',
        '',
        "Vous disposez d'un droit d'accès, de rectification, d'opposition et de suppression. Votre espace permet d'exporter vos données et de demander la suppression du compte. Vous pouvez aussi nous écrire à l'adresse de contact publiée sur le site. Vous avez le droit de saisir la CNDP.",
      ].join('\n'),
      ar: [
        '## المسؤول عن المعالجة',
        '',
        'مركز التكوين الغامر هو المسؤول عن المعالجات الموصوفة أدناه. وتتم هذه المعالجات وفق القانون المغربي 09-08 المتعلق بحماية الأشخاص الذاتيين تجاه معالجة المعطيات ذات الطابع الشخصي.',
        '',
        '## المعطيات المجمَّعة',
        '',
        '- **الحساب**: الاسم الكامل، البريد الإلكتروني، الهاتف، المدينة، الوضعية المهنية، وتاريخ الازدياد إن قدّمتَه.',
        '- **التعلّم**: التكوينات المتابَعة، التقدّم، نتائج الاختبارات، الواجبات المسلَّمة، الملاحظات الشخصية.',
        '- **الأداء**: المبلغ، المرجع، إشعار التحويل المرفوع، والفاتورة الصادرة. لا تُجمع أي معطيات عن البطاقة البنكية.',
        '- **تقنية**: عنوان IP، نوع الجهاز وسجلات الاتصال، تُحفظ لأغراض أمنية.',
        '',
        '## الغايات',
        '',
        'تدبير حسابك والمصادقة على تسجيلك، وإتاحة الولوج إلى التكوينات المؤدّى عنها، والتحقق من الأداءات وإصدار الفواتير، وضمان التتبع البيداغوجي، وإرسال الرسائل المرتبطة بمسارك، وحماية المنصة من الاستعمال المسيء.',
        '',
        '## مدد الحفظ',
        '',
        'تُحفظ معطيات الحساب ما دام الحساب قائماً، ثم اثني عشر شهراً بعده. وتُحفظ الوثائق المحاسبية عشر سنوات كما يفرض القانون. أما السجلات التقنية فتُحفظ اثني عشر شهراً.',
        '',
        '## المرسَل إليهم',
        '',
        'لا تُباع معطياتك ولا تُكرى. ويطّلع عليها فريق المركز ومزوّدونا التقنيون — الاستضافة، إرسال البريد، بث الفيديو — الذين يتصرفون وفق تعليماتنا.',
        '',
        '## حقوقك',
        '',
        'لك حق الولوج والتصحيح والتعرّض والحذف. يتيح لك فضاؤك تصدير معطياتك وطلب حذف الحساب. كما يمكنك مراسلتنا على عنوان الاتصال المنشور بالموقع. ولك الحق في اللجوء إلى اللجنة الوطنية لمراقبة حماية المعطيات ذات الطابع الشخصي.',
      ].join('\n'),
      en: [
        '## Data controller',
        '',
        'The Centre de Formation Immersive is the controller of the processing described below, carried out in accordance with Moroccan law 09-08 on the protection of individuals with regard to the processing of personal data.',
        '',
        '## Data collected',
        '',
        '- **Account**: full name, e-mail, phone, city, professional status, date of birth if you provide it.',
        '- **Learning**: courses taken, progress, quiz results, submitted assignments, personal notes.',
        '- **Payment**: amount, reference, uploaded transfer receipt, issued invoice. No bank card data is collected.',
        '- **Technical**: IP address, device type and connection logs, kept for security purposes.',
        '',
        '## Purposes',
        '',
        'Managing your account and the approval of your registration, granting access to purchased courses, verifying payments and issuing invoices, providing educational follow-up, sending you messages related to your learning path, and protecting the platform against abuse.',
        '',
        '## Retention periods',
        '',
        'Account data is kept for as long as the account exists, then for twelve months. Accounting records are kept for ten years, as the law requires. Technical logs are kept for twelve months.',
        '',
        '## Recipients',
        '',
        'Your data is neither sold nor rented. It is accessible to the center’s team and to our technical providers — hosting, e-mail delivery, video streaming — who act on our instructions.',
        '',
        '## Your rights',
        '',
        'You have the right to access, rectify, object to and delete your data. Your space lets you export your data and request deletion of the account. You may also write to the contact address published on the site. You have the right to lodge a complaint with the CNDP.',
      ].join('\n'),
      es: [
        '## Responsable del tratamiento',
        '',
        'El Centre de Formation Immersive es el responsable de los tratamientos descritos a continuación, realizados conforme a la ley marroquí 09-08 relativa a la protección de las personas físicas en el tratamiento de datos de carácter personal.',
        '',
        '## Datos recogidos',
        '',
        '- **Cuenta**: nombre completo, correo electrónico, teléfono, ciudad, situación profesional y fecha de nacimiento si la facilitas.',
        '- **Aprendizaje**: formaciones cursadas, progreso, resultados de los cuestionarios, trabajos entregados y notas personales.',
        '- **Pago**: importe, referencia, justificante de transferencia subido y factura emitida. No se recoge ningún dato de tarjeta bancaria.',
        '- **Técnicos**: dirección IP, tipo de dispositivo y registros de conexión, conservados con fines de seguridad.',
        '',
        '## Finalidades',
        '',
        'Gestionar tu cuenta y la validación de tu inscripción, dar acceso a las formaciones adquiridas, verificar los pagos y emitir las facturas, asegurar el seguimiento pedagógico, enviarte los mensajes relacionados con tu itinerario y proteger la plataforma frente a los abusos.',
        '',
        '## Plazos de conservación',
        '',
        'Los datos de la cuenta se conservan mientras exista la cuenta y doce meses después. Los documentos contables se conservan diez años, como exige la ley. Los registros técnicos se conservan doce meses.',
        '',
        '## Destinatarios',
        '',
        'Tus datos no se venden ni se alquilan. Son accesibles para el equipo del centro y para nuestros proveedores técnicos —alojamiento, envío de correos, difusión de vídeo—, que actúan siguiendo nuestras instrucciones.',
        '',
        '## Tus derechos',
        '',
        'Tienes derecho de acceso, rectificación, oposición y supresión. Tu espacio permite exportar tus datos y solicitar la eliminación de la cuenta. También puedes escribirnos a la dirección de contacto publicada en el sitio. Tienes derecho a presentar una reclamación ante la CNDP.',
      ].join('\n'),
    },
  },
  {
    slug: 'cookies',
    title: {
      fr: 'Politique relative aux cookies',
      ar: 'سياسة ملفات تعريف الارتباط',
      en: 'Cookie policy',
      es: 'Política de cookies',
    },
    seoTitle: 'Politique relative aux cookies — CFI',
    seoDescription:
      'Les cookies utilisés par la plateforme CFI : cookies strictement nécessaires, préférences d’affichage et mesure d’audience, et comment les refuser.',
    body: {
      fr: [
        '## Ce que nous déposons',
        '',
        "La plateforme utilise le minimum de cookies nécessaire à son fonctionnement.",
        '',
        '### Strictement nécessaires',
        '',
        "Cookie de session — vous maintient connecté et protège les formulaires contre la falsification de requêtes. Sa durée est celle de votre session, au maximum trente jours si vous demandez à rester connecté. Il ne peut pas être désactivé : sans lui, il n'y a pas de connexion possible.",
        '',
        '### Préférences',
        '',
        "Langue choisie, thème clair ou sombre, taille de texte et réglages d'accessibilité. Ces cookies ne servent qu'à vous réafficher le site comme vous l'avez laissé, et sont conservés un an.",
        '',
        '### Mesure d’audience',
        '',
        "Nous mesurons la fréquentation de manière agrégée, sans profilage publicitaire et sans revente à des tiers. Aucun cookie publicitaire n'est déposé.",
        '',
        '## Comment les refuser',
        '',
        "Vous pouvez à tout moment supprimer les cookies et bloquer leur dépôt depuis les réglages de votre navigateur. Le refus des cookies de préférence n'empêche pas l'utilisation du site, mais vos réglages seront redemandés à chaque visite ; le refus du cookie de session empêche la connexion à votre espace.",
      ].join('\n'),
      ar: [
        '## ما الذي نودعه',
        '',
        'تستعمل المنصة الحد الأدنى من ملفات تعريف الارتباط اللازمة لاشتغالها.',
        '',
        '### الضرورية تماماً',
        '',
        'ملف الجلسة — يُبقيك متصلاً ويحمي النماذج من تزوير الطلبات. مدته هي مدة جلستك، وثلاثون يوماً كحد أقصى إذا اخترت البقاء متصلاً. ولا يمكن تعطيله: بدونه لا يمكن الاتصال.',
        '',
        '### التفضيلات',
        '',
        'اللغة المختارة، والنمط الفاتح أو الداكن، وحجم النص وإعدادات الولوجية. لا تخدم هذه الملفات سوى إعادة عرض الموقع كما تركتَه، وتُحفظ لمدة سنة.',
        '',
        '### قياس الجمهور',
        '',
        'نقيس الزيارات بشكل إجمالي، دون تنميط إشهاري ودون بيع لأطراف ثالثة. ولا يُودَع أي ملف إشهاري.',
        '',
        '## كيف ترفضها',
        '',
        'يمكنك في أي وقت حذف ملفات تعريف الارتباط ومنع إيداعها من إعدادات متصفحك. رفض ملفات التفضيلات لا يمنع استعمال الموقع، لكن ستُطلب منك إعداداتك في كل زيارة؛ أما رفض ملف الجلسة فيمنع الاتصال بفضائك.',
      ].join('\n'),
      en: [
        '## What we store',
        '',
        'The platform uses the minimum number of cookies required to work.',
        '',
        '### Strictly necessary',
        '',
        'Session cookie — keeps you signed in and protects forms against request forgery. It lasts for your session, at most thirty days if you ask to stay signed in. It cannot be disabled: without it, signing in is impossible.',
        '',
        '### Preferences',
        '',
        'Chosen language, light or dark theme, text size and accessibility settings. These cookies only exist to show you the site as you left it, and are kept for one year.',
        '',
        '### Audience measurement',
        '',
        'We measure traffic in aggregate, with no advertising profiling and no resale to third parties. No advertising cookie is stored.',
        '',
        '## How to refuse them',
        '',
        'You can delete cookies and block them at any time from your browser settings. Refusing preference cookies does not prevent you from using the site, but your settings will be asked for on every visit; refusing the session cookie prevents you from signing in to your space.',
      ].join('\n'),
      es: [
        '## Qué almacenamos',
        '',
        'La plataforma utiliza el mínimo de cookies necesario para funcionar.',
        '',
        '### Estrictamente necesarias',
        '',
        'Cookie de sesión: te mantiene conectado y protege los formularios frente a la falsificación de peticiones. Dura lo que tu sesión, con un máximo de treinta días si pides seguir conectado. No puede desactivarse: sin ella no es posible iniciar sesión.',
        '',
        '### Preferencias',
        '',
        'Idioma elegido, tema claro u oscuro, tamaño del texto y ajustes de accesibilidad. Estas cookies solo sirven para mostrarte el sitio tal como lo dejaste y se conservan un año.',
        '',
        '### Medición de audiencia',
        '',
        'Medimos las visitas de forma agregada, sin perfilado publicitario y sin reventa a terceros. No se almacena ninguna cookie publicitaria.',
        '',
        '## Cómo rechazarlas',
        '',
        'Puedes eliminar las cookies y bloquear su instalación en cualquier momento desde los ajustes de tu navegador. Rechazar las cookies de preferencias no impide usar el sitio, pero se te volverán a pedir los ajustes en cada visita; rechazar la cookie de sesión impide acceder a tu espacio.',
      ].join('\n'),
    },
  },
];

async function seedLegalPages(tx: Prisma.TransactionClient): Promise<GroupResult> {
  const tally = new Tally();
  const existing = new Set(
    (await tx.page.findMany({ select: { slug: true } })).map((row) => row.slug),
  );

  for (const page of LEGAL_PAGES) {
    const shared = {
      status: 'PUBLISHED',
      titleFr: page.title.fr,
      titleAr: page.title.ar,
      titleEn: page.title.en,
      titleEs: page.title.es,
      bodyFr: page.body.fr,
      bodyAr: page.body.ar,
      bodyEn: page.body.en,
      bodyEs: page.body.es,
      seoTitle: page.seoTitle,
      seoDescription: page.seoDescription,
    };

    await tx.page.upsert({
      where: { slug: page.slug },
      create: { slug: page.slug, ...shared },
      update: shared,
    });

    tally.record(existing.has(page.slug));
  }

  return tally.toResult('Pages légales (× 4 locales)');
}

// ═══════════════════════════════════════════════════════════════════════════
// Deliberately empty groups — data owned by a later milestone (§25)
//
// These functions exist so the shape of the finished seed is visible from M0
// and so nobody has to guess where the missing data belongs. They insert
// nothing on purpose: an empty catalogue is a true statement about the state of
// the build, whereas a placeholder course would be a lie the admin panel, the
// sitemap and the AI index would all repeat.
// ═══════════════════════════════════════════════════════════════════════════

// Le catalogue — cours, modules, leçons, parcours et avis — vit dans
// `prisma/seed/catalog.ts` et s'écrit avec les autres groupes ci-dessus : c'est
// le seul groupe assez volumineux pour mériter son propre module, et le seul
// dont le contenu change régulièrement. Les ressources téléchargeables
// arriveront avec les fichiers eux-mêmes.

/**
 * Articles de blog, annonces et sessions live (§23).
 * Jalon **M2** pour le blog et les annonces, **M8** pour les sessions live et
 * le pointage QR. Ces contenus dépendent des cours auxquels ils se rattachent.
 */
export function seedEditorialContent(): GroupResult {
  return deferred('Blog, annonces, sessions live', 'M2/M8');
}

// Les demandes d'inscription (§9.2) — états, paiements, factures PDF et
// justificatifs de test — vivent dans `prisma/seed/requests.ts` et s'écrivent
// avec les autres groupes ci-dessus, après le catalogue dont elles dépendent.

/**
 * Inscriptions actives, progression des leçons, notes et signets (§23).
 * Jalon **M4 — Expérience d'apprentissage**, qui définit le suivi de
 * progression et donc la signification des colonnes dérivées.
 */
export function seedLearningActivity(): GroupResult {
  return deferred('Inscriptions, progression, notes, signets', 'M4');
}

/**
 * Discussions, réponses et avis modérés (§23).
 * Jalon **M4** : ils sont rattachés à une leçon ou à un cours.
 */
export function seedCommunity(): GroupResult {
  return deferred('Discussions, réponses, avis', 'M4');
}

/**
 * Quiz, questions, choix, devoirs et certificats (§23).
 * Jalon **M5 — Évaluation et certification**, qui fixe le barème, la correction
 * côté serveur et le format des certificats.
 */
export function seedAssessments(): GroupResult {
  return deferred('Quiz, devoirs, certificats', 'M5');
}

/**
 * Conversations de l'assistant, réponses curées, lacunes détectées et base de
 * connaissance indexée (§23). Jalon **M7 — Assistant IA Nour**, qui apporte le
 * découpage, les embeddings et la recherche hybride. Indexer un corpus vide
 * n'apprendrait rien à personne.
 */
export function seedAiCorpus(): GroupResult {
  return deferred('Conversations IA, réponses curées, base de connaissance', 'M7');
}

/**
 * Attribution de badges, événements XP, séries d'assiduité et flashcards.
 * Jalon **M8 — Engagement** : le catalogue de badges ci-dessus est seedé dès
 * maintenant parce que c'est une donnée de référence ; leur attribution est un
 * effet de l'activité réelle des étudiants.
 */
export function seedGamificationActivity(): GroupResult {
  return deferred('XP, badges attribués, séries, flashcards', 'M8');
}

// ═══════════════════════════════════════════════════════════════════════════
// --reset
// ═══════════════════════════════════════════════════════════════════════════

interface DeleteStep {
  readonly model: string;
  readonly run: () => Promise<{ count: number }>;
}

/**
 * Every table, children before parents.
 *
 * `deleteMany` per model rather than `TRUNCATE`: MySQL refuses to truncate a
 * table referenced by a foreign key, and switching `FOREIGN_KEY_CHECKS` off
 * would let a wrong order pass silently. Deleting in dependency order means a
 * mistake in this list surfaces as a constraint error instead of orphan rows.
 */
function deleteSteps(client: PrismaClient): readonly DeleteStep[] {
  return [
    // AI
    { model: 'AiMessage', run: () => client.aiMessage.deleteMany() },
    { model: 'AiConversation', run: () => client.aiConversation.deleteMany() },
    { model: 'AiUserMemory', run: () => client.aiUserMemory.deleteMany() },
    { model: 'AiUsage', run: () => client.aiUsage.deleteMany() },
    { model: 'AiQuestionGap', run: () => client.aiQuestionGap.deleteMany() },
    { model: 'CuratedAnswer', run: () => client.curatedAnswer.deleteMany() },
    { model: 'KnowledgeChunk', run: () => client.knowledgeChunk.deleteMany() },

    // Engagement
    { model: 'Attendance', run: () => client.attendance.deleteMany() },
    { model: 'LiveSession', run: () => client.liveSession.deleteMany() },
    { model: 'Announcement', run: () => client.announcement.deleteMany() },
    { model: 'Review', run: () => client.review.deleteMany() },
    { model: 'Reply', run: () => client.reply.deleteMany() },
    { model: 'Thread', run: () => client.thread.deleteMany() },
    { model: 'Bookmark', run: () => client.bookmark.deleteMany() },
    { model: 'Note', run: () => client.note.deleteMany() },

    // Assessment
    { model: 'Certificate', run: () => client.certificate.deleteMany() },
    { model: 'AssignmentSubmission', run: () => client.assignmentSubmission.deleteMany() },
    { model: 'AssignmentTranslation', run: () => client.assignmentTranslation.deleteMany() },
    { model: 'Assignment', run: () => client.assignment.deleteMany() },
    { model: 'QuizAttempt', run: () => client.quizAttempt.deleteMany() },
    { model: 'ChoiceTranslation', run: () => client.choiceTranslation.deleteMany() },
    { model: 'Choice', run: () => client.choice.deleteMany() },
    { model: 'QuestionTranslation', run: () => client.questionTranslation.deleteMany() },
    { model: 'Question', run: () => client.question.deleteMany() },
    { model: 'QuizTranslation', run: () => client.quizTranslation.deleteMany() },
    { model: 'Quiz', run: () => client.quiz.deleteMany() },

    // Enrollment & money
    { model: 'LessonProgress', run: () => client.lessonProgress.deleteMany() },
    { model: 'Enrollment', run: () => client.enrollment.deleteMany() },
    { model: 'Payment', run: () => client.payment.deleteMany() },
    { model: 'RequestEvent', run: () => client.requestEvent.deleteMany() },
    { model: 'EnrollmentRequest', run: () => client.enrollmentRequest.deleteMany() },
    { model: 'CouponCourse', run: () => client.couponCourse.deleteMany() },
    { model: 'Coupon', run: () => client.coupon.deleteMany() },

    // Catalog
    { model: 'Resource', run: () => client.resource.deleteMany() },
    { model: 'LessonTranslation', run: () => client.lessonTranslation.deleteMany() },
    { model: 'Lesson', run: () => client.lesson.deleteMany() },
    { model: 'ModuleTranslation', run: () => client.moduleTranslation.deleteMany() },
    { model: 'Module', run: () => client.module.deleteMany() },
    { model: 'PathItem', run: () => client.pathItem.deleteMany() },
    { model: 'PathTranslation', run: () => client.pathTranslation.deleteMany() },
    { model: 'Path', run: () => client.path.deleteMany() },
    { model: 'CoursePrerequisite', run: () => client.coursePrerequisite.deleteMany() },
    { model: 'CourseTranslation', run: () => client.courseTranslation.deleteMany() },
    { model: 'Course', run: () => client.course.deleteMany() },
    { model: 'CategoryTranslation', run: () => client.categoryTranslation.deleteMany() },
    { model: 'Category', run: () => client.category.deleteMany() },

    // Gamification & per-user rows
    { model: 'UserBadge', run: () => client.userBadge.deleteMany() },
    { model: 'Badge', run: () => client.badge.deleteMany() },
    { model: 'XpEvent', run: () => client.xpEvent.deleteMany() },
    { model: 'StudyStreak', run: () => client.studyStreak.deleteMany() },
    { model: 'Flashcard', run: () => client.flashcard.deleteMany() },
    { model: 'Notification', run: () => client.notification.deleteMany() },
    { model: 'Session', run: () => client.session.deleteMany() },
    { model: 'VerificationToken', run: () => client.verificationToken.deleteMany() },
    { model: 'AuditLog', run: () => client.auditLog.deleteMany() },
    { model: 'User', run: () => client.user.deleteMany() },

    // Standalone
    { model: 'ContactMessage', run: () => client.contactMessage.deleteMany() },
    { model: 'EmailLog', run: () => client.emailLog.deleteMany() },
    { model: 'BlogPost', run: () => client.blogPost.deleteMany() },
    { model: 'Testimonial', run: () => client.testimonial.deleteMany() },
    { model: 'FaqItem', run: () => client.faqItem.deleteMany() },
    { model: 'Page', run: () => client.page.deleteMany() },
    { model: 'SiteSetting', run: () => client.siteSetting.deleteMany() },
    { model: 'FeatureFlag', run: () => client.featureFlag.deleteMany() },
    { model: 'Job', run: () => client.job.deleteMany() },
    { model: 'RateLimitEvent', run: () => client.rateLimitEvent.deleteMany() },
  ];
}

async function resetDatabase(client: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '--reset refuse de s’exécuter avec NODE_ENV=production. ' +
        'Cette commande vide toutes les tables : elle est réservée au développement.',
    );
  }

  log.title('Réinitialisation (--reset)');
  log.warn('Toutes les tables vont être vidées.');

  let total = 0;
  for (const step of deleteSteps(client)) {
    const { count } = await step.run();
    total += count;
    if (count > 0) log.step(`${step.model} : ${count} ligne(s) supprimée(s)`);
  }

  log.step(`Total : ${total} ligne(s) supprimée(s).`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Output
// ═══════════════════════════════════════════════════════════════════════════

function printSummary(results: readonly GroupResult[]): void {
  const labelWidth = Math.max(...results.map((r) => r.label.length), 'Groupe'.length);

  log.title('Récapitulatif');
  console.log(
    `  ${pad('Groupe', labelWidth)}  ${padStart('Créés', 7)}  ${padStart('Màj', 7)}  ${padStart('Préservés', 10)}`,
  );
  console.log(`  ${'-'.repeat(labelWidth)}  ${'-'.repeat(7)}  ${'-'.repeat(7)}  ${'-'.repeat(10)}`);

  for (const result of results) {
    if (result.deferredTo !== undefined) {
      console.log(`  ${pad(result.label, labelWidth)}  ${padStart(`jalon ${result.deferredTo}`, 28)}`);
      continue;
    }
    console.log(
      `  ${pad(result.label, labelWidth)}  ${padStart(String(result.created), 7)}` +
        `  ${padStart(String(result.updated), 7)}  ${padStart(String(result.preserved), 10)}`,
    );
  }

  const created = results.reduce((sum, r) => sum + r.created, 0);
  const updated = results.reduce((sum, r) => sum + r.updated, 0);
  const preserved = results.reduce((sum, r) => sum + r.preserved, 0);
  console.log(`  ${'-'.repeat(labelWidth)}  ${'-'.repeat(7)}  ${'-'.repeat(7)}  ${'-'.repeat(10)}`);
  console.log(
    `  ${pad('Total', labelWidth)}  ${padStart(String(created), 7)}  ${padStart(String(updated), 7)}  ${padStart(String(preserved), 10)}`,
  );
}

/**
 * The credentials table. These accounts are demonstration accounts: the
 * passwords are printed because they are meant to be known, and that is exactly
 * why this seed must never touch a production database.
 */
function printCredentials(): void {
  const rows = ALL_SEED_USERS.map((user) => ({
    email: user.email,
    password: user.password,
    role: user.role,
    status: user.status,
  }));

  const emailWidth = Math.max(...rows.map((r) => r.email.length), 'E-mail'.length);
  const passwordWidth = Math.max(...rows.map((r) => r.password.length), 'Mot de passe'.length);
  const roleWidth = Math.max(...rows.map((r) => r.role.length), 'Rôle'.length);
  const statusWidth = Math.max(...rows.map((r) => r.status.length), 'Statut'.length);

  log.title('Comptes de démonstration');
  console.log(
    `  ${pad('E-mail', emailWidth)}  ${pad('Mot de passe', passwordWidth)}  ${pad('Rôle', roleWidth)}  ${pad('Statut', statusWidth)}`,
  );
  console.log(
    `  ${'-'.repeat(emailWidth)}  ${'-'.repeat(passwordWidth)}  ${'-'.repeat(roleWidth)}  ${'-'.repeat(statusWidth)}`,
  );
  for (const row of rows) {
    console.log(
      `  ${pad(row.email, emailWidth)}  ${pad(row.password, passwordWidth)}  ${pad(row.role, roleWidth)}  ${pad(row.status, statusWidth)}`,
    );
  }
  console.log('\n  Mots de passe de démonstration — à ne jamais réutiliser hors développement.');
}

// ═══════════════════════════════════════════════════════════════════════════
// main
// ═══════════════════════════════════════════════════════════════════════════

/** One interactive transaction per group; generous timeouts for a cold MySQL. */
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  loadEnvFiles();

  if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') {
    throw new Error(
      'DATABASE_URL est absent. Renseignez-le dans .env (voir .env.example) avant de lancer le seed.',
    );
  }

  const prisma = new PrismaClient({ log: ['warn', 'error'] });

  try {
    log.title(`CFI — seed (§23) · NODE_ENV=${process.env.NODE_ENV ?? 'development'}`);

    if (options.reset) {
      await resetDatabase(prisma);
    }

    // Argon2 runs before any transaction opens: 16 hashes at 19 MiB each take
    // longer than a transaction should ever be held open.
    log.title('Empreintes de mots de passe (argon2id)');
    const hashes = new Map<string, string>();
    for (const user of ALL_SEED_USERS) {
      hashes.set(user.email, await hashPassword(user.password));
    }
    log.step(`${hashes.size} empreintes calculées.`);

    const results: GroupResult[] = [];

    /** One group = one transaction: it commits whole or not at all. */
    const runGroup = async (
      group: (tx: Prisma.TransactionClient) => Promise<GroupResult>,
    ): Promise<void> => {
      const result = await prisma.$transaction(group, TRANSACTION_OPTIONS);
      results.push(result);
      log.done(result);
    };

    log.title('Écriture');
    await runGroup(seedSiteSettings);
    await runGroup(seedFeatureFlags);
    await runGroup(seedCategories);
    await runGroup((tx) => seedPeople(tx, hashes));
    await runGroup(seedBadges);
    await runGroup(seedFaq);
    await runGroup(seedTestimonials);
    await runGroup(seedLegalPages);
    await runGroup(seedCatalog);
    await runGroup(seedRequests);

    log.title('Groupes reportés à un jalon ultérieur');
    const laterMilestones: readonly GroupResult[] = [
      seedEditorialContent(),
      seedLearningActivity(),
      seedCommunity(),
      seedAssessments(),
      seedAiCorpus(),
      seedGamificationActivity(),
    ];
    for (const result of laterMilestones) log.done(result);

    printSummary([...results, ...laterMilestones]);
    printCredentials();

    log.title('Seed terminé.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('\nÉchec du seed :');
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  // Set the code rather than calling process.exit so stdout is flushed first.
  process.exitCode = 1;
});
