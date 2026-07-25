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
      <body className="min-h-dvh bg-abyss text-ink">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-start px-4 py-24 sm:px-6 sm:py-32">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-danger">
            Erreur technique
          </p>

          <h1 className="mt-4 text-title">Le service est momentanément indisponible</h1>

          <p className="mt-4 max-w-prose text-body text-ink-muted">
            Une erreur inattendue a interrompu le chargement de la page. Vos données ne sont pas
            affectées. Réessayez maintenant&nbsp;; si le problème persiste, revenez dans quelques
            minutes.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-12 items-center rounded-pill bg-strait px-6 text-sm font-medium text-on-accent shadow-e2 transition-[box-shadow,transform] duration-[120ms] hover:shadow-e3 active:translate-y-px"
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
              className="inline-flex h-12 items-center rounded-pill border border-hairline bg-surface px-6 text-sm font-medium text-ink transition-colors duration-[120ms] hover:bg-raised"
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
        </div>
      </body>
    </html>
  );
}
