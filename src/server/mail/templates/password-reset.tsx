/**
 * Email #13 (§18) — « Réinitialisation du mot de passe », 1-hour link.
 *
 * Two things make this email safe rather than merely functional. First, it says
 * plainly that ignoring it leaves the password untouched — that sentence is
 * what stops a phishing-shaped panic when the request was not the recipient's.
 * Second, it never states whether the address has an account: the reset
 * endpoint answers identically either way (§20), and this body is written so it
 * reads correctly for someone who simply typed the wrong address.
 *
 * `relatedId` must be the reset token's id, never the user's: a second, honest
 * request has to produce a second email.
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
  type DetailRow,
  type EmailContext,
  type EmailTemplate,
} from './layout';
import type { Locale } from '@/i18n/routing';
import { formatDateTime } from '@/lib/dates';

export const passwordResetPropsSchema = z
  .object({
    fullName: z.string().min(1).max(120),
    /** Absolute URL carrying the raw reset token. */
    resetUrl: z.string().url(),
    /** Token lifetime in minutes. 60 per §18. */
    expiresInMinutes: z.number().int().min(1).max(1440),
    /** ISO 8601 timestamp of the request, or `null` when not recorded. */
    requestedAt: z.string().datetime().nullable(),
    /** Requesting IP, shown so the owner can recognise their own action. */
    requestedIp: z.string().max(64).nullable(),
  })
  .strict();

export type PasswordResetProps = z.infer<typeof passwordResetPropsSchema>;

interface Copy {
  readonly subject: string;
  readonly preview: string;
  readonly heading: string;
  readonly greeting: (firstName: string) => string;
  readonly intro: string;
  readonly cta: string;
  readonly expiry: (minutes: number) => string;
  readonly requestTitle: string;
  readonly labels: { readonly requestedAt: string; readonly requestedIp: string };
  readonly notYouTitle: string;
  readonly notYouBody: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    subject: 'Réinitialisation de votre mot de passe',
    preview: 'Un lien valable une heure pour choisir un nouveau mot de passe.',
    heading: 'Réinitialisation de votre mot de passe',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro:
      'Nous avons reçu une demande de réinitialisation du mot de passe associé à cette adresse e-mail. Choisissez un nouveau mot de passe avec le bouton ci-dessous.',
    cta: 'Choisir un nouveau mot de passe',
    expiry: (minutes) =>
      `Ce lien est valable ${minutes} minutes et ne peut servir qu’une seule fois.`,
    requestTitle: 'Détails de la demande',
    labels: { requestedAt: 'Demandé le', requestedIp: 'Adresse IP' },
    notYouTitle: 'Vous n’êtes pas à l’origine de cette demande ?',
    notYouBody:
      'Ignorez ce message : votre mot de passe reste inchangé tant que ce lien n’est pas utilisé. Si vous recevez plusieurs demandes de ce type, écrivez-nous.',
  },
  ar: {
    subject: 'إعادة تعيين كلمة المرور',
    preview: 'رابط صالح لمدة ساعة لاختيار كلمة مرور جديدة.',
    heading: 'إعادة تعيين كلمة المرور',
    greeting: (firstName) => `مرحبًا ${firstName}،`,
    intro:
      'توصّلنا بطلب لإعادة تعيين كلمة المرور المرتبطة بهذا العنوان الإلكتروني. اختاروا كلمة مرور جديدة عبر الزر أسفله.',
    cta: 'اختيار كلمة مرور جديدة',
    expiry: (minutes) => `هذا الرابط صالح لمدة ${minutes} دقيقة ولا يمكن استعماله سوى مرّة واحدة.`,
    requestTitle: 'تفاصيل الطلب',
    labels: { requestedAt: 'تاريخ الطلب', requestedIp: 'عنوان IP' },
    notYouTitle: 'ألم تكونوا أصحاب هذا الطلب؟',
    notYouBody:
      'تجاهلوا هذه الرسالة: تبقى كلمة المرور كما هي ما دام الرابط لم يُستعمل. إذا وصلتكم عدّة طلبات من هذا النوع، راسلونا.',
  },
  en: {
    subject: 'Reset your password',
    preview: 'A link valid for one hour to choose a new password.',
    heading: 'Reset your password',
    greeting: (firstName) => `Hello ${firstName},`,
    intro:
      'We received a request to reset the password linked to this email address. Choose a new password with the button below.',
    cta: 'Choose a new password',
    expiry: (minutes) => `This link is valid for ${minutes} minutes and can be used only once.`,
    requestTitle: 'Request details',
    labels: { requestedAt: 'Requested at', requestedIp: 'IP address' },
    notYouTitle: 'Did you not request this?',
    notYouBody:
      'Ignore this message: your password stays unchanged as long as the link is not used. If you receive several requests like this one, please contact us.',
  },
  es: {
    subject: 'Restablecer su contraseña',
    preview: 'Un enlace válido durante una hora para elegir una nueva contraseña.',
    heading: 'Restablecer su contraseña',
    greeting: (firstName) => `Hola ${firstName}:`,
    intro:
      'Hemos recibido una solicitud para restablecer la contraseña asociada a esta dirección de correo. Elija una nueva contraseña con el botón siguiente.',
    cta: 'Elegir una nueva contraseña',
    expiry: (minutes) =>
      `Este enlace es válido durante ${minutes} minutos y solo puede utilizarse una vez.`,
    requestTitle: 'Detalles de la solicitud',
    labels: { requestedAt: 'Solicitado el', requestedIp: 'Dirección IP' },
    notYouTitle: '¿No ha sido usted?',
    notYouBody:
      'Ignore este mensaje: su contraseña permanece sin cambios mientras no se utilice el enlace. Si recibe varias solicitudes como esta, escríbanos.',
  },
};

