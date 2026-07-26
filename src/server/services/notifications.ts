/**
 * In-app notifications and the outbound e-mail queue (spec §18).
 *
 * Two related jobs live here because they are two faces of the same event: §18's
 * table pairs almost every e-mail with a bell icon in the header.
 *
 * ## Notifications never store a rendered sentence
 * A `Notification` row holds a **`titleKey`** (`notifications.accountApproved`)
 * and a JSON `payload` of parameters. The locale is resolved when the row is
 * *read*, so a student who switches from French to Arabic sees their whole
 * history in Arabic — which would be impossible if the French string had been
 * baked in at write time (§10.2).
 *
 * ## E-mail is queued, never sent inline
 * §18: "Send through the `Job` queue with retry (3 attempts, exponential
 * backoff) so a flaky SMTP never loses a notification." {@link queueEmail}
 * therefore writes one `Job` row and returns. The `drain` cron (§19.5) picks it
 * up, renders the template in `src/server/mail/templates/*`, sends it and writes
 * the `EmailLog` row. Nothing in this file opens a socket.
 *
 * ### The job payload contract
 * ```jsonc
 * {
 *   "template": "verify-email",          // EmailTemplate.id
 *   "to": ["etudiant@example.ma"],       // resolved addresses
 *   "locale": "fr",                      // recipient's locale, drives copy + dir
 *   "props": { … },                      // validated by the template's own zod schema
 *   "idempotencyKey": "verify-email:tok_123:etudiant@example.ma",
 *   "relatedType": "VerificationToken",  // → EmailLog.relatedType
 *   "relatedId": "tok_123",              // → EmailLog.relatedId
 *   "userId": "usr_123"                  // optional, for the admin e-mail log
 * }
 * ```
 * `props` crosses a JSON boundary, so it carries ISO strings, never `Date`s.
 */

import { Prisma, type Locale, type Role } from '@prisma/client';

import { db } from '@/server/db';
import { sendMailInputSchema, validateTemplateProps } from '@/server/mail/send';
import { env } from '@/lib/env';
import type { AccountEmailTemplateId } from './accounts/state-machine';

/** A Prisma client or an interactive-transaction client. */
export type NotificationDbClient = Prisma.TransactionClient;

/* -------------------------------------------------------------------------- */
/* Notification vocabulary                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `Notification.type` values. The column is a free `String` in the schema; this
 * union is what keeps it from becoming one in practice.
 *
 * Milestone 1 covers the account lifecycle and the password events. The
 * enrolment, grading and community types from §18 rows 6–12 and 16–26 are added
 * by the milestones that build those flows — an unused type here would be a
 * promise the UI cannot keep.
 */
export const NOTIFICATION_TYPES = [
  /** §18 row 2 — e-mail verified, human review pending. */
  'ACCOUNT_PENDING_APPROVAL',
  /** §18 row 3 — for administrators: an account is waiting in the queue. */
  'ACCOUNT_AWAITING_REVIEW',
  /** §18 row 4 — the account was validated. */
  'ACCOUNT_APPROVED',
  /** Suspension: carries the reason and the end date. */
  'ACCOUNT_SUSPENDED',
  /** Reinstatement after a suspension. */
  'ACCOUNT_REINSTATED',
  /** §18 row 14 — the password was changed. */
  'PASSWORD_CHANGED',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * i18n key carrying each notification's title. The messages catalogue must
 * provide every one of them under the `notifications` namespace; the `payload`
 * supplies the placeholders.
 */
export const NOTIFICATION_TITLE_KEYS: Record<NotificationType, string> = {
  ACCOUNT_PENDING_APPROVAL: 'notifications.accountPendingApproval',
  ACCOUNT_AWAITING_REVIEW: 'notifications.accountAwaitingReview',
  ACCOUNT_APPROVED: 'notifications.accountApproved',
  ACCOUNT_SUSPENDED: 'notifications.accountSuspended',
  ACCOUNT_REINSTATED: 'notifications.accountReinstated',
  PASSWORD_CHANGED: 'notifications.passwordChanged',
};

/** JSON-safe parameter for a notification title or an e-mail template. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type NotificationPayload = Readonly<Record<string, JsonValue>>;

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export interface CreateNotificationInput {
  readonly userId: string;
  readonly type: NotificationType;
  /** Placeholders for the title, e.g. `{ courseTitle: 'Marketing digital' }`. */
  readonly payload?: NotificationPayload;
  /**
   * Where the bell menu sends the user. A **locale-relative** path
   * (`/espace/profil`); the renderer prefixes the reader's locale, so the link
   * does not freeze the language it was created in.
   */
  readonly link?: string | null;
  /** Override the default key — only for a variant of the same type. */
  readonly titleKey?: string;
}

