import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import { Clock, MapPin, MessageCircle, Phone } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { HomeCentre } from '@/server/services/home';
import type { Locale } from '@/i18n/routing';

import { LazyMap } from './lazy-map';

/**
 * §12.2 #9 — the physical centre.
 *
 * The spec is emphatic about why this section exists: "this is a real place;
 * use it: it is the strongest differentiator against online-only platforms."
 * So it leads with the address, the hours and a way to visit, not with copy.
 *
 * Every fact here comes from `SiteSetting`. A centre with no address configured
 * renders the gallery and the invitation without inventing a location, and a
 * centre with neither address nor photos does not render at all — an empty
 * "come and visit us" block is worse than no block.
 */

/*
  Plain sections that follow one another would stack their paddings into a
  190 px hole. When the next section is also plain, this one keeps less below
  it; when the previous one is plain, a hairline at the content edge replaces
  the top padding. Same classes in proofs, instructors and faq.
*/
const PLAIN_BAND =
  '[&:has(+[data-home-band=plain])]:pb-12 sm:[&:has(+[data-home-band=plain])]:pb-16 [[data-home-band=plain]+&]:pt-0 [[data-home-band=plain]+&]:before:mb-12 [[data-home-band=plain]+&]:before:block [[data-home-band=plain]+&]:before:h-px [[data-home-band=plain]+&]:before:bg-hairline sm:[[data-home-band=plain]+&]:before:mb-16';

export interface HomeCentreProps {
  locale: Locale;
  centre: HomeCentre;
}

