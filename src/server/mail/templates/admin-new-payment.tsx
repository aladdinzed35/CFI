/* @jsxRuntime automatic @jsxImportSource react */
/**
 * Email #7 (§18) — « Nouveau paiement à vérifier », to the administrators.
 *
 * Everything the reviewer needs before opening the drawer: student, course,
 * amount, transfer type, reference — and one deep link into §17.3. The
 * receipt itself is *not* attached: it is private (§9.2 rule 5) and viewed
 * only through the authenticated gateway behind the deep link.
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
  textBody,
  type EmailContext,
  type EmailTemplate,
} from './layout';
import type { Locale } from '@/i18n/routing';
import { TRANSFER_TYPES } from './request-received';

export const adminNewPaymentPropsSchema = z
  .object({
    studentName: z.string().min(1).max(120),
    studentEmail: z.string().email(),
    courseTitle: z.string().min(1).max(200),
    reference: z.string().min(1).max(32),
    /** Pre-formatted amount, e.g. `1 200 DH`. */
    amountLabel: z.string().min(1).max(40),
    transferType: z.enum(TRANSFER_TYPES),
    /** Absolute URL of `/[locale]/admin/demandes/{id}` — the §17.3 drawer. */
    adminUrl: z.string().url(),
    /** `true` when the receipt's SHA-256 matches another request (§9.2 rule 6). */
    duplicateReceipt: z.boolean(),
  })
  .strict();

export type AdminNewPaymentProps = z.infer<typeof adminNewPaymentPropsSchema>;

interface Copy {
  readonly subject: (reference: string) => string;
  readonly preview: string;
  readonly heading: string;
  readonly intro: string;
  readonly studentLabel: string;
  readonly emailLabel: string;
  readonly courseLabel: string;
  readonly amountLabel: string;
  readonly referenceLabel: string;
  readonly transferLabel: string;
  readonly transferTypes: Record<(typeof TRANSFER_TYPES)[number], string>;
  readonly duplicateWarning: string;
  readonly cta: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    subject: (reference) => `Nouveau paiement à vérifier — ${reference}`,
    preview: 'Un justificatif de virement attend votre vérification.',
    heading: 'Nouveau paiement à vérifier',
    intro:
      'Un étudiant vient de soumettre un justificatif de virement. Ouvrez la demande pour consulter le justificatif et activer ou refuser l’accès.',
    studentLabel: 'Étudiant',
    emailLabel: 'E-mail',
    courseLabel: 'Formation',
    amountLabel: 'Montant',
    referenceLabel: 'Référence',
    transferLabel: 'Type de virement',
    transferTypes: {
      INSTANT: 'Virement instantané',
      STANDARD_48H: 'Virement standard (48 h)',
      CASH_AT_CENTER: 'Paiement en espèces au centre',
    },
    duplicateWarning:
      '⚠ Justificatif déjà utilisé : l’empreinte de ce fichier correspond à une autre demande. Vérifiez l’original avant de valider.',
    cta: 'Ouvrir la demande',
  },
  ar: {
    subject: (reference) => `أداء جديد للتحقق — ${reference}`,
    preview: 'إشعار تحويل في انتظار تحققكم.',
    heading: 'أداء جديد للتحقق',
    intro: 'قدّم طالب للتو إشعار تحويل. افتحوا الطلب للاطلاع على الإشعار وتفعيل الولوج أو رفضه.',
    studentLabel: 'الطالب',
    emailLabel: 'البريد الإلكتروني',
    courseLabel: 'الدورة التدريبية',
    amountLabel: 'المبلغ',
    referenceLabel: 'المرجع',
    transferLabel: 'نوع التحويل',
    transferTypes: {
      INSTANT: 'تحويل فوري',
      STANDARD_48H: 'تحويل عادي (48 ساعة)',
      CASH_AT_CENTER: 'أداء نقدًا بالمركز',
    },
    duplicateWarning:
      '⚠ إشعار مستعمل من قبل: بصمة هذا الملف تطابق طلبًا آخر. تحققوا من الأصل قبل المصادقة.',
    cta: 'فتح الطلب',
  },
  en: {
    subject: (reference) => `New payment to verify — ${reference}`,
    preview: 'A bank transfer receipt is waiting for your review.',
    heading: 'New payment to verify',
    intro:
      'A student has just submitted a transfer receipt. Open the request to view the receipt and activate or refuse access.',
    studentLabel: 'Student',
    emailLabel: 'Email',
    courseLabel: 'Course',
    amountLabel: 'Amount',
    referenceLabel: 'Reference',
    transferLabel: 'Transfer type',
    transferTypes: {
      INSTANT: 'Instant transfer',
      STANDARD_48H: 'Standard transfer (48 h)',
      CASH_AT_CENTER: 'Cash at the centre',
    },
    duplicateWarning:
      '⚠ Receipt already used: this file’s fingerprint matches another request. Check the original before approving.',
    cta: 'Open the request',
  },
  es: {
    subject: (reference) => `Nuevo pago por verificar — ${reference}`,
    preview: 'Un justificante de transferencia espera su verificación.',
    heading: 'Nuevo pago por verificar',
    intro:
      'Un estudiante acaba de enviar un justificante de transferencia. Abra la solicitud para consultar el justificante y activar o rechazar el acceso.',
    studentLabel: 'Estudiante',
    emailLabel: 'Correo',
    courseLabel: 'Formación',
    amountLabel: 'Importe',
    referenceLabel: 'Referencia',
    transferLabel: 'Tipo de transferencia',
    transferTypes: {
      INSTANT: 'Transferencia instantánea',
      STANDARD_48H: 'Transferencia estándar (48 h)',
      CASH_AT_CENTER: 'Pago en efectivo en el centro',
    },
    duplicateWarning:
      '⚠ Justificante ya utilizado: la huella de este archivo coincide con otra solicitud. Verifique el original antes de validar.',
    cta: 'Abrir la solicitud',
  },
};

