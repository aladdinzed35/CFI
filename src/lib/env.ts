/**
 * CFI — validation de l'environnement au démarrage.
 *
 * Toutes les variables décrites dans `.env.example` sont validées ici, à la
 * charge du module, et le processus s'arrête immédiatement si l'une d'elles est
 * absente ou malformée. Le rapport d'erreur liste TOUS les problèmes d'un coup,
 * groupés par section, avec le nom de la variable, ce qui ne va pas, et
 * l'endroit d'où la valeur provient (hPanel, Cloudflare R2, Bunny…).
 *
 * Deux schémas distincts :
 *   • `serverSchema` — tout, secrets compris. Accessible via `env`, jamais
 *     depuis un composant client (l'accès depuis le navigateur lève une erreur).
 *   • `clientSchema` — uniquement les `NEXT_PUBLIC_*`. Accessible via
 *     `clientEnv`, sûr dans un bundle navigateur.
 * Un composant client ne doit importer que `clientEnv`.
 *
 * SKIP_ENV_VALIDATION
 * -------------------
 * Lorsque `SKIP_ENV_VALIDATION` est définie (valeur non vide), la validation
 * est neutralisée : les variables absentes ou malformées sont remplacées par
 * des valeurs de remplissage explicitement factices et le processus ne s'arrête
 * pas. C'est ce qui permet à `next build` et à la CI de tourner sans détenir les
 * secrets de production. Ne jamais définir cette variable sur le serveur
 * d'exécution — un démarrage sans validation masquerait une configuration
 * cassée jusqu'à la première requête.
 */

import { z, type ZodIssue } from 'zod'

/* ────────────────────────────────────────────────────────────────────────────
 * Métadonnées : section et provenance de chaque variable
 * ────────────────────────────────────────────────────────────────────────── */

const SECTIONS = [
  'Cœur',
  'Base de données',
  'Authentification',
  'Courriel (SMTP)',
  'Stockage',
  'Vidéo',
  'IA',
  'Tâches planifiées',
  'Optionnel',
  'Autres',
] as const

type Section = (typeof SECTIONS)[number]

interface VariableMeta {
  readonly section: Section
  readonly origin: string
}

