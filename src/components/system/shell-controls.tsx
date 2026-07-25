'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import { locales, type Locale } from '@/i18n/routing';
import { useTheme } from '@/hooks/use-theme';

/**
 * The two shell controls the M0 landing shell needs: the locale switcher
 * (§10.1 — a compact segmented control that preserves the current path) and the
 * theme toggle (§11.2).
 *
 * These live in `components/system` because they are part of the application
 * shell rather than reusable design-system primitives; the richer
 * `LocaleSwitcher` / `ThemeToggle` in `components/ui` (§11.3) are the header's
 * versions and carry menus, tooltips and labels this shell does not need.
 *
 * Every user-facing string arrives as a prop. The locale labels below are the
 * only exception, and deliberately so: they are endonyms — a language names
 * itself the same way in every interface language — so translating them would
 * be wrong, not merely redundant.
 */

const LOCALE_LABELS: Record<Locale, { short: string; endonym: string }> = {
  fr: { short: 'FR', endonym: 'Français' },
  ar: { short: 'ع', endonym: 'العربية' },
  en: { short: 'EN', endonym: 'English' },
  es: { short: 'ES', endonym: 'Español' },
};

export interface ShellControlsProps {
  /** Accessible name of the language group, e.g. « Langue ». */
  languageLabel: string;
  /** Action label shown while the dark theme is active. */
  switchToLightLabel: string;
  /** Action label shown while the light theme is active. */
  switchToDarkLabel: string;
  className?: string;
}

export function ShellControls({
  languageLabel,
  switchToLightLabel,
  switchToDarkLabel,
  className,
}: ShellControlsProps): React.JSX.Element {
  const pathname = usePathname();
  const { resolvedTheme, toggle } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const segments = pathname.split('/');
  const currentSegment = segments[1];
  const currentLocale = locales.find((locale) => locale === currentSegment);

  const hrefFor = (target: Locale): string => {
    if (currentLocale === undefined) return `/${target}`;
    const next = [...segments];
    next[1] = target;
    return next.join('/');
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <nav
        aria-label={languageLabel}
        className="flex items-center gap-0.5 rounded-pill border border-hairline bg-surface p-1"
      >
        {locales.map((locale) => {
          const active = locale === currentLocale;
          return (
            <Link
              key={locale}
              href={hrefFor(locale)}
              hrefLang={locale}
              lang={locale}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'inline-flex h-11 min-w-11 items-center justify-center rounded-pill px-3 text-sm font-medium transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                active
                  ? 'bg-strait text-on-accent'
                  : 'text-ink-muted hover:bg-raised hover:text-ink',
              )}
            >
              <span aria-hidden="true">{LOCALE_LABELS[locale].short}</span>
              <span className="sr-only">{LOCALE_LABELS[locale].endonym}</span>
            </Link>
          );
        })}
      </nav>

      <div className="rounded-pill border border-hairline bg-surface p-1">
        <button
          type="button"
          onClick={toggle}
          aria-label={isDark ? switchToLightLabel : switchToDarkLabel}
          className="inline-flex size-11 items-center justify-center rounded-pill text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink"
        >
          {/* Not direction-carrying: never mirrored in RTL. */}
          {isDark ? (
            <Sun className="size-5" aria-hidden="true" />
          ) : (
            <Moon className="size-5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
