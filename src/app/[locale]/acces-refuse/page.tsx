import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { ArrowRight, ShieldAlert } from 'lucide-react';

import { SiteHeader } from '@/components/public/site-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { isLocale, type Locale } from '@/i18n/routing';
import { signOut } from '@/server/auth/config';
import { assertSameOrigin, getCurrentUser } from '@/server/auth/guards';
import { ROUTES, homeFor } from '@/server/auth/route-policy';
import { getPublicChrome } from '@/server/services/public-chrome';

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
 *
 * ## The frame and the picture
 * The public header sits on top — the logo home, the navigation, the language
 * switch — so a visitor turned away is still *somewhere* on the site. Beside
 * the explanation, the CFI gate from the hero with its doors shut: painted
 * Meknès blue, brass-studded, padlocked, and a thread of light under the seam
 * because the place is open, just not this door. Inline SVG, `aria-hidden`.
 */

type LocaleParams = { locale: string };

/* -------------------------------------------------------------------------- */
/* Illustration                                                                */
/* -------------------------------------------------------------------------- */

/** Brand star: two squares, one turned 45°, centred on (cx, cy). */
function Star({ cx, cy, size }: { cx: number; cy: number; size: number }): React.JSX.Element {
  const half = size / 2;
  return (
    <>
      <rect x={cx - half} y={cy - half} width={size} height={size} rx={size * 0.06} />
      <rect
        x={cx - half}
        y={cy - half}
        width={size}
        height={size}
        rx={size * 0.06}
        transform={`rotate(45 ${cx} ${cy})`}
      />
    </>
  );
}

/** Horseshoe arch, centred (200, 196), radius 115 — the 404's gate, shut. */
const ARCH = 'M91.9 400 L91.9 235.3 A115 115 0 1 1 308.1 235.3 L308.1 400 Z';

/** Brass studs: rows (y) and columns (x) across both leaves. */
const STUD_ROWS = [250, 290, 330, 370] as const;
const STUD_COLUMNS = [108, 136, 164, 236, 264, 292] as const;

