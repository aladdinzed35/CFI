/* @jsxRuntime automatic @jsxImportSource react */
/**
 * Email #11 (§18) — « Rappel : votre demande attend un justificatif ».
 *
 * Sent by the `reminders` cron at +24 h and +72 h for a request still in
 * `AWAITING_RECEIPT`. The idempotency key carries the stage
 * (`{requestId}:rappel-24h`), so each of the two reminders goes out exactly
 * once however many times the hourly cron passes over the row.
 */

import type { ReactNode } from 'react';
import { z } from 'zod';
import {
  EmailCta,
  EmailDetails,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
  Ltr,
  firstNameOf,
  textBody,
  type EmailContext,
  type EmailTemplate,
} from './layout';
import type { Locale } from '@/i18n/routing';

export const REMINDER_STAGES = ['24h', '72h'] as const;
export type ReminderStage = (typeof REMINDER_STAGES)[number];

export const receiptReminderPropsSchema = z
  .object({
    fullName: z.string().min(1).max(120),
    courseTitle: z.string().min(1).max(200),
    reference: z.string().min(1).max(32),
    /** Pre-formatted amount, e.g. `1 200 DH`. */
    amountLabel: z.string().min(1).max(40),
    stage: z.enum(REMINDER_STAGES),
    /** Pre-formatted local date the request expires, e.g. `12/03/2026`. */
    expiresAtLabel: z.string().min(1).max(20),
    /** Absolute URL of `/[locale]/espace/demandes`. */
    requestsUrl: z.string().url(),
  })
  .strict();

export type ReceiptReminderProps = z.infer<typeof receiptReminderPropsSchema>;

interface Copy {
  readonly subject: string;
  readonly preview: string;
  readonly heading: string;
  readonly greeting: (firstName: string) => string;
  readonly intro: (courseTitle: string) => string;
  readonly referenceLabel: string;
  readonly amountLabel: string;
  readonly expiresLabel: string;
  readonly expiry: (date: string) => string;
  readonly cta: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    subject: 'Rappel : votre demande attend un justificatif',
    preview: 'Votre demande d’inscription est en attente de votre justificatif de virement.',
    heading: 'Votre demande attend un justificatif',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro: (courseTitle) =>
      `Vous avez commencé une demande d’accès à la formation « ${courseTitle} », mais nous n’avons pas encore reçu votre justificatif de virement. Ajoutez-le depuis votre espace pour que notre équipe puisse activer votre accès.`,
    referenceLabel: 'Référence',
    amountLabel: 'Montant',
    expiresLabel: 'À faire avant le',
    expiry: (date) =>
      `Sans justificatif, votre demande expirera le ${date}. Vous pourrez toujours en refaire une, mais votre référence actuelle sera perdue.`,
    cta: 'Ajouter mon justificatif',
  },
  ar: {
    subject: 'تذكير: طلبكم في انتظار إشعار التحويل',
    preview: 'طلب تسجيلكم في انتظار إشعار التحويل الخاص بكم.',
    heading: 'طلبكم في انتظار إشعار التحويل',
    greeting: (firstName) => `مرحبًا ${firstName}،`,
    intro: (courseTitle) =>
      `بدأتم طلب الولوج إلى الدورة التدريبية «${courseTitle}»، لكننا لم نتوصل بعد بإشعار التحويل. أضيفوه من فضائكم ليتمكن فريقنا من تفعيل ولوجكم.`,
    referenceLabel: 'المرجع',
    amountLabel: 'المبلغ',
    expiresLabel: 'قبل تاريخ',
    expiry: (date) =>
      `بدون إشعار، سينتهي أجل طلبكم في ${date}. يمكنكم دائمًا تقديم طلب جديد، لكن مرجعكم الحالي سيُفقد.`,
    cta: 'إضافة إشعار التحويل',
  },
  en: {
    subject: 'Reminder: your request is waiting for a receipt',
    preview: 'Your enrollment request is waiting for your transfer receipt.',
    heading: 'Your request is waiting for a receipt',
    greeting: (firstName) => `Hello ${firstName},`,
    intro: (courseTitle) =>
      `You started a request for the course “${courseTitle}”, but we have not yet received your transfer receipt. Add it from your space so our team can activate your access.`,
    referenceLabel: 'Reference',
    amountLabel: 'Amount',
    expiresLabel: 'Before',
    expiry: (date) =>
      `Without a receipt, your request will expire on ${date}. You can always submit a new one, but your current reference will be lost.`,
    cta: 'Add my receipt',
  },
  es: {
    subject: 'Recordatorio: su solicitud espera un justificante',
    preview: 'Su solicitud de inscripción espera su justificante de transferencia.',
    heading: 'Su solicitud espera un justificante',
    greeting: (firstName) => `Hola ${firstName}:`,
    intro: (courseTitle) =>
      `Empezó una solicitud de acceso a la formación «${courseTitle}», pero aún no hemos recibido su justificante de transferencia. Añádalo desde su espacio para que nuestro equipo active su acceso.`,
    referenceLabel: 'Referencia',
    amountLabel: 'Importe',
    expiresLabel: 'Antes del',
    expiry: (date) =>
      `Sin justificante, su solicitud caducará el ${date}. Siempre podrá crear una nueva, pero su referencia actual se perderá.`,
    cta: 'Añadir mi justificante',
  },
};

function body(props: ReceiptReminderProps, ctx: EmailContext): ReactNode {
  const copy = COPY[ctx.locale];
  return (
    <EmailLayout ctx={ctx} preview={copy.preview}>
      <EmailHeading ctx={ctx}>{copy.heading}</EmailHeading>
      <EmailParagraph ctx={ctx}>{copy.greeting(firstNameOf(props.fullName))}</EmailParagraph>
      <EmailParagraph ctx={ctx}>{copy.intro(props.courseTitle)}</EmailParagraph>
      <EmailDetails
        ctx={ctx}
        rows={[
          {
            label: copy.referenceLabel,
            value: (
              <Ltr>
                <span style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>
                  {props.reference}
                </span>
              </Ltr>
            ),
          },
          { label: copy.amountLabel, value: <Ltr>{props.amountLabel}</Ltr> },
          { label: copy.expiresLabel, value: <Ltr>{props.expiresAtLabel}</Ltr> },
        ]}
      />
      <EmailParagraph ctx={ctx}>{copy.expiry(props.expiresAtLabel)}</EmailParagraph>
      <EmailCta ctx={ctx} href={props.requestsUrl} label={copy.cta} />
    </EmailLayout>
  );
}

function text(props: ReceiptReminderProps, ctx: EmailContext): string {
  const copy = COPY[ctx.locale];
  return textBody(ctx, [
    copy.heading,
    copy.greeting(firstNameOf(props.fullName)),
    copy.intro(props.courseTitle),
    `${copy.referenceLabel} : ${props.reference}\n${copy.amountLabel} : ${props.amountLabel}`,
    copy.expiry(props.expiresAtLabel),
    `${copy.cta} :\n${props.requestsUrl}`,
  ]);
}

export const receiptReminderTemplate: EmailTemplate<ReceiptReminderProps> = {
  id: 'receipt-reminder',
  schema: receiptReminderPropsSchema,
  subject: (_props, ctx) => COPY[ctx.locale].subject,
  body,
  text,
};
