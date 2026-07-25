'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * SSR-safe media queries (§11.4). `window` is never touched during render:
 * `useSyncExternalStore` asks for a server snapshot on the server and during
 * hydration, then re-renders with the real value.
 *
 * Use these only for behaviour that CSS genuinely cannot express (mounting a
 * bottom sheet instead of a modal, virtualising a list). Pure layout stays in
 * Tailwind breakpoints so it is correct before JS ever runs.
 *
 * Breakpoints mirror §11.4: mobile < 768, tablet 768–1023, desktop ≥ 1024.
 */

export const MEDIA_MOBILE = '(max-width: 767.98px)';
export const MEDIA_TABLET = '(min-width: 768px) and (max-width: 1023.98px)';
export const MEDIA_DESKTOP = '(min-width: 1024px)';

export function useMediaQuery(query: string, serverFallback = false): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onStoreChange);
      return () => list.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback((): boolean => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = useCallback((): boolean => serverFallback, [serverFallback]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** < 768 px. Server-rendered as `true`: the app is designed mobile-first. */
export function useIsMobile(): boolean {
  return useMediaQuery(MEDIA_MOBILE, true);
}

/** 768–1023 px. */
export function useIsTablet(): boolean {
  return useMediaQuery(MEDIA_TABLET, false);
}

/** ≥ 1024 px. */
export function useIsDesktop(): boolean {
  return useMediaQuery(MEDIA_DESKTOP, false);
}
