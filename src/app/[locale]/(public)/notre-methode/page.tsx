import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { getInstructors } from '@/server/services/public-pages';
import { getPublicChrome } from '@/server/services/public-chrome';
import { buildMetadata } from '@/lib/seo';
import { Link } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';

/**
 * `/[locale]/notre-methode` — the full argument (§12.5).
 *
 * §12.2 #2 is the *summary*: four tiles, two lines each, on the homepage. This
 * page is the argument itself, so it never repeats those sentences. Each
 * principle gains a concrete commitment (« proof ») that a visitor can hold us
 * to; the journey section says what actually happens week by week; and the
 * comparison band answers the question every online catalogue dodges — why pay
 * for this when the videos are free.
 *
 * ## The lattice marks the sections
 *
 * §11.2 restricts the tessellation to three places, but the *motif* — the {8/2}
 * octagram built from two squares at 45° — is the identity's section mark. It is
 * drawn once at module scope and stamped before every `h2`, `aria-hidden`, so it
 * carries no meaning and costs no request: one inline polygon, no icon font, no
 * client JavaScript.
 *
 * ## Everything about people is real
 *
 * The team block is `User` rows with published courses, read through
 * `getInstructors`. When nobody qualifies, the block does not render — an
 * « équipe pédagogique » heading over an empty row is a worse signal than
 * silence. The accreditations block says plainly that there is nothing to show
 * yet rather than inventing a label.
 */

/* -------------------------------------------------------------------------- */
/* The lattice section mark                                                    */
/* -------------------------------------------------------------------------- */

/** The octagram, constructed exactly as in `ui/lattice-grid.tsx`, on a 0…24 box. */
const STAR_POINTS = ((): string => {
  const radius = 11;
  const centre = 12;
  const inner = radius * Math.SQRT1_2;
  const notch = radius - inner;

  const quarter: readonly (readonly [number, number])[] = [
    [radius, 0],
    [inner, notch],
    [inner, inner],
    [notch, inner],
  ];

  const points: string[] = [];
  for (let turn = 0; turn < 4; turn += 1) {
    for (const [qx, qy] of quarter) {
      let x = qx;
      let y = qy;
      for (let step = 0; step < turn; step += 1) {
        const rotated = -y;
        y = x;
        x = rotated;
      }
      points.push(
        `${Math.round((centre + x) * 100) / 100},${Math.round((centre + y) * 100) / 100}`,
      );
    }
  }
  return points.join(' ');
})();

/**
 * An eight-point star is its own mirror image, so it never carries an `rtl:`
 * class: it is identical in French and in Arabic (§10.3).
 */
function LatticeMark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.15"
      strokeLinejoin="round"
    >
      <polygon points={STAR_POINTS} />
      <polygon
        points={STAR_POINTS}
        transform="rotate(22.5 12 12) scale(0.52) translate(11.08 11.08)"
        fill="currentColor"
        fillOpacity="0.2"
        stroke="none"
      />
    </svg>
  );
}

function SectionHeading({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <h2 id={id} className="flex items-start gap-3 text-display">
      <LatticeMark className="mt-[0.35em] size-[0.5em] shrink-0 text-strait" />
      <span className="min-w-0 text-balance">{children}</span>
    </h2>
  );
}

/* -------------------------------------------------------------------------- */
/* Content vocabularies                                                        */
/* -------------------------------------------------------------------------- */

const PRINCIPLES = ['situation', 'projects', 'coaching', 'hybrid'] as const;
const JOURNEY = ['step1', 'step2', 'step3', 'step4'] as const;
const COMPARISON = ['order', 'feedback', 'regularity', 'proof'] as const;
const FACILITIES = ['rooms', 'equipment', 'workspace', 'reception'] as const;

/** How many faces the team preview shows before deferring to `/formateurs`. */
const TEAM_PREVIEW = 4;

/* -------------------------------------------------------------------------- */
/* Route                                                                       */
/* -------------------------------------------------------------------------- */

type LocaleParams = { locale: string };

export function generateStaticParams(): LocaleParams[] {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'seo.method' });
  return buildMetadata({
    locale,
    path: '/notre-methode',
    title: t('title'),
    description: t('description'),
  });
}