const META: Readonly<Record<string, VariableMeta>> = {
  NODE_ENV: {
    section: 'Cœur',
    origin: "définie par la plateforme d'exécution (« production » sur Hostinger)",
  },
  PORT: { section: 'Cœur', origin: "hPanel → Node.js → port de l'application" },
  APP_URL: { section: 'Cœur', origin: 'domaine canonique du site (hPanel → Domaines)' },
  NEXT_PUBLIC_APP_URL: {
    section: 'Cœur',
    origin: 'même valeur que APP_URL, exposée au navigateur',
  },
  DATABASE_URL: {
    section: 'Base de données',
    origin: 'hPanel → Bases de données MySQL (hôte, utilisateur, mot de passe, nom)',
  },
  AUTH_SECRET: { section: 'Authentification', origin: 'à générer : openssl rand -base64 48' },
  AUTH_TRUST_HOST: {
    section: 'Authentification',
    origin: 'true derrière le proxy Hostinger',
  },
  SESSION_MAX_AGE_DAYS: {
    section: 'Authentification',
    origin: 'choix produit : durée de vie d’une session, en jours',
  },
  SMTP_HOST: { section: 'Courriel (SMTP)', origin: 'hPanel → Comptes e-mail → paramètres SMTP' },
  SMTP_PORT: { section: 'Courriel (SMTP)', origin: 'hPanel → Comptes e-mail → paramètres SMTP' },
  SMTP_SECURE: { section: 'Courriel (SMTP)', origin: 'true pour le port 465 (TLS implicite)' },
  SMTP_USER: { section: 'Courriel (SMTP)', origin: 'hPanel → Comptes e-mail → adresse complète' },
  SMTP_PASSWORD: {
    section: 'Courriel (SMTP)',
    origin: 'hPanel → Comptes e-mail → mot de passe du compte',
  },
  MAIL_FROM_NAME: { section: 'Courriel (SMTP)', origin: 'nom affiché comme expéditeur' },
  MAIL_FROM_ADDRESS: {
    section: 'Courriel (SMTP)',
    origin: 'adresse d’expédition créée dans hPanel → Comptes e-mail',
  },
  MAIL_ADMIN_RECIPIENTS: {
    section: 'Courriel (SMTP)',
    origin: 'adresses internes destinataires des notifications d’administration, séparées par des virgules',
  },
  STORAGE_DRIVER: { section: 'Stockage', origin: 's3 en production, local en développement' },
  S3_ENDPOINT: {
    section: 'Stockage',
    origin: 'tableau de bord Cloudflare R2 → API → point de terminaison compatible S3',
  },
  S3_REGION: { section: 'Stockage', origin: 'auto pour Cloudflare R2' },
  S3_BUCKET: { section: 'Stockage', origin: 'nom du bucket créé dans Cloudflare R2' },
  S3_ACCESS_KEY_ID: { section: 'Stockage', origin: 'Cloudflare R2 → Gérer les jetons d’API' },
  S3_SECRET_ACCESS_KEY: { section: 'Stockage', origin: 'Cloudflare R2 → Gérer les jetons d’API' },
  S3_PUBLIC_BASE_URL: {
    section: 'Stockage',
    origin: 'domaine public du bucket ou CDN placé devant R2 (facultatif)',
  },
  LOCAL_STORAGE_PATH: {
    section: 'Stockage',
    origin: 'chemin sur disque, développement uniquement (non durable sur Hostinger)',
  },
  VIDEO_PROVIDER: { section: 'Vidéo', origin: 'bunny en production' },
  BUNNY_STREAM_LIBRARY_ID: {
    section: 'Vidéo',
    origin: 'Bunny.net → Stream → bibliothèque → identifiant',
  },
  BUNNY_STREAM_API_KEY: { section: 'Vidéo', origin: 'Bunny.net → Stream → bibliothèque → API' },
  BUNNY_STREAM_CDN_HOSTNAME: {
    section: 'Vidéo',
    origin: 'Bunny.net → Stream → bibliothèque → nom d’hôte CDN',
  },
  BUNNY_TOKEN_AUTH_KEY: {
    section: 'Vidéo',
    origin: 'Bunny.net → Stream → sécurité → clé d’authentification par jeton',
  },
  AI_ENABLED: { section: 'IA', origin: 'commutateur produit de l’assistant' },
  ANTHROPIC_API_KEY: { section: 'IA', origin: 'console Anthropic → API keys' },
  AI_MODEL_CHAT: { section: 'IA', origin: 'identifiant de modèle Anthropic' },
  AI_MODEL_REASONING: { section: 'IA', origin: 'identifiant de modèle Anthropic' },
  EMBEDDINGS_PROVIDER: { section: 'IA', origin: 'voyage (API distante) ou local' },
  VOYAGE_API_KEY: { section: 'IA', origin: 'tableau de bord Voyage AI → API keys' },
  AI_DAILY_TOKEN_BUDGET_PER_USER: { section: 'IA', origin: 'garde-fou de coût, choix produit' },
  AI_MONTHLY_COST_CAP_USD: { section: 'IA', origin: 'garde-fou de coût, choix produit' },
  CRON_SECRET: { section: 'Tâches planifiées', origin: 'à générer : openssl rand -hex 24' },
  SENTRY_DSN: { section: 'Optionnel', origin: 'Sentry → paramètres du projet → Client Keys (DSN)' },
  NEXT_PUBLIC_GA_ID: {
    section: 'Optionnel',
    origin: 'Google Analytics → administration → flux de données',
  },
  MAINTENANCE_MODE: { section: 'Optionnel', origin: 'commutateur d’exploitation' },
}

/* ────────────────────────────────────────────────────────────────────────────
 * Fabriques de schémas
 * ────────────────────────────────────────────────────────────────────────── */

const REQUIRED = { required_error: 'est obligatoire : aucune valeur n’est définie' } as const

/** Une variable absente et une variable vide sont la même chose dans un `.env`. */
function normalize(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function isPresent(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, '')
}

const URL_MESSAGE = 'doit être une URL absolue valide, schéma inclus (https://…)'
const SCHEME_MESSAGE = 'doit utiliser le schéma http:// ou https://'

