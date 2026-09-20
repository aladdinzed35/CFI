'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { LocaleSwitcher } from '@/components/ui/locale-switcher';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { MobileNav, type PublicNavItem } from '@/components/public/mobile-nav';
import { cn } from '@/lib/cn';
import { Link, usePathname } from '@/i18n/navigation';

/**
 * The public header (§12.1) — the most-seen component in the product.
 *
 * Sticky, and **transparent until the page has scrolled 24 px**, at which point
 * it becomes translucent: `.surface-blur` (a 72 % abyss wash plus a 14 px
 * backdrop blur) and a hairline bottom border. Over the homepage lattice that
 * means the hero is uninterrupted at rest and the header separates itself the
 * instant content starts sliding under it.
 *
 * ## The look
 * Three brand cues, all drawn, none of them an image request:
 * - a hairline **thread** along the top edge, strait → brass → strait. It is
 *   symmetric, so it needs no mirroring in Arabic;
 * - the **lockup**: the zellige star on a tinted tile, the brand name, and —
 *   between `sm` and `xl`, where the row has room for it — the centre's full
 *   name under it. From `xl` the six links need that room (the content edge is
 *   capped at `max-w-6xl`, 1 104 px of row whatever the screen), and a name cut
 *   to « Centre de Forma… » is worse than none. The star turns an eighth of a
 *   turn on hover, which leaves an eight-point star looking exactly as it did:
 *   movement without a change of meaning;
 * - the navigation sits in a **capsule**, and every control on the row is a
 *   pill, so the header reads as one family of shapes.
 *
 * ## Why the navigation starts at `xl`, not `lg`
 * Measured with the real fonts: the six links, the language and theme controls
 * and the two account buttons need ≈1 000 px in French and ≈1 050 px in Spanish,
 * and at 1 024 px the row has 976 px to give. The links were being squeezed until
 * « Notre méthode » broke onto two lines inside a 44 px pill. Between `lg` and
 * `xl` the header therefore keeps the two account buttons in view and moves the
 * six links behind the menu button, which opens as a side sheet at that width.
 * From 1 280 px up the row is 1 104 px (the shared `max-w-6xl` edge) and the
 * longest locale, Spanish, needs ≈1 070 px of it.
 *
 * ## Why this is a client component
 * The scroll threshold, the locale menu, the theme toggle and the mobile sheet
 * are all interactive. What is *not* here is data: the brand strings are
 * resolved on the server by the public layout and arrive as props, so no page
 * pays for a database read on the client.
 *
 * ## The account slot reads no session, on either side
 * All three variants — the guest pair, the student link, the admin link — are
 * in the markup, and CSS reveals one from the `data-chrome` attribute that
 * `ThemeScript` writes before the first paint. Nothing is conditional at render
 * time, which is precisely what lets every public page be prerendered: the
 * layout above used to call `getCurrentUser()` for this one element and made
 * the whole marketing site dynamic and uncacheable.
 *
 * Doing it with state and an effect instead would have been a flash of the
 * wrong call to action, plus a layout shift when it corrected itself.
 *
 * ## Right-to-left
 * Every inset is logical (`ms-auto`, `ps-`, `pe-`), so the header mirrors
 * wholesale in Arabic. The one thing that must *not* mirror is the brand mark,
 * and it does not: an eight-point zellige star is its own mirror image, and it
 * carries no `rtl:` class in any case (§10.3).
 */

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The six public sections of §12.1, in the order the spec lists them. Slugs stay
 * French in every locale (§10.1), so the paths are literal and shared.
 */
const NAV_ROUTES = [
  { href: '/formations', labelKey: 'formations' },
  { href: '/parcours', labelKey: 'parcours' },
  { href: '/notre-methode', labelKey: 'method' },
  { href: '/tarifs', labelKey: 'pricing' },
  { href: '/blog', labelKey: 'blog' },
  { href: '/contact', labelKey: 'contact' },
] as const;

const SIGN_IN_HREF = '/connexion';
const REGISTER_HREF = '/inscription';

