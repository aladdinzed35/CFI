'use client';

import '@/styles/globals.css';

/**
 * Last-resort error boundary: it replaces the root layout when the layout
 * itself fails, so React requires it to render its own <html> and <body>.
 *
 * Deliberately dependency-free:
 *  - no next-intl. This tree renders *outside* NextIntlClientProvider and
 *    outside the request-locale scope, so any translation call would throw
 *    inside an error handler — the one place that must never throw. The copy is
 *    therefore written in French, the source language of the product (§28.1).
 *  - no locale, so `lang` is fixed to the default locale and `dir` to ltr.
 *  - no theme bootstrap script: `data-theme="dark"` is set literally, which
 *    guarantees a correctly painted page even if client JS is broken.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <html lang="fr-MA" dir="ltr" data-theme="dark">
      <body className="texture-bathymetric flex min-h-dvh flex-col bg-abyss text-ink">
        {/* The brand, without the header component: this page must not import
            anything that could be what failed. Same shared edge as the site. */}
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2.5 px-4 sm:px-6 lg:h-20">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-md border border-strait/25 bg-strait-wash text-strait"
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-6">
              <g stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round">
                <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="1" />
                <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="1" transform="rotate(45 12 12)" />
              </g>
              <g className="fill-brass">
                <rect x="9.6" y="9.6" width="4.8" height="4.8" rx="0.4" />
                <rect x="9.6" y="9.6" width="4.8" height="4.8" rx="0.4" transform="rotate(45 12 12)" />
              </g>
            </svg>
          </span>
          <span className="font-display text-heading leading-none tracking-tight">CFI</span>
        </div>

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-start justify-center px-4 py-16 sm:px-6 sm:py-24">
          <p className="inline-flex h-8 items-center rounded-pill border border-hairline bg-surface px-3 font-mono text-xs uppercase tracking-[0.22em] text-danger">
            Erreur technique
          </p>

          <h1 className="mt-5 max-w-[22ch] font-display text-display text-balance">
            Le service est momentanément indisponible
          </h1>

          <p className="mt-4 max-w-prose text-lead text-pretty text-ink-muted">
            Une erreur inattendue a interrompu le chargement de la page. Vos données ne sont pas
            affectées. Réessayez maintenant&nbsp;; si le problème persiste, revenez dans quelques
            minutes.
          </p>

          <div className="mt-10 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-12 items-center justify-center rounded-pill bg-strait px-6 text-sm font-medium text-on-accent shadow-e2 transition-[box-shadow,transform] duration-[120ms] hover:shadow-e3 active:translate-y-px"
            >
              Réessayer
            </button>
            {/*
              A plain <a>, deliberately, not next/link. global-error replaces the
              ROOT layout when the root layout itself threw: a client-side
              transition would keep that broken React tree mounted and navigate
              inside it. A full document load is the only way back to a known-good
              state — which is exactly what this escape hatch is for.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/fr"
              className="inline-flex h-12 items-center justify-center rounded-pill border border-hairline bg-surface px-6 text-sm font-medium text-ink transition-colors duration-[120ms] hover:bg-raised"
            >
              Retour à l&apos;accueil
            </a>
          </div>

          {error.digest === undefined ? null : (
            <p className="mt-10 text-sm text-ink-muted">
              Référence à communiquer au support&nbsp;:{' '}
              <span className="force-ltr text-ink" dir="ltr" data-numeric>
                {error.digest}
              </span>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
