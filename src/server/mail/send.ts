/**
 * The single way an email leaves this application (§18).
 *
 * ```ts
 * await sendMail({
 *   to: user.email,
 *   template: 'verify-email',
 *   props: { fullName: user.fullName, verifyUrl, expiresInHours: 24 },
 *   locale: user.locale,
 *   relatedType: 'VerificationToken',
 *   relatedId: token.id,
 * });
 * ```
 *
 * ## Idempotency is the point
 * §18: *"Never send more than one email per event per recipient (idempotency key
 * = `template:relatedId:recipient`, recorded in `EmailLog`, checked before
 * send)."* That is enforced here and nowhere else, which is why every caller
 * goes through this function instead of touching the transport.
 *
 * Two layers:
 *  1. **Durable** — an `EmailLog` row with `status = SENT` for the same
 *     (template, relatedId, recipient) triple means the mail already went out;
 *     the send is skipped. This survives restarts and job retries.
 *  2. **In-process** — a promise map collapses concurrent sends of the same key
 *     onto one result. The database check alone cannot do this: two callers can
 *     both read "not sent" before either writes.
 *
 * **`relatedId` identifies the event, not the person.** A verification email is
 * keyed on the token id, not the user id — otherwise a legitimate "resend"
 * would be swallowed forever. A rejection email is keyed on the user id,
 * because there is exactly one rejection decision to announce.
 *
 * Only a `SENT` row blocks. A previous `FAILED` attempt must be retryable, or
 * a transient SMTP outage would permanently lose a notification.
 *
 * ## Failure
 * A failure writes `EmailLog(status: FAILED, error)` and **rethrows**, so the
 * job layer above can count the attempt and schedule a backoff. Swallowing the
 * error here would turn a mail outage into silence.
 */

import { render } from '@react-email/render';
import { z } from 'zod';
import { db } from '@/server/db';
import { env } from '@/lib/env';
import { formatPhoneDisplay, parsePhone, toWhatsAppNumber } from '@/lib/phone';
import { defaultLocale, isLocale, locales, type Locale } from '@/i18n/routing';
import { getTransport, mailFrom, safeErrorMessage } from './transport';
import {
  emailContext,
  type BrandContext,
  type EmailContext,
  type EmailTemplate,
} from './templates/layout';
import { verifyEmailTemplate, type VerifyEmailProps } from './templates/verify-email';
import { pendingApprovalTemplate, type PendingApprovalProps } from './templates/pending-approval';
import { adminNewAccountTemplate, type AdminNewAccountProps } from './templates/admin-new-account';
import { accountApprovedTemplate, type AccountApprovedProps } from './templates/account-approved';
import { accountRejectedTemplate, type AccountRejectedProps } from './templates/account-rejected';
import { passwordResetTemplate, type PasswordResetProps } from './templates/password-reset';
import { passwordChangedTemplate, type PasswordChangedProps } from './templates/password-changed';
import { requestReceivedTemplate, type RequestReceivedProps } from './templates/request-received';
import { adminNewPaymentTemplate, type AdminNewPaymentProps } from './templates/admin-new-payment';
import {
  requestInfoNeededTemplate,
  type RequestInfoNeededProps,
} from './templates/request-info-needed';
import { requestApprovedTemplate, type RequestApprovedProps } from './templates/request-approved';
import { requestRejectedTemplate, type RequestRejectedProps } from './templates/request-rejected';
import { receiptReminderTemplate, type ReceiptReminderProps } from './templates/receipt-reminder';
import { requestExpiredTemplate, type RequestExpiredProps } from './templates/request-expired';

/* ────────────────────────────────────────────────────────────────────────────
 * Registry
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Every template in the milestone, mapped to its props.
 *
 * Adding a template means adding a line here and a line in {@link registry};
 * TypeScript then refuses any `sendMail` call whose props do not match the
 * template it names.
 *
 * M1 covers §18 templates 1–5, 13 and 14. Later milestones extend this map.
 */
export interface EmailTemplateProps {
  'verify-email': VerifyEmailProps;
  'pending-approval': PendingApprovalProps;
  'admin-new-account': AdminNewAccountProps;
  'account-approved': AccountApprovedProps;
  'account-rejected': AccountRejectedProps;
  'password-reset': PasswordResetProps;
  'password-changed': PasswordChangedProps;
  // M3 — §18 rows 6–12, the enrollment-request flow (§9.2).
  'request-received': RequestReceivedProps;
  'admin-new-payment': AdminNewPaymentProps;
  'request-info-needed': RequestInfoNeededProps;
  'request-approved': RequestApprovedProps;
  'request-rejected': RequestRejectedProps;
  'receipt-reminder': ReceiptReminderProps;
  'request-expired': RequestExpiredProps;
}

