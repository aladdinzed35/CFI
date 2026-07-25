import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware navigation APIs (§10.1).
 *
 * Always import `Link`, `redirect`, `usePathname`, `useRouter` and
 * `getPathname` from here — never from `next/link` or `next/navigation` —
 * so that the active locale prefix is preserved on every transition.
 */
export const { Link, redirect, permanentRedirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
