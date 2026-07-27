import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import { Clock, MapPin, Phone } from 'lucide-react';

import { Button } from '@/components/ui/button';
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

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
        {t('sectionLabel')}
      </p>
      <h2 className="mt-4 max-w-2xl text-title text-balance">{t('title')}</h2>
      <p className="mt-4 max-w-2xl text-lead text-pretty text-ink-muted">{t('subtitle')}</p>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:items-start">
        {/* Gallery. Explicit aspect boxes so nothing shifts as images decode. */}
        {centre.gallery.length === 0 ? null : (
          <div className="flex flex-col gap-3" aria-label={t('galleryLabel')}>
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
          <p className="text-body text-pretty text-ink-muted">{t('body')}</p>

          <dl className="flex flex-col gap-4">
            {centre.address === null ? null : (
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-5 shrink-0 text-strait" aria-hidden="true" />
                <div>
                  <dt className="text-sm font-medium text-ink">{t('addressLabel')}</dt>
                  <dd className="mt-0.5 text-sm text-pretty text-ink-muted">{centre.address}</dd>
                </div>
              </div>
            )}

            {centre.hours === null ? null : (
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 size-5 shrink-0 text-strait" aria-hidden="true" />
                <div>
                  <dt className="text-sm font-medium text-ink">{t('hoursLabel')}</dt>
                  <dd className="mt-0.5 text-sm text-pretty text-ink-muted">{centre.hours}</dd>
                </div>
              </div>
            )}

            {centre.phoneDisplay === null || centre.phoneE164 === null ? null : (
              <div className="flex items-start gap-3">
                <Phone className="mt-0.5 size-5 shrink-0 text-strait" aria-hidden="true" />
                <div>
                  <dt className="text-sm font-medium text-ink">{t('phoneLabel')}</dt>
                  <dd className="mt-0.5 text-sm">
                    {/* A number is Latin script and stays LTR inside Arabic (§10.3). */}
                    <a
                      href={`tel:${centre.phoneE164}`}
                      dir="ltr"
                      className="force-ltr text-ink underline-offset-4 hover:underline"
                    >
                      {centre.phoneDisplay}
                    </a>
                  </dd>
                </div>
              </div>
            )}
          </dl>

          {centre.whatsappNumber === null ? null : (
            <Button asChild variant="secondary" className="self-start">
              <a
                href={`https://wa.me/${centre.whatsappNumber}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('visitCta')}
              </a>
            </Button>
          )}

          {/* §12.2: the map loads lazily ON INTERACTION. Google's embed pulls
              several hundred kilobytes and third-party cookies; loading it on
              arrival would cost the Lighthouse budget and set a tracker on a
              visitor who never asked to see a map. */}
          {centre.address === null ? null : (
            <LazyMap
              address={centre.address}
              cta={t('mapCta')}
              notice={t('mapNotice')}
              frameTitle={t('mapTitle')}
              directionsLabel={t('directions')}
            />
          )}
        </div>
      </div>
    </section>
  );
}
