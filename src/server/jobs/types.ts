/**
 * The job vocabulary (§19.5).
 *
 * ## One map, two guarantees
 * {@link JobPayloads} is the single place a job type and its payload are tied
 * together. Everything else derives from it:
 *
 *  - {@link JobType} — the runtime string stored in `Job.type`.
 *  - {@link JobSpec} — a discriminated union on `type`, which is what makes
 *    `enqueue('SEND_EMAIL', <certificate payload>)` a compile error instead of
 *    a job that explodes two minutes later inside a cron run.
 *  - {@link jobPayloadValidators} — the runtime counterpart. A payload survives
 *    a round trip through a MySQL `JSON` column, where TypeScript cannot follow
 *    it, so it is re-validated on the way in *and* on the way out.
 *
 * Adding a job type means adding one line to `JobPayloads` and one to
 * `jobPayloadValidators`; both are exhaustive by construction, so a missing
 * validator or a missing handler fails the build.
 *
 * ## Payloads are JSON, not objects
 * A payload is serialised. It may contain strings, numbers, booleans, `null`,
 * arrays and plain objects — never a `Date`, a `Buffer`, a class instance or
 * `undefined` nested inside. Timestamps travel as ISO 8601 strings.
 *
 * ## Every handler is idempotent
 * A job can run twice: a process can die between "work done" and "row marked
 * DONE", and a stale lock is reclaimed on purpose. Handlers are written so the
 * second run is a no-op — for `SEND_EMAIL` that guarantee comes from the
 * `EmailLog` idempotency key in `sendMail` (§18).
 */

import { z } from 'zod';

import type { SendMailPayload } from '@/server/mail/send';
import { sendMailInputSchema } from '@/server/mail/send';

/* ────────────────────────────────────────────────────────────────────────────
 * The map
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Job type → payload. M1 registers one job; later milestones add
 * `GENERATE_INVOICE`, `GENERATE_CERTIFICATE`, `REINDEX_COURSE`, … here.
 */
export interface JobPayloads {
  /** Render and deliver one templated email (§18). */
  SEND_EMAIL: SendMailPayload;
  /**
   * Render and store the invoice PDF of one payment (§19.4). Enqueued by the
   * §1666 approval transaction — the PDF is generated in a job, never in the
   * request cycle. Idempotent: `generateInvoiceForPayment` skips a payment
   * whose invoice already exists in storage.
   */
  GENERATE_INVOICE: GenerateInvoicePayload;
}

/** `Job.payload` of `GENERATE_INVOICE` — validated by {@link generateInvoicePayloadSchema}. */
export interface GenerateInvoicePayload {
  readonly paymentId: string;
}

export const generateInvoicePayloadSchema = z
  .object({ paymentId: z.string().min(1).max(64) })
  .strict();

export type JobType = keyof JobPayloads;

/** A job and its payload, welded together. */
export type JobSpec = { [K in JobType]: { readonly type: K; readonly payload: JobPayloads[K] } }[JobType];

export const JOB_TYPES = ['SEND_EMAIL', 'GENERATE_INVOICE'] as const satisfies readonly JobType[];

export function isJobType(value: unknown): value is JobType {
  return typeof value === 'string' && (JOB_TYPES as readonly string[]).includes(value);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Runtime validation
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The narrow surface the queue needs from a validator: turn `unknown` into
 * something, or throw. Declaring it structurally rather than as a Zod type
 * keeps the map free of generic-variance friction while staying exact — a Zod
 * schema satisfies it as-is.
 */
export interface PayloadValidator {
  parse(value: unknown): unknown;
}

/** One validator per job type. Exhaustive: a new job type will not compile without one. */
export const jobPayloadValidators: Record<JobType, PayloadValidator> = {
  SEND_EMAIL: sendMailInputSchema,
  GENERATE_INVOICE: generateInvoicePayloadSchema,
};

/** Throws a `ZodError` when `payload` does not match what `type` expects. */
export function assertJobPayload(type: JobType, payload: unknown): void {
  jobPayloadValidators[type].parse(payload);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Handler contract
 * ────────────────────────────────────────────────────────────────────────── */

/** What a handler may report back. Values are JSON-safe so the summary can be logged as-is. */
export type JobResult = Readonly<Record<string, string | number | boolean | null>>;

export interface JobRunContext {
  readonly jobId: string;
  /** 1 for the first run. */
  readonly attempt: number;
  readonly maxAttempts: number;
}

/**
 * A handler receives the raw payload and validates it itself with the precise
 * schema for its type. The queue-level check in {@link assertJobPayload} guards
 * the envelope; the handler is what narrows it to a usable value.
 */
export type JobHandler = (payload: unknown, ctx: JobRunContext) => Promise<JobResult>;

/* ────────────────────────────────────────────────────────────────────────────
 * Retry policy
 * ────────────────────────────────────────────────────────────────────────── */

/** §18: three attempts for an email. Applies to every job type unless overridden at enqueue. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** First retry after a minute — long enough for a flaky SMTP host to recover. */
export const BACKOFF_BASE_MS = 60_000;

/** Ceiling, so a permanently broken dependency retries hourly rather than never. */
export const BACKOFF_MAX_MS = 30 * 60_000;

/**
 * Delay before attempt `attempt + 1`, exponential with ±20 % jitter.
 *
 * The jitter matters when a whole batch fails for the same reason — without it,
 * twenty emails queued in the same second would retry in the same second,
 * forever, and hammer a host that is already struggling.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_MAX_MS);
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(base * jitter);
}
