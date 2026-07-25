/**
 * Email #1 (§18) — « Confirmez votre adresse e-mail ».
 *
 * Sent the moment a registration is accepted, while the account sits in
 * `PENDING_EMAIL`. The link carries a 64-byte token whose SHA-256 is all the
 * database keeps (§9.1), and it expires in 24 hours.
 *
 * `relatedId` for this template must identify the **token**, not the user: a
 * student who asks for a new link has to receive one, and idempotency keyed on
 * the user id would silently swallow it.
 */

import type { ReactNode } from 'react';
import { z } from 'zod';
import {
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

export const verifyEmailPropsSchema = z
  .object({
    fullName: z.string().min(1).max(120),
    /** Absolute URL, locale-prefixed, carrying the raw token. */
    verifyUrl: z.string().url(),
    /** Token lifetime, in hours. 24 per §9.1. */
    expiresInHours: z.number().int().min(1).max(168),
  })
  .strict();

export type VerifyEmailProps = z.infer<typeof verifyEmailPropsSchema>;

interface Copy {
  readonly subject: string;
  readonly preview: string;
  readonly heading: string;
  readonly greeting: (firstName: string) => string;
  readonly intro: string;
  readonly cta: string;
  readonly expiry: (hours: number) => string;
  readonly notYou: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    subject: 'Confirmez votre adresse e-mail',
    preview: 'Une confirmation et votre inscription est enregistrée.',
    heading: 'Confirmez votre adresse e-mail',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro:
      'Merci pour votre inscription. Confirmez votre adresse e-mail pour que nous puissions poursuivre la création de votre compte.',
    cta: 'Confirmer mon adresse e-mail',
    expiry: (hours) =>
      `Ce lien est valable ${hours} heures. Passé ce délai, demandez-en un nouveau depuis la page de vérification.`,
    notYou:
      'Si vous n’êtes pas à l’origine de cette inscription, ignorez ce message : aucun compte ne sera activé sans cette confirmation.',
  },
  ar: {
    subject: 'أكّدوا عنوان بريدكم الإلكتروني',
    preview: 'تأكيد واحد ويُسجَّل طلب انخراطكم.',
    heading: 'أكّدوا عنوان بريدكم الإلكتروني',
    greeting: (firstName) => `مرحبًا ${firstName}،`,
    intro:
      'شكرًا على تسجيلكم. أكّدوا عنوان بريدكم الإلكتروني حتى نتمكّن من متابعة إنشاء حسابكم.',
    cta: 'تأكيد عنوان بريدي الإلكتروني',
    expiry: (hours) =>
      `هذا الرابط صالح لمدة ${hours} ساعة. بعد انقضاء المدة، اطلبوا رابطًا جديدًا من صفحة التحقق.`,
    notYou:
      'إذا لم تكونوا أصحاب هذا الطلب، تجاهلوا هذه الرسالة: لن يُفعَّل أي حساب بدون هذا التأكيد.',
  },
  en: {
    subject: 'Confirm your email address',
    preview: 'One confirmation and your registration is recorded.',
    heading: 'Confirm your email address',
    greeting: (firstName) => `Hello ${firstName},`,
    intro:
      'Thank you for registering. Please confirm your email address so we can continue setting up your account.',
    cta: 'Confirm my email address',
    expiry: (hours) =>
      `This link is valid for ${hours} hours. After that, request a new one from the verification page.`,
    notYou:
      'If you did not register, please ignore this message: no account will be activated without this confirmation.',
  },
  es: {
    subject: 'Confirme su dirección de correo electrónico',
    preview: 'Una confirmación y su inscripción queda registrada.',
    heading: 'Confirme su dirección de correo electrónico',
    greeting: (firstName) => `Hola ${firstName}:`,
    intro:
      'Gracias por registrarse. Confirme su dirección de correo electrónico para que podamos continuar con la creación de su cuenta.',
    cta: 'Confirmar mi dirección de correo',
    expiry: (hours) =>
      `Este enlace es válido durante ${hours} horas. Pasado ese plazo, solicite uno nuevo desde la página de verificación.`,
    notYou:
      'Si no ha sido usted quien se ha registrado, ignore este mensaje: no se activará ninguna cuenta sin esta confirmación.',
  },
};

function body(props: VerifyEmailProps, ctx: EmailContext): ReactNode {
  const copy = COPY[ctx.locale];
  return (
    <EmailLayout ctx={ctx} preview={copy.preview}>
      <EmailHeading ctx={ctx}>{copy.heading}</EmailHeading>
      <EmailParagraph ctx={ctx}>{copy.greeting(firstNameOf(props.fullName))}</EmailParagraph>
      <EmailParagraph ctx={ctx}>{copy.intro}</EmailParagraph>
      <EmailCta ctx={ctx} href={props.verifyUrl} label={copy.cta} />
      <EmailParagraph ctx={ctx} muted>
        {copy.expiry(props.expiresInHours)}
      </EmailParagraph>
      <EmailParagraph ctx={ctx} muted>
        {copy.notYou}
      </EmailParagraph>
    </EmailLayout>
  );
}

function text(props: VerifyEmailProps, ctx: EmailContext): string {
  const copy = COPY[ctx.locale];
  return textBody(ctx, [
    copy.heading,
    copy.greeting(firstNameOf(props.fullName)),
    copy.intro,
    `${copy.cta} :\n${props.verifyUrl}`,
    copy.expiry(props.expiresInHours),
    copy.notYou,
  ]);
}

export const verifyEmailTemplate: EmailTemplate<VerifyEmailProps> = {
  id: 'verify-email',
  schema: verifyEmailPropsSchema,
  subject: (_props, ctx) => COPY[ctx.locale].subject,
  body,
  text,
};
