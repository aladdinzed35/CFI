import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AUTH_ROUTES, getCurrentUser, redirectToWaitingScreen } from '@/server/auth';
import { Link, redirect } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';

import { RegisterForm } from './register-form';

/**
 * `/[locale]/inscription` — account creation (§9.1).
 *
 * The page itself is a server component: it owns the heading, the metadata and
 * the "already signed in" redirect. Only the form is a client component,
 * because only the form needs state.
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

  const t = await getTranslations({ locale, namespace: 'auth.register' });
  return {
    title: t('title'),
    description: t('subtitle'),
    // A signup form has nothing to offer a search engine, and indexing it only
    // splits the ranking of the pages that do (§21).
    robots: { index: false, follow: true },
  };
}

export default async function RegisterPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  // Someone who already has a session has nothing to do here; send them where
  // their status says they belong rather than letting them create a second one.
  const current = await getCurrentUser();
  if (current !== null) {
    if (current.status === 'ACTIVE') {
      redirect({ href: AUTH_ROUTES.home, locale });
    } else {
      redirectToWaitingScreen(locale, current.status);
    }
  }

  const t = await getTranslations('auth.register');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-title text-balance text-ink">{t('title')}</h1>
        <p className="text-body text-pretty text-ink-muted">{t('lead')}</p>
      </header>

      <RegisterForm locale={locale} />

      <p className="text-sm text-ink-muted">
        {t('hasAccount')}{' '}
        <Link
          href={AUTH_ROUTES.signIn}
          className="rounded-sm font-medium text-strait underline underline-offset-4 hover:text-ink"
        >
          {t('signIn')}
        </Link>
      </p>
    </div>
  );
}