/**
 * Where each signed-in variant points. Literal, because the session is no
 * longer read to build them.
 *
 * `/espace` is right for every non-admin account regardless of status: it
 * re-routes an unconfirmed e-mail or a pending approval to the screen that
 * explains the wait (§9.1), so one link serves all of them.
 */
const STUDENT_HREF = '/espace';
const ADMIN_HREF = '/admin';

/** Scroll distance after which the header stops being transparent (§12.1). */
const TRANSLUCENT_AFTER_PX = 24;

/* -------------------------------------------------------------------------- */
/* Brand                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The zellige eight-point star: two squares, one rotated 45°, around a small
 * brass star — the same two-glaze pairing as the tiles in the hero's gate.
 */
function BrandMark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none">
      <g stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round">
        <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="1" />
        <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="1" transform="rotate(45 12 12)" />
      </g>
      <g className="fill-brass">
        <rect x="9.6" y="9.6" width="4.8" height="4.8" rx="0.4" />
        <rect x="9.6" y="9.6" width="4.8" height="4.8" rx="0.4" transform="rotate(45 12 12)" />
      </g>
    </svg>
  );
}

/**
 * The line under the brand name: the full name without the short name it
 * starts with, so « CFI — Centre de Formation Immersive » becomes « Centre de
 * Formation Immersive ». `null` when there is nothing left to say.
 */
function brandCaption(brandName: string, brandFullName: string): string | null {
  const full = brandFullName.trim();
  const rest = full.startsWith(brandName)
    ? full.slice(brandName.length).replace(/^[\s—–\-:·|,]+/u, '').trim()
    : full;
  return rest.length === 0 || rest === brandName ? null : rest;
}

/* -------------------------------------------------------------------------- */
/* Header                                                                      */
/* -------------------------------------------------------------------------- */

export interface SiteHeaderProps {
  /** `SiteSetting['brand.name']`, e.g. « CFI ». */
  readonly brandName: string;
  /** `SiteSetting['brand.fullName']` — the accessible name of the home link. */
  readonly brandFullName: string;
}

/** `true` when `href` is the current page or one of its descendants. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Every control on the row is a pill: the account buttons follow suit. */
const ACCOUNT_BUTTON = 'rounded-pill';

