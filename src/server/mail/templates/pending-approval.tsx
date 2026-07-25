/**
 * Email #2 (§18) — « Votre compte est en cours de validation ».
 *
 * Sent to the student the moment the address is verified and the account moves
 * to `PENDING_APPROVAL` (§9.1). Its job is to remove the anxiety of a silent
 * wait: it says who is looking at the file, how long it usually takes, and how
 * to reach a human.
 *
 * The French body is the canonical §28.3 waiting-for-approval copy, reproduced
 * word for word — the same sentences the waiting screen shows, so the email and
 * the page never drift apart. `delayLabel` is injected because the expected
 * delay is a setting; its default is the canonical « sous 24 heures ouvrées ».
 */

import type { ReactNode } from 'react';
import { z } from 'zod';
import {
  EmailCta,
  EmailHeading,
  EmailLayout,
  EmailLink,
  EmailParagraph,
  emailPalette,
  firstNameOf,
  textBody,
  type EmailContext,
  type EmailTemplate,
} from './layout';
import type { Locale } from '@/i18n/routing';

/** The canonical delay wording from §28.3, per locale. */
const DEFAULT_DELAY: Record<Locale, string> = {
  fr: 'sous 24 heures ouvrées',
  ar: 'في غضون 24 ساعة عمل',
  en: 'within 24 working hours',
  es: 'en un plazo de 24 horas hábiles',
};

export const pendingApprovalPropsSchema = z
  .object({
    fullName: z.string().min(1).max(120),
    /** Absolute URL of `/[locale]/compte-en-attente`. */
    waitingUrl: z.string().url(),
    /**
     * Expected delay, already phrased ( « sous 24 heures ouvrées » ). Omitted
     * means the canonical wording for the recipient's locale.
     */
    delayLabel: z.string().min(1).max(120).optional(),
  })
  .strict();

export type PendingApprovalProps = z.infer<typeof pendingApprovalPropsSchema>;

interface Copy {
  readonly subject: string;
  readonly preview: string;
  readonly heading: string;
  readonly greeting: (firstName: string) => string;
  /** Split at the bolded delay so the emphasis lands exactly where §28.3 puts it. */
  readonly bodyBefore: string;
  readonly bodyAfter: string;
  readonly whatsappLead: string;
  readonly cta: string;
  readonly noAction: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    subject: 'Votre compte est en cours de validation',
    preview: 'Nous vérifions vos informations. Vous serez prévenu par e-mail.',
    heading: 'Votre compte est en cours de validation',
    greeting: (firstName) => `Bonjour ${firstName},`,
    bodyBefore:
      'Merci pour votre inscription. Notre équipe vérifie vos informations et valide votre compte manuellement, généralement ',
    bodyAfter: '. Vous recevrez un e-mail dès que votre compte sera activé.',
    whatsappLead: 'Besoin d’accélérer les choses ? Écrivez-nous sur WhatsApp.',
    cta: 'Suivre l’état de mon compte',
    noAction:
      'Vous n’avez rien d’autre à faire pour l’instant. Vous pouvez déjà parcourir le catalogue des formations.',
  },
  ar: {
    subject: 'حسابكم قيد التحقّق',
    preview: 'نتحقّق من معلوماتكم وسنخبركم عبر البريد الإلكتروني.',
    heading: 'حسابكم قيد التحقّق',
    greeting: (firstName) => `مرحبًا ${firstName}،`,
    bodyBefore:
      'شكرًا على تسجيلكم. يتحقّق فريقنا من معلوماتكم ويُفعّل حسابكم يدويًا، عادةً ',
    bodyAfter: '. ستصلكم رسالة إلكترونية بمجرّد تفعيل حسابكم.',
    whatsappLead: 'هل ترغبون في تسريع الأمر؟ راسلونا عبر واتساب.',
    cta: 'متابعة حالة حسابي',
    noAction:
      'لا شيء آخر مطلوب منكم في الوقت الحالي. يمكنكم منذ الآن تصفّح كتالوج الدورات التدريبية.',
  },
  en: {
    subject: 'Your account is being reviewed',
    preview: 'We are checking your details. We will email you as soon as it is done.',
    heading: 'Your account is being reviewed',
    greeting: (firstName) => `Hello ${firstName},`,
    bodyBefore:
      'Thank you for registering. Our team checks your details and approves your account manually, usually ',
    bodyAfter: '. You will receive an email as soon as your account is active.',
    whatsappLead: 'Would you like to speed things up? Message us on WhatsApp.',
    cta: 'Track my account status',
    noAction:
      'There is nothing else for you to do right now. You can already browse the course catalogue.',
  },
  es: {
    subject: 'Su cuenta está en proceso de validación',
    preview: 'Estamos comprobando sus datos. Le avisaremos por correo electrónico.',
    heading: 'Su cuenta está en proceso de validación',
    greeting: (firstName) => `Hola ${firstName}:`,
    bodyBefore:
      'Gracias por registrarse. Nuestro equipo comprueba sus datos y valida su cuenta manualmente, normalmente ',
    bodyAfter: '. Recibirá un correo en cuanto su cuenta esté activada.',
    whatsappLead: '¿Desea acelerar el proceso? Escríbanos por WhatsApp.',
    cta: 'Seguir el estado de mi cuenta',
    noAction:
      'De momento no tiene que hacer nada más. Ya puede consultar el catálogo de formaciones.',
  },
};

function delayFor(props: PendingApprovalProps, locale: Locale): string {
  return props.delayLabel ?? DEFAULT_DELAY[locale];
}

function body(props: PendingApprovalProps, ctx: EmailContext): ReactNode {
  const copy = COPY[ctx.locale];
  const delay = delayFor(props, ctx.locale);
  const { whatsappUrl } = ctx.brand;

  return (
    <EmailLayout ctx={ctx} preview={copy.preview}>
      <EmailHeading ctx={ctx}>{copy.heading}</EmailHeading>
      <EmailParagraph ctx={ctx}>{copy.greeting(firstNameOf(props.fullName))}</EmailParagraph>
      <EmailParagraph ctx={ctx}>
        {copy.bodyBefore}
        <strong style={{ fontWeight: 700, color: emailPalette.ink }}>{delay}</strong>
        {copy.bodyAfter}
      </EmailParagraph>
      <EmailParagraph ctx={ctx}>{copy.noAction}</EmailParagraph>
      <EmailCta ctx={ctx} href={props.waitingUrl} label={copy.cta} />
      {whatsappUrl !== null ? (
        <EmailParagraph ctx={ctx} muted>
          <EmailLink href={whatsappUrl}>{copy.whatsappLead}</EmailLink>
        </EmailParagraph>
      ) : null}
    </EmailLayout>
  );
}

function text(props: PendingApprovalProps, ctx: EmailContext): string {
  const copy = COPY[ctx.locale];
  const delay = delayFor(props, ctx.locale);
  const { whatsappUrl } = ctx.brand;

  return textBody(ctx, [
    copy.heading,
    copy.greeting(firstNameOf(props.fullName)),
    `${copy.bodyBefore}${delay}${copy.bodyAfter}`,
    copy.noAction,
    `${copy.cta} :\n${props.waitingUrl}`,
    whatsappUrl === null ? null : `${copy.whatsappLead}\n${whatsappUrl}`,
  ]);
}

export const pendingApprovalTemplate: EmailTemplate<PendingApprovalProps> = {
  id: 'pending-approval',
  schema: pendingApprovalPropsSchema,
  subject: (_props, ctx) => COPY[ctx.locale].subject,
  body,
  text,
};
