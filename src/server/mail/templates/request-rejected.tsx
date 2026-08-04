/* @jsxRuntime automatic @jsxImportSource react */
/**
 * Email #10 (§18) — « Demande refusée ».
 *
 * Says what happened, why, and what to do next (rule 9: errors say what
 * happened AND what to do). The reason is the administrator's text, verbatim.
 * The WhatsApp CTA is rendered only when the centre has configured a number —
 * a dead chat button is worse than none.
 */

import type { ReactNode } from 'react';
import { z } from 'zod';
import {
  EmailCallout,
  EmailCta,
  EmailHeading,
  EmailLayout,
  EmailLink,
  EmailParagraph,
  Ltr,
  chromeCopy,
  firstNameOf,
  textBody,
  type EmailContext,
  type EmailTemplate,
} from './layout';
import type { Locale } from '@/i18n/routing';

export const requestRejectedPropsSchema = z
  .object({
    fullName: z.string().min(1).max(120),
    courseTitle: z.string().min(1).max(200),
    reference: z.string().min(1).max(32),
    /** The administrator's reason, shown verbatim. */
    reason: z.string().min(1).max(2_000),
    /** Absolute URL of the course page — where a new request starts. */
    courseUrl: z.string().url(),
  })
  .strict();

export type RequestRejectedProps = z.infer<typeof requestRejectedPropsSchema>;

interface Copy {
  readonly subject: string;
  readonly preview: string;
  readonly heading: string;
  readonly greeting: (firstName: string) => string;
  readonly intro: (courseTitle: string, reference: string) => string;
  readonly reasonTitle: string;
  readonly outro: string;
  readonly cta: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    subject: 'Votre demande n’a pas pu être validée',
    preview: 'Votre demande a été refusée — voici pourquoi et comment refaire une demande.',
    heading: 'Votre demande a été refusée',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro: (courseTitle, reference) =>
      `Après vérification, nous n’avons pas pu valider votre demande pour la formation « ${courseTitle} » (référence ${reference}).`,
    reasonTitle: 'Motif du refus',
    outro:
      'Vous pouvez soumettre une nouvelle demande à tout moment depuis la page de la formation. En cas de doute, écrivez-nous sur WhatsApp : nous vous répondrons rapidement.',
    cta: 'Refaire une demande',
  },
  ar: {
    subject: 'تعذّرت المصادقة على طلبكم',
    preview: 'رُفض طلبكم — إليكم السبب وكيفية تقديم طلب جديد.',
    heading: 'رُفض طلبكم',
    greeting: (firstName) => `مرحبًا ${firstName}،`,
    intro: (courseTitle, reference) =>
      `بعد التحقق، لم نتمكن من المصادقة على طلبكم الخاص بالدورة التدريبية «${courseTitle}» (المرجع ${reference}).`,
    reasonTitle: 'سبب الرفض',
    outro:
      'يمكنكم تقديم طلب جديد في أي وقت من صفحة الدورة. إن كان لديكم أي استفسار، راسلونا عبر واتساب وسنرد عليكم بسرعة.',
    cta: 'تقديم طلب جديد',
  },
  en: {
    subject: 'Your request could not be validated',
    preview: 'Your request was refused — here is why and how to submit a new one.',
    heading: 'Your request was refused',
    greeting: (firstName) => `Hello ${firstName},`,
    intro: (courseTitle, reference) =>
      `After review, we could not validate your request for the course “${courseTitle}” (reference ${reference}).`,
    reasonTitle: 'Reason',
    outro:
      'You can submit a new request at any time from the course page. If in doubt, message us on WhatsApp — we reply quickly.',
    cta: 'Submit a new request',
  },
  es: {
    subject: 'Su solicitud no pudo ser validada',
    preview: 'Su solicitud fue rechazada — aquí el motivo y cómo volver a solicitarla.',
    heading: 'Su solicitud fue rechazada',
    greeting: (firstName) => `Hola ${firstName}:`,
    intro: (courseTitle, reference) =>
      `Tras la verificación, no hemos podido validar su solicitud para la formación «${courseTitle}» (referencia ${reference}).`,
    reasonTitle: 'Motivo del rechazo',
    outro:
      'Puede enviar una nueva solicitud en cualquier momento desde la página de la formación. Si tiene dudas, escríbanos por WhatsApp: le responderemos rápidamente.',
    cta: 'Volver a solicitar',
  },
};

function body(props: RequestRejectedProps, ctx: EmailContext): ReactNode {
  const copy = COPY[ctx.locale];
  return (
    <EmailLayout ctx={ctx} preview={copy.preview}>
      <EmailHeading ctx={ctx}>{copy.heading}</EmailHeading>
      <EmailParagraph ctx={ctx}>{copy.greeting(firstNameOf(props.fullName))}</EmailParagraph>
      <EmailParagraph ctx={ctx}>{copy.intro(props.courseTitle, props.reference)}</EmailParagraph>
      <EmailCallout ctx={ctx} tone="danger" title={copy.reasonTitle}>
        {props.reason}
      </EmailCallout>
      <EmailParagraph ctx={ctx}>{copy.outro}</EmailParagraph>
      <EmailCta ctx={ctx} href={props.courseUrl} label={copy.cta} />
      {ctx.brand.whatsappUrl !== null ? (
        <EmailParagraph ctx={ctx} muted>
          <EmailLink href={ctx.brand.whatsappUrl}>{chromeCopy(ctx.locale).writeUs}</EmailLink>
        </EmailParagraph>
      ) : null}
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

function text(props: RequestRejectedProps, ctx: EmailContext): string {
  const copy = COPY[ctx.locale];
  return textBody(ctx, [
    copy.heading,
    copy.greeting(firstNameOf(props.fullName)),
    copy.intro(props.courseTitle, props.reference),
    `${copy.reasonTitle} :\n${props.reason}`,
    copy.outro,
    `${copy.cta} :\n${props.courseUrl}`,
  ]);
}

export const requestRejectedTemplate: EmailTemplate<RequestRejectedProps> = {
  id: 'request-rejected',
  schema: requestRejectedPropsSchema,
  subject: (_props, ctx) => COPY[ctx.locale].subject,
  body,
  text,
};