export type EmailTemplateId = keyof EmailTemplateProps;

export const EMAIL_TEMPLATE_IDS = [
  'verify-email',
  'pending-approval',
  'admin-new-account',
  'account-approved',
  'account-rejected',
  'password-reset',
  'password-changed',
  'request-received',
  'admin-new-payment',
  'request-info-needed',
  'request-approved',
  'request-rejected',
  'receipt-reminder',
  'request-expired',
] as const satisfies readonly EmailTemplateId[];

export function isEmailTemplateId(value: unknown): value is EmailTemplateId {
  return (
    typeof value === 'string' && (EMAIL_TEMPLATE_IDS as readonly string[]).includes(value)
  );
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/**
 * A template with its prop type erased.
 *
 * The erasure happens *inside* {@link compile}, where the concrete `P` is still
 * in scope: `schema.parse` narrows `unknown` to `P` before anything is called
 * with it. That is why this file contains no `as` cast and no `any` — the only
 * boundary where props are untyped is the one Zod validates.
 */
interface CompiledTemplate {
  readonly id: EmailTemplateId;
  /** `null` when the props satisfy this template's schema, else why not. */
  validateProps(props: unknown): string | null;
  render(props: unknown, ctx: EmailContext): Promise<RenderedEmail>;
}

function compile<P>(id: EmailTemplateId, template: EmailTemplate<P>): CompiledTemplate {
  return {
    id,
    validateProps(rawProps) {
      const result = template.schema.safeParse(rawProps);
      if (result.success) return null;
      return result.error.issues
        .map((issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`)
        .join(' · ');
    },
    async render(rawProps, ctx) {
      const props = template.schema.parse(rawProps);
      return {
        subject: template.subject(props, ctx),
        html: await render(template.body(props, ctx)),
        text: template.text(props, ctx),
      };
    },
  };
}

/**
 * Validates a template's props WITHOUT rendering, so a caller can reject a
 * malformed notification at the moment it is queued.
 *
 * `sendMailInputSchema` deliberately types `props` as `unknown` — the envelope
 * cannot know the shape each template wants. That left a gap: `account-approved`
 * shipped without its required `catalogUrl`, the envelope validated happily, and
 * the defect only appeared inside the cron as a silent retry loop while the
 * administrator was told the mail had gone out. Returns `null` when valid, or a
 * human-readable summary of what is wrong.
 */
export function validateTemplateProps(template: string, props: unknown): string | null {
  // An unknown id is not this function's error to report: the envelope schema
  // already constrains `template` to the registered set.
  const compiled = (registry as Record<string, CompiledTemplate | undefined>)[template];
  return compiled === undefined ? null : compiled.validateProps(props);
}

const registry: Record<EmailTemplateId, CompiledTemplate> = {
  'verify-email': compile('verify-email', verifyEmailTemplate),
  'pending-approval': compile('pending-approval', pendingApprovalTemplate),
  'admin-new-account': compile('admin-new-account', adminNewAccountTemplate),
  'account-approved': compile('account-approved', accountApprovedTemplate),
  'account-rejected': compile('account-rejected', accountRejectedTemplate),
  'password-reset': compile('password-reset', passwordResetTemplate),
  'password-changed': compile('password-changed', passwordChangedTemplate),
  'request-received': compile('request-received', requestReceivedTemplate),
  'admin-new-payment': compile('admin-new-payment', adminNewPaymentTemplate),
  'request-info-needed': compile('request-info-needed', requestInfoNeededTemplate),
  'request-approved': compile('request-approved', requestApprovedTemplate),
  'request-rejected': compile('request-rejected', requestRejectedTemplate),
  'receipt-reminder': compile('receipt-reminder', receiptReminderTemplate),
  'request-expired': compile('request-expired', requestExpiredTemplate),
};

/* ────────────────────────────────────────────────────────────────────────────
 * Brand context — resolved from SiteSetting (§3), cached briefly
 * ────────────────────────────────────────────────────────────────────────── */

const BRAND_KEYS = [
  'brand.name',
  'brand.fullName',
  'contact.email',
  'contact.phone',
  'contact.whatsapp',
  'contact.address',
  'contact.hours',
] as const;

/**
 * Defaults from §3. They exist so a fresh database still sends a coherent
 * email; the owner overrides them from the admin settings page (§17.12).
 * `contact.whatsapp` has no default on purpose — a wrong number is worse than
 * no button, so the WhatsApp call to action simply disappears until it is set.
 */
const BRAND_DEFAULTS: Readonly<Record<(typeof BRAND_KEYS)[number], string | null>> = {
  'brand.name': 'CFI',
  'brand.fullName': 'Centre de Formation Immersive',
  'contact.email': 'contact@cfi.ma',
  'contact.phone': null,
  'contact.whatsapp': null,
  'contact.address': null,
  'contact.hours': null,
};

/** A settings row is re-read at most every minute; an email is never worth a cold query. */
const BRAND_CACHE_TTL_MS = 60_000;

let brandCache: { readonly value: BrandContext; readonly expiresAt: number } | null = null;

/** `SiteSetting.value` is JSON; only a non-empty string is usable as a label. */
function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function resolveBrandContext(): Promise<BrandContext> {
  const now = Date.now();
  if (brandCache !== null && brandCache.expiresAt > now) return brandCache.value;

  const settings = new Map<string, string | null>();
  try {
    const rows = await db.siteSetting.findMany({
      where: { key: { in: [...BRAND_KEYS] } },
      select: { key: true, value: true },
    });
    for (const row of rows) settings.set(row.key, asString(row.value));
  } catch (cause) {
    // A settings table that cannot be read must not stop a password-reset
    // email. Fall through to the defaults and say so once.
    console.warn('[mail] SiteSetting illisible, repli sur les valeurs par défaut :', safeErrorMessage(cause));
  }

  const pick = (key: (typeof BRAND_KEYS)[number]): string | null =>
    settings.get(key) ?? BRAND_DEFAULTS[key];

  const phone = pick('contact.phone');
  const parsedPhone = phone === null ? null : parsePhone(phone);
  const whatsapp = pick('contact.whatsapp');
  const parsedWhatsapp = whatsapp === null ? null : parsePhone(whatsapp);

  const value: BrandContext = {
    name: pick('brand.name') ?? 'CFI',
    fullName: pick('brand.fullName') ?? 'Centre de Formation Immersive',
    appUrl: env.APP_URL,
    contactEmail: pick('contact.email') ?? env.MAIL_FROM_ADDRESS,
    contactPhoneE164: parsedPhone?.e164 ?? null,
    contactPhoneDisplay: parsedPhone === null ? null : formatPhoneDisplay(parsedPhone.e164),
    whatsappE164: parsedWhatsapp?.e164 ?? null,
    whatsappUrl:
      parsedWhatsapp === null ? null : `https://wa.me/${toWhatsAppNumber(parsedWhatsapp.e164)}`,
    address: pick('contact.address'),
    hours: pick('contact.hours'),
  };

  brandCache = { value, expiresAt: now + BRAND_CACHE_TTL_MS };
  return value;
}

/** Drops the cached settings — call after the admin saves the contact block. */
export function invalidateBrandCache(): void {
  brandCache = null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Public API
 * ────────────────────────────────────────────────────────────────────────── */

export interface SendMailInput<K extends EmailTemplateId = EmailTemplateId> {
  /** One address or several. Each recipient gets its own message and its own `EmailLog` row. */
  readonly to: string | readonly string[];
  readonly template: K;
  readonly props: EmailTemplateProps[K];
  /** The recipient's interface language. Defaults to French, the source language. */
  readonly locale?: Locale;
  /** Entity family behind the send — `User`, `VerificationToken`, `EnrollmentRequest`… */
  readonly relatedType: string;
  /** **The event's** id, not the person's. See the module note on idempotency. */
  readonly relatedId: string;
  /** Overrides the default reply-to (the public contact mailbox). */
  readonly replyTo?: string;
}

export type DeliveryStatus = 'SENT' | 'SKIPPED_DUPLICATE';

export interface Delivery {
  readonly to: string;
  readonly status: DeliveryStatus;
  readonly emailLogId: string | null;
  readonly messageId: string | null;
}

export interface SendMailResult {
  readonly template: EmailTemplateId;
  readonly locale: Locale;
  readonly subject: string;
  readonly deliveries: readonly Delivery[];
  readonly sent: number;
  readonly skipped: number;
}

export interface DeliveryFailure {
  readonly to: string;
  readonly error: string;
}

/** Thrown when at least one recipient could not be reached. Carries no credentials. */
export class MailDeliveryError extends Error {
  readonly failures: readonly DeliveryFailure[];
  readonly template: EmailTemplateId;

  constructor(template: EmailTemplateId, failures: readonly DeliveryFailure[]) {
    const detail = failures.map((failure) => `${failure.to} (${failure.error})`).join(' · ');
    super(`Envoi impossible pour ${failures.length} destinataire(s) — ${template} : ${detail}`);
    this.name = 'MailDeliveryError';
    this.template = template;
    this.failures = failures;
  }
}

/**
 * The same call, as a discriminated union on `template`.
 *
 * This is the shape the job queue stores: `template` and `props` stay welded
 * together, so `{ template: 'password-reset', props: <verify-email props> }`
 * does not compile.
 */
export type SendMailPayload = { [K in EmailTemplateId]: SendMailInput<K> }[EmailTemplateId];

const recipientSchema = z.string().trim().toLowerCase().email();

/**
 * Runtime shape of a send. Exported because the job queue validates a payload
 * against it at enqueue time — a malformed notification must fail where it is
 * created, not three retries later inside a cron run.
 */
export const sendMailInputSchema = z
  .object({
    to: z.union([recipientSchema, z.array(recipientSchema).min(1).max(50)]),
    template: z.enum(EMAIL_TEMPLATE_IDS),
    // Validated a second time, precisely, by the named template's own schema.
    props: z.unknown(),
    locale: z.enum(locales).optional(),
    // Nullable: not every notification hangs off an entity. When they are null
    // an explicit `idempotencyKey` is required instead — see the refinement.
    relatedType: z.string().trim().min(1).max(64).nullable().optional(),
    relatedId: z.string().trim().min(1).max(191).nullable().optional(),
    /**
     * Overrides the derived `template:relatedId` half of the §18 key. Needed
     * where the natural key is wrong: a *resent* verification link keys on the
     * token rather than the user, otherwise the resend is swallowed as a
     * duplicate and the student never gets a second mail (§9.1).
     *
     * The recipient is always appended by `sendMailFromPayload`, so an override
     * can never collapse a multi-recipient send into one delivery.
     */
    idempotencyKey: z.string().trim().min(1).max(191).optional(),
    /** Recipient account when there is one — powers the per-user e-mail log. */
    userId: z.string().trim().min(1).max(191).nullable().optional(),
    replyTo: recipientSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // A key must always be computable, or §18's "never twice" guarantee is
    // silently unenforceable for this send.
    if (value.idempotencyKey === undefined && (value.relatedId ?? null) === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['idempotencyKey'],
        message:
          'requis lorsque relatedId est absent : sans lui, la clé d’idempotence §18 ne peut pas être calculée',
      });
    }
  });

/** `template:relatedId:recipient` — the §18 key, verbatim. */
export function idempotencyKey(
  template: EmailTemplateId,
  relatedId: string,
  recipient: string,
): string {
  return `${template}:${relatedId}:${recipient}`;
}

/**
 * Renders a template without sending it — used by the admin preview and by
 * tests that assert the copy. Never touches SMTP.
 */
export async function renderEmail<K extends EmailTemplateId>(
  template: K,
  props: EmailTemplateProps[K],
  locale: Locale = defaultLocale,
  brand?: BrandContext,
): Promise<RenderedEmail> {
  const resolved = brand ?? (await resolveBrandContext());
  return registry[template].render(props, emailContext(locale, resolved));
}

/** In-flight sends, keyed by `template:relatedId:recipient`. */
const inFlight = new Map<string, Promise<Delivery>>();

/**
 * Send an email. The typed entry point — `props` must match `template`.
 */
export function sendMail<K extends EmailTemplateId>(
  input: SendMailInput<K>,
): Promise<SendMailResult> {
  return sendMailFromPayload(input);
}

/**
 * Send an email whose shape is only known at runtime — the job queue hands back
 * a `Job.payload` that left TypeScript's sight when it was written as JSON.
 * Validation is identical to {@link sendMail}: the envelope through
 * {@link sendMailInputSchema}, then the props through the named template's own
 * schema. Prefer `sendMail` everywhere the template is known statically.
 */
export async function sendMailFromPayload(input: unknown): Promise<SendMailResult> {
  // §20: validate the boundary before anything else happens.
  const parsed = sendMailInputSchema.parse(input);

  const recipients = dedupe(Array.isArray(parsed.to) ? parsed.to : [parsed.to]);
  const locale: Locale = isLocale(parsed.locale) ? parsed.locale : defaultLocale;
  const template = parsed.template;

  const brand = await resolveBrandContext();
  const ctx = emailContext(locale, brand);
  const rendered = await registry[template].render(parsed.props, ctx);

  const deliveries: Delivery[] = [];
  const failures: DeliveryFailure[] = [];

  for (const recipient of recipients) {
    // The recipient is appended in BOTH branches, so §18's "per event per
    // recipient" holds even when the caller supplies its own key. Keying an
    // admin broadcast on the event alone would deliver to whoever happened to
    // be first and silently drop the rest.
    const key =
      parsed.idempotencyKey === undefined
        ? idempotencyKey(template, parsed.relatedId ?? 'none', recipient)
        : `${parsed.idempotencyKey}:${recipient}`;
    const pending = inFlight.get(key);

    const work =
      pending ??
      deliverOnce({
        key,
        recipient,
        template,
        rendered,
        relatedType: parsed.relatedType ?? null,
        relatedId: parsed.relatedId ?? null,
        replyTo: parsed.replyTo ?? brand.contactEmail,
      });

    if (pending === undefined) inFlight.set(key, work);

    try {
      deliveries.push(await work);
    } catch (cause) {
      failures.push({ to: recipient, error: safeErrorMessage(cause) });
    } finally {
      if (pending === undefined) inFlight.delete(key);
    }
  }

  if (failures.length > 0) throw new MailDeliveryError(template, failures);

  return {
    template,
    locale,
    subject: rendered.subject,
    deliveries,
    sent: deliveries.filter((delivery) => delivery.status === 'SENT').length,
    skipped: deliveries.filter((delivery) => delivery.status === 'SKIPPED_DUPLICATE').length,
  };
}

interface DeliverArgs {
  readonly key: string;
  readonly recipient: string;
  readonly template: EmailTemplateId;
  readonly rendered: RenderedEmail;
  // Nullable: an e-mail need not hang off an entity. `EmailLog.relatedType` and
  // `relatedId` are themselves nullable columns, and the idempotency key is
  // computed by the caller, so nothing here depends on them being present.
  readonly relatedType: string | null;
  readonly relatedId: string | null;
  readonly replyTo: string;
}

async function deliverOnce(args: DeliverArgs): Promise<Delivery> {
  const { recipient, template, rendered, relatedType, relatedId } = args;

  // Exactly the §18 key — template, relatedId, recipient. `relatedType` is
  // deliberately *not* part of the lookup: it is descriptive metadata, and
  // including it would let a caller that labelled the same event differently
  // slip a second email past the guard.
  const already = await db.emailLog.findFirst({
    where: { template, relatedId, to: recipient, status: 'SENT' },
    select: { id: true },
  });

  if (already !== null) {
    return {
      to: recipient,
      status: 'SKIPPED_DUPLICATE',
      emailLogId: already.id,
      messageId: null,
    };
  }

  try {
    const info = await getTransport().sendMail({
      from: mailFrom(),
      to: recipient,
      replyTo: args.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        // Gmail and Outlook use this to collapse an accidental duplicate that
        // slipped past our own key — a second, independent safety net.
        'X-Entity-Ref-ID': args.key,
        'X-CFI-Template': template,
      },
    });

    if (env.NODE_ENV !== 'production') {
      console.info(
        `[mail] ${template} → ${recipient}\n  ${rendered.subject}\n${indent(rendered.text)}`,
      );
    }

    const log = await db.emailLog.create({
      data: {
        to: recipient,
        template,
        subject: rendered.subject,
        status: 'SENT',
        relatedType,
        relatedId,
      },
      select: { id: true },
    });

    return {
      to: recipient,
      status: 'SENT',
      emailLogId: log.id,
      messageId: info.messageId ?? null,
    };
  } catch (cause) {
    const message = safeErrorMessage(cause);
    // Recorded before rethrowing: the diagnostics page must be able to show a
    // failure even when the job that triggered it is still retrying.
    await db.emailLog
      .create({
        data: {
          to: recipient,
          template,
          subject: rendered.subject,
          status: 'FAILED',
          error: message,
          relatedType,
          relatedId,
        },
      })
      .catch((logError: unknown) => {
        console.error('[mail] EmailLog non écrit :', safeErrorMessage(logError));
      });

    throw cause instanceof Error ? cause : new Error(message);
  }
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  | ${line}`)
    .join('\n');
}
