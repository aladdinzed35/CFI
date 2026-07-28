import { getTranslations } from 'next-intl/server';
import { Clock, Facebook, Instagram, Linkedin, Mail, MapPin, Phone, Youtube } from 'lucide-react';

import { NewsletterForm } from '@/components/public/newsletter-form';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import type { ChromeCategory, ChromeContact, ChromeSocial, SocialNetwork } from '@/server/services/public-chrome';

/**
 * The public footer (§12.1): four columns, a newsletter row, the bathymetric
 * texture at 3 %, and the legal line.
 *
 * ## Nothing here is hardcoded
 * The address, the opening hours, the phone number, the e-mail, the WhatsApp
 * number and the five social accounts all arrive from `SiteSetting` through the
 * public layout, and the formations column lists **real** `Category` rows in the
 * active locale. A value that is not configured does not render an empty line —
 * it does not render at all. That is the difference between a footer that is
 * being filled in and a footer that looks broken.
 *
 * ## Direction
 * Prices, phone numbers and e-mail addresses stay left-to-right inside Arabic
 * prose (§10.3): both carry `.force-ltr` and an explicit `dir="ltr"`. Everything
 * else uses logical properties and mirrors wholesale.
 *
 * A server component: the only interactive part is the newsletter form, and it
 * is the only thing here that ships JavaScript.
 */

/* -------------------------------------------------------------------------- */
/* Social marks                                                                */
/* -------------------------------------------------------------------------- */

/**
 * TikTok has no mark in `lucide-react` (brand glyphs were removed in v0.4xx),
 * so its path is inlined — the same reasoning, and the same treatment, as the
 * WhatsApp glyph in `components/ui/whatsapp-fab.tsx`.
 */