export function SiteHeader({
  brandName,
  brandFullName,
}: SiteHeaderProps): React.JSX.Element {
  const t = useTranslations();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  // Mirrors `scrolled` without re-reading state inside the listener, so a scroll
  // event only reaches React on the two frames where the threshold is crossed.
  const scrolledRef = useRef(false);

  useEffect(() => {
    const read = (): void => {
      const next = window.scrollY > TRANSLUCENT_AFTER_PX;
      if (next === scrolledRef.current) return;
      scrolledRef.current = next;
      setScrolled(next);
    };

    // A reload restores the previous scroll position before this runs.
    read();
    window.addEventListener('scroll', read, { passive: true });
    return () => window.removeEventListener('scroll', read);
  }, []);

  const items: readonly PublicNavItem[] = NAV_ROUTES.map((route) => ({
    href: route.href,
    label: t(`nav.${route.labelKey}`),
  }));

  const caption = brandCaption(brandName, brandFullName);

  return (
    <header
      className={cn(
        'sticky top-0 z-30 w-full print:static',
        'transition-[background-color,border-color,box-shadow,backdrop-filter] duration-200 ease-[var(--ease-out-strait)]',
        scrolled ? 'surface-blur hairline-b shadow-e1' : 'border-b border-transparent bg-transparent',
      )}
    >
      {/* The thread: strait → brass → strait, symmetric so it never mirrors. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-[linear-gradient(90deg,transparent,var(--color-strait)_22%,var(--color-brass)_50%,var(--color-strait)_78%,transparent)] opacity-80 print:hidden"
      />

      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6 lg:h-20">
        <Link
          href="/"
          aria-label={brandFullName}
          className="group flex min-w-0 items-center gap-2.5 rounded-md py-1"
        >
          {/* A logo is never mirrored (§10.3). */}
          <span
            aria-hidden="true"
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-md border border-strait/25 bg-strait-wash text-strait',
              'shadow-e1 transition-[border-color,box-shadow] duration-200 ease-[var(--ease-out-strait)]',
              'group-hover:border-strait/50 group-hover:shadow-e2',
            )}
          >
            <BrandMark className="size-6 transition-transform duration-500 ease-[var(--ease-out-strait)] group-hover:rotate-45" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-display text-heading leading-none tracking-tight text-ink">
              {brandName}
            </span>
            {caption === null ? null : (
              <span className="mt-1 hidden truncate text-[0.6875rem] font-medium leading-tight tracking-wide text-ink-muted rtl:tracking-normal sm:block xl:hidden">
                {caption}
              </span>
            )}
          </span>
        </Link>

        <nav aria-label={t('a11y.mainNavigation')} className="mx-auto hidden xl:block">
          <ul className="flex items-center gap-0.5 rounded-pill border border-hairline bg-surface/70 p-1 shadow-e1">
            {items.map((item) => {
              const current = isActive(pathname, item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'inline-flex h-10 items-center whitespace-nowrap rounded-pill px-3 text-sm font-medium',
                      'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                      current
                        ? 'bg-strait-wash text-strait'
                        : 'text-ink-muted hover:bg-raised hover:text-ink',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-2 xl:ms-0">
          {/* Both controls stay visible at every width. §12.1 describes the
              mobile header as "logo + hamburger", but that sentence is about the
              *navigation*: burying the language switcher two taps deep on a
              four-locale Moroccan site would cost more than the 108 px it
              occupies, and at 360 px the row still measures under 300 px. */}
          <LocaleSwitcher label={t('locale.switchLanguage')} />
          <ThemeToggle
            switchToLightLabel={t('landing.switchToLight')}
            switchToDarkLabel={t('landing.switchToDark')}
            lightEnabledMessage={t('theme.light')}
            darkEnabledMessage={t('theme.dark')}
          />

          {/* All three variants, one revealed by CSS from `data-chrome`. The
              slot owns the responsive rule; the variants are `display: contents`
              so switching never changes the box that rule applies to. Shown
              from `lg`, one step before the links: a tablet in landscape keeps
              its two account buttons in reach. */}
          <div className="ms-1 hidden items-center gap-2 lg:flex">
            <span className="cfi-chrome-guest">
              <Button asChild variant="ghost" size="sm" className={ACCOUNT_BUTTON}>
                <Link href={SIGN_IN_HREF}>{t('nav.login')}</Link>
              </Button>
              <Button asChild variant="primary" size="sm" className={cn(ACCOUNT_BUTTON, 'px-4')}>
                <Link href={REGISTER_HREF}>{t('nav.register')}</Link>
              </Button>
            </span>
            <span className="cfi-chrome-student">
              <Button asChild variant="primary" size="sm" className={cn(ACCOUNT_BUTTON, 'px-4')}>
                <Link href={STUDENT_HREF}>{t('nav.dashboard')}</Link>
              </Button>
            </span>
            <span className="cfi-chrome-admin">
              <Button asChild variant="primary" size="sm" className={cn(ACCOUNT_BUTTON, 'px-4')}>
                <Link href={ADMIN_HREF}>{t('nav.admin')}</Link>
              </Button>
            </span>
          </div>

          <MobileNav
            className="xl:hidden"
            items={items}
            openLabel={t('a11y.openMenu')}
            closeLabel={t('a11y.closeMenu')}
            navLabel={t('a11y.mainNavigation')}
            title={brandName}
            caption={caption ?? undefined}
            mark={<BrandMark className="size-6" />}
            studentLabel={t('nav.dashboard')}
            studentHref={STUDENT_HREF}
            adminLabel={t('nav.admin')}
            adminHref={ADMIN_HREF}
            signInLabel={t('nav.login')}
            signInHref={SIGN_IN_HREF}
            registerLabel={t('nav.register')}
            registerHref={REGISTER_HREF}
          />
        </div>
      </div>
    </header>
  );
}
