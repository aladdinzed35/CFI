/* @jsxRuntime automatic @jsxImportSource react */
/**
 * Email #6 (§18) — « Demande reçue — vérification en cours ».
 *
 * Sent to the student the moment their justificatif lands. Carries the
 * reference, the amount, and — for a standard transfer — the **verbatim** §28.3
 * 48-hour notice (§9.2 rule 4 requires it in this e-mail, word for word).
 */

import type { ReactNode } from 'react';
import { z } from 'zod';
import {
  EmailCallout,
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

export const TRANSFER_TYPES = ['INSTANT', 'STANDARD_48H', 'CASH_AT_CENTER'] as const;
export type TransferTypeProp = (typeof TRANSFER_TYPES)[number];

export const requestReceivedPropsSchema = z
  .object({
    fullName: z.string().min(1).max(120),
    /** `CFI-2026-000123` — rendered LTR and monospace in every locale. */
    reference: z.string().min(1).max(32),
    courseTitle: z.string().min(1).max(200),
    /** Pre-formatted by `formatMoney` in the recipient's locale — e.g. `1 200 DH`. */
    amountLabel: z.string().min(1).max(40),
    transferType: z.enum(TRANSFER_TYPES),
    /** Absolute URL of `/[locale]/espace/demandes`. */
    requestsUrl: z.string().url(),
  })
  .strict();

export type RequestReceivedProps = z.infer<typeof requestReceivedPropsSchema>;

interface Copy {
  readonly subject: string;
  readonly preview: string;
  readonly heading: string;
  readonly greeting: (firstName: string) => string;
  readonly intro: (courseTitle: string) => string;
  readonly referenceLabel: string;
  readonly amountLabel: string;
  readonly courseLabel: string;
  readonly noticeTitle: string;
  /** The §28.3 standard-transfer notice — verbatim in French. */
  readonly standardNotice: string;
  readonly cashNotice: string;
  readonly nextStep: string;
  readonly cta: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    subject: 'Demande reçue — vérification en cours',
    preview: 'Nous avons bien reçu votre justificatif de virement.',
    heading: 'Votre demande est en cours de traitement',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro: (courseTitle) =>
      `Nous avons bien reçu votre justificatif de virement pour la formation « ${courseTitle} ». Notre équipe le vérifie et active votre accès dès confirmation du paiement.`,
    referenceLabel: 'Référence',
    amountLabel: 'Montant',
    courseLabel: 'Formation',
    noticeTitle: 'Virement standard (48 h)',
    standardNotice:
      'Nous vous recommandons d’effectuer un virement instantané : votre accès est alors activé le jour même. En cas de virement standard, l’accès à la formation ne sera activé qu’une fois les fonds effectivement reçus sur notre compte, dans un délai pouvant aller jusqu’à 48 heures ouvrées.',
    cashNotice:
      'Vous avez choisi le paiement en espèces au centre : présentez-vous à l’accueil ; votre accès sera activé après encaissement.',
    nextStep:
      'Vous recevrez un e-mail dès que votre formation sera disponible. Vous pouvez suivre l’avancement de votre demande à tout moment.',
    cta: 'Voir mes demandes',
  },
  ar: {
    subject: 'تم استلام طلبكم — التحقق جارٍ',
    preview: 'لقد توصلنا بإشعار التحويل الخاص بكم.',
    heading: 'طلبكم قيد المعالجة',
    greeting: (firstName) => `مرحبًا ${firstName}،`,
    intro: (courseTitle) =>
      `لقد توصلنا بإشعار التحويل الخاص بالدورة التدريبية «${courseTitle}». يتحقق فريقنا منه وسيُفعّل ولوجكم فور تأكيد الأداء.`,
    referenceLabel: 'المرجع',
    amountLabel: 'المبلغ',
    courseLabel: 'الدورة التدريبية',
    noticeTitle: 'تحويل عادي (48 ساعة)',
    standardNotice:
      'ننصحكم بإجراء تحويل فوري: يُفعّل ولوجكم حينها في اليوم نفسه. في حال التحويل العادي، لن يُفعّل الولوج إلى الدورة إلا بعد استلام الأموال فعليًا في حسابنا، وقد يستغرق ذلك ما يصل إلى 48 ساعة عمل.',
    cashNotice: 'اخترتم الأداء نقدًا بالمركز: تفضلوا إلى الاستقبال؛ سيُفعّل ولوجكم بعد التحصيل.',
    nextStep: 'ستتوصلون برسالة إلكترونية فور توفر دورتكم. يمكنكم متابعة تقدم طلبكم في أي وقت.',
    cta: 'عرض طلباتي',
  },
  en: {
    subject: 'Request received — verification in progress',
    preview: 'We have received your bank transfer receipt.',
    heading: 'Your request is being processed',
    greeting: (firstName) => `Hello ${firstName},`,
    intro: (courseTitle) =>
      `We have received your transfer receipt for the course “${courseTitle}”. Our team is checking it and will activate your access as soon as the payment is confirmed.`,
    referenceLabel: 'Reference',
    amountLabel: 'Amount',
    courseLabel: 'Course',
    noticeTitle: 'Standard transfer (48 h)',
    standardNotice:
      'We recommend an instant transfer: your access is then activated the same day. With a standard transfer, access to the course is only activated once the funds have actually reached our account, which can take up to 48 working hours.',
    cashNotice:
      'You chose to pay in cash at the centre: come to the front desk; your access will be activated once the payment is received.',
    nextStep:
      'You will receive an email as soon as your course is available. You can follow the progress of your request at any time.',
    cta: 'View my requests',
  },
  es: {
    subject: 'Solicitud recibida — verificación en curso',
    preview: 'Hemos recibido su justificante de transferencia.',
    heading: 'Su solicitud está en curso de tratamiento',
    greeting: (firstName) => `Hola ${firstName}:`,
    intro: (courseTitle) =>
      `Hemos recibido su justificante de transferencia para la formación «${courseTitle}». Nuestro equipo lo verifica y activará su acceso en cuanto se confirme el pago.`,
    referenceLabel: 'Referencia',
    amountLabel: 'Importe',
    courseLabel: 'Formación',
    noticeTitle: 'Transferencia estándar (48 h)',
    standardNotice:
      'Le recomendamos una transferencia instantánea: su acceso se activa entonces el mismo día. Con una transferencia estándar, el acceso a la formación solo se activará cuando los fondos lleguen efectivamente a nuestra cuenta, lo que puede tardar hasta 48 horas laborables.',
    cashNotice:
      'Ha elegido el pago en efectivo en el centro: preséntese en recepción; su acceso se activará tras el cobro.',
    nextStep:
      'Recibirá un correo en cuanto su formación esté disponible. Puede seguir el estado de su solicitud en cualquier momento.',
    cta: 'Ver mis solicitudes',
  },
};