function TikTokGlyph({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

/** Brand marks are never mirrored in RTL, and their names are never translated. */
const SOCIAL_MARK: Record<SocialNetwork, { readonly name: string; readonly Glyph: (props: { className?: string }) => React.JSX.Element }> = {
  facebook: { name: 'Facebook', Glyph: ({ className }) => <Facebook aria-hidden="true" className={className} /> },
  instagram: { name: 'Instagram', Glyph: ({ className }) => <Instagram aria-hidden="true" className={className} /> },
  linkedin: { name: 'LinkedIn', Glyph: ({ className }) => <Linkedin aria-hidden="true" className={className} /> },
  tiktok: { name: 'TikTok', Glyph: TikTokGlyph },
  youtube: { name: 'YouTube', Glyph: ({ className }) => <Youtube aria-hidden="true" className={className} /> },
};

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

const CATALOG_HREF = '/formations';
/** §12.3 filters the catalogue from the URL. Slugs and parameters stay French. */
const CATEGORY_PARAM = 'categorie';

const USEFUL_ROUTES = [
  { href: '/faq', labelKey: 'faq' },
  { href: '/legal/cgu', labelKey: 'terms' },
  { href: '/legal/confidentialite', labelKey: 'privacy' },
  { href: '/legal/cookies', labelKey: 'cookies' },
  { href: '/certificat', labelKey: 'verifyCertificate' },
] as const;

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

const COLUMN_HEADING = 'font-display text-sm font-medium uppercase tracking-[0.14em] text-ink';
const FOOTER_LINK = cn(
  'inline-flex min-h-11 items-center rounded-sm text-sm text-ink-muted',
  'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-strait',
);

/* -------------------------------------------------------------------------- */
/* Footer                                                                      */
/* -------------------------------------------------------------------------- */

export interface SiteFooterProps {
  /** `SiteSetting['brand.fullName']`. */
  readonly brandFullName: string;
  /** `SiteSetting['brand.tagline.<locale>']`, or `null` when unset. */
  readonly tagline: string | null;
  readonly contact: ChromeContact;
  readonly socials: readonly ChromeSocial[];
  /** Real, active categories, already named in the active locale. */
  readonly categories: readonly ChromeCategory[];
  /** Prefilled, already-translated WhatsApp greeting. */
  readonly whatsappMessage: string;
}

export async function SiteFooter({
  brandFullName,
  tagline,
  contact,
  socials,
  categories,
  whatsappMessage,
}: SiteFooterProps): Promise<React.JSX.Element> {
  const t = await getTranslations();

  const whatsappHref =
    contact.whatsappNumber === null
      ? null
      : `https://wa.me/${contact.whatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`;

  return (
    <footer className="texture-bathymetric hairline-t mt-20 bg-surface print:mt-8">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        {/* ── Newsletter row ────────────────────────────────────────────── */}
        <section className="hairline-b grid gap-6 pb-10 md:grid-cols-2 md:items-start md:gap-12">
          <h2 className="font-display text-title text-balance text-ink">
            {t('footer.newsletter.title')}
          </h2>
          <NewsletterForm />
        </section>

        {/* ── Four columns ──────────────────────────────────────────────── */}
        <div className="grid gap-10 pt-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {/* 1 — About, address, hours */}
          <section>
            <h2 className={COLUMN_HEADING}>{t('footer.about')}</h2>
            <p className="mt-4 text-sm font-medium text-ink">{brandFullName}</p>
            {tagline === null ? null : (
              <p className="mt-2 max-w-prose text-sm text-pretty text-ink-muted">{tagline}</p>
            )}

            {contact.address === null && contact.hours === null ? null : (
              <dl className="mt-5 flex flex-col gap-4">
                {/* One <div> only between <dl> and its <dt>/<dd> — the icon
                    spans both rows instead of forcing a second wrapper. Same
                    note in home/centre.tsx; axe flagged both as `dlitem`. */}
                {contact.address === null ? null : (
                  <div className="grid grid-cols-[auto_1fr] items-start gap-x-2.5">
                    <MapPin aria-hidden="true" className="row-span-2 mt-0.5 size-4 shrink-0 text-ink-muted" />
                    <dt className="text-xs uppercase tracking-[0.12em] text-ink-muted">
                      {t('footer.address')}
                    </dt>
                    <dd className="mt-1 text-sm text-pretty text-ink">{contact.address}</dd>
                  </div>
                )}
                {contact.hours === null ? null : (
                  <div className="grid grid-cols-[auto_1fr] items-start gap-x-2.5">
                    <Clock aria-hidden="true" className="row-span-2 mt-0.5 size-4 shrink-0 text-ink-muted" />
                    <dt className="text-xs uppercase tracking-[0.12em] text-ink-muted">
                      {t('footer.hours')}
                    </dt>
                    <dd className="mt-1 text-sm text-ink">{contact.hours}</dd>
                  </div>
                )}
              </dl>
            )}
          </section>

          {/* 2 — Formations, by real category */}
          <nav aria-labelledby="footer-formations">
            <h2 id="footer-formations" className={COLUMN_HEADING}>
              {t('nav.formations')}
            </h2>
            <ul className="mt-2 flex flex-col">
              {categories.map((category) => (
                <li key={category.slug}>
                  <Link
                    href={`${CATALOG_HREF}?${CATEGORY_PARAM}=${encodeURIComponent(category.slug)}`}
                    className={FOOTER_LINK}
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link href={CATALOG_HREF} className={cn(FOOTER_LINK, 'font-medium text-ink')}>
                  {t('common.seeAll')}
                </Link>
              </li>
            </ul>
          </nav>

          {/* 3 — Useful links */}
          <nav aria-labelledby="footer-useful">
            <h2 id="footer-useful" className={COLUMN_HEADING}>
              {t('footer.usefulLinks')}
            </h2>
            <ul className="mt-2 flex flex-col">
              {USEFUL_ROUTES.map((route) => (
                <li key={route.href}>
                  <Link href={route.href} className={FOOTER_LINK}>
                    {t(`footer.${route.labelKey}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* 4 — Contact */}
          <section>
            <h2 className={COLUMN_HEADING}>{t('footer.contactUs')}</h2>
            <ul className="mt-2 flex flex-col">
              {contact.phoneE164 === null || contact.phoneDisplay === null ? null : (
                <li>
                  <a href={`tel:${contact.phoneE164}`} className={FOOTER_LINK}>
                    <Phone aria-hidden="true" className="me-2 size-4 shrink-0" />
                    {/* A phone number reads left-to-right in every locale. */}
                    <span className="force-ltr" dir="ltr">
                      {contact.phoneDisplay}
                    </span>
                  </a>
                </li>
              )}
              {contact.email === null ? null : (
                <li>
                  <a href={`mailto:${contact.email}`} className={FOOTER_LINK}>
                    <Mail aria-hidden="true" className="me-2 size-4 shrink-0" />
                    <span className="force-ltr" dir="ltr">
                      {contact.email}
                    </span>
                  </a>
                </li>
              )}
              {whatsappHref === null ? null : (
                <li>
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={FOOTER_LINK}
                  >
                    {t('whatsapp.fabLabel')}
                    <span className="sr-only"> ({t('a11y.newWindow')})</span>
                  </a>
                </li>
              )}
            </ul>

            {socials.length === 0 ? null : (
              <>
                <h3 className="mt-6 text-xs uppercase tracking-[0.12em] text-ink-muted">
                  {t('footer.followUs')}
                </h3>
                <ul className="mt-2 flex flex-wrap items-center gap-1">
                  {socials.map((social) => {
                    const mark = SOCIAL_MARK[social.network];

                    return (
                      <li key={social.network}>
                        <a
                          href={social.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            'inline-flex size-11 items-center justify-center rounded-pill text-ink-muted',
                            'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                            'hover:bg-raised hover:text-strait',
                          )}
                        >
                          <mark.Glyph className="size-5" />
                          <span className="sr-only">
                            {mark.name} ({t('a11y.newWindow')})
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        </div>

        {/* ── Legal line ────────────────────────────────────────────────── */}
        <p className="hairline-t mt-10 pt-6 text-xs text-ink-muted">{t('footer.rights')}</p>
      </div>
    </footer>
  );
}