function rows(props: PasswordResetProps, ctx: EmailContext): readonly DetailRow[] {
  const copy = COPY[ctx.locale];
  const list: DetailRow[] = [];
  if (props.requestedAt !== null) {
    list.push({
      label: copy.labels.requestedAt,
      value: <Ltr>{formatDateTime(props.requestedAt, ctx.locale)}</Ltr>,
    });
  }
  if (props.requestedIp !== null) {
    list.push({ label: copy.labels.requestedIp, value: <Ltr>{props.requestedIp}</Ltr> });
  }
  return list;
}

function body(props: PasswordResetProps, ctx: EmailContext): ReactNode {
  const copy = COPY[ctx.locale];
  const details = rows(props, ctx);
  return (
    <EmailLayout ctx={ctx} preview={copy.preview}>
      <EmailHeading ctx={ctx}>{copy.heading}</EmailHeading>
      <EmailParagraph ctx={ctx}>{copy.greeting(firstNameOf(props.fullName))}</EmailParagraph>
      <EmailParagraph ctx={ctx}>{copy.intro}</EmailParagraph>
      <EmailCta ctx={ctx} href={props.resetUrl} label={copy.cta} />
      <EmailParagraph ctx={ctx} muted>
        {copy.expiry(props.expiresInMinutes)}
      </EmailParagraph>
      {details.length > 0 ? (
        <>
          <EmailParagraph ctx={ctx} muted>
            {copy.requestTitle}
          </EmailParagraph>
          <EmailDetails ctx={ctx} rows={details} />
        </>
      ) : null}
      <EmailCallout ctx={ctx} tone="warn" title={copy.notYouTitle}>
        {copy.notYouBody}
      </EmailCallout>
    </EmailLayout>
  );
}

function text(props: PasswordResetProps, ctx: EmailContext): string {
  const copy = COPY[ctx.locale];
  const details: string[] = [];
  if (props.requestedAt !== null) {
    details.push(`${copy.labels.requestedAt} : ${formatDateTime(props.requestedAt, ctx.locale)}`);
  }
  if (props.requestedIp !== null) {
    details.push(`${copy.labels.requestedIp} : ${props.requestedIp}`);
  }

  return textBody(ctx, [
    copy.heading,
    copy.greeting(firstNameOf(props.fullName)),
    copy.intro,
    `${copy.cta} :\n${props.resetUrl}`,
    copy.expiry(props.expiresInMinutes),
    details.length > 0 ? `${copy.requestTitle}\n${details.join('\n')}` : null,
    `${copy.notYouTitle}\n${copy.notYouBody}`,
  ]);
}

export const passwordResetTemplate: EmailTemplate<PasswordResetProps> = {
  id: 'password-reset',
  schema: passwordResetPropsSchema,
  subject: (_props, ctx) => COPY[ctx.locale].subject,
  body,
  text,
};
