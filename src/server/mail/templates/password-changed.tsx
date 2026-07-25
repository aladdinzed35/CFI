/**
 * Email #14 (§18) — « Votre mot de passe a été modifié ».
 *
 * A security notice, not a confirmation receipt: its whole value is in the case
 * where the recipient did *not* make the change. So it leads with what changed
 * and when, shows the device and IP that did it, and gives an immediate way to
 * act — review active sessions, and reach a human if something is wrong.
 *
 * It is sent after every password change, whether the change came from the
 * reset link or from the profile page, and it is never suppressed: silence
 * after an account takeover is the failure mode this email exists to prevent.
 */

import type { ReactNode } from 'react';
import { z } from 'zod';
import {
  EmailCallout,
  EmailCta,
  EmailDetails,
  EmailHeading,
  EmailLayout,
  EmailLink,
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

export const passwordChangedPropsSchema = z
  .object({
    fullName: z.string().min(1).max(120),
    /** ISO 8601 — when the change was committed. */
    changedAt: z.string().datetime(),
    /** Parsed device label, e.g. « Chrome · Android ». `null` when unknown. */
    device: z.string().max(120).nullable(),
    ip: z.string().max(64).nullable(),
    /** Absolute URL of the student's active-sessions page. */
    sessionsUrl: z.string().url(),
  })
  .strict();

export type PasswordChangedProps = z.infer<typeof passwordChangedPropsSchema>;

interface Copy {
  readonly subject: string;
  readonly preview: string;
  readonly heading: string;
  readonly greeting: (firstName: string) => string;
  readonly intro: string;
  readonly detailsTitle: string;
  readonly labels: {
    readonly changedAt: string;
    readonly device: string;
    readonly ip: string;
  };
  readonly unknown: string;
  readonly sessionsNote: string;
  readonly cta: string;
  readonly notYouTitle: string;
  readonly notYouBody: string;
  readonly contactLead: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    subject: 'Votre mot de passe a été modifié',
    preview: 'Si ce n’était pas vous, agissez maintenant.',
    heading: 'Votre mot de passe a été modifié',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro:
      'Le mot de passe de votre compte vient d’être modifié. Ce message confirme l’opération ; aucune action n’est nécessaire si vous en êtes à l’origine.',
    detailsTitle: 'Détails de l’opération',
    labels: { changedAt: 'Modifié le', device: 'Appareil', ip: 'Adresse IP' },
    unknown: 'Inconnu',
    sessionsNote:
      'Par précaution, vos autres sessions ouvertes peuvent être fermées depuis la page de sécurité de votre profil.',
    cta: 'Vérifier mes sessions actives',
    notYouTitle: 'Ce n’était pas vous ?',
    notYouBody:
      'Votre compte est peut-être compromis. Réinitialisez immédiatement votre mot de passe, fermez toutes les sessions actives, puis prévenez-nous.',
    contactLead: 'Nous contacter tout de suite',
  },
  ar: {
    subject: 'تمّ تغيير كلمة المرور الخاصة بكم',
    preview: 'إذا لم تكونوا أنتم، تصرّفوا الآن.',
    heading: 'تمّ تغيير كلمة المرور الخاصة بكم',
    greeting: (firstName) => `مرحبًا ${firstName}،`,
    intro:
      'تمّ للتو تغيير كلمة مرور حسابكم. هذه الرسالة تؤكّد العملية؛ ولا حاجة لأي إجراء إن كنتم أنتم من قام بها.',
    detailsTitle: 'تفاصيل العملية',
    labels: { changedAt: 'تاريخ التغيير', device: 'الجهاز', ip: 'عنوان IP' },
    unknown: 'غير معروف',
    sessionsNote:
      'احتياطًا، يمكنكم إغلاق جلساتكم المفتوحة الأخرى من صفحة الأمان في ملفّكم الشخصي.',
    cta: 'مراجعة جلساتي النشطة',
    notYouTitle: 'ألم تكونوا أنتم؟',
    notYouBody:
      'قد يكون حسابكم مخترَقًا. أعيدوا تعيين كلمة المرور فورًا، وأغلقوا جميع الجلسات النشطة، ثم أخبرونا.',
    contactLead: 'التواصل معنا فورًا',
  },
  en: {
    subject: 'Your password has been changed',
    preview: 'If this was not you, act now.',
    heading: 'Your password has been changed',
    greeting: (firstName) => `Hello ${firstName},`,
    intro:
      'The password on your account has just been changed. This message confirms the change; no action is needed if you made it.',
    detailsTitle: 'Change details',
    labels: { changedAt: 'Changed at', device: 'Device', ip: 'IP address' },
    unknown: 'Unknown',
    sessionsNote:
      'As a precaution, your other open sessions can be closed from the security page of your profile.',
    cta: 'Review my active sessions',
    notYouTitle: 'Was this not you?',
    notYouBody:
      'Your account may be compromised. Reset your password immediately, close every active session, then let us know.',
    contactLead: 'Contact us right away',
  },
  es: {
    subject: 'Su contraseña ha sido modificada',
    preview: 'Si no ha sido usted, actúe ahora.',
    heading: 'Su contraseña ha sido modificada',
    greeting: (firstName) => `Hola ${firstName}:`,
    intro:
      'La contraseña de su cuenta acaba de modificarse. Este mensaje confirma la operación; no hace falta ninguna acción si ha sido usted.',
    detailsTitle: 'Detalles de la operación',
    labels: { changedAt: 'Modificada el', device: 'Dispositivo', ip: 'Dirección IP' },
    unknown: 'Desconocido',
    sessionsNote:
      'Por precaución, puede cerrar sus otras sesiones abiertas desde la página de seguridad de su perfil.',
    cta: 'Revisar mis sesiones activas',
    notYouTitle: '¿No ha sido usted?',
    notYouBody:
      'Puede que su cuenta esté comprometida. Restablezca su contraseña de inmediato, cierre todas las sesiones activas y avísenos.',
    contactLead: 'Contactar con nosotros ahora',
  },
};

