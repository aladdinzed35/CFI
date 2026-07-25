import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { ArrowRight, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { isLocale, type Locale } from '@/i18n/routing';
import { signOut } from '@/server/auth/config';
import { assertSameOrigin, getCurrentUser } from '@/server/auth/guards';
import { ROUTES, homeFor } from '@/server/auth/route-policy';

/**
 * `/acces-refuse` — the 403.
 *
 * Where a refusal is **explained** rather than hidden. The distinction is
 * deliberate and it is the whole design of the gate:
 *
 * - `/admin` answers a non-administrator with a 404 (§20, admin hardening): a
 *   stranger must not be able to confirm that an administration panel exists,
 *   and « accès refusé » confirms it.
 * - Everything else answers with this page, because the visitor is a customer
 *   who took a legitimate route to a place they cannot open, and leaving them
 *   with a bare framework error is how a product loses someone who has already
 *   paid.
 *
 * So it says three things, in this order: what happened, why, and the one thing
 * to do next — which is their own account's home, whatever state that account is
 * in. The second action exists for the case that is otherwise a dead end:
 * being signed in with the wrong account on a shared computer.
 */

type LocaleParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const active: Locale = isLocale(locale) ? locale : 'fr';
  const t = await getTranslations({ locale: active, namespace: 'accessDenied' });

  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default async function AccessDeniedPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'accessDenied' });
  const user = await getCurrentUser();

  /** « Se déconnecter » — the way out of "signed in as the wrong person". */
  async function endSession(): Promise<void> {
    'use server';
    await assertSameOrigin();
    await signOut({ redirectTo: `/${locale}${ROUTES.signIn}` });
  }

  return (
    <main id="contenu" className="texture-bathymetric flex min-h-dvh items-center">
      <div className="mx-auto w-full max-w-xl px-4 py-16 sm:px-6">
        <Card padding="lg" elevation={2}>
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className="grid size-12 shrink-0 place-items-center rounded-md bg-warn-wash text-warn"
              >
                {/* A shield has no reading direction: never mirrored (§10.3). */}
                <ShieldAlert className="size-6" />
              </span>
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-ink-muted">
                <span className="force-ltr" dir="ltr">
                  {t('code')}
                </span>
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <h1 className="text-title">{t('title')}</h1>
              <p className="text-lead text-ink-muted">{t('body')}</p>
            </div>

            <CardContent className="hairline-t px-0 pb-0 pt-5">
              <h2 className="text-sm font-medium text-ink">{t('whatToDo')}</h2>
              <p className="mt-2 text-sm text-ink-muted">
                {user === null ? t('tipSignedOut') : t('tipSignedIn')}
              </p>

              {user === null ? null : (
                <p className="mt-3 text-sm text-ink-muted">
                  {t('signedInAs')}{' '}
                  {/* An address is Latin script and stays LTR inside Arabic (§10.3). */}
                  <span dir="ltr" className="force-ltr text-ink">
                    {user.email}
                  </span>
                </p>
              )}
            </CardContent>

            <div className="flex flex-wrap items-center gap-3">
              {user === null ? (
                <Button asChild iconEnd={<ArrowRight className="size-4 rtl:-scale-x-100" />}>
                  <Link href={ROUTES.signIn}>{t('actionSignedOut')}</Link>
                </Button>
              ) : (
                <Button asChild iconEnd={<ArrowRight className="size-4 rtl:-scale-x-100" />}>
                  <Link href={homeFor(user.status)}>{t('actionSignedIn')}</Link>
                </Button>
              )}

              {user === null ? (
                <Button asChild variant="ghost">
                  <Link href={ROUTES.home}>{t('secondarySignedOut')}</Link>
                </Button>
              ) : (
                <form action={endSession}>
                  <Button type="submit" variant="ghost">
                    {t('secondarySignedIn')}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
