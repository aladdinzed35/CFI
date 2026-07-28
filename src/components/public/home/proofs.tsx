'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Quote } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Rating } from '@/components/ui/rating';
import { useReducedMotionSafe } from '@/hooks/use-reduced-motion-safe';
import type { HomeTestimonial } from '@/server/services/home';

/**
 * §12.2 §7 — « Preuves ».
 *
 * The only client component above the FAQ, and deliberately the smallest one it
 * can be: no animation library, no carousel package, no virtualisation. The rail
 * is a native scroll-snap container — the browser does the panning, the
 * momentum, the touch handling and the reduced-motion behaviour — and the two
 * controls exist only so a mouse user without a trackpad has a way through it.
 *
 * ## Direction is never computed
 *
 * `scrollIntoView({ inline: 'start' })` is expressed in *logical* terms, so
 * "next" moves toward the inline end in French and toward the inline start in
 * Arabic without this file knowing which one it is in. The chevrons, by
 * contrast, are direction-carrying glyphs, so they are the one thing here that
 * *is* mirrored (`rtl:-scale-x-100`, §10.3).
 *
 * ## The position is observed, not assumed
 *
 * A visitor can swipe the rail past the controls' back. An IntersectionObserver
 * rooted on the rail keeps `index` honest whatever moved it, which is what makes
 * the live region and the disabled states truthful rather than decorative.
 *
 * The partner/employer logo strip §12.2 mentions is absent on purpose: the
 * schema has nowhere to store those logos yet, and a strip of invented ones
 * would be the exact opposite of a proof.
 */

export interface HomeProofsProps {
  testimonials: readonly HomeTestimonial[];
}

export function HomeProofs({ testimonials }: HomeProofsProps): React.JSX.Element | null {
  const t = useTranslations('home.proofs');
  const { reduced } = useReducedMotionSafe();
  const railRef = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);

  const total = testimonials.length;

  useEffect(() => {
    const rail = railRef.current;
    if (rail === null || total === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const position = Number(entry.target.getAttribute('data-index'));
          if (Number.isInteger(position)) setIndex(position);
        }
      },
      { root: rail, threshold: 0.6 },
    );

    for (const child of Array.from(rail.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [total]);

  const goTo = useCallback(
    (target: number) => {
      const rail = railRef.current;
      if (rail === null) return;

      const clamped = Math.min(Math.max(target, 0), total - 1);
      const slide = rail.children[clamped];
      if (!(slide instanceof HTMLElement)) return;

      slide.scrollIntoView({
        behavior: reduced ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'start',
      });
      setIndex(clamped);
    },
    [reduced, total],
  );

  if (total === 0) return null;

  return (
    <section
      aria-labelledby="home-proofs-title"
      className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
            {t('sectionLabel')}
          </p>
          <h2 id="home-proofs-title" className="mt-4 max-w-[20ch] text-display">
            {t('title')}
          </h2>
          <p className="mt-5 max-w-[62ch] text-lead text-ink-muted">{t('subtitle')}</p>
        </div>

        {total > 1 ? (
          <div className="flex items-center gap-2">
            <IconButton
              aria-label={t('previous')}
              variant="secondary"
              shape="round"
              icon={<ChevronLeft className="rtl:-scale-x-100" aria-hidden="true" />}
              disabled={index === 0}
              onClick={() => goTo(index - 1)}
            />
            <IconButton
              aria-label={t('next')}
              variant="secondary"
              shape="round"
              icon={<ChevronRight className="rtl:-scale-x-100" aria-hidden="true" />}
              disabled={index >= total - 1}
              onClick={() => goTo(index + 1)}
            />
          </div>
        ) : null}
      </div>

      <ul
        ref={railRef}
        role="list"
        aria-label={t('title')}
        /*
          Focusable because it scrolls, exactly as in home/featured.tsx. This
          testimonial rail overflows horizontally at every width, so without a
          tab stop a keyboard-only visitor can read the first testimonial and
          reach none of the others — axe's `scrollable-region-focusable`.
        */
        tabIndex={0}
        className="-mx-4 mt-12 flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-p-4 px-4 pb-2 sm:-mx-6 sm:scroll-p-6 sm:px-6 lg:mx-0 lg:scroll-p-0 lg:px-0"
      >
        {testimonials.map((testimonial, position) => (
          <li
            key={testimonial.id}
            data-index={position}
            className="flex w-[85%] shrink-0 snap-start rounded-lg border border-hairline bg-surface p-6 sm:w-[60%] lg:w-[calc((100%-3rem)/3)]"
          >
            <figure className="flex min-w-0 flex-1 flex-col">
              <Quote className="size-6 shrink-0 text-strait" aria-hidden="true" />

              <blockquote className="mt-4 flex-1 text-body text-ink">
                <p>{testimonial.quote}</p>
              </blockquote>

              <Rating
                className="mt-5"
                value={testimonial.rating}
                size="sm"
                label={t('ratingLabel', { rating: testimonial.rating })}
              />

              <figcaption className="mt-5 flex items-center gap-3 border-t border-hairline pt-5">
                <Avatar name={testimonial.authorName} src={testimonial.avatarUrl} size="md" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">
                    {testimonial.authorName}
                  </span>
                  {testimonial.authorRole === null ? null : (
                    <span className="block truncate text-xs text-ink-muted">
                      {testimonial.authorRole}
                    </span>
                  )}
                </span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>

      {total > 1 ? (
        <p aria-live="polite" className="sr-only">
          {t('slideLabel', { index: index + 1, total })}
        </p>
      ) : null}
    </section>
  );
}
