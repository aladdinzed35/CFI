/**
 * Theme + accessibility-preferences bootstrap (§11.2 "no flash of wrong theme",
 * §13.5 "accessibility features as product features").
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ This is the ONLY file in the codebase allowed to use                      │
 * │ `dangerouslySetInnerHTML`. It is required because the preferences must be │
 * │ applied to <html> *before the first paint*; any React-driven approach     │
 * │ runs after hydration and produces a visible flash of the wrong theme.     │
 * │ The payload is a fixed, author-written string — no interpolation of any   │
 * │ kind, so there is no injection surface. Do not copy this pattern.         │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * What it does, in order, before paint:
 *   1. data-theme      ← localStorage 'cfi-theme' → prefers-color-scheme → dark
 *   2. data-reduce-motion / data-dyslexia / data-contrast ← localStorage 'cfi-prefs'
 *   3. --font-scale    ← 'cfi-prefs'.fontScale, clamped to the 90–130 range
 *
 * Every access is individually try/catch-wrapped: Safari private mode and
 * "block third-party cookies" both make `localStorage` *throw on read*, and a
 * throw here would leave the page unstyled. Worst case the attributes are never
 * written and globals.css falls back to `:root:not([data-theme])`, which
 * already honours the OS colour scheme.
 *
 * Serialized payload: ~570 bytes (budget: 900).
 */

const BOOTSTRAP = `(function(){var d=document.documentElement;try{var t=null;try{t=localStorage.getItem('cfi-theme')}catch(e){}if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}d.setAttribute('data-theme',t);var p={};try{p=JSON.parse(localStorage.getItem('cfi-prefs')||'{}')||{}}catch(e){}if(p.reduceMotion===true)d.setAttribute('data-reduce-motion','true');if(p.dyslexia===true)d.setAttribute('data-dyslexia','true');if(p.contrast==='high')d.setAttribute('data-contrast','high');var f=Number(p.fontScale);if(f>=90&&f<=130)d.style.setProperty('--font-scale',String(Math.round(f)/100))}catch(e){}})();`;

export function ThemeScript(): React.JSX.Element {
  return <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: BOOTSTRAP }} />;
}
