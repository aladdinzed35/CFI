'use client';

import { useState } from 'react';
import { MapPin, Navigation } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

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
  /** Extra classes for the map frame — e.g. a squarer aspect beside a text column. */
  frameClassName?: string;
}

export function LazyMap({
  address,
  cta,
  notice,
  frameTitle,
  directionsLabel,
  frameClassName,
}: LazyMapProps): React.JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const query = encodeURIComponent(address);

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          'relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-hairline bg-raised',
          frameClassName,
        )}
      >
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
            {/* A street-grid hint drawn in hairline, so the reserved box reads
                as « a map goes here » rather than as an empty panel. Two
                gradients over a theme token: no request, retints with the
                theme, and fades out toward the edges. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--color-hairline)_1px,transparent_1px),linear-gradient(90deg,var(--color-hairline)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
            />
            <span
              aria-hidden="true"
              className="relative grid size-12 place-items-center rounded-pill border border-hairline bg-surface text-strait shadow-e2"
            >
              <MapPin className="size-6" />
            </span>
            <p className="relative max-w-sm rounded-sm bg-raised/80 px-2 text-xs text-pretty text-ink-muted">
              {notice}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="relative"
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
        className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-strait underline-offset-4 hover:underline"
      >
        {/* A compass needle, not a « forward » arrow: it is not mirrored. */}
        <Navigation className="size-4 shrink-0" aria-hidden="true" />
        {directionsLabel}
      </a>
    </div>
  );
}
