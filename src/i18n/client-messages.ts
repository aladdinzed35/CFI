import type { AbstractIntlMessages } from 'next-intl';

/**
 * Which parts of the message catalogue each part of the app ships to the browser.
 *
 * `NextIntlClientProvider` serialises whatever `messages` it is given into the
 * RSC flight payload of **every** page under it. The root layout was handing it
 * the whole catalogue, so every visitor to the homepage downloaded and parsed
 * the entire administration vocabulary, the e-mail templates and the SEO
 * metadata strings along with it.
 *
 * Measured on the production build:
 *
 *   /fr document                457 KB   (113 KB transferred)
 *     of which RSC payload      298 KB   65 %
 *   fr.json, stringified        127 KB
 *     admin                      42 KB   32 %  — unreachable from a public page
 *     emails                      9 KB    7 %  — rendered by the mail service
 *     seo                         4 KB    3 %  — read only in generateMetadata
 *
 * Lighthouse attributed 2 689 ms of script evaluation to the document itself,
 * which is that inline payload being parsed. The catalogue is not the only
 * cause, but it is the largest part of it that carries no benefit.
 *
 * ## How the split is kept honest
 * `scripts/check-client-messages.ts` walks the import graph from every
 * `'use client'` entry point, collects the namespaces each one can reach, and
 * fails if a scope is missing one it needs. Without that guard this file is a
 * loaded gun: a namespace omitted here does not fail to compile, it throws
 * `MISSING_MESSAGE` in the browser the first time someone opens the screen that
 * needed it.
 */

/**
 * Never reachable from a browser bundle, in any scope.
 *
 * `seo` is read exclusively through `await getTranslations({ namespace: 'seo…' })`
 * inside `generateMetadata`, which runs on the server and never consults the
 * client provider.
 */
export const SERVER_ONLY_NAMESPACES = ['seo'] as const;

/**
 * Reachable only from the administration console.
 *
 * `emails` travels with `admin` rather than with `seo`, despite being an e-mail
 * vocabulary: the §17.3 verification drawer labels a `REMINDER_SENT` timeline
 * node with `emails.receiptReminder.subject`, and that drawer is a Client
 * Component. Dropping it would empty a node on a screen nobody would test until
 * a reminder had actually been sent.
 */
export const ADMIN_ONLY_NAMESPACES = ['admin', 'emails'] as const;

/** Excluded from the provider that wraps every non-admin page. */
export const PUBLIC_EXCLUDED_NAMESPACES = [
  ...SERVER_ONLY_NAMESPACES,
  ...ADMIN_ONLY_NAMESPACES,
] as const;

/**
 * A shallow copy of `messages` without the named top-level namespaces.
 *
 * Shallow on purpose: the provider only needs the top level to differ, and a
 * deep clone of 2 369 keys on every request would trade the bytes saved for the
 * CPU that saved them.
 */
export function omitNamespaces(
  messages: AbstractIntlMessages,
  exclude: readonly string[],
): AbstractIntlMessages {
  const drop = new Set<string>(exclude);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(messages)) {
    if (drop.has(key)) continue;
    out[key] = value;
  }
  return out as AbstractIntlMessages;
}
