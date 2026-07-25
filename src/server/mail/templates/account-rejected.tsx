/**
 * Email #5 (§18) — « Votre inscription n'a pas pu être validée ».
 *
 * The hardest email in M1 to get right. Someone signed up in good faith and is
 * being turned away, so the tone is factual and respectful, the admin's reason
 * is quoted in full rather than paraphrased, and the way back is spelled out:
 * the account can be reactivated at any time (§9.1), and there is a human to
 * talk to. No apology theatre, no « Oops », no dead end.
 *
 * The call to action is WhatsApp when a number is configured, and the contact
 * mailbox otherwise — never a link back to a page that would only repeat the
 * refusal.
 */

import type { ReactNode } from 'react';
import { z } from 'zod';
import {
  EmailCallout,
  EmailCta,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
  firstNameOf,
  textBody,
  type EmailContext,
  type EmailTemplate,
} from './layout';
import type { Locale } from '@/i18n/routing';

export const accountRejectedPropsSchema = z
  .object({
    fullName: z.string().min(1).max(120),
    /** The admin's reason, shown to the student verbatim. Required — a refusal is never unexplained. */
    reason: z.string().min(1).max(2000),
  })
  .strict();

export type AccountRejectedProps = z.infer<typeof accountRejectedPropsSchema>;

interface Copy {
  readonly subject: string;
  readonly preview: string;
  readonly heading: string;
  readonly greeting: (firstName: string) => string;
  readonly intro: string;
  readonly reasonTitle: string;
  readonly nextSteps: string;
  readonly ctaWhatsapp: string;
  readonly ctaEmail: string;
  readonly closing: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    subject: 'Votre inscription n’a pas pu être validée',
    preview: 'Voici pourquoi, et comment nous pouvons y remédier ensemble.',
    heading: 'Votre inscription n’a pas pu être validée',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro:
      'Après vérification, notre équipe n’a pas pu valider votre compte. Nous vous en donnons la raison ci-dessous.',
    reasonTitle: 'Motif indiqué par notre équipe',
    nextSteps:
      'Cette décision n’est pas définitive. Si les informations concernées peuvent être corrigées ou complétées, contactez-nous : nous réexaminons votre dossier et réactivons votre compte.',
    ctaWhatsapp: 'Écrire sur WhatsApp',
    ctaEmail: 'Nous écrire par e-mail',
    closing: 'Merci de l’intérêt que vous portez à nos formations.',
  },
  ar: {
    subject: 'تعذّرت المصادقة على تسجيلكم',
    preview: 'إليكم السبب، وكيف يمكننا معالجته معًا.',
    heading: 'تعذّرت المصادقة على تسجيلكم',
    greeting: (firstName) => `مرحبًا ${firstName}،`,
    intro: 'بعد التحقّق، لم يتمكّن فريقنا من المصادقة على حسابكم. نوضّح لكم السبب أدناه.',
    reasonTitle: 'السبب الذي ذكره فريقنا',
    nextSteps:
      'هذا القرار ليس نهائيًا. إذا كان بالإمكان تصحيح المعلومات المعنية أو استكمالها، تواصلوا معنا: سنعيد دراسة ملفّكم ونُعيد تفعيل حسابكم.',
    ctaWhatsapp: 'المراسلة عبر واتساب',
    ctaEmail: 'مراسلتنا بالبريد الإلكتروني',
    closing: 'شكرًا لاهتمامكم بدوراتنا التدريبية.',
  },
  en: {
    subject: 'Your registration could not be approved',
    preview: 'Here is why, and how we can sort it out together.',
    heading: 'Your registration could not be approved',
    greeting: (firstName) => `Hello ${firstName},`,
    intro:
      'After review, our team was unable to approve your account. The reason is given below.',
    reasonTitle: 'Reason given by our team',
    nextSteps:
      'This decision is not final. If the information concerned can be corrected or completed, get in touch: we will look at your file again and reactivate your account.',
    ctaWhatsapp: 'Message us on WhatsApp',
    ctaEmail: 'Email us',
    closing: 'Thank you for your interest in our courses.',
  },
  es: {
    subject: 'No hemos podido validar su inscripción',
    preview: 'Aquí tiene el motivo y cómo podemos resolverlo juntos.',
    heading: 'No hemos podido validar su inscripción',
    greeting: (firstName) => `Hola ${firstName}:`,
    intro:
      'Tras la comprobación, nuestro equipo no ha podido validar su cuenta. Le indicamos el motivo a continuación.',
    reasonTitle: 'Motivo indicado por nuestro equipo',
    nextSteps:
      'Esta decisión no es definitiva. Si la información afectada puede corregirse o completarse, póngase en contacto con nosotros: revisaremos su expediente y reactivaremos su cuenta.',
    ctaWhatsapp: 'Escribir por WhatsApp',
    ctaEmail: 'Escribirnos por correo',
    closing: 'Gracias por su interés en nuestras formaciones.',
  },
};

interface Action {
  readonly href: string;
  readonly label: string;
  /** A `wa.me` or `mailto:` target is not worth printing as a raw URL. */
  readonly showFallback: boolean;
}

function actionFor(ctx: EmailContext): Action {
  const copy = COPY[ctx.locale];
  if (ctx.brand.whatsappUrl !== null) {
    return { href: ctx.brand.whatsappUrl, label: copy.ctaWhatsapp, showFallback: false };
  }
  return {
    href: `mailto:${ctx.brand.contactEmail}`,
    label: copy.ctaEmail,
    showFallback: false,
  };
}

function body(props: AccountRejectedProps, ctx: EmailContext): ReactNode {
  const copy = COPY[ctx.locale];
  const action = actionFor(ctx);
  return (
    <EmailLayout ctx={ctx} preview={copy.preview}>
      <EmailHeading ctx={ctx}>{copy.heading}</EmailHeading>
      <EmailParagraph ctx={ctx}>{copy.greeting(firstNameOf(props.fullName))}</EmailParagraph>
      <EmailParagraph ctx={ctx}>{copy.intro}</EmailParagraph>
      <EmailCallout ctx={ctx} tone="danger" title={copy.reasonTitle}>
        {props.reason}
      </EmailCallout>
      <EmailParagraph ctx={ctx}>{copy.nextSteps}</EmailParagraph>
      <EmailCta
        ctx={ctx}
        href={action.href}
        label={action.label}
        showFallback={action.showFallback}
      />
      <EmailParagraph ctx={ctx} muted>
        {copy.closing}
      </EmailParagraph>
    </EmailLayout>
  );
}

function text(props: AccountRejectedProps, ctx: EmailContext): string {
  const copy = COPY[ctx.locale];
  const action = actionFor(ctx);
  return textBody(ctx, [
    copy.heading,
    copy.greeting(firstNameOf(props.fullName)),
    copy.intro,
    `${copy.reasonTitle} :\n${props.reason}`,
    copy.nextSteps,
    `${action.label} : ${action.href}`,
    copy.closing,
  ]);
}

export const accountRejectedTemplate: EmailTemplate<AccountRejectedProps> = {
  id: 'account-rejected',
  schema: accountRejectedPropsSchema,
  subject: (_props, ctx) => COPY[ctx.locale].subject,
  body,
  text,
};
