'use client';

import { useState } from 'react';
import { MapPin } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * A Google Maps embed that does not exist until the visitor asks for it.
 *
 * §12.2 requires the map to be "loaded lazily on interaction". Two reasons, and
 * both matter here:
 *
 *  · Cost. The embed pulls several hundred kilobytes of third-party script. On
 *    a mid-range Android over 4G in Meknès — the device §21 sets the budget
 *    against — that is the difference between passing and failing Lighthouse.
 *  · Consent. Loading it sets Google cookies. Doing that to someone who never
 *    asked to see a map is exactly the "no third-party script the visitor did
 *    not ask for" posture of the Law 09-08 section, so the notice says plainly
 *    where the map comes from before anything loads.
 *
 * The placeholder reserves the final height, so revealing the map shifts
 * nothing. A text « Itinéraire » link is always present — it works with no
 * JavaScript, no consent and no embed, which is what most people actually want.
 */

export interface LazyMapProps {
  address: string;
  cta: string;
  notice: string;
  frameTitle: string;
  directionsLabel: string;
}

export function LazyMap({
  address,
  cta,
  notice,
  frameTitle,
  directionsLabel,
}: LazyMapProps): React.JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const query = encodeURIComponent(address);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-md border border-hairline bg-raised">
        {loaded ? (
          <iframe
            title={frameTitle}
            src={`https://www.google.com/maps?q=${query}&output=embed`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="absolute inset-0 size-full border-0"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <span
              aria-hidden="true"
              className="grid size-12 place-items-center rounded-md border border-hairline bg-surface text-strait"
            >
              <MapPin className="size-6" />
            </span>
            <p className="max-w-sm text-xs text-pretty text-ink-muted">{notice}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setLoaded(true);
              }}
            >
              {cta}
            </Button>
          </div>
        )}
      </div>

      <a
        href={`https://www.google.com/maps/search/?api=1&query=${query}`}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
      >
        {directionsLabel}
      </a>
    </div>
  );
}