function rows(props: PasswordChangedProps, ctx: EmailContext): readonly DetailRow[] {
  const copy = COPY[ctx.locale];
  return [
    {
      label: copy.labels.changedAt,
      value: <Ltr>{formatDateTime(props.changedAt, ctx.locale)}</Ltr>,
    },
    { label: copy.labels.device, value: props.device ?? copy.unknown },
    {
      label: copy.labels.ip,
      value: props.ip === null ? copy.unknown : <Ltr>{props.ip}</Ltr>,
    },
  ];
}

function helpHref(ctx: EmailContext): string {
  return ctx.brand.whatsappUrl ?? `mailto:${ctx.brand.contactEmail}`;
}

function body(props: PasswordChangedProps, ctx: EmailContext): ReactNode {
  const copy = COPY[ctx.locale];
  return (
    <EmailLayout ctx={ctx} preview={copy.preview}>
      <EmailHeading ctx={ctx}>{copy.heading}</EmailHeading>
      <EmailParagraph ctx={ctx}>{copy.greeting(firstNameOf(props.fullName))}</EmailParagraph>
      <EmailParagraph ctx={ctx}>{copy.intro}</EmailParagraph>
      <EmailParagraph ctx={ctx} muted>
        {copy.detailsTitle}
      </EmailParagraph>
      <EmailDetails ctx={ctx} rows={rows(props, ctx)} />
      <EmailParagraph ctx={ctx}>{copy.sessionsNote}</EmailParagraph>
      <EmailCta ctx={ctx} href={props.sessionsUrl} label={copy.cta} />
      <EmailCallout ctx={ctx} tone="danger" title={copy.notYouTitle}>
        {copy.notYouBody}{' '}
        <EmailLink href={helpHref(ctx)}>{copy.contactLead}</EmailLink>
      </EmailCallout>
    </EmailLayout>
  );
}

function text(props: PasswordChangedProps, ctx: EmailContext): string {
  const copy = COPY[ctx.locale];
  const details = [
    `${copy.labels.changedAt} : ${formatDateTime(props.changedAt, ctx.locale)}`,
    `${copy.labels.device} : ${props.device ?? copy.unknown}`,
    `${copy.labels.ip} : ${props.ip ?? copy.unknown}`,
  ].join('\n');

  return textBody(ctx, [
    copy.heading,
    copy.greeting(firstNameOf(props.fullName)),
    copy.intro,
    `${copy.detailsTitle}\n${details}`,
    copy.sessionsNote,
    `${copy.cta} :\n${props.sessionsUrl}`,
    `${copy.notYouTitle}\n${copy.notYouBody}\n${copy.contactLead} : ${helpHref(ctx)}`,
  ]);
}

export const passwordChangedTemplate: EmailTemplate<PasswordChangedProps> = {
  id: 'password-changed',
  schema: passwordChangedPropsSchema,
  subject: (_props, ctx) => COPY[ctx.locale].subject,
  body,
  text,
};