export interface NotificationView {
  readonly id: string;
  readonly type: string;
  readonly titleKey: string;
  readonly payload: NotificationPayload;
  readonly link: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

/**
 * Create one notification.
 *
 * Pass `client` to commit it with the change that caused it — a notification
 * about an approval that rolled back is worse than no notification.
 */
export async function createNotification(
  input: CreateNotificationInput,
  client: NotificationDbClient = db,
): Promise<void> {
  const payload = input.payload ?? {};

  await client.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      titleKey: input.titleKey ?? NOTIFICATION_TITLE_KEYS[input.type],
      payload: Object.keys(payload).length === 0 ? Prisma.DbNull : toJsonObject(payload),
      link: input.link ?? null,
    },
  });
}

/**
 * Create the same notification for several recipients in one statement — the
 * administrators, when an account lands in the review queue.
 */
export async function createNotifications(
  userIds: readonly string[],
  input: Omit<CreateNotificationInput, 'userId'>,
  client: NotificationDbClient = db,
): Promise<number> {
  if (userIds.length === 0) return 0;

  const payload = input.payload ?? {};
  const serialized = Object.keys(payload).length === 0 ? Prisma.DbNull : toJsonObject(payload);

  const result = await client.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: input.type,
      titleKey: input.titleKey ?? NOTIFICATION_TITLE_KEYS[input.type],
      payload: serialized,
      link: input.link ?? null,
    })),
  });

  return result.count;
}

/**
 * Mark one notification read.
 *
 * Scoped by `userId` in the `where` clause, not checked afterwards: a student
 * must not be able to mark someone else's notification read by guessing an id
 * (§20 "every DB query in a service scoped by the actor"). Already-read rows are
 * left alone so the original timestamp survives.
 */
export async function markRead(
  userId: string,
  notificationId: string,
  client: NotificationDbClient = db,
): Promise<boolean> {
  const result = await client.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count > 0;
}

