/**
 * `GENERATE_INVOICE` — render and store one payment's invoice PDF (§19.4).
 *
 * Enqueued inside the §1666 approval transaction, so the job exists exactly
 * when the payment does. Idempotency is delegated to
 * `generateInvoiceForPayment`: a payment whose `invoiceKey` already resolves
 * in storage reports `skipped: true`, which is what makes this handler safe to
 * run twice (a retried drain, a reclaimed stale lock, or the §22 double-submit
 * scenario upstream).
 *
 * A failure is rethrown so the runner counts the attempt and backs off; after
 * `maxAttempts` the job lands as `FAILED` on the diagnostics page, while the
 * enrollment itself — already committed — is untouched. §19.4: invoices are
 * "regenerable", so re-enqueueing from the admin panel is always safe.
 */

import { generateInvoiceForPayment } from '@/server/pdf';
import { generateInvoicePayloadSchema } from '../types';
import type { JobHandler, JobResult } from '../types';

export const generateInvoiceHandler: JobHandler = async (payload, ctx): Promise<JobResult> => {
  // The payload is JSON read back from MySQL — validate before trusting it.
  const { paymentId } = generateInvoicePayloadSchema.parse(payload);

  const result = await generateInvoiceForPayment(paymentId);

  return {
    paymentId: result.paymentId,
    invoiceNumber: result.invoiceNumber,
    invoiceKey: result.invoiceKey,
    skippedAsExisting: result.skipped,
    sizeBytes: result.sizeBytes,
    attempt: ctx.attempt,
  };
};
