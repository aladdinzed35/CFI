import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AUTH_ROUTES } from '@/server/auth';
import { Link } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';

import { ForgotForm } from './forgot-form';

/**
 * `/[locale]/mot-de-passe-oublie` — ask for a reset link (§9.1, §20).
 *
 * There is deliberately no "no account with that address" path: the answer is
 * the same, in the same shape, after the same work, whether or not the address
 * is known. The confirmation therefore says « si un compte existe avec cette
 * adresse… », which is the only wording that is both honest and safe.
 */

type LocaleParams = { locale: string };

export function generateStaticParams(): LocaleParams[] {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'auth.forgotPassword' });
  return { title: t('title'), description: t('subtitle'), robots: { index: false, follow: true } };
}

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  const t = await getTranslations('auth.forgotPassword');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-title text-balance text-ink">{t('title')}</h1>
        <p className="text-body text-pretty text-ink-muted">{t('subtitle')}</p>
      </header>

      <ForgotForm />

      <p className="text-sm">
        <Link
          href={AUTH_ROUTES.signIn}
          className="rounded-sm font-medium text-strait underline underline-offset-4 hover:text-ink"
        >
          {t('backToLogin')}
        </Link>
      </p>
    </div>
  );
}
