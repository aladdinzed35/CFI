import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Compass } from 'lucide-react';

/**
 * 404 inside a locale segment (§11.5: say what happened, say what to do next,
 * offer exactly one primary action — no apology, no dead end).
 *
 * Rendered inside the locale layout, so the message catalogue is available and
 * the copy is French by default through `fr` being the source locale.
 */

export default function LocaleNotFound(): React.JSX.Element {
  const locale = useLocale();
  const t = useTranslations('notFound');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-start px-4 py-24 sm:px-6 sm:py-32">
      <span className="inline-flex size-12 items-center justify-center rounded-md border border-hairline bg-surface text-ink-muted">
        {/* A compass is not direction-carrying in the RTL sense: never mirrored. */}
        <Compass className="size-6" aria-hidden="true" />
      </span>

      <p className="mt-8 font-mono text-xs uppercase tracking-[0.22em] text-ink-muted">
        <span className="force-ltr" dir="ltr" data-numeric>
          404
        </span>
      </p>

      <h1 className="mt-4 text-title">{t('title')}</h1>

      <p className="mt-4 max-w-prose text-body text-ink-muted">{t('description')}</p>

      <Link
        href={`/${locale}`}
        className="mt-10 inline-flex h-12 items-center gap-2 rounded-pill bg-strait px-6 text-sm font-medium text-on-accent shadow-e2 transition-[box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)] hover:shadow-e3 active:translate-y-px"
      >
        {t('action')}
        <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
      </Link>
    </div>
  );
}