function ClosedGate({ className }: { className?: string }): React.JSX.Element {
  return (
    <div aria-hidden="true" className={className}>
      <svg viewBox="0 0 400 440" className="block h-auto w-full overflow-visible" focusable="false">
        <defs>
          <radialGradient id="cfi-403-halo" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" style={{ stopColor: 'var(--raw-signal-warn)', stopOpacity: 0.14 }} />
            <stop offset="1" style={{ stopColor: 'var(--raw-signal-warn)', stopOpacity: 0 }} />
          </radialGradient>
          <linearGradient id="cfi-403-door" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--raw-accent-deep)' }} />
            <stop offset="1" style={{ stopColor: 'var(--raw-art-silhouette)' }} />
          </linearGradient>
          <pattern id="cfi-403-zellige" width="36" height="36" patternUnits="userSpaceOnUse">
            <g style={{ fill: 'var(--raw-art-tile)' }} opacity="0.7">
              <Star cx={18} cy={18} size={12} />
            </g>
            <g style={{ fill: 'var(--raw-art-tile-accent)' }} opacity="0.5">
              <rect x="-2.5" y="-2.5" width="5" height="5" transform="rotate(45 0 0)" />
              <rect x="33.5" y="-2.5" width="5" height="5" transform="rotate(45 36 0)" />
              <rect x="-2.5" y="33.5" width="5" height="5" transform="rotate(45 0 36)" />
              <rect x="33.5" y="33.5" width="5" height="5" transform="rotate(45 36 36)" />
            </g>
          </pattern>
          <clipPath id="cfi-403-arch">
            <path d={ARCH} />
          </clipPath>
        </defs>

        <circle cx="200" cy="230" r="215" fill="url(#cfi-403-halo)" />

        {/* The alfiz. */}
        <rect
          x="40"
          y="20"
          width="320"
          height="400"
          rx="10"
          className="fill-surface stroke-hairline"
          strokeWidth="1.5"
          style={{ filter: 'drop-shadow(0 22px 36px rgb(2 8 20 / 0.2))' }}
        />
        <rect x="40" y="20" width="320" height="400" rx="10" fill="url(#cfi-403-zellige)" />
        <rect
          x="56"
          y="36"
          width="288"
          height="384"
          rx="4"
          className="fill-none stroke-brass opacity-60"
          strokeWidth="1.25"
        />

        {/* Two painted leaves, shaped to the arch. */}
        <g clipPath="url(#cfi-403-arch)">
          <rect x="85" y="75" width="230" height="330" fill="url(#cfi-403-door)" />

          {/* Panel mouldings, and the rosette in the arch head. */}
          <g className="fill-none stroke-white" strokeWidth="1.25" opacity="0.16">
            <rect x="102" y="232" width="84" height="152" rx="3" />
            <rect x="214" y="232" width="84" height="152" rx="3" />
            <Star cx={200} cy={158} size={54} />
            <Star cx={200} cy={158} size={30} />
          </g>

          {/* Light through the seam and under the doors: open, just not this door. */}
          <rect x="198.5" y="80" width="3" height="325" style={{ fill: 'var(--raw-art-sun)' }} opacity="0.55" />
          <rect x="96" y="396" width="208" height="4" style={{ fill: 'var(--raw-art-sun)' }} opacity="0.45" />

          <g style={{ fill: 'var(--raw-art-tile)' }}>
            {STUD_ROWS.map((y) =>
              STUD_COLUMNS.map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" />),
            )}
          </g>
        </g>

        {/* Ring knockers. */}
        <g className="fill-none" style={{ stroke: 'var(--raw-art-tile)' }} strokeWidth="2.5">
          <circle cx="176" cy="300" r="8" />
          <circle cx="224" cy="300" r="8" />
        </g>

        {/* The padlock across the seam. */}
        <path
          d="M188 312 V302 A12 12 0 0 1 212 302 V312"
          className="fill-none"
          style={{ stroke: 'var(--raw-art-tile)' }}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <rect x="182" y="310" width="36" height="30" rx="5" style={{ fill: 'var(--raw-art-sun)' }} />
        <circle cx="200" cy="322" r="3.4" style={{ fill: 'var(--raw-art-silhouette)' }} />
        <rect x="198.6" y="323" width="2.8" height="9" rx="1.2" style={{ fill: 'var(--raw-art-silhouette)' }} />

        {/* Marble jambs and the arch's double outline. */}
        <rect x="82" y="236" width="10" height="164" rx="2" className="fill-raised stroke-hairline" strokeWidth="1" />
        <rect x="308" y="236" width="10" height="164" rx="2" className="fill-raised stroke-hairline" strokeWidth="1" />
        <path d={ARCH} className="fill-none stroke-brass" strokeWidth="3" />
        <path
          d="M83.5 400 L83.5 238.4 A124 124 0 1 1 316.5 238.4 L316.5 400"
          className="fill-none stroke-brass opacity-40"
          strokeWidth="1.25"
        />

        {/* Keystone. */}
        <circle cx="200" cy="46" r="22" className="fill-surface stroke-brass" strokeWidth="1.25" />
        <g style={{ fill: 'var(--raw-art-sun)' }}>
          <Star cx={200} cy={46} size={20} />
        </g>

        {/* Threshold. */}
        <rect x="56" y="400" width="288" height="20" rx="2" className="fill-raised" />
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

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

  const [t, user, chrome] = await Promise.all([
    getTranslations({ locale, namespace: 'accessDenied' }),
    getCurrentUser(),
    getPublicChrome(locale),
  ]);

  /** « Se déconnecter » — the way out of "signed in as the wrong person". */
  async function endSession(): Promise<void> {
    'use server';
    await assertSameOrigin();
    await signOut({ redirectTo: `/${locale}${ROUTES.signIn}` });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader brandName={chrome.brandName} brandFullName={chrome.brandFullName} />

      <main id="contenu" className="texture-bathymetric flex flex-1 items-center">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 py-10 sm:px-6 sm:py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] md:gap-10 lg:grid-cols-[minmax(0,36rem)_minmax(0,22rem)] lg:justify-between lg:gap-12 lg:py-20 xl:gap-16">
          <ClosedGate className="mx-auto w-full max-w-[10.5rem] sm:max-w-[13rem] md:order-last md:max-w-none" />

          <Card padding="lg" elevation={2} className="min-w-0">
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
                <h1 className="text-title text-balance">{t('title')}</h1>
                <p className="text-lead text-pretty text-ink-muted">{t('body')}</p>
              </div>

              <CardContent className="hairline-t px-0 pb-0 pt-5">
                <h2 className="text-sm font-medium text-ink">{t('whatToDo')}</h2>
                <p className="mt-2 text-sm text-pretty text-ink-muted">
                  {user === null ? t('tipSignedOut') : t('tipSignedIn')}
                </p>

                {user === null ? null : (
                  <p className="mt-3 text-sm text-ink-muted">
                    {t('signedInAs')}{' '}
                    {/* An address is Latin script and stays LTR inside Arabic (§10.3). */}
                    <span dir="ltr" className="force-ltr max-w-full break-all text-ink">
                      {user.email}
                    </span>
                  </p>
                )}
              </CardContent>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                {user === null ? (
                  <Button
                    asChild
                    className="w-full sm:w-auto"
                    iconEnd={<ArrowRight className="size-4 rtl:-scale-x-100" />}
                  >
                    <Link href={ROUTES.signIn}>{t('actionSignedOut')}</Link>
                  </Button>
                ) : (
                  <Button
                    asChild
                    className="w-full sm:w-auto"
                    iconEnd={<ArrowRight className="size-4 rtl:-scale-x-100" />}
                  >
                    <Link href={homeFor(user.status)}>{t('actionSignedIn')}</Link>
                  </Button>
                )}

                {user === null ? (
                  <Button asChild variant="ghost" className="w-full sm:w-auto">
                    <Link href={ROUTES.home}>{t('secondarySignedOut')}</Link>
                  </Button>
                ) : (
                  <form action={endSession} className="w-full sm:w-auto">
                    <Button type="submit" variant="ghost" className="w-full sm:w-auto">
                      {t('secondarySignedIn')}
                    </Button>
                  </form>
                )}
              </div>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
