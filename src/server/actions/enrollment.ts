'use server';

/**
 * Server actions of the §9.2 flow — the student side of the modal and the
 * timeline (§12.4, §13.3), plus the §17.3 admin decisions.
 *
 * Every export goes through {@link withAction}: Origin check → Zod `.strict()`
 * → session → capability → rate limit → handler. The business itself lives in
 * `@/server/services/enrollment/*` — state machine, compare-and-set
 * idempotency, e-mails, notifications, audit, all inside one transaction.
 *
 * ## The upload is a plain server action
 * `submitEnrollmentReceipt` accepts `FormData` with a `File`: no presigned-URL
 * choreography for the student path, exactly as the local driver requires.
 * The §1678 pipeline (magic bytes, sharp re-encode, SHA-256) runs server-side
 * in `receipts.submitReceipt`; the client-declared MIME is never trusted.
 */

import { z } from 'zod';
import { revalidatePath } from 'next/cache';

import { withAction } from '@/server/auth/guards';
import { UPLOAD } from '@/lib/rate-limit';
import {
  cancelRequest,
  createRequest,
  enrollFree,
  type RequestView,
} from '@/server/services/enrollment/requests';
import {
  submitReceipt,
  TRANSFER_DATE_MAX_AGE_DAYS,
  type SubmitReceiptResult,
} from '@/server/services/enrollment/receipts';
import {
  approveRequest,
  grantEnrollment,
  rejectRequest,
  requestInfo,
  type VerificationResult,
} from '@/server/services/enrollment/verification';
import { RECEIPT_MAX_BYTES } from '@/server/storage/images';

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                               */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().min(1).max(64);

/** Refresh the screens that render request state. */
function revalidateStudentScreens(): void {
  revalidatePath('/[locale]/(student)/espace', 'layout');
}

function revalidateAdminScreens(): void {
  revalidatePath('/[locale]/(admin)/admin', 'layout');
}

/* -------------------------------------------------------------------------- */
/* Student — create / cancel / free                                            */
/* -------------------------------------------------------------------------- */

/**
 * Step 1 « Enregistrer » of the §9.2 modal. Returns the existing open request
 * (rule 1) instead of erroring when one is already in flight.
 */
export const createEnrollmentRequest = withAction(
  z
    .object({
      courseId: idSchema,
      transferType: z.enum(['INSTANT', 'STANDARD_48H', 'CASH_AT_CENTER']),
      couponCode: z.string().trim().max(64).optional(),
    })
    .strict(),
  async (input, ctx): Promise<RequestView> => {
    const view = await createRequest(
      {
        courseId: input.courseId,
        transferType: input.transferType,
        couponCode: input.couponCode ?? null,
      },
      { userId: ctx.user.id, ip: ctx.ip, userAgent: ctx.userAgent },
    );
    revalidateStudentScreens();
    return view;
  },
  { auth: 'active', can: 'enrollment.request' },
);