function body(props: RequestReceivedProps, ctx: EmailContext): ReactNode {
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
          { label: copy.courseLabel, value: props.courseTitle },
          { label: copy.amountLabel, value: <Ltr>{props.amountLabel}</Ltr> },
        ]}
      />
      {props.transferType === 'STANDARD_48H' ? (
        <EmailCallout ctx={ctx} tone="warn" title={copy.noticeTitle}>
          {copy.standardNotice}
        </EmailCallout>
      ) : null}
      {props.transferType === 'CASH_AT_CENTER' ? (
        <EmailParagraph ctx={ctx}>{copy.cashNotice}</EmailParagraph>
      ) : null}
      <EmailParagraph ctx={ctx}>{copy.nextStep}</EmailParagraph>
      <EmailCta ctx={ctx} href={props.requestsUrl} label={copy.cta} />
    </EmailLayout>
  );
}

function text(props: RequestReceivedProps, ctx: EmailContext): string {
  const copy = COPY[ctx.locale];
  return textBody(ctx, [
    copy.heading,
    copy.greeting(firstNameOf(props.fullName)),
    copy.intro(props.courseTitle),
    `${copy.referenceLabel} : ${props.reference}\n${copy.courseLabel} : ${props.courseTitle}\n${copy.amountLabel} : ${props.amountLabel}`,
    props.transferType === 'STANDARD_48H' ? `${copy.noticeTitle} — ${copy.standardNotice}` : null,
    props.transferType === 'CASH_AT_CENTER' ? copy.cashNotice : null,
    copy.nextStep,
    `${copy.cta} :\n${props.requestsUrl}`,
  ]);
}

export const requestReceivedTemplate: EmailTemplate<RequestReceivedProps> = {
  id: 'request-received',
  schema: requestReceivedPropsSchema,
  subject: (_props, ctx) => COPY[ctx.locale].subject,
  body,
  text,
};
