'use client';

import { useMemo } from 'react';
import { useLocale } from 'next-intl';
import { defaultLocale, isRtl, locales, type Locale } from '@/i18n/routing';

/**
 * The single place in the app that knows about writing direction (§10.3).
 *
 * Components must never hardcode `x: -20` in a motion variant: multiply the
 * inline offset by `sign` instead, so a slide-in from the inline-start comes
 * from the right in Arabic. Layout still uses logical Tailwind utilities
 * (ms-/me-/ps-/pe-/start-/end-) — `inlineStart` / `inlineEnd` exist only for
 * the handful of APIs that demand physical values (transform-origin, chart
 * axis order, Radix `swipeDirection`, canvas drawing).
 */

export interface DirectionInfo {
  dir: 'ltr' | 'rtl';
  isRtl: boolean;
  /** Physical side the inline axis starts on. */
  inlineStart: 'left' | 'right';
  /** Physical side the inline axis ends on. */
  inlineEnd: 'left' | 'right';
  /** +1 in LTR, -1 in RTL. Multiply inline motion offsets by this. */
  sign: 1 | -1;
}

function isSupportedLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function useDirection(): DirectionInfo {
  const locale = useLocale();

  return useMemo<DirectionInfo>(() => {
    const active: Locale = isSupportedLocale(locale) ? locale : defaultLocale;
    const rtl = isRtl(active);

    return {
      dir: rtl ? 'rtl' : 'ltr',
      isRtl: rtl,
      inlineStart: rtl ? 'right' : 'left',
      inlineEnd: rtl ? 'left' : 'right',
      sign: rtl ? -1 : 1,
    };
  }, [locale]);
}
