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

/** The zellige eight-point star: two squares, one rotated 45°. */
function BrandMark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
    >
      <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="1" />
      <rect x="4.4" y="4.4" width="15.2" height="15.2" rx="1" transform="rotate(45 12 12)" />
    </svg>
  );
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

  return (
    <header
      className={cn(
        'sticky top-0 z-30 w-full print:static',
        'transition-[background-color,border-color,backdrop-filter] duration-200 ease-[var(--ease-out-strait)]',
        scrolled ? 'surface-blur hairline-b' : 'border-b border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:h-20 lg:px-8">
        <Link
          href="/"
          aria-label={brandFullName}
          className="inline-flex shrink-0 items-center gap-2.5 rounded-md py-1"
        >
          {/* A logo is never mirrored (§10.3). */}
          <BrandMark className="size-7 shrink-0 text-strait lg:size-8" />
          <span className="font-display text-heading tracking-tight text-ink">{brandName}</span>
        </Link>

        <nav aria-label={t('a11y.mainNavigation')} className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {items.map((item) => {
              const current = isActive(pathname, item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'inline-flex h-11 items-center rounded-md px-3 text-sm font-medium',
                      'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                      current ? 'bg-strait-wash text-ink' : 'text-ink-muted hover:bg-raised hover:text-ink',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-2">
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
              so switching never changes the box that rule applies to. */}
          <div className="hidden items-center gap-2 lg:flex">
            <span className="cfi-chrome-guest">
              <Button asChild variant="ghost" size="sm">
                <Link href={SIGN_IN_HREF}>{t('nav.login')}</Link>
              </Button>
              <Button asChild variant="primary" size="sm">
                <Link href={REGISTER_HREF}>{t('nav.register')}</Link>
              </Button>
            </span>
            <span className="cfi-chrome-student">
              <Button asChild variant="primary" size="sm">
                <Link href={STUDENT_HREF}>{t('nav.dashboard')}</Link>
              </Button>
            </span>
            <span className="cfi-chrome-admin">
              <Button asChild variant="primary" size="sm">
                <Link href={ADMIN_HREF}>{t('nav.admin')}</Link>
              </Button>
            </span>
          </div>

          <MobileNav
            className="lg:hidden"
            items={items}
            openLabel={t('a11y.openMenu')}
            closeLabel={t('a11y.closeMenu')}
            navLabel={t('a11y.mainNavigation')}
            title={brandName}
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