export default async function MethodPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [t, tInstructors, tContact, tWhatsapp, chrome, instructors] = await Promise.all([
    getTranslations({ locale, namespace: 'pages.method' }),
    getTranslations({ locale, namespace: 'pages.instructors' }),
    getTranslations({ locale, namespace: 'pages.contact' }),
    getTranslations({ locale, namespace: 'whatsapp' }),
    getPublicChrome(locale),
    getInstructors(locale),
  ]);

  const team = instructors.slice(0, TEAM_PREVIEW);

  const whatsappHref =
    chrome.contact.whatsappNumber === null
      ? null
      : `https://wa.me/${chrome.contact.whatsappNumber}?text=${encodeURIComponent(
          tWhatsapp('prefillGeneric'),
        )}`;

  return (
    <>
      {/* ------------------------------------------------------------ header */}
      <header className="mx-auto w-full max-w-6xl px-4 pb-4 pt-12 sm:px-6 sm:pb-8 sm:pt-20">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">{t('eyebrow')}</p>
        <h1 className="mt-4 max-w-[18ch] text-hero text-balance">{t('title')}</h1>
        <p className="mt-6 max-w-[62ch] text-lead text-pretty text-ink-muted">{t('lead')}</p>
      </header>

      {/* -------------------------------------------------------- principles */}
      <section
        aria-labelledby="method-principles"
        className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20"
      >
        <SectionHeading id="method-principles">{t('principlesTitle')}</SectionHeading>
        <p className="mt-5 max-w-[62ch] text-lead text-pretty text-ink-muted">
          {t('principlesLead')}
        </p>

        <ul
          role="list"
          className="mt-10 grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-2"
        >
          {PRINCIPLES.map((principle) => (
            <li key={principle} className="flex flex-col gap-4 bg-surface p-6 sm:p-8">
              <h3 className="text-heading font-medium text-ink text-balance">
                {t(`principles.${principle}.title`)}
              </h3>
              <p className="text-body text-pretty text-ink-muted">
                {t(`principles.${principle}.body`)}
              </p>
              <p className="mt-auto flex items-start gap-2.5 border-t border-hairline pt-4 text-sm text-ink">
                <Check className="mt-0.5 size-4 shrink-0 text-strait" aria-hidden="true" />
                <span className="text-pretty">{t(`principles.${principle}.proof`)}</span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ----------------------------------------------------------- journey */}
      <section aria-labelledby="method-journey" className="border-y border-hairline bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <SectionHeading id="method-journey">{t('journeyTitle')}</SectionHeading>
          <p className="mt-5 max-w-[62ch] text-lead text-pretty text-ink-muted">
            {t('journeyLead')}
          </p>

          {/* A sequence, so it is numbered — and the rail runs on the block
              axis, which behaves identically at 360 px and in Arabic. */}
          <ol role="list" className="mt-10 flex flex-col">
            {JOURNEY.map((step, index) => (
              <li key={step} className="relative flex gap-4 pb-8 last:pb-0 sm:gap-6">
                {index === JOURNEY.length - 1 ? null : (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 start-[1.375rem] top-12 w-px bg-hairline"
                  />
                )}
                <span
                  aria-hidden="true"
                  data-numeric
                  className="relative z-10 inline-flex size-11 shrink-0 items-center justify-center rounded-pill border border-hairline bg-abyss text-sm text-strait"
                >
                  {`0${index + 1}`}
                </span>
                <div className="min-w-0 pt-1.5">
                  <h3 className="text-heading font-medium text-ink text-balance">
                    {t(`journey.${step}.title`)}
                  </h3>
                  <p className="mt-2 max-w-[62ch] text-body text-pretty text-ink-muted">
                    {t(`journey.${step}.body`)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* -------------------------------------------------------- comparison */}
      <section
        aria-labelledby="method-comparison"
        className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20"
      >
        <SectionHeading id="method-comparison">{t('comparisonTitle')}</SectionHeading>
        <p className="mt-5 max-w-[62ch] text-lead text-pretty text-ink-muted">
          {t('comparisonLead')}
        </p>

        {/* Two columns of prose rather than a table: at 360 px a two-column
            comparison table either overflows or truncates, and the rows here
            are sentences, not data. */}
        <ul role="list" className="mt-10 flex flex-col gap-4">
          {COMPARISON.map((row) => (
            <li key={row} className="rounded-lg border border-hairline bg-surface p-6 sm:p-8">
              <h3 className="text-heading font-medium text-ink text-balance">
                {t(`comparison.${row}.aspect`)}
              </h3>
              <dl className="mt-5 grid gap-5 sm:grid-cols-2 sm:gap-8">
                <div>
                  <dt className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
                    {t('comparisonAloneLabel')}
                  </dt>
                  <dd className="mt-2 text-body text-pretty text-ink-muted">
                    {t(`comparison.${row}.alone`)}
                  </dd>
                </div>
                <div className="border-t border-hairline pt-5 sm:border-s sm:border-t-0 sm:ps-8 sm:pt-0">
                  <dt className="font-mono text-xs uppercase tracking-[0.18em] text-strait">
                    {t('comparisonCentreLabel')}
                  </dt>
                  <dd className="mt-2 text-body text-pretty text-ink">
                    {t(`comparison.${row}.centre`)}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      {/* -------------------------------------------------------- facilities */}
      <section aria-labelledby="method-facilities" className="border-y border-hairline bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <SectionHeading id="method-facilities">{t('facilitiesTitle')}</SectionHeading>
          <p className="mt-5 max-w-[62ch] text-lead text-pretty text-ink-muted">
            {t('facilitiesLead')}
          </p>

          <ul role="list" className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FACILITIES.map((facility) => (
              <li key={facility} className="rounded-lg border border-hairline bg-abyss p-6">
                <h3 className="text-body font-medium text-ink">{t(`facilities.${facility}.title`)}</h3>
                <p className="mt-3 text-sm text-pretty text-ink-muted">
                  {t(`facilities.${facility}.body`)}
                </p>
              </li>
            ))}
          </ul>

          {/* The address and the hours are `SiteSetting` rows, never hardcoded
              (§12.1). A missing one simply does not render its line. */}
          {chrome.contact.address === null && chrome.contact.hours === null ? null : (
            <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-3 text-sm">
              {chrome.contact.address === null ? null : (
                <div className="flex flex-wrap items-baseline gap-2">
                  <dt className="text-ink-muted">{tContact('addressLabel')}</dt>
                  <dd className="text-ink">{chrome.contact.address}</dd>
                </div>
              )}
              {chrome.contact.hours === null ? null : (
                <div className="flex flex-wrap items-baseline gap-2">
                  <dt className="text-ink-muted">{tContact('hoursLabel')}</dt>
                  <dd className="text-ink">{chrome.contact.hours}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </section>

      {/* -------------------------------------------------------------- team */}
      {team.length === 0 ? null : (
        <section
          aria-labelledby="method-team"
          className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20"
        >
          <SectionHeading id="method-team">{t('teamTitle')}</SectionHeading>
          <p className="mt-5 max-w-[62ch] text-lead text-pretty text-ink-muted">{t('teamLead')}</p>

          <ul role="list" className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {team.map((instructor) => (
              <li
                key={instructor.id}
                className="flex flex-col items-start rounded-lg border border-hairline bg-surface p-6"
              >
                <Avatar name={instructor.fullName} src={instructor.avatarUrl} size="xl" />
                <h3 className="mt-5 text-body font-medium text-ink">{instructor.fullName}</h3>
                {instructor.headline === null ? null : (
                  <p className="mt-2 text-sm text-pretty text-ink-muted">{instructor.headline}</p>
                )}
                <div className="mt-auto pt-5">
                  <Badge tone="neutral" variant="outline">
                    {tInstructors('courseCount', { count: instructor.courseCount })}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-8">
            <Link
              href="/formateurs"
              className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-hairline px-5 text-sm font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none"
            >
              {t('teamCta')}
              <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------- accreditations */}
      <section
        aria-labelledby="method-accreditations"
        className="mx-auto w-full max-w-6xl px-4 pb-14 sm:px-6 sm:pb-20"
      >
        <SectionHeading id="method-accreditations">{t('accreditationsTitle')}</SectionHeading>
        <p className="mt-5 flex max-w-[62ch] items-start gap-3 rounded-lg border border-hairline bg-surface p-6 text-body text-pretty text-ink-muted">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ink-muted" aria-hidden="true" />
          <span>{t('accreditationsEmpty')}</span>
        </p>
      </section>

      {/* --------------------------------------------------------------- cta */}
      <section aria-labelledby="method-cta" className="texture-bathymetric hairline-t">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
          <h2 id="method-cta" className="max-w-2xl text-title text-balance">
            {t('ctaTitle')}
          </h2>
          <p className="max-w-xl text-lead text-pretty text-ink-muted">{t('ctaBody')}</p>

          <div className="mt-2 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            {whatsappHref === null ? null : (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-strait px-6 text-body font-medium text-on-accent shadow-e1 transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-strait/90 motion-reduce:transition-none"
              >
                {t('ctaAction')}
              </a>
            )}

            <Link
              href="/formations"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-hairline bg-raised px-6 text-body font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-surface motion-reduce:transition-none"
            >
              {t('ctaSecondary')}
              <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
