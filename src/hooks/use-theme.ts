'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Theme state (§11.2). Dark is the default; light is a first-class theme.
 *
 * The single source of truth at runtime is the `data-theme` attribute on
 * <html>, written before paint by <ThemeScript />. This hook reads that
 * attribute through `useSyncExternalStore`, which is what makes it correct
 * during hydration: the server snapshot is the documented default (`dark`), and
 * React re-renders once after hydration if the real client value differs — so
 * a toggle button never renders a label that contradicts the painted theme.
 */

export type Theme = 'dark' | 'light';

export interface UseThemeResult {
  /** The theme currently applied to the document. */
  theme: Theme;
  /** Alias of `theme`: the effective value after storage + OS resolution. */
  resolvedTheme: Theme;
  /** Persist an explicit choice and apply it immediately. */
  setTheme: (theme: Theme) => void;
  /** Flip between dark and light. */
  toggle: () => void;
}

const STORAGE_KEY = 'cfi-theme';
/** Same-tab notification channel (the `storage` event only fires cross-tab). */
const CHANGE_EVENT = 'cfi:theme-change';
const LIGHT_QUERY = '(prefers-color-scheme: light)';

function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    // localStorage throws outright in some privacy modes.
    return null;
  }
}

function readSystemTheme(): Theme {
  return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function getServerSnapshot(): Theme {
  return 'dark';
}

function subscribe(onStoreChange: () => void): () => void {
  const media = window.matchMedia(LIGHT_QUERY);

  const handleStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    applyTheme(readStoredTheme() ?? readSystemTheme());
    onStoreChange();
  };

  const handleMedia = (): void => {
    // The OS only wins while the user has never made an explicit choice.
    if (readStoredTheme() !== null) return;
    applyTheme(readSystemTheme());
    onStoreChange();
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  media.addEventListener('change', handleMedia);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    media.removeEventListener('change', handleMedia);
  };
}

export function useTheme(): UseThemeResult {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme): void => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference cannot be persisted; still apply it for this session.
    }
    applyTheme(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const toggle = useCallback((): void => {
    setTheme(getSnapshot() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  return { theme, resolvedTheme: theme, setTheme, toggle };
}
