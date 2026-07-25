/**
 * Email #4 (§18) — « Bienvenue — votre compte est validé ».
 *
 * The first genuinely good news the student gets from us, so it does two things
 * and stops: it confirms the account is active, and it says what to do next in
 * three concrete steps (§9.1). No catalogue dump, no promotion — the single
 * call to action is signing in.
 */

import type { ReactNode } from 'react';
import { z } from 'zod';
import {
  EmailCta,
  EmailHeading,
  EmailLayout,
  EmailLink,
  EmailParagraph,
  EmailSteps,
  firstNameOf,
  textBody,
  type EmailContext,
  type EmailTemplate,
} from './layout';
import type { Locale } from '@/i18n/routing';

export const accountApprovedPropsSchema = z
  .object({
    fullName: z.string().min(1).max(120),
    /** Absolute URL of `/[locale]/connexion`. */
    loginUrl: z.string().url(),
    /** Absolute URL of `/[locale]/formations`. */
    catalogUrl: z.string().url(),
  })
  .strict();

export type AccountApprovedProps = z.infer<typeof accountApprovedPropsSchema>;

interface Copy {
  readonly subject: (brandName: string) => string;
  readonly preview: string;
  readonly heading: string;
  readonly greeting: (firstName: string) => string;
  readonly intro: string;
  readonly stepsTitle: string;
  readonly steps: readonly [string, string, string];
  readonly cta: string;
  readonly catalogLead: string;
  readonly catalogLink: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    subject: (brandName) => `Votre compte est validé — bienvenue chez ${brandName}`,
    preview: 'Votre espace est ouvert. Voici par quoi commencer.',
    heading: 'Bienvenue — votre compte est validé',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro:
      'Votre compte vient d’être validé par notre équipe. Vous pouvez dès maintenant vous connecter à votre espace et choisir votre formation.',
    stepsTitle: 'Vos trois prochaines étapes',
    steps: [
      'Connectez-vous à votre espace avec l’adresse e-mail que vous avez confirmée.',
      'Parcourez le catalogue et ouvrez la formation qui vous intéresse.',
      'Demandez l’accès : vous joignez votre justificatif de virement, notre équipe le vérifie et active votre formation.',
    ],
    cta: 'Se connecter',
    catalogLead: 'Vous préférez commencer par regarder le programme ?',
    catalogLink: 'Voir le catalogue des formations',
  },
  ar: {
    subject: (brandName) => `تمّت المصادقة على حسابكم — مرحبًا بكم في ${brandName}`,
    preview: 'فضاؤكم مفتوح. إليكم من أين تبدأون.',
    heading: 'مرحبًا بكم — تمّت المصادقة على حسابكم',
    greeting: (firstName) => `مرحبًا ${firstName}،`,
    intro:
      'صادق فريقنا للتو على حسابكم. يمكنكم منذ الآن الولوج إلى فضائكم واختيار دورتكم التدريبية.',
    stepsTitle: 'خطواتكم الثلاث التالية',
    steps: [
      'لِجوا إلى فضائكم بالبريد الإلكتروني الذي أكّدتموه.',
      'تصفّحوا الكتالوج وافتحوا الدورة التدريبية التي تهمّكم.',
      'اطلبوا الولوج: ترفقون إشعار التحويل، ويتحقّق منه فريقنا ثم يُفعّل دورتكم.',
    ],
    cta: 'تسجيل الدخول',
    catalogLead: 'هل تفضّلون الاطّلاع على البرنامج أولًا؟',
    catalogLink: 'الاطّلاع على كتالوج الدورات',
  },
  en: {
    subject: (brandName) => `Your account is approved — welcome to ${brandName}`,
    preview: 'Your space is open. Here is where to start.',
    heading: 'Welcome — your account is approved',
    greeting: (firstName) => `Hello ${firstName},`,
    intro:
      'Your account has just been approved by our team. You can now sign in to your space and choose your course.',
    stepsTitle: 'Your next three steps',
    steps: [
      'Sign in to your space with the email address you confirmed.',
      'Browse the catalogue and open the course you are interested in.',
      'Request access: attach your bank transfer receipt, our team checks it and activates your course.',
    ],
    cta: 'Sign in',
    catalogLead: 'Would you rather look at the programme first?',
    catalogLink: 'See the course catalogue',
  },
  es: {
    subject: (brandName) => `Su cuenta está validada — bienvenido a ${brandName}`,
    preview: 'Su espacio está abierto. Aquí tiene por dónde empezar.',
    heading: 'Bienvenido — su cuenta está validada',
    greeting: (firstName) => `Hola ${firstName}:`,
    intro:
      'Nuestro equipo acaba de validar su cuenta. Ya puede iniciar sesión en su espacio y elegir su formación.',
    stepsTitle: 'Sus tres próximos pasos',
    steps: [
      'Inicie sesión en su espacio con la dirección de correo que confirmó.',
      'Consulte el catálogo y abra la formación que le interese.',
      'Solicite el acceso: adjunta su justificante de transferencia, nuestro equipo lo verifica y activa su formación.',
    ],
    cta: 'Iniciar sesión',
    catalogLead: '¿Prefiere ver primero el programa?',
    catalogLink: 'Ver el catálogo de formaciones',
  },
};

function body(props: AccountApprovedProps, ctx: EmailContext): ReactNode {
  const copy = COPY[ctx.locale];
  return (
    <EmailLayout ctx={ctx} preview={copy.preview}>
      <EmailHeading ctx={ctx}>{copy.heading}</EmailHeading>
      <EmailParagraph ctx={ctx}>{copy.greeting(firstNameOf(props.fullName))}</EmailParagraph>
      <EmailParagraph ctx={ctx}>{copy.intro}</EmailParagraph>
      <EmailParagraph ctx={ctx}>
        <strong style={{ fontWeight: 700 }}>{copy.stepsTitle}</strong>
      </EmailParagraph>
      <EmailSteps ctx={ctx} steps={copy.steps} />
      <EmailCta ctx={ctx} href={props.loginUrl} label={copy.cta} />
      <EmailParagraph ctx={ctx} muted>
        {copy.catalogLead}{' '}
        <EmailLink href={props.catalogUrl}>{copy.catalogLink}</EmailLink>
      </EmailParagraph>
    </EmailLayout>
  );
}

function text(props: AccountApprovedProps, ctx: EmailContext): string {
  const copy = COPY[ctx.locale];
  const steps = copy.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
  return textBody(ctx, [
    copy.heading,
    copy.greeting(firstNameOf(props.fullName)),
    copy.intro,
    `${copy.stepsTitle}\n${steps}`,
    `${copy.cta} :\n${props.loginUrl}`,
    `${copy.catalogLead}\n${copy.catalogLink} : ${props.catalogUrl}`,
  ]);
}

export const accountApprovedTemplate: EmailTemplate<AccountApprovedProps> = {
  id: 'account-approved',
  schema: accountApprovedPropsSchema,
  subject: (_props, ctx) => COPY[ctx.locale].subject(ctx.brand.name),
  body,
  text,
};