/** §9.2 rule 8 — one click on a free course. Idempotent. */
export const enrollInFreeCourse = withAction(
  z.object({ courseId: idSchema }).strict(),
  async (input, ctx) => {
    const result = await enrollFree(input.courseId, {
      userId: ctx.user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateStudentScreens();
    return result;
  },
  { auth: 'active', can: 'enrollment.request' },
);

/** « Annuler la demande » (§13.3). A no-op on an already-final request. */
export const cancelEnrollmentRequest = withAction(
  z.object({ requestId: idSchema }).strict(),
  async (input, ctx) => {
    const result = await cancelRequest(input.requestId, {
      userId: ctx.user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateStudentScreens();
    return result;
  },
  { auth: 'active', can: 'enrollment.request' },
);

/* -------------------------------------------------------------------------- */
/* Student — the receipt upload (§9.2 step 2)                                  */
/* -------------------------------------------------------------------------- */

/**
 * `File` arrives through `FormData`; dates arrive as `YYYY-MM-DD` from the
 * date picker. The size ceiling is asserted here *and* re-checked from the
 * real bytes in the pipeline — the schema check exists to fail fast, the
 * pipeline check exists because the schema reads a client-declared number.
 */
const submitReceiptSchema = z
  .object({
    requestId: idSchema,
    file: z
      .instanceof(File, { message: 'errors.required' })
      .refine((file) => file.size > 0, 'errors.required')
      .refine((file) => file.size <= RECEIPT_MAX_BYTES, 'errors.fileTooLarge'),
    /** Declared transfer date — §9.2: ≤ today, ≥ today − 30 j (re-checked in the service). */
    transferDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, 'errors.required')
      .transform((value) => new Date(`${value}T12:00:00.000Z`)),
    bankReference: z.string().trim().max(64).optional(),
    message: z.string().trim().max(1_000).optional(),
    /** « Je confirme que le virement a bien été effectué » — required (§9.2 step 2). */
    confirmed: z
      .union([z.literal('true'), z.literal(true)])
      .transform(() => true as const),
  })
  .strict();

export const submitEnrollmentReceipt = withAction(
  submitReceiptSchema,
  async (input, ctx): Promise<SubmitReceiptResult> => {
    const bytes = Buffer.from(await input.file.arrayBuffer());
    const result = await submitReceipt(
      {
        requestId: input.requestId,
        fileBytes: bytes,
        transferDate: input.transferDate,
        bankReference: input.bankReference ?? null,
        message: input.message ?? null,
      },
      { userId: ctx.user.id, ip: ctx.ip, userAgent: ctx.userAgent },
    );
    revalidateStudentScreens();
    revalidateAdminScreens();
    return result;
  },
  {
    auth: 'active',
    can: 'enrollment.request',
    // §20: the receipt upload endpoint is brute-force protected like login.
    rateLimit: { policy: UPLOAD, identify: (_input, ctx) => ctx.user?.id ?? ctx.ip },
  },
);

/** Re-exported so the UI prints the same constraint the server enforces. */
export async function receiptUploadConstraints(): Promise<{
  readonly maxBytes: number;
  readonly maxAgeDays: number;
}> {
  return { maxBytes: RECEIPT_MAX_BYTES, maxAgeDays: TRANSFER_DATE_MAX_AGE_DAYS };
}

/* -------------------------------------------------------------------------- */
/* Admin — the §17.3 decisions                                                 */
/* -------------------------------------------------------------------------- */

/**
 * « Activer l'accès » — the §1666 approval transaction. Safe to double-click:
 * the second invocation returns `{ changed: false }` and creates nothing.
 */
export const approveEnrollmentRequest = withAction(
  z.object({ requestId: idSchema }).strict(),
  async (input, ctx): Promise<VerificationResult> => {
    const result = await approveRequest(input.requestId, {
      userId: ctx.user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateAdminScreens();
    revalidateStudentScreens();
    return result;
  },
  { auth: 'active', can: 'payment.verify' },
);

/** « Refuser » — the reason reaches the student verbatim in e-mail #10. */
export const rejectEnrollmentRequest = withAction(
  z
    .object({ requestId: idSchema, reason: z.string().trim().min(10).max(2_000) })
    .strict(),
  async (input, ctx): Promise<VerificationResult> => {
    const result = await rejectRequest(input.requestId, input.reason, {
      userId: ctx.user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateAdminScreens();
    revalidateStudentScreens();
    return result;
  },
  { auth: 'active', can: 'payment.verify' },
);

/** « Demander un complément » — e-mail #8 carries the message verbatim. */
export const requestEnrollmentInfo = withAction(
  z
    .object({ requestId: idSchema, message: z.string().trim().min(10).max(2_000) })
    .strict(),
  async (input, ctx): Promise<VerificationResult> => {
    const result = await requestInfo(input.requestId, input.message, {
      userId: ctx.user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    revalidateAdminScreens();
    revalidateStudentScreens();
    return result;
  },
  { auth: 'active', can: 'payment.verify' },
);

/** §9.2 rule 9 — manual `ADMIN_GRANT` with a mandatory, audited reason. */
export const grantEnrollmentManually = withAction(
  z
    .object({
      userId: idSchema,
      courseId: idSchema,
      reason: z.string().trim().min(10).max(1_000),
    })
    .strict(),
  async (input, ctx) => {
    const result = await grantEnrollment(
      { userId: input.userId, courseId: input.courseId, reason: input.reason },
      { userId: ctx.user.id, ip: ctx.ip, userAgent: ctx.userAgent },
    );
    revalidateAdminScreens();
    revalidateStudentScreens();
    return result;
  },
  { auth: 'active', can: 'payment.verify' },
);
