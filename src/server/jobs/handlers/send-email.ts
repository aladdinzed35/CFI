/**
 * `SEND_EMAIL` — render one templated email and deliver it (§18, §19.5).
 *
 * Every notification in the application goes through the queue rather than
 * being sent inline, for one reason: a flaky SMTP host must never be able to
 * lose a notification, and it must never be able to slow down the request that
 * triggered it. Registering a student stays fast whether or not Hostinger's
 * mail server is having a bad minute.
 *
 * ## Idempotency
 * Guaranteed one level down. `sendMail` refuses to send when an `EmailLog` row
 * already records this `template:relatedId:recipient` as `SENT`, so a retry —
 * or a reclaimed stale lock — produces `skipped`, not a second email in
 * someone's inbox. That is what makes this handler safe to run twice.
 *
 * ## Failure
 * The error is rethrown so the runner records the attempt and schedules a
 * backoff. `sendMail` has already written the `EmailLog(FAILED)` row by then,
 * so the admin diagnostics page can show the failure while the job is still
 * retrying.
 */

import { sendMailFromPayload } from '@/server/mail/send';
import type { JobHandler, JobResult } from '../types';

export const sendEmailHandler: JobHandler = async (payload, ctx): Promise<JobResult> => {
  // The payload is JSON read back from MySQL — `sendMailFromPayload` validates
  // the envelope with `sendMailInputSchema.strict()` and then the props with
  // the named template's own schema before anything is rendered.
  const result = await sendMailFromPayload(payload);

  return {
    template: result.template,
    locale: result.locale,
    subject: result.subject,
    recipients: result.deliveries.length,
    sent: result.sent,
    // A non-zero count here is the idempotency guard doing its job — usually on
    // a retry after a partial failure, which is exactly when it matters.
    skippedAsDuplicate: result.skipped,
    attempt: ctx.attempt,
  };
};
