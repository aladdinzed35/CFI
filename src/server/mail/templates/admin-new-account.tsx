/**
 * Email #3 (§18) — « Nouveau compte à valider », sent to
 * `MAIL_ADMIN_RECIPIENTS` when a student verifies their address (§9.1).
 *
 * This is an internal working email, so it is dense on purpose: everything the
 * person on approval duty needs in order to decide is in the summary block, and
 * the button opens the account straight in the admin panel. A non-Moroccan
 * phone number is called out explicitly — §9.1 asks for that flag, and it is
 * the single most common reason a file needs a second look.
 *
 * Phone numbers, email addresses and dates are Latin in every locale and stay
 * left-to-right even when an administrator reads in Arabic.
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
  textBody,
  type DetailRow,
  type EmailContext,
  type EmailTemplate,
} from './layout';
import { localeLabels, locales, type Locale } from '@/i18n/routing';
import { formatDateTime } from '@/lib/dates';
import { formatPhoneDisplay } from '@/lib/phone';

export const adminNewAccountPropsSchema = z
  .object({
    /** The account under review. */
    studentId: z.string().min(1).max(64),
    fullName: z.string().min(1).max(120),
    email: z.string().email(),
    /** E.164, as stored. */
    phone: z.string().min(4).max(20),
    /** `false` marks a foreign number — surfaced to the admin per §9.1. */
    isMoroccanPhone: z.boolean(),
    city: z.string().max(80).nullable(),
    professionalStatus: z.string().max(80).nullable(),
    /** The interface language the student chose. */
    studentLocale: z.enum(locales),
    /** ISO 8601 — props cross the job queue as JSON, so never a `Date`. */
    registeredAt: z.string().datetime(),
    /** Absolute deep link to `/[locale]/admin/comptes/[id]`. */
    adminUrl: z.string().url(),
  })
  .strict();

export type AdminNewAccountProps = z.infer<typeof adminNewAccountPropsSchema>;

interface Copy {
  readonly subject: (fullName: string) => string;
  readonly preview: (fullName: string) => string;
  readonly heading: string;
  readonly intro: string;
  readonly labels: {
    readonly fullName: string;
    readonly email: string;
    readonly phone: string;
    readonly city: string;
    readonly professionalStatus: string;
    readonly locale: string;
    readonly registeredAt: string;
  };
  readonly notProvided: string;
  readonly foreignPhoneTitle: string;
  readonly foreignPhoneBody: string;
  readonly cta: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    subject: (fullName) => `Nouveau compte à valider — ${fullName}`,
    preview: (fullName) => `${fullName} attend la validation de son compte.`,
    heading: 'Nouveau compte à valider',
    intro:
      'Une personne vient de confirmer son adresse e-mail. Son compte attend une validation manuelle avant de pouvoir accéder aux formations.',
    labels: {
      fullName: 'Nom complet',
      email: 'Adresse e-mail',
      phone: 'Téléphone',
      city: 'Ville',
      professionalStatus: 'Situation professionnelle',
      locale: 'Langue de l’interface',
      registeredAt: 'Inscription',
    },
    notProvided: 'Non renseigné',
    foreignPhoneTitle: 'Numéro hors Maroc',
    foreignPhoneBody:
      'Le numéro de téléphone n’est pas marocain. Vérifiez l’identité avant de valider le compte.',
    cta: 'Ouvrir la fiche du compte',
  },
  ar: {
    subject: (fullName) => `حساب جديد في انتظار المصادقة — ${fullName}`,
    preview: (fullName) => `${fullName} في انتظار المصادقة على الحساب.`,
    heading: 'حساب جديد في انتظار المصادقة',
    intro:
      'أكّد أحد المسجَّلين عنوان بريده الإلكتروني للتو. حسابه في انتظار مصادقة يدوية قبل الولوج إلى الدورات التدريبية.',
    labels: {
      fullName: 'الاسم الكامل',
      email: 'البريد الإلكتروني',
      phone: 'الهاتف',
      city: 'المدينة',
      professionalStatus: 'الوضعية المهنية',
      locale: 'لغة الواجهة',
      registeredAt: 'تاريخ التسجيل',
    },
    notProvided: 'غير محدَّد',
    foreignPhoneTitle: 'رقم خارج المغرب',
    foreignPhoneBody: 'رقم الهاتف ليس مغربيًا. تحقّقوا من الهوية قبل المصادقة على الحساب.',
    cta: 'فتح بطاقة الحساب',
  },
  en: {
    subject: (fullName) => `New account awaiting approval — ${fullName}`,
    preview: (fullName) => `${fullName} is waiting for account approval.`,
    heading: 'New account awaiting approval',
    intro:
      'Someone has just confirmed their email address. Their account is waiting for manual approval before they can access any course.',
    labels: {
      fullName: 'Full name',
      email: 'Email address',
      phone: 'Phone',
      city: 'City',
      professionalStatus: 'Professional status',
      locale: 'Interface language',
      registeredAt: 'Registered',
    },
    notProvided: 'Not provided',
    foreignPhoneTitle: 'Non-Moroccan number',
    foreignPhoneBody:
      'The phone number is not Moroccan. Check the person’s identity before approving the account.',
    cta: 'Open the account record',
  },
  es: {
    subject: (fullName) => `Nueva cuenta pendiente de validación — ${fullName}`,
    preview: (fullName) => `${fullName} espera la validación de su cuenta.`,
    heading: 'Nueva cuenta pendiente de validación',
    intro:
      'Una persona acaba de confirmar su dirección de correo electrónico. Su cuenta espera una validación manual antes de poder acceder a las formaciones.',
    labels: {
      fullName: 'Nombre completo',
      email: 'Correo electrónico',
      phone: 'Teléfono',
      city: 'Ciudad',
      professionalStatus: 'Situación profesional',
      locale: 'Idioma de la interfaz',
      registeredAt: 'Registro',
    },
    notProvided: 'Sin especificar',
    foreignPhoneTitle: 'Número fuera de Marruecos',
    foreignPhoneBody:
      'El número de teléfono no es marroquí. Compruebe la identidad antes de validar la cuenta.',
    cta: 'Abrir la ficha de la cuenta',
  },
};

