/* @jsxRuntime automatic @jsxImportSource react */
/**
 * Email #8 (§18) — « Justificatif à compléter ».
 *
 * The admin looked at the receipt and needs something better — a legible
 * amount, the right beneficiary, the missing reference. Their message is shown
 * verbatim; the single CTA leads back to the request, where the inline
 * re-upload box of the §9.2 timeline widget lives.
 */

import type { ReactNode } from 'react';
import { z } from 'zod';
import {
  EmailCallout,
  EmailCta,
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

export const requestInfoNeededPropsSchema = z
  .object({
    fullName: z.string().min(1).max(120),
    courseTitle: z.string().min(1).max(200),
    reference: z.string().min(1).max(32),
    /** The administrator's message, shown verbatim. */
    adminMessage: z.string().min(1).max(2_000),
    /** Absolute URL of `/[locale]/espace/demandes`. */
    requestsUrl: z.string().url(),
  })
  .strict();

export type RequestInfoNeededProps = z.infer<typeof requestInfoNeededPropsSchema>;

interface Copy {
  readonly subject: string;
  readonly preview: string;
  readonly heading: string;
  readonly greeting: (firstName: string) => string;
  readonly intro: (courseTitle: string, reference: string) => string;
  readonly messageTitle: string;
  readonly outro: string;
  readonly cta: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    subject: 'Justificatif à compléter',
    preview: 'Notre équipe a besoin d’un complément pour valider votre demande.',
    heading: 'Votre justificatif doit être complété',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro: (courseTitle, reference) =>
      `Notre équipe a examiné votre demande pour la formation « ${courseTitle} » (référence ${reference}) et a besoin d’un complément avant de pouvoir activer votre accès.`,
    messageTitle: 'Message de notre équipe',
    outro:
      'Renvoyez un justificatif depuis votre espace : votre demande repassera aussitôt en vérification.',
    cta: 'Renvoyer un justificatif',
  },
  ar: {
    subject: 'إشعار التحويل بحاجة إلى استكمال',
    preview: 'يحتاج فريقنا إلى معلومة إضافية للمصادقة على طلبكم.',
    heading: 'إشعار التحويل الخاص بكم بحاجة إلى استكمال',
    greeting: (firstName) => `مرحبًا ${firstName}،`,
    intro: (courseTitle, reference) =>
      `درس فريقنا طلبكم الخاص بالدورة التدريبية «${courseTitle}» (المرجع ${reference}) ويحتاج إلى معلومة إضافية قبل تفعيل ولوجكم.`,
    messageTitle: 'رسالة فريقنا',
    outro: 'أعيدوا إرسال إشعار التحويل من فضائكم: سيعود طلبكم فورًا إلى مرحلة التحقق.',
    cta: 'إعادة إرسال الإشعار',
  },
  en: {
    subject: 'Receipt needs completing',
    preview: 'Our team needs one more thing to validate your request.',
    heading: 'Your receipt needs completing',
    greeting: (firstName) => `Hello ${firstName},`,
    intro: (courseTitle, reference) =>
      `Our team reviewed your request for the course “${courseTitle}” (reference ${reference}) and needs one more thing before activating your access.`,
    messageTitle: 'Message from our team',
    outro: 'Send a new receipt from your space: your request goes straight back under review.',
    cta: 'Send a new receipt',
  },
  es: {
    subject: 'Justificante por completar',
    preview: 'Nuestro equipo necesita un dato más para validar su solicitud.',
    heading: 'Su justificante debe completarse',
    greeting: (firstName) => `Hola ${firstName}:`,
    intro: (courseTitle, reference) =>
      `Nuestro equipo ha examinado su solicitud para la formación «${courseTitle}» (referencia ${reference}) y necesita un dato más antes de activar su acceso.`,
    messageTitle: 'Mensaje de nuestro equipo',
    outro:
      'Vuelva a enviar un justificante desde su espacio: su solicitud volverá inmediatamente a verificación.',
    cta: 'Reenviar un justificante',
  },
};

function body(props: RequestInfoNeededProps, ctx: EmailContext): ReactNode {
  const copy = COPY[ctx.locale];
  return (
    <EmailLayout ctx={ctx} preview={copy.preview}>
      <EmailHeading ctx={ctx}>{copy.heading}</EmailHeading>
      <EmailParagraph ctx={ctx}>{copy.greeting(firstNameOf(props.fullName))}</EmailParagraph>
      <EmailParagraph ctx={ctx}>{copy.intro(props.courseTitle, props.reference)}</EmailParagraph>
      <EmailCallout ctx={ctx} tone="warn" title={copy.messageTitle}>
        {props.adminMessage}
      </EmailCallout>
      <EmailParagraph ctx={ctx}>{copy.outro}</EmailParagraph>
      <EmailCta ctx={ctx} href={props.requestsUrl} label={copy.cta} />
      <EmailParagraph ctx={ctx} muted>
        <Ltr>
          <span style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>
            {props.reference}
          </span>
        </Ltr>
      </EmailParagraph>
    </EmailLayout>
  );
}

function text(props: RequestInfoNeededProps, ctx: EmailContext): string {
  const copy = COPY[ctx.locale];
  return textBody(ctx, [
    copy.heading,
    copy.greeting(firstNameOf(props.fullName)),
    copy.intro(props.courseTitle, props.reference),
    `${copy.messageTitle} :\n${props.adminMessage}`,
    copy.outro,
    `${copy.cta} :\n${props.requestsUrl}`,
  ]);
}

export const requestInfoNeededTemplate: EmailTemplate<RequestInfoNeededProps> = {
  id: 'request-info-needed',
  schema: requestInfoNeededPropsSchema,
  subject: (_props, ctx) => COPY[ctx.locale].subject,
  body,
  text,
};
