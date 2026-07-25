'use client';

import { useCallback, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useTheme } from '@/hooks/use-theme';

/**
 * Theme toggle (§11.2) — the reusable version of the inline control in
 * `components/system/shell-controls.tsx`, and it keeps that file's naming
 * decision: **the button is named for the action it performs, not for the
 * theme currently applied.** « Thème sombre » read out on a control is
 * ambiguous — is it a status or a destination? « Passer au thème clair » is not.
 *
 * No flash: `useTheme` reads the `data-theme` attribute that `<ThemeScript />`
 * writes before first paint, through `useSyncExternalStore`. The server
 * snapshot is the documented default (`dark`), so the first client render is
 * byte-identical to the server HTML and React only re-renders afterwards if the
 * real preference differs. The icon therefore never contradicts the painted
 * theme, and there is no hydration warning to suppress.
 *
 * Announcing: pressing the button swaps its own accessible name, and a change
 * of accessible name on the focused element is not reliably announced. A
 * polite live region carries the resulting state instead — the only place where
 * naming the *state* is correct.
 */

export interface ThemeToggleProps {
  /** Name while DARK is active — the action, e.g. « Passer au thème clair ». */
  switchToLightLabel: string;
  /** Name while LIGHT is active, e.g. « Passer au thème sombre ». */
  switchToDarkLabel: string;
  /** Announced after switching to light, e.g. « Thème clair activé ». */
  lightEnabledMessage: string;
  /** Announced after switching to dark, e.g. « Thème sombre activé ». */
  darkEnabledMessage: string;
  /** Renders the action label next to the icon instead of only in the a11y tree. */
  showLabel?: boolean;
  className?: string;
}

export function ThemeToggle({
  switchToLightLabel,
  switchToDarkLabel,
  lightEnabledMessage,
  darkEnabledMessage,
  showLabel = false,
  className,
}: ThemeToggleProps): React.JSX.Element {
  const { resolvedTheme, setTheme } = useTheme();
  const [announcement, setAnnouncement] = useState('');

  const isDark = resolvedTheme === 'dark';
  const actionLabel = isDark ? switchToLightLabel : switchToDarkLabel;

  const handleClick = useCallback((): void => {
    const next = isDark ? 'light' : 'dark';
    setTheme(next);
    setAnnouncement(next === 'light' ? lightEnabledMessage : darkEnabledMessage);
  }, [darkEnabledMessage, isDark, lightEnabledMessage, setTheme]);

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={showLabel ? undefined : actionLabel}
        className={cn(
          'inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-pill border border-hairline bg-surface',
          showLabel ? 'px-4 text-sm font-medium' : 'w-11',
          'text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
          'hover:bg-raised hover:text-ink active:bg-raised',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
      >
        {/* Sun and moon carry no reading direction: never mirrored in RTL. */}
        {isDark ? (
          <Sun className="size-5 shrink-0" aria-hidden="true" />
        ) : (
          <Moon className="size-5 shrink-0" aria-hidden="true" />
        )}
        {showLabel ? <span>{actionLabel}</span> : null}
      </button>

      {/* Empty until the first press, so nothing is announced on page load. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
