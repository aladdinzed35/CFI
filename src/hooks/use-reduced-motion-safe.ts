'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { Variants } from 'motion/react';

/**
 * Reduced motion, resolved from BOTH sources (§11.2, §13.5):
 *   - the OS/browser setting, `prefers-reduced-motion: reduce`;
 *   - the in-app preference, mirrored onto <html data-reduce-motion="true"> by
 *     the theme bootstrap and by the Préférences screen.
 *
 * globals.css already neutralises CSS transitions and animations for both. This
 * hook covers the other half — JS-driven animation, which CSS cannot reach.
 *
 * `variants()` returns a static, opacity-only variant map when motion is
 * reduced, so a component can keep one set of variants and stay correct:
 *
 *   const { variants } = useReducedMotionSafe();
 *   <motion.div variants={variants(cardVariants)} initial="hidden" animate="shown" />
 */

export interface ReducedMotionSafe {
  /** True when the user has asked for reduced motion, from either source. */
  reduced: boolean;
  /** Passes variants through untouched, or flattens them when reduced. */
  variants: (variants: Variants) => Variants;
}

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** Emitted by the preferences screen after it rewrites the <html> attributes. */
const PREFS_EVENT = 'cfi:prefs-change';

function getSnapshot(): boolean {
  if (document.documentElement.getAttribute('data-reduce-motion') === 'true') return true;
  return window.matchMedia(MOTION_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(onStoreChange: () => void): () => void {
  const media = window.matchMedia(MOTION_QUERY);
  media.addEventListener('change', onStoreChange);
  window.addEventListener(PREFS_EVENT, onStoreChange);
  window.addEventListener('storage', onStoreChange);

  return () => {
    media.removeEventListener('change', onStoreChange);
    window.removeEventListener(PREFS_EVENT, onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

/** Every state collapses to "visible, instantly". */
function flatten(variants: Variants): Variants {
  const result: Variants = {};
  for (const key of Object.keys(variants)) {
    result[key] = { opacity: 1, transition: { duration: 0 } };
  }
  return result;
}

export function useReducedMotionSafe(): ReducedMotionSafe {
  const reduced = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const variants = useCallback(
    (input: Variants): Variants => (reduced ? flatten(input) : input),
    [reduced],
  );

  return { reduced, variants };
}
