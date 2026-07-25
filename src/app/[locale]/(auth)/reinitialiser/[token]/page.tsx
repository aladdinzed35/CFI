import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Clock } from 'lucide-react';

import { tokenSchema } from '@/lib/validation/auth';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';

import { ResetForm } from './reset-form';

/**
 * `/[locale]/reinitialiser/[token]` — choose a new password (§9.1, §20).
 *
 * The token is **not** consumed here. Unlike the e-mail-confirmation link, this
 * one only opens a form; spending it on a `GET` would let a mail scanner
 * pre-fetching the URL burn the student's single-use link before they ever saw
 * it. What the page does do is check the token's *shape* — length and alphabet,
 * from the shared `tokenSchema` — so an obviously malformed link produces the
 * dead-end state immediately, without a database round trip and without leaking
 * whether a well-formed token exists.
 *
 * Never cached, never indexed: the URL is a credential.
 */

export const dynamic = 'force-dynamic';

type ResetParams = { locale: string; token: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<ResetParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'auth.resetPassword' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<ResetParams>;
}): Promise<React.JSX.Element> {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const t = await getTranslations('auth.resetPassword');
  const parsed = tokenSchema.safeParse(decodeURIComponent(token));

  if (!parsed.success) {
    return (
      <div className="flex flex-col gap-6">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-md border border-warn/30 bg-warn-wash text-warn"
        >
          <Clock className="size-6" />
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-title text-balance text-ink">{t('expired.title')}</h1>
          <p className="text-body text-pretty text-ink-muted">{t('expired.body')}</p>
        </div>

        <Link
          href="/mot-de-passe-oublie"
          className="inline-flex h-12 w-full items-center justify-center rounded-md bg-strait px-6 text-sm font-medium text-on-accent shadow-e2 transition-[box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)] hover:shadow-e3 active:translate-y-px"
        >
          {t('expired.action')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-title text-balance text-ink">{t('title')}</h1>
        <p className="text-body text-pretty text-ink-muted">{t('subtitle')}</p>
      </header>

      <ResetForm token={parsed.data} />
    </div>
  );
}
