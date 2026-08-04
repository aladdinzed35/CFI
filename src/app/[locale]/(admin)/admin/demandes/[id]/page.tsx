import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { redirect } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { requirePageAdmin } from '@/server/auth/guards';

import { PARAM } from '../request-view';

/**
 * `/admin/demandes/[id]` — the deep link e-mail #7 sends the administrators
 * (`ENROLLMENT_ROUTES.adminRequest`).
 *
 * The verification drawer's open state lives in a search parameter, not in a
 * route segment, so that a link carries the queue, the page and the filters
 * around it. This segment exists so the address in a real inbox resolves to a
 * real page instead of a 404 — the exact defect `scripts/check-routes.ts` was
 * written after. It authorises first, then rewrites the address into the shape
 * the queue understands.
 */

export default async function AdminRequestDeepLink({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<never> {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  await requirePageAdmin(locale);

  return redirect({
    href: { pathname: '/admin/demandes', query: { [PARAM.review]: id } },
    locale,
  });
}
