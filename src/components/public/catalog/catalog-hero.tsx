import { CatalogGateArt, ZelligeBackdrop } from '@/components/public/catalog/gate-art';

/**
 * The catalogue's header band (§12.3): who we are, what this page is, and the
 * search field — the one thing most visitors came here to use.
 *
 * A full-bleed band whose content sits on the site's shared edge
 * (`max-w-6xl px-4 sm:px-6`), so the title lines up with the logo above it and
 * the filters below it. The illustration appears from `md`, where there is a
 * column for it; on a phone the band stays compact so the first results are on
 * the first screen, and the zellige field alone carries the mood.
 */

export interface CatalogHeroProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle: string;
  /** The search form. Omitted on an empty catalogue, where there is nothing to search. */
  readonly children?: React.ReactNode;
}

export function CatalogHero({
  eyebrow,
  title,
  subtitle,
  children,
}: CatalogHeroProps): React.JSX.Element {
  return (
    <section
      aria-labelledby="catalogue-titre"
      className="relative isolate overflow-hidden border-b border-hairline bg-surface"
    >
      <ZelligeBackdrop id="cfi-catalog-backdrop" className="-z-10" />
      {/* A soft pool of light behind the illustration. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-24 -top-24 -z-10 size-[28rem] rounded-pill bg-strait/10 blur-3xl"
      />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 py-8 sm:px-6 sm:py-12 md:grid-cols-[minmax(0,1fr)_15rem] md:gap-10 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-16 lg:py-14">
        <div className="flex min-w-0 flex-col">
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-strait sm:text-xs sm:tracking-[0.2em] rtl:font-arabic rtl:text-sm rtl:tracking-normal">
            {eyebrow}
          </p>
          <h1
            id="catalogue-titre"
            className="mt-3 text-[clamp(2.25rem,1.4rem+3vw,3.5rem)] leading-[1.05] font-medium tracking-[-0.02em] text-balance break-words rtl:tracking-normal"
          >
            {title}
          </h1>
          <p className="mt-4 max-w-[52ch] text-lead text-pretty text-ink-muted">{subtitle}</p>

          {children === undefined ? null : <div className="mt-6 max-w-2xl sm:mt-8">{children}</div>}
        </div>

        <CatalogGateArt className="hidden w-full md:block" />
      </div>
    </section>
  );
}
