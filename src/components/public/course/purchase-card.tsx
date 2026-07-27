import { getTranslations } from 'next-intl/server';
import { Award, Check, Clock, Infinity as InfinityIcon, Users } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PriceTag } from '@/components/ui/price-tag';
import { Link } from '@/i18n/navigation';
import { formatDuration } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import type { Locale } from '@/i18n/routing';
import type { CourseDetail } from '@/server/services/catalog/course-detail';

import type { EnrollCta } from '@/server/services/catalog/enroll-cta';

/**
 * The sticky purchase card (§12.4), and the mobile bar that replaces it.
 *
 * One component renders both: below `lg` the card becomes a fixed bottom bar
 * showing price and CTA, which is the only part a phone visitor needs within
 * thumb reach. Two components would drift, and the state-aware CTA is exactly
 * the thing that must not.
 *
 * Everything shown is conditional on the data existing: the seats indicator
 * appears only when `maxSeats` is set, the certificate line only when the
 * course actually issues one. §12.4 lists them as possible, not mandatory, and
 * a "certificat inclus" on a course with no certificate is a promise the
 * platform cannot keep.
 */

export interface PurchaseCardProps {
  locale: Locale;
  course: CourseDetail;
  cta: EnrollCta;
}

export async function PurchaseCard({
  locale,
  course,
  cta,
}: PurchaseCardProps): Promise<React.JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'course' });

  const price = formatMoney(course.priceCentimes, locale);
  const label = t(`cta.${cta.kind}`, { price });

  const button =
    cta.href === null ? (
      <Button size="lg" fullWidth disabled={!cta.actionable}>
        {label}
      </Button>
    ) : (
      <Button asChild size="lg" fullWidth>
        <Link href={cta.href}>{label}</Link>
      </Button>
    );

  const includes: ReadonlyArray<{ key: string; icon: React.ElementType; text: string }> = [
    {
      key: 'duration',
      icon: Clock,
      text: t('purchase.included.duration', { duration: formatDuration(course.durationMinutes, locale) }),
    },
    ...(course.certificateEnabled
      ? [{ key: 'certificate', icon: Award, text: t('purchase.included.certificate') }]
      : []),
    {
      key: 'access',
      icon: InfinityIcon,
      text:
        course.accessDurationDays === null
          ? t('purchase.accessLifetime')
          : t('purchase.accessLimited', { days: course.accessDurationDays }),
    },
  ];

  return (
    <>
      {/* Desktop: the sticky card. */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 flex flex-col gap-5 rounded-lg border border-hairline bg-surface p-5 shadow-e2">
          <PriceTag
            centimes={course.priceCentimes}
            compareAtCentimes={course.comparePriceCentimes}
            locale={locale}
            size="lg"
          />

          {button}

          {/* A disabled CTA must always be accompanied by the reason. Every
              non-actionable kind has a matching `…Hint` key, which is why the
              CTA vocabulary was named after the i18n keys rather than mapped. */}
          {cta.actionable ? null : (
            <Alert variant="info" title={label}>
              {t(`cta.${cta.kind}Hint`)}
            </Alert>
          )}

          {cta.requestReference === null ? null : (
            <p className="text-xs text-ink-muted">
              {t('purchase.approvalNote')}{' '}
              <span data-numeric dir="ltr" className="force-ltr text-ink">
                {cta.requestReference}
              </span>
            </p>
          )}

          <ul className="flex flex-col gap-2.5 border-t border-hairline pt-4">
            {includes.map(({ key, icon: Icon, text }) => (
              <li key={key} className="flex items-start gap-2.5 text-sm text-ink-muted">
                <Icon className="mt-0.5 size-4 shrink-0 text-strait" aria-hidden="true" />
                <span className="text-pretty">{text}</span>
              </li>
            ))}
          </ul>

          {/* Only when a real cap exists, and only while it is meaningful. */}
          {course.seatsLeft === null || course.seatsLeft > 10 ? null : (
            <p className="flex items-center gap-2 rounded-sm bg-warn-wash px-3 py-2 text-sm text-warn">
              <Users className="size-4 shrink-0" aria-hidden="true" />
              {t('purchase.seatsLeft', { count: course.seatsLeft })}
            </p>
          )}

          {course.installmentsAllowed && course.installmentCount !== null ? (
            <p className="flex items-start gap-2 text-xs text-ink-muted">
              <Check className="mt-0.5 size-3.5 shrink-0 text-strait" aria-hidden="true" />
              {t('purchase.installments', { count: course.installmentCount })}
            </p>
          ) : null}
        </div>
      </aside>

      {/* Mobile: price and CTA within thumb reach, above the safe-area inset. */}
      <div className="safe-b surface-blur fixed inset-x-0 bottom-0 z-40 border-t border-hairline px-4 py-3 lg:hidden">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-4">
          <div className="min-w-0 shrink-0">
            <PriceTag
              centimes={course.priceCentimes}
              compareAtCentimes={course.comparePriceCentimes}
              locale={locale}
              size="sm"
            />
          </div>
          <div className="min-w-0 flex-1">{button}</div>
        </div>
      </div>

      {/* Reserves the height the fixed bar occupies, so the last section of the
          page is never hidden behind it. */}
      <div aria-hidden="true" className="h-20 lg:hidden" />
    </>
  );
}