function rows(props: AdminNewAccountProps, ctx: EmailContext): readonly DetailRow[] {
  const copy = COPY[ctx.locale];
  return [
    { label: copy.labels.fullName, value: props.fullName },
    { label: copy.labels.email, value: <Ltr>{props.email}</Ltr> },
    { label: copy.labels.phone, value: <Ltr>{formatPhoneDisplay(props.phone)}</Ltr> },
    { label: copy.labels.city, value: props.city ?? copy.notProvided },
    {
      label: copy.labels.professionalStatus,
      value: props.professionalStatus ?? copy.notProvided,
    },
    { label: copy.labels.locale, value: localeLabels[props.studentLocale] },
    {
      label: copy.labels.registeredAt,
      value: <Ltr>{formatDateTime(props.registeredAt, ctx.locale)}</Ltr>,
    },
  ];
}

function body(props: AdminNewAccountProps, ctx: EmailContext): ReactNode {
  const copy = COPY[ctx.locale];
  return (
    <EmailLayout ctx={ctx} preview={copy.preview(props.fullName)}>
      <EmailHeading ctx={ctx}>{copy.heading}</EmailHeading>
      <EmailParagraph ctx={ctx}>{copy.intro}</EmailParagraph>
      <EmailDetails ctx={ctx} rows={rows(props, ctx)} />
      {props.isMoroccanPhone ? null : (
        <EmailCallout ctx={ctx} tone="warn" title={copy.foreignPhoneTitle}>
          {copy.foreignPhoneBody}
        </EmailCallout>
      )}
      <EmailCta ctx={ctx} href={props.adminUrl} label={copy.cta} />
    </EmailLayout>
  );
}

function text(props: AdminNewAccountProps, ctx: EmailContext): string {
  const copy = COPY[ctx.locale];
  const summary = [
    `${copy.labels.fullName} : ${props.fullName}`,
    `${copy.labels.email} : ${props.email}`,
    `${copy.labels.phone} : ${formatPhoneDisplay(props.phone)}`,
    `${copy.labels.city} : ${props.city ?? copy.notProvided}`,
    `${copy.labels.professionalStatus} : ${props.professionalStatus ?? copy.notProvided}`,
    `${copy.labels.locale} : ${localeLabels[props.studentLocale]}`,
    `${copy.labels.registeredAt} : ${formatDateTime(props.registeredAt, ctx.locale)}`,
  ].join('\n');

  return textBody(ctx, [
    copy.heading,
    copy.intro,
    summary,
    props.isMoroccanPhone ? null : `${copy.foreignPhoneTitle} — ${copy.foreignPhoneBody}`,
    `${copy.cta} :\n${props.adminUrl}`,
  ]);
}

export const adminNewAccountTemplate: EmailTemplate<AdminNewAccountProps> = {
  id: 'admin-new-account',
  schema: adminNewAccountPropsSchema,
  subject: (props, ctx) => COPY[ctx.locale].subject(props.fullName),
  body,
  text,
};
