/**
 * SMTP transport — Hostinger, pooled, created once per process (§18, §24.3).
 *
 * ## One transporter, lazily built
 * Hostinger's mailboxes allow a small number of concurrent SMTP connections and
 * throttle aggressively. A pooled transporter keeps a handful of authenticated
 * connections warm and queues messages behind them, which is both faster than
 * reconnecting per email and the only way to stay inside the provider's limits
 * when the `drain` cron flushes a batch of queued notifications at once.
 *
 * The instance is built on first use rather than at module load: importing this
 * file (from the health endpoint, from a test, from a Server Component tree that
 * never actually sends) must not open a socket.
 *
 * ## Credentials never reach a log
 * `logger` and `debug` stay off, and nothing in this module ever prints
 * `SMTP_PASSWORD`, the auth object, or a nodemailer error's `command` payload
 * verbatim. {@link describeTransport} is the only shape allowed out, and it
 * carries host/port/secure — never the password, never the full mailbox address.
 *
 * ## Development without a mailbox
 * `SMTP_PASSWORD` is mandatory in production (`src/lib/env.ts` refuses to boot
 * without it) but empty in a fresh clone. Rather than making the whole M1
 * registration flow un-runnable locally, an empty password outside production
 * selects nodemailer's built-in `jsonTransport`: the message is serialised and
 * printed to the terminal — subject, recipient and, crucially, the verification
 * link — instead of being handed to a server. This can never engage in
 * production because the environment schema rejects an empty password there.
 */

import { createTransport, type Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { env } from '@/lib/env';

/** Concurrent authenticated connections. Hostinger tolerates a small pool. */
const MAX_CONNECTIONS = 3;

/** Messages per connection before it is recycled — avoids provider-side session caps. */
const MAX_MESSAGES = 50;

/** At most 5 messages per second, so a drained batch never looks like a burst. */
const RATE_DELTA_MS = 1_000;
const RATE_LIMIT = 5;

const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

/** Verification is a network round-trip; the diagnostics endpoint must not hang on it. */
const VERIFY_TIMEOUT_MS = 8_000;

export interface TransportDescription {
  /** SMTP host, e.g. `smtp.hostinger.com`. Not a secret. */
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  /**
   * `true` when messages are serialised to the terminal instead of being sent
   * (development only — see the module note).
   */
  readonly dryRun: boolean;
}

export interface TransportVerification extends TransportDescription {
  readonly ok: boolean;
  /** Short, credential-free reason when `ok` is false. */
  readonly error: string | null;
}

/**
 * The pooled and the development transports report slightly different
 * `SentMessageInfo` shapes; the union is what both callers can rely on, and
 * `messageId` — the only field this codebase reads — is present in each.
 */
export type MailTransport = Transporter<
  SMTPPool.SentMessageInfo | SMTPTransport.SentMessageInfo
>;

let cached: MailTransport | null = null;
let cachedDescription: TransportDescription | null = null;

/**
 * `true` when no SMTP password is configured and we are not in production.
 * Production is impossible here: the env schema makes `SMTP_PASSWORD`
 * mandatory when `NODE_ENV=production`.
 */
function isDryRun(): boolean {
  return env.NODE_ENV !== 'production' && env.SMTP_PASSWORD.length === 0;
}

function buildOptions(): SMTPPool.Options {
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // Port 465 is implicit TLS. Anything else negotiates STARTTLS, which we
    // require rather than merely offer: an SMTP server that cannot upgrade is a
    // server we refuse to hand a password to.
    secure: env.SMTP_SECURE,
    // Defaults to "required whenever the connection is not already implicit
    // TLS". SMTP_REQUIRE_TLS=false is the documented escape hatch for a local
    // sink (Mailpit advertises STARTTLS but answers 502 to it); it must never
    // be set against a real server, and production leaves it unset.
    requireTLS: (env.SMTP_REQUIRE_TLS ?? true) && !env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    pool: true,
    maxConnections: MAX_CONNECTIONS,
    maxMessages: MAX_MESSAGES,
    rateDelta: RATE_DELTA_MS,
    rateLimit: RATE_LIMIT,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    tls: { minVersion: 'TLSv1.2' },
    logger: false,
    debug: false,
  };
}

/**
 * The process-wide transporter. Safe to call on every message: the pool is
 * created once and reused.
 */
export function getTransport(): MailTransport {
  if (cached !== null) return cached;

  if (isDryRun()) {
    const instance: MailTransport = createTransport({ jsonTransport: true });
    cached = instance;
    cachedDescription = {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      dryRun: true,
    };
    console.warn(
      '[mail] SMTP_PASSWORD absente hors production : les e-mails sont écrits dans la console au lieu d’être envoyés.',
    );
    return instance;
  }

  const instance: MailTransport = createTransport(buildOptions());
  cached = instance;
  cachedDescription = {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    dryRun: false,
  };
  return instance;
}

/** Host/port/secure only — never credentials. Safe to return from a diagnostics endpoint. */
export function describeTransport(): TransportDescription {
  if (cachedDescription !== null) return cachedDescription;
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    dryRun: isDryRun(),
  };
}

/** The `From` header. A display name plus the mailbox created in hPanel. */
export function mailFrom(): string {
  return `"${env.MAIL_FROM_NAME.replace(/"/gu, '')}" <${env.MAIL_FROM_ADDRESS}>`;
}

/** Internal recipients for administration notifications (§18 templates 3, 7, 24…). */
export function adminRecipients(): readonly string[] {
  return env.MAIL_ADMIN_RECIPIENTS;
}

/**
 * Open a connection, authenticate, and close it again — used by `/api/health`
 * and the admin diagnostics page. Never throws: a mail server that is down must
 * not take the health endpoint with it.
 */
export async function verifyTransport(): Promise<TransportVerification> {
  const description = describeTransport();

  if (description.dryRun) {
    return { ...description, ok: true, error: null };
  }

  try {
    await withTimeout(getTransport().verify(), VERIFY_TIMEOUT_MS);
    return { ...description, ok: true, error: null };
  } catch (cause) {
    return { ...description, ok: false, error: safeErrorMessage(cause) };
  }
}

/** Drains and closes the pool. Called by tests and by a graceful shutdown. */
export function closeTransport(): void {
  if (cached === null) return;
  cached.close();
  cached = null;
  cachedDescription = null;
}

/**
 * A credential-free one-liner for an SMTP failure.
 *
 * Nodemailer attaches the failing SMTP `command` and sometimes the server's
 * response to its errors; an `AUTH PLAIN` response can echo back base64 that
 * decodes to the password. Only the message and the provider's response code
 * are kept, and the message is truncated.
 */
export function safeErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? String((cause as { code: unknown }).code)
      : null;
  const scrubbed = raw
    .replace(/AUTH\s+\S+\s+\S+/giu, 'AUTH […]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 300);
  return code === null || code === 'undefined' ? scrubbed : `${code}: ${scrubbed}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Délai dépassé après ${ms} ms.`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