/** Mark every unread notification of a user read. Returns how many were touched. */
export async function markAllRead(
  userId: string,
  client: NotificationDbClient = db,
): Promise<number> {
  const result = await client.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

/** The badge count on the bell. Served by the `[userId, readAt, createdAt]` index. */
export async function unreadCount(
  userId: string,
  client: NotificationDbClient = db,
): Promise<number> {
  return client.notification.count({ where: { userId, readAt: null } });
}

export interface ListNotificationsOptions {
  readonly onlyUnread?: boolean;
  /** Page size, newest first. Clamped to {@link NOTIFICATION_PAGE_MAX}. */
  readonly limit?: number;
  /** Keyset cursor: the id of the last row of the previous page. */
  readonly cursor?: string | null;
}

export const NOTIFICATION_PAGE_DEFAULT = 20;
export const NOTIFICATION_PAGE_MAX = 100;

export interface NotificationPage {
  readonly items: readonly NotificationView[];
  /** Pass as `cursor` to fetch the next page; `null` when the list is exhausted. */
  readonly nextCursor: string | null;
}

/**
 * The notification list, newest first, keyset-paginated.
 *
 * A cursor rather than `skip`: the list grows at the head while the user reads
 * it, and an offset would show them the same row twice.
 */
export async function listNotifications(
  userId: string,
  options: ListNotificationsOptions = {},
  client: NotificationDbClient = db,
): Promise<NotificationPage> {
  const limit = clamp(options.limit ?? NOTIFICATION_PAGE_DEFAULT, 1, NOTIFICATION_PAGE_MAX);
  const cursor = options.cursor ?? null;

  const rows = await client.notification.findMany({
    where: {
      userId,
      ...(options.onlyUnread === true ? { readAt: null } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // One extra row tells us whether another page exists without a second query.
    take: limit + 1,
    ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
    select: {
      id: true,
      type: true,
      titleKey: true,
      payload: true,
      link: true,
      readAt: true,
      createdAt: true,
    },
  });

  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    items: page.map((row) => ({
      id: row.id,
      type: row.type,
      titleKey: row.titleKey,
      payload: readJsonObject(row.payload),
      link: row.link,
      readAt: row.readAt,
      createdAt: row.createdAt,
    })),
    nextCursor: rows.length > limit && last !== undefined ? last.id : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Administrators                                                              */
/* -------------------------------------------------------------------------- */

const ADMIN_ROLES: readonly Role[] = ['ADMIN', 'SUPER_ADMIN'];

/**
 * Ids of the administrators who should receive an in-app notification.
 *
 * Only `ACTIVE`, non-deleted accounts: notifying a suspended administrator fills
 * a bell nobody will ever open.
 */
export async function adminUserIds(client: NotificationDbClient = db): Promise<readonly string[]> {
  const rows = await client.user.findMany({
    where: { role: { in: [...ADMIN_ROLES] }, status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/* -------------------------------------------------------------------------- */
/* E-mail queue                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every e-mail template this milestone can queue, by its `EmailTemplate.id`.
 *
 * The account-lifecycle subset is declared by the state machine so the machine
 * stays free of database imports; the union below is the authority the mail
 * layer registers against.
 */
export type EmailTemplateId =
  | AccountEmailTemplateId
  /** #1 — « Confirmez votre adresse e-mail ». */
  | 'verify-email'
  /** #13 — « Réinitialisation du mot de passe ». */
  | 'password-reset'
  /** #14 — « Votre mot de passe a été modifié ». */
  | 'password-changed'
  /** #15 — « Nouvelle connexion détectée ». */
  | 'new-device-login';

/** `Job.type` of a queued outbound e-mail. The `drain` cron dispatches on it. */
export const SEND_EMAIL_JOB = 'SEND_EMAIL';

export interface QueueEmailInput {
  readonly template: EmailTemplateId;
  /** Resolved recipient addresses. At least one; duplicates are removed. */
  readonly to: readonly string[];
  /** Drives the copy and the text direction of the rendered message. */
  readonly locale: Locale;
  /** Template props — JSON only, validated against the template's own schema when it renders. */
  readonly props: Readonly<Record<string, JsonValue>>;
  /** `EmailLog.relatedType`, e.g. `User`, `VerificationToken`. */
  readonly relatedType?: string | null;
  readonly relatedId?: string | null;
  /** Recipient account, when there is one — powers the per-user e-mail log. */
  readonly userId?: string | null;
  /**
   * Override the derived key. §18: "Never send more than one e-mail per event
   * per recipient (idempotency key = `template:relatedId:recipient`)". Override
   * it only when the natural key would be wrong — a resent verification link
   * keys on the *token*, not the user, or the second link would be swallowed.
   */
  readonly idempotencyKey?: string;
  /** Delay the first attempt — reminders, digests. Defaults to "now". */
  readonly runAfter?: Date;
}

/** §18: three attempts with exponential backoff, applied by the `drain` cron. */
export const EMAIL_MAX_ATTEMPTS = 3;

/**
 * Queue one outbound e-mail.
 *
 * Pass `client` to enqueue it inside the transaction that caused it: the job row
 * and the state change commit together, so a rolled-back approval can never
 * leave a « votre compte est validé » in the queue.
 *
 * Returns the `Job` id, or `null` when there was no usable recipient — which is
 * a configuration problem for the diagnostics page, not a reason to fail a
 * student's registration.
 */
export async function queueEmail(
  input: QueueEmailInput,
  client: NotificationDbClient = db,
): Promise<string | null> {
  const recipients = normalizeRecipients(input.to);
  if (recipients.length === 0) return null;

  const payload: SendEmailJobPayload = {
    template: input.template,
    to: recipients,
    locale: input.locale,
    props: input.props,
    idempotencyKey:
      input.idempotencyKey ?? defaultIdempotencyKey(input.template, input.relatedId, recipients),
    relatedType: input.relatedType ?? null,
    relatedId: input.relatedId ?? null,
    userId: input.userId ?? null,
  };

  // Validate HERE, not when the cron eventually runs it.
  //
  // A malformed payload is a code defect, not a transient fault: retrying it
  // three times cannot help. Validating only inside the runner meant a missing
  // template prop surfaced as a silent RETRY loop in a cron summary nobody
  // reads — while the administrator had already been told the mail was sent.
  // That shipped: `account-approved` omitted `catalogUrl`, so every welcome
  // e-mail failed and no newly approved student was ever notified.
  //
  // Throwing rolls back the surrounding transaction, which is the correct
  // trade: an approval whose student is never told is worse than a visible
  // failure the administrator can retry.
  const validation = sendMailInputSchema.safeParse(payload);
  if (!validation.success) {
    const detail = validation.error.issues
      .map((issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join(' · ');
    throw new Error(`Enveloppe d’e-mail invalide pour « ${input.template} » — ${detail}`);
  }

  // The envelope types `props` as `unknown`, so it alone would have accepted the
  // `account-approved` payload that was missing `catalogUrl`. Check the props
  // against the TEMPLATE's own schema too, which is the check that actually
  // catches a caller passing the wrong shape.
  const propsError = validateTemplateProps(input.template, input.props);
  if (propsError !== null) {
    throw new Error(`Props d’e-mail invalides pour « ${input.template} » — ${propsError}`);
  }

  const job = await client.job.create({
    data: {
      type: SEND_EMAIL_JOB,
      payload: toJsonObject(payload as unknown as Readonly<Record<string, JsonValue>>),
      maxAttempts: EMAIL_MAX_ATTEMPTS,
      ...(input.runAfter === undefined ? {} : { runAfter: input.runAfter }),
    },
    select: { id: true },
  });

  return job.id;
}

/** The exact shape the `drain` cron reads back out of `Job.payload`. */
export interface SendEmailJobPayload {
  readonly template: EmailTemplateId;
  readonly to: readonly string[];
  readonly locale: Locale;
  readonly props: Readonly<Record<string, JsonValue>>;
  readonly idempotencyKey: string;
  readonly relatedType: string | null;
  readonly relatedId: string | null;
  readonly userId: string | null;
}

/** `template:relatedId:recipient` — §18's idempotency key. */
function defaultIdempotencyKey(
  template: string,
  relatedId: string | null | undefined,
  recipients: readonly string[],
): string {
  return `${template}:${relatedId ?? 'none'}:${recipients.join(',')}`;
}

function normalizeRecipients(addresses: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  for (const address of addresses) {
    if (typeof address !== 'string') continue;
    const normalized = address.trim().toLowerCase();
    if (normalized !== '' && normalized.includes('@')) seen.add(normalized);
  }
  return [...seen];
}

/**
 * The internal recipients of the administration e-mails (#3, #7, …), from
 * `MAIL_ADMIN_RECIPIENTS`.
 *
 * Read from the validated environment rather than from the administrator rows:
 * §18 addresses these to a mailbox the center actually watches, which is often a
 * shared `contact@` and not a personal account.
 */
export function adminEmailRecipients(): readonly string[] {
  return normalizeRecipients(env.MAIL_ADMIN_RECIPIENTS);
}

/* -------------------------------------------------------------------------- */
/* Absolute URLs for e-mail bodies                                             */
/* -------------------------------------------------------------------------- */

/**
 * Build an absolute, locale-prefixed URL for an e-mail body.
 *
 * A message has no request context, so every link in it must be absolute and
 * carry its locale explicitly (§10.1: every URL is locale-prefixed).
 */
export function absoluteUrl(locale: Locale, path: string): string {
  const base = env.APP_URL.replace(/\/+$/u, '');
  const suffix = path === '' || path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  return `${base}/${locale}${suffix}`;
}

/**
 * The routes the account e-mails link to. Centralised here so the services and
 * the pages that must exist agree on one spelling (§5: French slugs, identical
 * in every locale).
 */
export const ACCOUNT_ROUTES = {
  /**
   * Where e-mail #1's button lands, carrying the raw token.
   *
   * `/verifier/…` — the token-CONSUMING route, distinct from
   * `/verification-email`, which is the "check your inbox" screen and takes no
   * token. Getting these two confused shipped a verification link that 404'd,
   * which silently broke the whole account lifecycle: the address could never
   * be confirmed, so no account could ever reach PENDING_APPROVAL.
   * `scripts/check-routes.ts` now asserts every path here resolves.
   */
  verifyEmail: (token: string) => `/verifier/${encodeURIComponent(token)}`,
  /** The waiting screen of §9.1. */
  waiting: () => '/compte-en-attente',
  login: () => '/connexion',
  /** Where e-mail #13's button lands, carrying the raw token. */
  resetPassword: (token: string) => `/reinitialiser/${encodeURIComponent(token)}`,
  /** Deep link into the review drawer of §17.2. */
  adminAccount: (userId: string) => `/admin/comptes/${encodeURIComponent(userId)}`,
  /**
   * « Découvrez nos formations » in the welcome e-mail (#4).
   *
   * The catalogue proper is §12.3 and arrives with M2. Until it exists this is
   * the home page: a welcome e-mail is the first thing a newly approved student
   * opens, and a 404 there is a worse first impression than one extra click.
   * Point this at `/formations` when M2 lands — `check-routes.ts` verifies it.
   */
  catalog: () => '/',
  /**
   * « Ce n'était pas vous ? » — the student's own security page.
   *
   * That page is built in §13.4 (a later milestone). Until it exists, point at
   * the account root rather than a 404: a security e-mail whose link is dead is
   * worse than one that lands a click away from the right place.
   */
  security: () => '/espace',
} as const;

/* -------------------------------------------------------------------------- */
/* JSON plumbing                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Hand a typed JSON object to Prisma's `Json` column.
 *
 * The cast is structural only: `Prisma.InputJsonObject` carries an index
 * signature that a precise type is never assignable to, even when every value is
 * genuinely JSON. The {@link JsonValue} constraint is what makes it true.
 */
function toJsonObject(value: Readonly<Record<string, JsonValue>>): Prisma.InputJsonObject {
  return { ...value } as unknown as Prisma.InputJsonObject;
}

/** Read a `Json` column back as a payload object, tolerating `null` and scalars. */
function readJsonObject(value: Prisma.JsonValue): NotificationPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as NotificationPayload;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
