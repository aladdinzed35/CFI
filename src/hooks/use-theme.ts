'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Theme state (§11.2). Dark is THE default — on every device, whatever the OS
 * asks for — and light is a first-class theme a visitor opts into.
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
  /** Alias of `theme`: the stored choice, or dark. */
  resolvedTheme: Theme;
  /** Persist an explicit choice and apply it immediately. */
  setTheme: (theme: Theme) => void;
  /** Flip between dark and light. */
  toggle: () => void;
}

const STORAGE_KEY = 'cfi-theme';
/** Same-tab notification channel (the `storage` event only fires cross-tab). */
const CHANGE_EVENT = 'cfi:theme-change';

/** What the browser paints around the page — kept in step with the theme. */
const THEME_COLOUR: Readonly<Record<Theme, string>> = { dark: '#060a12', light: '#f6f4ef' };

function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    // localStorage throws outright in some privacy modes.
    return null;
  }
}

/**
 * Apply a theme to the document, and tell the browser to match its own chrome:
 * `<meta name="theme-color">` is static in the document head, so without this
 * a visitor who switches to light keeps a dark address bar around a light page.
 */
function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOUR[theme]);
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function getServerSnapshot(): Theme {
  return 'dark';
}

/**
 * Only two things change the theme: this tab (`CHANGE_EVENT`) and another tab
 * writing the same key (`storage`). The OS colour scheme is deliberately not
 * one of them — dark is the default and only a visitor's own choice moves it.
 */
function subscribe(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    applyTheme(readStoredTheme() ?? 'dark');
    onStoreChange();
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
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