function hasHttpScheme(value: string): boolean {
  return /^https?:\/\//iu.test(value)
}

const requiredString = z.preprocess(normalize, z.string(REQUIRED).min(1, 'ne peut pas être vide'))

const optionalString = z.preprocess(normalize, z.string().optional())

function stringWithDefault(fallback: string) {
  return z.preprocess(normalize, z.string().default(fallback))
}

const requiredUrl = z.preprocess(
  normalize,
  z
    .string(REQUIRED)
    .url(URL_MESSAGE)
    .refine(hasHttpScheme, SCHEME_MESSAGE)
    .transform(stripTrailingSlashes),
)

const optionalUrl = z.preprocess(
  normalize,
  z
    .string()
    .url(URL_MESSAGE)
    .refine(hasHttpScheme, SCHEME_MESSAGE)
    .transform(stripTrailingSlashes)
    .optional(),
)

const databaseUrl = z.preprocess(
  normalize,
  z
    .string(REQUIRED)
    .min(1, 'ne peut pas être vide')
    .refine(
      (value) => value.startsWith('mysql://'),
      'doit commencer par mysql:// (le provider Prisma du projet est mysql)',
    ),
)

const requiredEmail = z.preprocess(
  normalize,
  z.string(REQUIRED).email('doit être une adresse e-mail valide'),
)

const emailProbe = z.string().email()

/** « a@x.ma, b@x.ma » → ['a@x.ma', 'b@x.ma'], chaque entrée validée. */
const emailList = z.preprocess(
  normalize,
  z
    .string(REQUIRED)
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    )
    .superRefine((list, ctx) => {
      if (list.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'doit contenir au moins une adresse e-mail',
        })
        return
      }
      for (const entry of list) {
        if (!emailProbe.safeParse(entry).success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `contient une adresse e-mail invalide : « ${entry} »`,
          })
        }
      }
    }),
)

function enumErrorMap(values: readonly string[]): z.ZodErrorMap {
  return (issue) => {
    if (issue.code === z.ZodIssueCode.invalid_type && issue.received === 'undefined') {
      return { message: REQUIRED.required_error }
    }
    return { message: `doit valoir ${values.join(', ')}` }
  }
}

function requiredEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(normalize, z.enum(values, { errorMap: enumErrorMap(values) }))
}

function enumWithDefault<T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
  return z.preprocess(
    normalize,
    z.enum(values, { errorMap: enumErrorMap(values) }).default(fallback),
  )
}

const BOOLEAN_VALUES = ['true', 'false', '1', '0'] as const

/** Accepte true/false/1/0, insensible à la casse. Tout le reste est rejeté. */
function booleanWithDefault(fallback: 'true' | 'false') {
  return z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value
      const trimmed = value.trim().toLowerCase()
      return trimmed === '' ? undefined : trimmed
    },
    z
      .enum(BOOLEAN_VALUES, {
        errorMap: () => ({ message: 'doit valoir true, false, 1 ou 0' }),
      })
      .default(fallback)
      .transform((value) => value === 'true' || value === '1'),
  )
}

function integerWithDefault(fallback: number, min: number, max: number) {
  return z.preprocess(
    normalize,
    z.coerce
      .number({ invalid_type_error: 'doit être un nombre' })
      .int('doit être un nombre entier')
      .min(min, `doit être supérieur ou égal à ${min}`)
      .max(max, `doit être inférieur ou égal à ${max}`)
      .default(fallback),
  )
}

