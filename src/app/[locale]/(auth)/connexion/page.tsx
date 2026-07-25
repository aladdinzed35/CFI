import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  AUTH_ROUTES,
  RETURN_TO_PARAM,
  getCurrentUser,
  redirectToWaitingScreen,
} from '@/server/auth';
import { Link, redirect } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';

import { LoginForm } from './login-form';

/**
 * `/[locale]/connexion` — sign in (§9.1, §20).
 *
 * The page reads the "where were you going" parameter and hands it to the form,
 * which posts it to the action; the action is what sanitises it. A client that
 * decided the destination on its own would be an open redirect waiting to
 * happen, so the value is only ever *carried* here, never trusted.
 *
 * Two spellings are accepted: `suivant`, which the page guards emit, and `next`,
 * which is what an integrator or a hand-written link tends to use.
 */

type LocaleParams = { locale: string };
type LoginSearchParams = Record<string, string | string[] | undefined>;

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

  const t = await getTranslations({ locale, namespace: 'auth.login' });
  return {
    title: t('title'),
    description: t('subtitle'),
    robots: { index: false, follow: true },
  };
}

/** First value of a search parameter, ignoring a repeated one. */
function firstValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<LocaleParams>;
  searchParams: Promise<LoginSearchParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const current = await getCurrentUser();
  if (current !== null) {
    if (current.status === 'ACTIVE') {
      redirect({ href: AUTH_ROUTES.home, locale });
    } else {
      redirectToWaitingScreen(locale, current.status);
    }
  }

  const query = await searchParams;
  const returnTo = firstValue(query[RETURN_TO_PARAM]) ?? firstValue(query.next);

  const t = await getTranslations('auth.login');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-title text-balance text-ink">{t('title')}</h1>
        <p className="text-body text-pretty text-ink-muted">{t('subtitle')}</p>
      </header>

      <LoginForm returnTo={returnTo} />

      <p className="text-sm text-ink-muted">
        {t('noAccount')}{' '}
        <Link
          href="/inscription"
          className="rounded-sm font-medium text-strait underline underline-offset-4 hover:text-ink"
        >
          {t('createAccount')}
        </Link>
      </p>
    </div>
  );
}
