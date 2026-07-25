/**
 * The mail layer's public surface (§18).
 *
 * Import from `@/server/mail`, never from a template file directly — the
 * templates are an implementation detail and their prop types are re-exported
 * here for the callers that build them.
 *
 * Two ways in, and they are not interchangeable:
 *
 *  - `enqueue('SEND_EMAIL', …)` from `@/server/jobs/queue` — **the default.**
 *    Delivery is retried with backoff and never blocks the request that caused
 *    it (§18: "Send through the `Job` queue with retry … so a flaky SMTP never
 *    loses a notification").
 *  - {@link sendMail} — direct, synchronous, no retry. Only for a script, a
 *    test, or an admin action that must report a delivery failure to the person
 *    who clicked the button.
 *
 * Both paths share the same idempotency guarantee: one email per
 * `template:relatedId:recipient`, ever.
 */

export {
  EMAIL_TEMPLATE_IDS,
  MailDeliveryError,
  idempotencyKey,
  invalidateBrandCache,
  isEmailTemplateId,
  renderEmail,
  resolveBrandContext,
  sendMail,
  sendMailFromPayload,
  sendMailInputSchema,
  type Delivery,
  type DeliveryFailure,
  type DeliveryStatus,
  type EmailTemplateId,
  type EmailTemplateProps,
  type RenderedEmail,
  type SendMailInput,
  type SendMailPayload,
  type SendMailResult,
} from './send';

export {
  adminRecipients,
  closeTransport,
  describeTransport,
  mailFrom,
  verifyTransport,
  type TransportDescription,
  type TransportVerification,
} from './transport';

export type { BrandContext, EmailContext, EmailTemplate } from './templates/layout';

export type { VerifyEmailProps } from './templates/verify-email';
export type { PendingApprovalProps } from './templates/pending-approval';
export type { AdminNewAccountProps } from './templates/admin-new-account';
export type { AccountApprovedProps } from './templates/account-approved';
export type { AccountRejectedProps } from './templates/account-rejected';
export type { PasswordResetProps } from './templates/password-reset';
export type { PasswordChangedProps } from './templates/password-changed';
