import type { LucideIcon } from 'lucide-react';

import { GateArt, ZelligeBackdrop } from '@/components/public/catalog/gate-art';
import { cn } from '@/lib/cn';

/**
 * The header band every secondary public page opens with — Méthode, À propos,
 * Tarifs, Parcours, Formateurs, FAQ, Contact, Blog, Certificat, the legal
 * documents.
 *
 * ## Why these pages needed one
 * They used to open on three lines of text against the page background: an
 * eyebrow, a display `<h1>` and a lead. At 1440 px that is a left-aligned
 * paragraph floating in a lot of nothing, and four of them (Contact, Blog, FAQ,
 * Certificat) did not even use the same heading size or column width as the
 * other six — the site read as ten pages written by ten people.
 *
 * The band is the catalogue's header, generalised: a full-bleed surface with
 * the zellige backdrop, a soft pool of light, the content on the shared
 * `max-w-6xl` edge the logo sits on, and the Bab Mansour gate from the homepage
 * with three tiles floating around it. The tiles carry the page's own icons, so
 * the pages are one family without being one picture ten times.
 *
 * ## What it costs
 * Inline SVG and server HTML: no image request, no client JavaScript, a fixed
 * aspect ratio so nothing shifts. The illustration is `aria-hidden` and hidden
 * below `md`, where a phone needs the title above the fold more than it needs a
 * gate; on a phone the page's main icon sits in the eyebrow instead, so the
 * band still says which page this is at a glance.
 *
 * ## Right-to-left
 * Every inset is logical, and the backdrop mirrors itself. The icons are
 * symbolic (a question mark, a medal, a map pin) and are never mirrored —
 * nothing in them points anywhere.
 *
 * ## Where this file lives
 * Under a private `_components` folder of one route because of how the layout
 * audit split ownership; it belongs in `src/components/public/`. Moving it is a
 * pure move — nothing here depends on the route it sits in.
 */

const floatKeyframes = `
@keyframes cfi-page-float {
  0%, 100% { transform: translate3d(0, 0, 0); }
  50%      { transform: translate3d(0, -6px, 0); }
}
.cfi-page-float {
  animation: cfi-page-float 8s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .cfi-page-float { animation: none; }
}
`;

/** The three icons a page's illustration floats around the gate. */
export interface PageArt {
  /** The page's own symbol — large, in the accent colour, and the phone eyebrow's icon. */
  readonly icon: LucideIcon;
  /** Two supporting symbols, in brass. */
  readonly accents: readonly [LucideIcon, LucideIcon];
}

function Tile({
  icon: Icon,
  tone,
  large = false,
  className,
  delay,
}: {
  icon: LucideIcon;
  tone: 'strait' | 'brass';
  large?: boolean;
  className?: string;
  delay: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'cfi-page-float absolute grid place-items-center rounded-md border border-hairline bg-surface/95 shadow-e3 backdrop-blur-sm',
        large ? 'size-14 lg:size-16' : 'size-10 lg:size-12',
        className,
      )}
      style={{ animationDelay: delay }}
    >
      <span
        className={cn(
          'grid place-items-center rounded-sm',
          large ? 'size-10 lg:size-11' : 'size-7 lg:size-8',
          tone === 'strait' ? 'bg-strait-wash text-strait' : 'bg-brass-wash text-brass',
        )}
      >
        <Icon
          className={large ? 'size-5 lg:size-6' : 'size-4 lg:size-[1.125rem]'}
          strokeWidth={1.75}
        />
      </span>
    </span>
  );
}

function PageIllustration({
  id,
  art,
  className,
}: {
  id: string;
  art: PageArt;
  className?: string;
}): React.JSX.Element {
  const [first, second] = art.accents;

  return (
    <div aria-hidden="true" className={cn('relative select-none', className)}>
      <style href="cfi-page-hero" precedence="medium">
        {floatKeyframes}
      </style>
      <div className="relative mx-auto aspect-[16/15] w-full">
        <GateArt id={`${id}-gate`} className="absolute inset-y-0 start-[12.5%] h-full w-3/4" />
        <Tile icon={art.icon} tone="strait" large className="start-[2%] top-[18%]" delay="0s" />
        <Tile icon={first} tone="brass" className="end-[3%] top-[8%]" delay="-2.6s" />
        <Tile icon={second} tone="brass" className="bottom-[14%] end-0" delay="-5.1s" />
      </div>
    </div>
  );
}

export interface PageHeroProps {
  /** Unique on the page: prefixes the illustration's SVG ids. */
  readonly id: string;
  readonly title: string;
  readonly eyebrow?: string | null;
  readonly lead?: string | null;
  readonly art: PageArt;
  /** Rendered above the eyebrow — a breadcrumb trail, typically. */
  readonly before?: React.ReactNode;
  /** Rendered under the lead — key facts, a call to action. */
  readonly children?: React.ReactNode;
  /** `lang`/`dir` of the title and lead when they are not in the page's language. */
  readonly contentLang?: string;
  readonly contentDir?: 'ltr' | 'rtl';
}

export function PageHero({
  id,
  title,
  eyebrow,
  lead,
  art,
  before,
  children,
  contentLang,
  contentDir,
}: PageHeroProps): React.JSX.Element {
  const Icon = art.icon;
  const hasEyebrow = eyebrow !== undefined && eyebrow !== null && eyebrow !== '';

  return (
    <header className="relative isolate overflow-hidden border-b border-hairline bg-surface">
      <ZelligeBackdrop id={`${id}-backdrop`} className="-z-10" />
      {/* A soft pool of light behind the illustration. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-24 -top-24 -z-10 size-[28rem] rounded-pill bg-strait/10 blur-3xl"
      />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 py-10 sm:px-6 sm:py-14 md:grid-cols-[minmax(0,1fr)_14rem] md:gap-10 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-16 lg:py-16">
        <div className="flex min-w-0 flex-col gap-4">
          {before}

          {/* On a phone the illustration is gone, so the page's icon moves up
              here; from `md` the gate carries it and the eyebrow is text. */}
          <p
            className={cn(
              'flex items-center gap-3 font-mono text-xs uppercase tracking-[0.22em] text-strait',
              hasEyebrow ? null : 'md:hidden',
            )}
          >
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-md border border-hairline bg-surface text-strait shadow-e1 md:hidden"
            >
              <Icon className="size-[1.125rem]" strokeWidth={1.75} />
            </span>
            {hasEyebrow ? <span className="min-w-0">{eyebrow}</span> : null}
          </p>

          <h1
            className="max-w-[18ch] text-hero text-balance break-words"
            lang={contentLang}
            dir={contentDir}
          >
            {title}
          </h1>

          {lead === undefined || lead === null || lead === '' ? null : (
            <p
              className="max-w-[60ch] text-lead text-pretty text-ink-muted"
              lang={contentLang}
              dir={contentDir}
            >
              {lead}
            </p>
          )}

          {children === undefined ? null : <div className="mt-2 sm:mt-4">{children}</div>}
        </div>

        <PageIllustration id={id} art={art} className="hidden w-full md:block" />
      </div>
    </header>
  );
}