function decimalWithDefault(fallback: number, min: number, max: number) {
  return z.preprocess(
    normalize,
    z.coerce
      .number({ invalid_type_error: 'doit être un nombre' })
      .min(min, `doit être supérieur ou égal à ${min}`)
      .max(max, `doit être inférieur ou égal à ${max}`)
      .default(fallback),
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Schéma serveur
 * ────────────────────────────────────────────────────────────────────────── */

const serverShape = z.object({
  // Cœur
  NODE_ENV: enumWithDefault(['development', 'test', 'production'] as const, 'development'),
  PORT: integerWithDefault(3000, 1, 65535),
  APP_URL: requiredUrl,
  NEXT_PUBLIC_APP_URL: requiredUrl,

  // Base de données
  DATABASE_URL: databaseUrl,

  // Authentification
  AUTH_SECRET: stringWithDefault(''),
  AUTH_TRUST_HOST: booleanWithDefault('true'),
  SESSION_MAX_AGE_DAYS: integerWithDefault(30, 1, 365),

  // Courriel
  SMTP_HOST: requiredString,
  SMTP_PORT: integerWithDefault(465, 1, 65535),
  SMTP_SECURE: booleanWithDefault('true'),
  SMTP_USER: requiredString,
  SMTP_PASSWORD: stringWithDefault(''),
  MAIL_FROM_NAME: requiredString,
  MAIL_FROM_ADDRESS: requiredEmail,
  MAIL_ADMIN_RECIPIENTS: emailList,

  // Stockage
  STORAGE_DRIVER: requiredEnum(['s3', 'local'] as const),
  S3_ENDPOINT: optionalUrl,
  S3_REGION: stringWithDefault('auto'),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_PUBLIC_BASE_URL: optionalUrl,
  LOCAL_STORAGE_PATH: optionalString,

  // Vidéo
  VIDEO_PROVIDER: requiredEnum(['bunny', 'cloudflare', 'vimeo', 'youtube'] as const),
  BUNNY_STREAM_LIBRARY_ID: optionalString,
  BUNNY_STREAM_API_KEY: optionalString,
  BUNNY_STREAM_CDN_HOSTNAME: optionalString,
  BUNNY_TOKEN_AUTH_KEY: optionalString,

  // IA
  AI_ENABLED: booleanWithDefault('false'),
  ANTHROPIC_API_KEY: optionalString,
  AI_MODEL_CHAT: stringWithDefault('claude-haiku-4-5-20251001'),
  AI_MODEL_REASONING: stringWithDefault('claude-sonnet-5'),
  EMBEDDINGS_PROVIDER: requiredEnum(['voyage', 'local'] as const),
  VOYAGE_API_KEY: optionalString,
  AI_DAILY_TOKEN_BUDGET_PER_USER: integerWithDefault(60_000, 1_000, 10_000_000),
  AI_MONTHLY_COST_CAP_USD: decimalWithDefault(150, 0, 100_000),

  // Tâches planifiées
  CRON_SECRET: stringWithDefault(''),

  // Optionnel
  SENTRY_DSN: optionalUrl,
  NEXT_PUBLIC_GA_ID: optionalString,
  MAINTENANCE_MODE: booleanWithDefault('false'),
})

const AUTH_SECRET_MIN = 32
const CRON_SECRET_MIN = 24

export const serverSchema = serverShape.superRefine((value, ctx) => {
  const demand = (key: string, candidate: string | undefined, reason: string): void => {
    if (candidate === undefined || candidate.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `est obligatoire ${reason}`,
      })
    }
  }

  if (value.STORAGE_DRIVER === 's3') {
    const reason = 'lorsque STORAGE_DRIVER vaut s3'
    demand('S3_ENDPOINT', value.S3_ENDPOINT, reason)
    demand('S3_BUCKET', value.S3_BUCKET, reason)
    demand('S3_ACCESS_KEY_ID', value.S3_ACCESS_KEY_ID, reason)
    demand('S3_SECRET_ACCESS_KEY', value.S3_SECRET_ACCESS_KEY, reason)
  }

  if (value.STORAGE_DRIVER === 'local') {
    demand('LOCAL_STORAGE_PATH', value.LOCAL_STORAGE_PATH, 'lorsque STORAGE_DRIVER vaut local')
  }

  if (value.AI_ENABLED) {
    demand('ANTHROPIC_API_KEY', value.ANTHROPIC_API_KEY, 'lorsque AI_ENABLED vaut true')
  }

  if (value.EMBEDDINGS_PROVIDER === 'voyage') {
    demand('VOYAGE_API_KEY', value.VOYAGE_API_KEY, 'lorsque EMBEDDINGS_PROVIDER vaut voyage')
  }

  if (value.VIDEO_PROVIDER === 'bunny') {
    const reason = 'lorsque VIDEO_PROVIDER vaut bunny'
    demand('BUNNY_STREAM_LIBRARY_ID', value.BUNNY_STREAM_LIBRARY_ID, reason)
    demand('BUNNY_STREAM_API_KEY', value.BUNNY_STREAM_API_KEY, reason)
    demand('BUNNY_STREAM_CDN_HOSTNAME', value.BUNNY_STREAM_CDN_HOSTNAME, reason)
    demand('BUNNY_TOKEN_AUTH_KEY', value.BUNNY_TOKEN_AUTH_KEY, reason)
  }

  if (value.NODE_ENV === 'production') {
    if (value.AUTH_SECRET.length < AUTH_SECRET_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_SECRET'],
        message: `est obligatoire en production et doit compter au moins ${AUTH_SECRET_MIN} caractères (actuellement ${value.AUTH_SECRET.length})`,
      })
    }
    if (value.CRON_SECRET.length < CRON_SECRET_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CRON_SECRET'],
        message: `est obligatoire en production et doit compter au moins ${CRON_SECRET_MIN} caractères (actuellement ${value.CRON_SECRET.length})`,
      })
    }
    if (value.SMTP_PASSWORD.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_PASSWORD'],
        message: 'est obligatoire en production : sans elle, aucun courriel ne peut partir',
      })
    }
  }
})

