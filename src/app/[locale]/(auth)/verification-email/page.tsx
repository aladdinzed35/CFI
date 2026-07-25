import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MailCheck } from 'lucide-react';

import { AUTH_ROUTES, getCurrentUser } from '@/server/auth';
import { maskEmail } from '@/lib/validation/auth';
import { Link, redirect } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';

import { ResendPanel } from './resend-panel';

/**
 * `/[locale]/verification-email` — "we sent you a link" (§9.1).
 *
 * The address is shown **masked**: `y•••••••••••f@gmail.com`. Enough for the
 * student to recognise their own, useless to anyone reading over their shoulder,
 * and — the reason it matters here — safe to carry in a URL that ends up in
 * browser history, a proxy log and a referrer header.
 *
 * `?email=` therefore carries the mask, and even that is re-checked rather than
 * trusted: a hand-edited parameter must not be able to inject arbitrary text
 * into a sentence that reads as if it came from us. When there is a session, its
 * address wins over the parameter and is re-masked here.
 *
 * The mask is wrapped in `U+2068 … U+2069` (first-strong isolate / pop
 * directional isolate) before it is interpolated, so a Latin address embedded in
 * the Arabic sentence keeps its own direction and does not drag the following
 * full stop to the wrong end of the line (§10.3).
 */

type LocaleParams = { locale: string };
type VerifySearchParams = Record<string, string | string[] | undefined>;

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

  const t = await getTranslations({ locale, namespace: 'auth.verifyEmail' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * What a masked address may contain: the bullet `maskEmail` writes, plus the
 * characters an address is itself allowed. Anything else means the parameter was
 * edited, and it is dropped rather than displayed.
 */
const MASKED_EMAIL_PATTERN = /^[A-Za-z0-9•._%+-]{1,64}@[A-Za-z0-9.-]{1,190}$/u;

/** Bidi isolation, so the address behaves as one LTR run inside Arabic prose. */
function isolate(value: string): string {
  return `⁨${value}⁩`;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<LocaleParams>;
  searchParams: Promise<VerifySearchParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  // An account that is past this step has no business waiting here.
  const current = await getCurrentUser();
  if (current !== null && current.status !== 'PENDING_EMAIL') {
    if (current.status === 'ACTIVE') {
      redirect({ href: AUTH_ROUTES.home, locale });
    } else {
      redirect({ href: AUTH_ROUTES.pendingApproval, locale });
    }
  }

  const query = await searchParams;
  const fromQuery = firstValue(query.email)?.trim();

  const masked =
    current !== null
      ? maskEmail(current.email)
      : fromQuery !== undefined && MASKED_EMAIL_PATTERN.test(fromQuery)
        ? fromQuery
        : null;

  const t = await getTranslations('auth.verifyEmail');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-md border border-strait/30 bg-strait-wash text-strait"
        >
          <MailCheck className="size-6" />
        </span>

        <h1 className="font-display text-title text-balance text-ink">{t('title')}</h1>

        {masked === null ? null : (
          <p className="text-body text-pretty text-ink-muted">
            {t('body', { maskedEmail: isolate(masked) })}
          </p>
        )}

        <p className="text-sm text-pretty text-ink-muted">{t('spamHint')}</p>
      </header>

      <ResendPanel initialEmail={current === null ? '' : current.email} />

      <p className="text-sm text-ink-muted">
        {t('wrongAddress')}{' '}
        <Link
          href="/inscription"
          className="rounded-sm font-medium text-strait underline underline-offset-4 hover:text-ink"
        >
          {t('changeEmail')}
        </Link>
      </p>
    </div>
  );
}
