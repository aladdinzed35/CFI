import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { HomeCentreSection } from '@/components/public/home/centre';
import { HomeFaqSection } from '@/components/public/home/faq';
import { HomeFeatured } from '@/components/public/home/featured';
import { HomeFinalCta } from '@/components/public/home/final-cta';
import { HomeHero } from '@/components/public/home/hero';
import { HomeHowItWorks } from '@/components/public/home/how-it-works';
import { HomeInstructors } from '@/components/public/home/instructors';
import { HomeMethod } from '@/components/public/home/method';
import { HomePaths } from '@/components/public/home/paths';
import { HomePricingBand } from '@/components/public/home/pricing-band';
import { HomeProofs } from '@/components/public/home/proofs';
import { getCurrentUser } from '@/server/auth';
import { getHomeData } from '@/server/services/home';
import { buildMetadata } from '@/lib/seo';
import { isLocale, locales } from '@/i18n/routing';

/**
 * `/[locale]` — the homepage, §12.2 sections 1 through 11 in order.
 *
 * This replaces the Milestone 0 placeholder that used to live at
 * `app/[locale]/page.tsx`. Both would resolve to the same URL — Next treats a
 * route group as transparent — so the placeholder is gone rather than moved.
 *
 * ## One read, eleven sections
 *
 * `getHomeData` issues every query in parallel and memoises per locale, so the
 * page performs a single round trip regardless of how many sections render.
 * Sections receive plain data and never touch the database; several return
 * `null` when they have nothing true to show, which is the §12.2 rule about not
 * inventing a proof applied to whole blocks rather than just to numbers.
 *
 * ## Why this is one Server Component
 *
 * M2's gate is Lighthouse >= 95 on mobile. Everything here renders on the
 * server; the only client code the homepage ships is what genuinely needs it —
 * the map that loads on click, the testimonial carousel, the accordion.
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

  const t = await getTranslations({ locale, namespace: 'seo.home' });
  return buildMetadata({
    locale,
    // '' rather than '/', so the canonical is https://…/fr and not https://…/fr/
    path: '',
    title: t('title'),
    description: t('description'),
  });
}

export default async function HomePage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  // The homepage is public: `getCurrentUser` returns null for a guest and must
  // never be `requireUser`. It is read only to decide which CTA to show.
  const [data, user] = await Promise.all([getHomeData(locale), getCurrentUser()]);

  return (
    <>
      <HomeHero locale={locale} stats={data.stats} tiles={data.lattice} />
      <HomeMethod />
      <HomeFeatured locale={locale} courses={data.featured} categories={data.categories} />
      <HomePaths locale={locale} paths={data.paths} />
      <HomeHowItWorks />
      <HomePricingBand locale={locale} pricing={data.pricing} />
      <HomeProofs testimonials={data.testimonials} />
      <HomeInstructors instructors={data.instructors} />
      <HomeCentreSection locale={locale} centre={data.centre} />
      <HomeFaqSection locale={locale} items={data.faq} />
      <HomeFinalCta
        locale={locale}
        whatsappUrl={
          data.centre.whatsappNumber === null
            ? null
            : `https://wa.me/${data.centre.whatsappNumber}`
        }
        isSignedIn={user !== null}
      />
    </>
  );
}
