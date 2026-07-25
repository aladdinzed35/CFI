'use client';

import { useLocale } from 'next-intl';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Link, usePathname } from '@/i18n/navigation';
import { isLocale, locales, localeLabels, localeShortLabels } from '@/i18n/routing';
import { useTheme } from '@/hooks/use-theme';

/**
 * The two shell controls the M0 landing shell needs: the locale switcher
 * (§10.1 — a compact segmented control that preserves the current path and
 * query) and the theme toggle (§11.2).
 *
 * They live in `components/system` because they belong to the application
 * shell, not to the reusable design-system inventory; the header's richer
 * `LocaleSwitcher` / `ThemeToggle` (§11.3) carry menus and tooltips this shell
 * does not need.
 *
 * Every user-facing string arrives as a prop. The locale labels are the
 * deliberate exception: they come from the locale contract because they are
 * endonyms — a language names itself the same way in every interface language.
 */

export interface ShellControlsProps {
  /** Accessible name of the language group, e.g. « Changer de langue ». */
  languageLabel: string;
  /**
   * Accessible name of the theme button while the DARK theme is active — it
   * names the action the press performs, e.g. « Passer au thème clair ».
   * A toggle named for its current state ("Thème sombre") is ambiguous to a
   * screen-reader user: it reads as a status, not as a control.
   */
  switchToLightLabel: string;
  /** Same, while the LIGHT theme is active, e.g. « Passer au thème sombre ». */
  switchToDarkLabel: string;
  className?: string;
}

export function ShellControls({
  languageLabel,
  switchToLightLabel,
  switchToDarkLabel,
  className,
}: ShellControlsProps): React.JSX.Element {
  // Locale-agnostic path (no `/fr` prefix): next-intl re-prefixes it per link.
  const pathname = usePathname();
  const activeLocale = useLocale();
  const { resolvedTheme, toggle } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <nav
        aria-label={languageLabel}
        className="flex items-center gap-0.5 rounded-pill border border-hairline bg-surface p-1"
      >
        {locales.map((locale) => {
          const current = isLocale(activeLocale) && activeLocale === locale;
          return (
            <Link
              key={locale}
              href={pathname}
              locale={locale}
              hrefLang={locale}
              lang={locale}
              aria-current={current ? 'true' : undefined}
              className={cn(
                'inline-flex h-11 min-w-11 items-center justify-center rounded-pill px-3 text-sm font-medium transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                current ? 'bg-strait text-on-accent' : 'text-ink-muted hover:bg-raised hover:text-ink',
              )}
            >
              <span aria-hidden="true">{localeShortLabels[locale]}</span>
              <span className="sr-only">{localeLabels[locale]}</span>
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
          {/* Sun and moon carry no reading direction: never mirrored in RTL. */}
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
