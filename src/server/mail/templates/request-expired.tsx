/* @jsxRuntime automatic @jsxImportSource react */
/**
 * Email #12 (§18) — « Demande expirée ».
 *
 * The request ran out its seven days without a usable justificatif. §9.2 row 6:
 * the student may re-submit freely — so the single CTA opens the course page,
 * where a fresh request (new reference) starts.
 */

import type { ReactNode } from 'react';
import { z } from 'zod';
import {
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

export const requestExpiredPropsSchema = z
  .object({
    fullName: z.string().min(1).max(120),
    courseTitle: z.string().min(1).max(200),
    reference: z.string().min(1).max(32),
    /** Absolute URL of the course page — where a new request starts. */
    courseUrl: z.string().url(),
  })
  .strict();

export type RequestExpiredProps = z.infer<typeof requestExpiredPropsSchema>;

interface Copy {
  readonly subject: string;
  readonly preview: string;
  readonly heading: string;
  readonly greeting: (firstName: string) => string;
  readonly intro: (courseTitle: string, reference: string) => string;
  readonly outro: string;
  readonly cta: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    subject: 'Votre demande a expiré',
    preview: 'Votre demande d’inscription a expiré — vous pouvez en refaire une à tout moment.',
    heading: 'Votre demande a expiré',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro: (courseTitle, reference) =>
      `Votre demande d’accès à la formation « ${courseTitle} » (référence ${reference}) est restée sans justificatif et a expiré.`,
    outro:
      'Rien n’est perdu : vous pouvez refaire une demande en quelques clics depuis la page de la formation. Une nouvelle référence vous sera attribuée.',
    cta: 'Refaire une demande',
  },
  ar: {
    subject: 'انتهى أجل طلبكم',
    preview: 'انتهى أجل طلب تسجيلكم — يمكنكم تقديم طلب جديد في أي وقت.',
    heading: 'انتهى أجل طلبكم',
    greeting: (firstName) => `مرحبًا ${firstName}،`,
    intro: (courseTitle, reference) =>
      `بقي طلبكم الخاص بالدورة التدريبية «${courseTitle}» (المرجع ${reference}) دون إشعار تحويل وانتهى أجله.`,
    outro:
      'لم يضِع شيء: يمكنكم تقديم طلب جديد ببضع نقرات من صفحة الدورة. سيُمنح لكم مرجع جديد.',
    cta: 'تقديم طلب جديد',
  },
  en: {
    subject: 'Your request has expired',
    preview: 'Your enrollment request has expired — you can submit a new one at any time.',
    heading: 'Your request has expired',
    greeting: (firstName) => `Hello ${firstName},`,
    intro: (courseTitle, reference) =>
      `Your request for the course “${courseTitle}” (reference ${reference}) stayed without a receipt and has expired.`,
    outro:
      'Nothing is lost: you can submit a new request in a few clicks from the course page. A new reference will be assigned to you.',
    cta: 'Submit a new request',
  },
  es: {
    subject: 'Su solicitud ha caducado',
    preview: 'Su solicitud de inscripción ha caducado — puede crear una nueva en cualquier momento.',
    heading: 'Su solicitud ha caducado',
    greeting: (firstName) => `Hola ${firstName}:`,
    intro: (courseTitle, reference) =>
      `Su solicitud de acceso a la formación «${courseTitle}» (referencia ${reference}) quedó sin justificante y ha caducado.`,
    outro:
      'No se ha perdido nada: puede crear una nueva solicitud en unos clics desde la página de la formación. Se le asignará una nueva referencia.',
    cta: 'Volver a solicitar',
  },
};

function body(props: RequestExpiredProps, ctx: EmailContext): ReactNode {
  const copy = COPY[ctx.locale];
  return (
    <EmailLayout ctx={ctx} preview={copy.preview}>
      <EmailHeading ctx={ctx}>{copy.heading}</EmailHeading>
      <EmailParagraph ctx={ctx}>{copy.greeting(firstNameOf(props.fullName))}</EmailParagraph>
      <EmailParagraph ctx={ctx}>{copy.intro(props.courseTitle, props.reference)}</EmailParagraph>
      <EmailParagraph ctx={ctx}>{copy.outro}</EmailParagraph>
      <EmailCta ctx={ctx} href={props.courseUrl} label={copy.cta} />
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

function text(props: RequestExpiredProps, ctx: EmailContext): string {
  const copy = COPY[ctx.locale];
  return textBody(ctx, [
    copy.heading,
    copy.greeting(firstNameOf(props.fullName)),
    copy.intro(props.courseTitle, props.reference),
    copy.outro,
    `${copy.cta} :\n${props.courseUrl}`,
  ]);
}

export const requestExpiredTemplate: EmailTemplate<RequestExpiredProps> = {
  id: 'request-expired',
  schema: requestExpiredPropsSchema,
  subject: (_props, ctx) => COPY[ctx.locale].subject,
  body,
  text,
};