export type Env = z.infer<typeof serverSchema>

/* ────────────────────────────────────────────────────────────────────────────
 * Schéma client — uniquement NEXT_PUBLIC_*
 * ────────────────────────────────────────────────────────────────────────── */

export const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: requiredUrl,
  NEXT_PUBLIC_GA_ID: optionalString,
})

export type ClientEnv = z.infer<typeof clientSchema>

/* ────────────────────────────────────────────────────────────────────────────
 * Rapport d'erreur groupé
 * ────────────────────────────────────────────────────────────────────────── */

const RULE = '─'.repeat(78)

function metaFor(variable: string): VariableMeta {
  return META[variable] ?? { section: 'Autres', origin: 'non documentée dans .env.example' }
}

function groupIssues(issues: readonly ZodIssue[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>()
  for (const issue of issues) {
    const head = issue.path[0]
    const variable = typeof head === 'string' ? head : '(racine)'
    const bucket = grouped.get(variable)
    if (bucket === undefined) {
      grouped.set(variable, [issue.message])
    } else if (!bucket.includes(issue.message)) {
      bucket.push(issue.message)
    }
  }
  return grouped
}

function formatReport(title: string, issues: readonly ZodIssue[]): string {
  const grouped = groupIssues(issues)
  const lines: string[] = [
    '',
    RULE,
    ` ${title}`,
    ` ${grouped.size} variable(s) à corriger. Le processus s’arrête maintenant.`,
    ' Référence : .env.example à la racine du dépôt · docs/DEPLOYMENT.md',
    RULE,
  ]

  for (const section of SECTIONS) {
    const entries = [...grouped.entries()].filter(
      ([variable]) => metaFor(variable).section === section,
    )
    if (entries.length === 0) continue

    lines.push('', `  ${section}`)
    for (const [variable, messages] of entries) {
      lines.push(`    ✗ ${variable}`)
      for (const message of messages) {
        lines.push(`        ${message}`)
      }
      lines.push(`        provenance : ${metaFor(variable).origin}`)
    }
  }

  lines.push('', RULE, '')
  return lines.join('\n')
}

function fail(title: string, issues: readonly ZodIssue[]): never {
  const report = formatReport(title, issues)
  if (typeof process !== 'undefined' && typeof process.exit === 'function') {
    console.error(report)
    process.exit(1)
  }
  throw new Error(report)
}

/* ────────────────────────────────────────────────────────────────────────────
 * Repli de développement + mode SKIP_ENV_VALIDATION
 * ────────────────────────────────────────────────────────────────────────── */

const DEV_AUTH_SECRET = 'dev-insecure-auth-secret-do-not-use-in-production'
const DEV_CRON_SECRET = 'dev-insecure-cron-secret-do-not-use-in-production'

/** Valeurs de remplissage manifestement factices, utilisées seulement sous SKIP_ENV_VALIDATION. */
const BUILD_PLACEHOLDERS: Readonly<Record<string, string>> = {
  APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://build:build@localhost:3306/build',
  AUTH_SECRET: 'skip-env-validation-placeholder-auth-secret-value',
  SMTP_HOST: 'smtp.invalid',
  SMTP_USER: 'build@example.invalid',
  SMTP_PASSWORD: 'skip-env-validation-placeholder',
  MAIL_FROM_NAME: 'CFI',
  MAIL_FROM_ADDRESS: 'build@example.invalid',
  MAIL_ADMIN_RECIPIENTS: 'build@example.invalid',
  STORAGE_DRIVER: 'local',
  LOCAL_STORAGE_PATH: './.storage',
  S3_ENDPOINT: 'https://build.invalid',
  S3_BUCKET: 'build',
  S3_ACCESS_KEY_ID: 'build',
  S3_SECRET_ACCESS_KEY: 'build',
  VIDEO_PROVIDER: 'bunny',
  BUNNY_STREAM_LIBRARY_ID: '0',
  BUNNY_STREAM_API_KEY: 'build',
  BUNNY_STREAM_CDN_HOSTNAME: 'build.invalid',
  BUNNY_TOKEN_AUTH_KEY: 'build',
  EMBEDDINGS_PROVIDER: 'local',
  ANTHROPIC_API_KEY: 'skip-env-validation-placeholder',
  VOYAGE_API_KEY: 'skip-env-validation-placeholder',
  CRON_SECRET: 'skip-env-validation-placeholder-cron',
}

type RawEnv = Record<string, string | undefined>

function applyPlaceholders(raw: RawEnv): RawEnv {
  const filled: RawEnv = { ...raw }
  for (const [key, placeholder] of Object.entries(BUILD_PLACEHOLDERS)) {
    if (!isPresent(filled[key])) filled[key] = placeholder
  }
  return filled
}

interface Prepared {
  readonly raw: RawEnv
  readonly warnings: readonly string[]
}

/**
 * Hors production, AUTH_SECRET et CRON_SECRET peuvent retomber sur une valeur
 * de développement explicitement marquée comme non sûre — avec un avertissement.
 */
function applyDevFallbacks(source: RawEnv): Prepared {
  const raw: RawEnv = { ...source }
  const warnings: string[] = []
  const isProduction = (raw.NODE_ENV ?? '').trim() === 'production'
  if (isProduction) return { raw, warnings }

  const authSecret = raw.AUTH_SECRET
  if (!isPresent(authSecret)) {
    raw.AUTH_SECRET = DEV_AUTH_SECRET
    warnings.push(
      'AUTH_SECRET n’est pas définie : repli sur une valeur de développement NON SÛRE. Générez-en une avec « openssl rand -base64 48 ».',
    )
  } else if (authSecret.trim().length < AUTH_SECRET_MIN) {
    warnings.push(
      `AUTH_SECRET compte moins de ${AUTH_SECRET_MIN} caractères : toléré en développement, refusé en production.`,
    )
  }

  const cronSecret = raw.CRON_SECRET
  if (!isPresent(cronSecret)) {
    raw.CRON_SECRET = DEV_CRON_SECRET
    warnings.push(
      'CRON_SECRET n’est pas définie : repli sur une valeur de développement NON SÛRE. Générez-en une avec « openssl rand -hex 24 ».',
    )
  } else if (cronSecret.trim().length < CRON_SECRET_MIN) {
    warnings.push(
      `CRON_SECRET compte moins de ${CRON_SECRET_MIN} caractères : toléré en développement, refusé en production.`,
    )
  }

  return { raw, warnings }
}

let warningsEmitted = false

function emitWarnings(warnings: readonly string[]): void {
  if (warningsEmitted || warnings.length === 0) return
  warningsEmitted = true
  const lines = ['', RULE, ' CFI — avertissements de configuration', RULE]
  for (const warning of warnings) lines.push(`  ! ${warning}`)
  lines.push(RULE, '')
  console.warn(lines.join('\n'))
}

/* ────────────────────────────────────────────────────────────────────────────
 * Chargement
 * ────────────────────────────────────────────────────────────────────────── */

function readProcessEnv(): RawEnv {
  if (typeof process === 'undefined') return {}
  return { ...process.env }
}

function skipValidation(): boolean {
  if (typeof process === 'undefined') return false
  return isPresent(process.env.SKIP_ENV_VALIDATION)
}

const SKIP_WARNING =
  'SKIP_ENV_VALIDATION est définie : la validation de l’environnement est neutralisée et des valeurs factices sont substituées. Ne jamais utiliser ce mode sur le serveur d’exécution.'

function loadServerEnv(): Env {
  const skip = skipValidation()
  const skipWarnings = skip ? [SKIP_WARNING] : []
  const source = skip ? applyPlaceholders(readProcessEnv()) : readProcessEnv()
  const { raw, warnings } = applyDevFallbacks(source)

  const parsed = serverSchema.safeParse(raw)
  if (parsed.success) {
    emitWarnings([...skipWarnings, ...warnings])
    return parsed.data
  }

  if (skip) {
    // Mode build/CI : on neutralise les variables fautives et on repart des
    // valeurs de remplissage plutôt que d'arrêter le processus.
    const relaxed: RawEnv = { ...raw }
    for (const issue of parsed.error.issues) {
      const head = issue.path[0]
      if (typeof head === 'string') relaxed[head] = undefined
    }
    const retried = serverSchema.safeParse(applyPlaceholders(relaxed))
    if (retried.success) {
      const substituted = [...groupIssues(parsed.error.issues).keys()].map(
        (variable) => `${variable} : valeur absente ou invalide, remplacée pour le build.`,
      )
      emitWarnings([...skipWarnings, ...substituted])
      return retried.data
    }
  }

  return fail('CFI — configuration d’environnement serveur invalide', parsed.error.issues)
}

let cachedServerEnv: Env | null = null

function serverEnv(): Env {
  if (typeof window !== 'undefined') {
    throw new Error(
      '`env` contient des secrets serveur et ne doit jamais être lu depuis le navigateur. Importez `clientEnv` dans les composants client.',
    )
  }
  if (cachedServerEnv === null) cachedServerEnv = loadServerEnv()
  return cachedServerEnv
}

/**
 * Environnement serveur. Validé paresseusement au premier accès — et cet accès
 * a lieu dès le chargement du module côté serveur (voir plus bas), de sorte
 * qu'une configuration invalide arrête le processus au démarrage, pas au milieu
 * d'une requête.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, property) {
    if (typeof property !== 'string') return undefined
    return serverEnv()[property as keyof Env]
  },
  has(_target, property) {
    return typeof property === 'string' && property in serverEnv()
  },
  ownKeys() {
    return Reflect.ownKeys(serverEnv())
  },
  getOwnPropertyDescriptor(_target, property) {
    return Object.getOwnPropertyDescriptor(serverEnv(), property)
  },
  set() {
    throw new Error('L’environnement est en lecture seule.')
  },
  deleteProperty() {
    throw new Error('L’environnement est en lecture seule.')
  },
})

// Validation immédiate côté serveur : le processus s'arrête au démarrage plutôt
// que de servir des requêtes avec une configuration cassée. Placée avant la
// validation client pour que l'opérateur voie d'abord le rapport complet.
if (typeof window === 'undefined') {
  serverEnv()
}

/* ────────────────────────────────────────────────────────────────────────────
 * Environnement client
 * ────────────────────────────────────────────────────────────────────────── */

function loadClientEnv(): ClientEnv {
  // Accès littéraux obligatoires : Next.js n'inline `process.env.NEXT_PUBLIC_*`
  // dans le bundle navigateur que sous cette forme.
  const raw: RawEnv = {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_GA_ID: process.env.NEXT_PUBLIC_GA_ID,
  }

  const source = skipValidation() ? applyPlaceholders(raw) : raw
  const parsed = clientSchema.safeParse(source)
  if (parsed.success) return parsed.data

  if (skipValidation()) {
    const retried = clientSchema.safeParse(
      applyPlaceholders({ NEXT_PUBLIC_APP_URL: undefined, NEXT_PUBLIC_GA_ID: undefined }),
    )
    if (retried.success) return retried.data
  }

  return fail('CFI — configuration d’environnement client invalide', parsed.error.issues)
}

/** Variables exposées au navigateur. Aucun secret ne peut transiter par ici. */
export const clientEnv: ClientEnv = loadClientEnv()