export async function HomeCentreSection({
  locale,
  centre,
}: HomeCentreProps): Promise<React.JSX.Element | null> {
  const hasAnything =
    centre.address !== null || centre.gallery.length > 0 || centre.hours !== null;
  if (!hasAnything) return null;

  const t = await getTranslations({ locale, namespace: 'home.center' });
  const [lead, ...rest] = centre.gallery;
  const hasGallery = centre.gallery.length > 0;

  /* §12.2: the map loads lazily ON INTERACTION. Google's embed pulls several
     hundred kilobytes and third-party cookies; loading it on arrival would
     cost the Lighthouse budget and set a tracker on a visitor who never asked
     to see a map. */
  const map =
    centre.address === null ? null : (
      <LazyMap
        address={centre.address}
        cta={t('mapCta')}
        notice={t('mapNotice')}
        frameTitle={t('mapTitle')}
        directionsLabel={t('directions')}
        // Beside the facts (no photos) it gets a squarer frame, so its
        // column ends near where the facts column does.
        frameClassName={hasGallery ? undefined : 'lg:aspect-[5/4]'}
      />
    );

  /*
    Two columns whenever there are two things to show. With photos: the
    gallery, then the facts with the map under them. Without photos — which is
    every fresh installation — the facts and the map side by side. The map
    used to stay in the second column regardless, so a centre with no photos
    had its whole content in the left 55 % and an empty right side.
  */
  const twoColumns = hasGallery || map !== null;

  return (
    <section
      aria-labelledby="home-centre-title"
      data-home-band="plain"
      className={cn('mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24', PLAIN_BAND)}
    >
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait rtl:font-arabic rtl:text-sm rtl:tracking-normal">
        {t('sectionLabel')}
      </p>
      <h2 id="home-centre-title" className="mt-4 max-w-[20ch] text-display text-balance">
        {t('title')}
      </h2>
      <p className="mt-5 max-w-[62ch] text-lead text-pretty text-ink-muted">{t('subtitle')}</p>

      <div
        className={cn(
          'mt-10 grid gap-10 sm:mt-12 lg:items-start lg:gap-12',
          twoColumns ? (hasGallery ? 'lg:grid-cols-[1.15fr_1fr]' : 'lg:grid-cols-2') : null,
        )}
      >
        {/* Gallery. Explicit aspect boxes so nothing shifts as images decode. */}
        {!hasGallery ? null : (
          <div className="flex flex-col gap-3" role="group" aria-label={t('galleryLabel')}>
            {lead === undefined ? null : (
              <div className="relative aspect-[16/10] w-full overflow-hidden rounded-md border border-hairline bg-raised">
                <Image
                  src={lead.url}
                  alt={lead.alt}
                  fill
                  sizes="(min-width: 1024px) 640px, 100vw"
                  className="object-cover"
                />
              </div>
            )}

            {rest.length === 0 ? null : (
              <ul className="grid grid-cols-3 gap-3">
                {rest.slice(0, 3).map((image) => (
                  <li
                    key={image.url}
                    className="relative aspect-square overflow-hidden rounded-sm border border-hairline bg-raised"
                  >
                    <Image
                      src={image.url}
                      alt={image.alt}
                      fill
                      sizes="(min-width: 1024px) 200px, 30vw"
                      className="object-cover"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-col gap-6">
          <p className="max-w-[62ch] text-body text-pretty text-ink-muted">{t('body')}</p>

          {/*
            A grid rather than nested flex wrappers, and that is a correctness
            constraint rather than a style choice: HTML allows exactly ONE <div>
            between a <dl> and its <dt>/<dd>. Wrapping the text in a second div
            to sit the icon beside it put <dt> two levels deep, which axe
            reported as `dlitem` on every render of the homepage. Here the icon
            spans both rows of the first column, so <dt> and <dd> stay direct
            children of the single permitted wrapper and the layout is unchanged.
          */}
          <dl className="grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline">
            {centre.address === null ? null : (
              <div className="grid grid-cols-[auto_1fr] items-start gap-x-4 bg-surface p-4 sm:p-5">
                <span className="row-span-2 inline-flex size-10 items-center justify-center rounded-md bg-strait-wash text-strait">
                  <MapPin className="size-5" aria-hidden="true" />
                </span>
                <dt className="text-sm font-medium text-ink">{t('addressLabel')}</dt>
                <dd className="mt-0.5 text-sm text-pretty text-ink-muted">{centre.address}</dd>
              </div>
            )}

            {centre.hours === null ? null : (
              <div className="grid grid-cols-[auto_1fr] items-start gap-x-4 bg-surface p-4 sm:p-5">
                <span className="row-span-2 inline-flex size-10 items-center justify-center rounded-md bg-strait-wash text-strait">
                  <Clock className="size-5" aria-hidden="true" />
                </span>
                <dt className="text-sm font-medium text-ink">{t('hoursLabel')}</dt>
                <dd className="mt-0.5 text-sm text-pretty text-ink-muted">{centre.hours}</dd>
              </div>
            )}

            {centre.phoneDisplay === null || centre.phoneE164 === null ? null : (
              <div className="grid grid-cols-[auto_1fr] items-start gap-x-4 bg-surface p-4 sm:p-5">
                <span className="row-span-2 inline-flex size-10 items-center justify-center rounded-md bg-strait-wash text-strait">
                  <Phone className="size-5" aria-hidden="true" />
                </span>
                <dt className="text-sm font-medium text-ink">{t('phoneLabel')}</dt>
                <dd className="text-sm">
                  {/* A number is Latin script and stays LTR inside Arabic (§10.3).
                      44 px tall to tap, pulled back by its own margin so the
                      row keeps the rhythm of the two above it. */}
                  <a
                    href={`tel:${centre.phoneE164}`}
                    dir="ltr"
                    className="force-ltr -my-3 inline-flex min-h-11 items-center text-ink underline-offset-4 hover:text-strait hover:underline"
                  >
                    {centre.phoneDisplay}
                  </a>
                </dd>
              </div>
            )}
          </dl>

          {centre.whatsappNumber === null ? null : (
            <a
              href={`https://wa.me/${centre.whatsappNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2 self-stretch rounded-pill border border-hairline bg-surface px-6 text-body font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none sm:self-start"
            >
              <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
              {t('visitCta')}
            </a>
          )}

          {hasGallery ? map : null}
        </div>

        {hasGallery ? null : map}
      </div>
    </section>
  );
}