function body(props: AdminNewPaymentProps, ctx: EmailContext): ReactNode {
  const copy = COPY[ctx.locale];
  return (
    <EmailLayout ctx={ctx} preview={copy.preview}>
      <EmailHeading ctx={ctx}>{copy.heading}</EmailHeading>
      <EmailParagraph ctx={ctx}>{copy.intro}</EmailParagraph>
      <EmailDetails
        ctx={ctx}
        rows={[
          { label: copy.studentLabel, value: props.studentName },
          { label: copy.emailLabel, value: <Ltr>{props.studentEmail}</Ltr> },
          { label: copy.courseLabel, value: props.courseTitle },
          { label: copy.amountLabel, value: <Ltr>{props.amountLabel}</Ltr> },
          { label: copy.transferLabel, value: copy.transferTypes[props.transferType] },
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
        ]}
      />
      {props.duplicateReceipt ? (
        <EmailParagraph ctx={ctx}>
          <strong style={{ fontWeight: 700 }}>{copy.duplicateWarning}</strong>
        </EmailParagraph>
      ) : null}
      <EmailCta ctx={ctx} href={props.adminUrl} label={copy.cta} />
    </EmailLayout>
  );
}

function text(props: AdminNewPaymentProps, ctx: EmailContext): string {
  const copy = COPY[ctx.locale];
  return textBody(ctx, [
    copy.heading,
    copy.intro,
    [
      `${copy.studentLabel} : ${props.studentName}`,
      `${copy.emailLabel} : ${props.studentEmail}`,
      `${copy.courseLabel} : ${props.courseTitle}`,
      `${copy.amountLabel} : ${props.amountLabel}`,
      `${copy.transferLabel} : ${copy.transferTypes[props.transferType]}`,
      `${copy.referenceLabel} : ${props.reference}`,
    ].join('\n'),
    props.duplicateReceipt ? copy.duplicateWarning : null,
    `${copy.cta} :\n${props.adminUrl}`,
  ]);
}

export const adminNewPaymentTemplate: EmailTemplate<AdminNewPaymentProps> = {
  id: 'admin-new-payment',
  schema: adminNewPaymentPropsSchema,
  subject: (props, ctx) => COPY[ctx.locale].subject(props.reference),
  body,
  text,
};
