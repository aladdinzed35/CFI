'use client';

import { useCallback, useTransition } from 'react';
import { useLocale } from 'next-intl';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  defaultLocale,
  isLocale,
  locales,
  localeLabels,
  localeShortLabels,
  type Locale,
} from '@/i18n/routing';
import { useDirection } from '@/hooks/use-direction';

/**
 * Locale switcher (§10.1) — the general-purpose version of the inline control in
 * `components/system/shell-controls.tsx`.
 *
 * The shell renders a segmented control because it only ever had to show two
 * locales side by side. This project ships FOUR, and four segments either
 * overflow a 360 px header or shrink below the 44 px touch target, so the
 * reusable control is a dropdown: a compact trigger carrying the current short
 * label (FR / ع / EN / ES) that opens a menu of the full autonyms.
 *
 * What it guarantees:
 * - the pathname AND the query string survive the switch (a filtered catalog
 *   stays filtered), read from `window.location` at click time rather than
 *   through `useSearchParams` so no consumer page is forced into a Suspense
 *   boundary at build time;
 * - the `NEXT_LOCALE` cookie is written, which is what the middleware reads on
 *   the next visit to `/`;
 * - `onPersist` lets an authenticated page also write `User.locale`. The
 *   component never touches the database itself — primitives do not do data
 *   access.
 *
 * Language names are the one string the component owns: they are endonyms, so
 * « Français » reads the same in every interface language. Everything else —
 * the accessible name of the control, the "bêta" affix — arrives as a prop.
 */

/** Locales that are still incomplete, plus the affix shown next to them. */
export interface LocaleBetaMark {
  readonly locales: readonly Locale[];
  /** Short affix, e.g. « bêta ». Translated by the caller. */
  readonly label: string;
}

export interface LocaleSwitcherProps {
  /** Accessible name of the control, e.g. « Changer de langue ». */
  label: string;
  /**
   * Called with the newly chosen locale *before* navigation, so an
   * authenticated screen can persist `User.locale`. Failures must be handled by
   * the caller: the switch itself never blocks on it.
   */
  onPersist?: (locale: Locale) => void;
  /** Marks some locales as incomplete translations. */
  beta?: LocaleBetaMark;
  /** `icon` shows the short label only; `full` also shows the autonym. */
  variant?: 'icon' | 'full';
  className?: string;
}

const LOCALE_COOKIE = 'NEXT_LOCALE';
const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

function writeLocaleCookie(locale: Locale): void {
  // `Secure` would make the cookie unwritable over plain http in development.
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${ONE_YEAR_IN_SECONDS}; SameSite=Lax${secure}`;
}

export function LocaleSwitcher({
  label,
  onPersist,
  beta,
  variant = 'icon',
  className,
}: LocaleSwitcherProps): React.JSX.Element {
  const router = useRouter();
  // Locale-agnostic pathname: next-intl re-prefixes it with the target locale.
  const pathname = usePathname();
  const rawLocale = useLocale();
  const active: Locale = isLocale(rawLocale) ? rawLocale : defaultLocale;
  const { isRtl } = useDirection();
  const [isPending, startTransition] = useTransition();

  const select = useCallback(
    (next: Locale): void => {
      if (next === active) return;

      writeLocaleCookie(next);
      onPersist?.(next);

      // Read the query here rather than during render: `useSearchParams()` in a
      // client component opts every page that mounts this switcher out of
      // static rendering unless it is wrapped in Suspense.
      const search = window.location.search;
      const hash = window.location.hash;

      startTransition(() => {
        router.replace(`${pathname}${search}${hash}`, { locale: next });
      });
    },
    [active, onPersist, pathname, router],
  );

  return (
    <DropdownMenu.Root dir={isRtl ? 'rtl' : 'ltr'}>
      <DropdownMenu.Trigger
        aria-label={label}
        className={cn(
          'group inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-pill border border-hairline bg-surface px-3',
          'text-sm font-medium text-ink-muted',
          'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
          'hover:bg-raised hover:text-ink',
          'data-[state=open]:bg-raised data-[state=open]:text-ink',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <span aria-hidden="true" lang={active}>
            {localeShortLabels[active]}
          </span>
        )}
        {variant === 'full' ? (
          <span aria-hidden="true" lang={active} className="hidden sm:inline">
            {localeLabels[active]}
          </span>
        ) : null}
        {/* A chevron carries no reading direction of its own here: it points
            down in both writing systems, so it is never mirrored. */}
        <ChevronDown
          className="size-4 transition-transform duration-[120ms] ease-[var(--ease-out-strait)] group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 min-w-[11rem] overflow-hidden rounded-md border border-hairline bg-raised p-1 shadow-e3"
        >
          {locales.map((locale) => {
            const current = locale === active;
            const isBeta = beta !== undefined && beta.locales.includes(locale);

            return (
              <DropdownMenu.Item
                key={locale}
                lang={locale}
                dir={locale === 'ar' ? 'rtl' : 'ltr'}
                onSelect={() => select(locale)}
                aria-current={current ? 'true' : undefined}
                className={cn(
                  'flex h-11 cursor-pointer select-none items-center gap-2 rounded-sm px-3 text-sm outline-none',
                  'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                  'data-[highlighted]:bg-strait-wash data-[highlighted]:text-ink',
                  current ? 'text-ink' : 'text-ink-muted',
                )}
              >
                <span
                  aria-hidden="true"
                  className="inline-flex w-6 shrink-0 justify-center text-xs text-ink-muted"
                >
                  {localeShortLabels[locale]}
                </span>
                <span className="flex-1 text-start">{localeLabels[locale]}</span>
                {isBeta ? (
                  <span className="rounded-pill bg-warn-wash px-2 py-0.5 text-xs text-warn">
                    {beta.label}
                  </span>
                ) : null}
                {/* A checkmark is never mirrored (§10.3). */}
                <Check
                  className={cn('size-4 shrink-0 text-strait', current ? 'opacity-100' : 'opacity-0')}
                  aria-hidden="true"
                />
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
