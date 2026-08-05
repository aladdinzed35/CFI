import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { AUTH_ROUTES } from '@/server/auth';
import { ROUTES } from '@/server/auth/route-policy';
import type { Locale } from '@/i18n/routing';

/**
 * §12.2 #11 — the closing band, over the bathymetric texture.
 *
 * Two actions, and they are deliberately of different weight: registering is
 * the primary path, and WhatsApp is for the person who still has a question.
 * §12.1 already puts a WhatsApp button on every page, so this repeats it only
 * because the end of a long scroll is where an undecided visitor gives up.
 *
 * Renders for everyone. A signed-in visitor reaching the bottom of the homepage
 * is browsing, not registering, so the primary CTA points at their space rather
 * than at a registration form they have already completed.
 */

export interface HomeFinalCtaProps {
  locale: Locale;
  whatsappUrl: string | null;
}

export async function HomeFinalCta({
  locale,
  whatsappUrl,
}: HomeFinalCtaProps): Promise<React.JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'home.finalCta' });
  const tNav = await getTranslations({ locale, namespace: 'publicNav' });

  return (
    <section className="texture-bathymetric hairline-t">
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6 sm:py-28">
        <h2 className="max-w-2xl text-title text-balance">{t('title')}</h2>
        <p className="max-w-xl text-lead text-pretty text-ink-muted">{t('body')}</p>

        <div className="mt-2 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          {/* Both variants ship; CSS reveals one from `data-chrome`, written
              before the first paint. Reading the session here would make the
              homepage dynamic — see `src/styles/globals.css`. */}
          <span className="cfi-chrome-guest">
            <Button asChild size="lg" iconEnd={<ArrowRight className="size-4 rtl:-scale-x-100" />}>
              <Link href={ROUTES.register}>{t('primary')}</Link>
            </Button>
          </span>
          <span className="cfi-chrome-account">
            <Button asChild size="lg" iconEnd={<ArrowRight className="size-4 rtl:-scale-x-100" />}>
              <Link href={AUTH_ROUTES.home}>{tNav('dashboard')}</Link>
            </Button>
          </span>

          {whatsappUrl === null ? null : (
            <Button asChild variant="secondary" size="lg">
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                {t('secondary')}
              </a>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
