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
import { EnrollCtaButton } from '@/components/public/course/enroll-cta-button';
import type { EnrollmentModalData } from '@/components/enrollment/types';

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
 *
 * ## The bar shares the bottom edge with the WhatsApp button
 * Both are fixed to the bottom of the screen, and the button used to sit on top
 * of the call to action. The bar carries `data-cfi-bottom-bar`, which is the
 * WhatsApp button's cue to ride above it (see `WhatsAppFab`) — so the bar is
 * kept within the 4.75 rem that lift allows.
 *
 * ## …and never covers the end of the page
 * A fixed bar hides whatever scrolls under it, and at the bottom of the page
 * that is the footer. An in-flow spacer cannot help — the footer comes after
 * the page — so the bar reserves its height on `<body>` instead, only while it
 * is on screen: the rule is keyed on the same `data-` attribute through
 * `:has()`, so it lapses the moment the course page unmounts.
 */

/**
 * The bar's height, safe-area inset excluded: 12 + 48 + 12 px and the hairline.
 * Kept in step with its padding, and under the WhatsApp button's 4.75 rem lift.
 */
const BAR_RESERVE = '4.75rem';

const barReserveCss = `
@media (max-width: 63.98rem) {
  body:has([data-cfi-bottom-bar]) {
    padding-block-end: calc(${BAR_RESERVE} + env(safe-area-inset-bottom, 0px));
  }
}
`;

export interface PurchaseCardProps {
  locale: Locale;
  course: CourseDetail;
  cta: EnrollCta;
  /**
   * Everything the §9.2 modal needs, resolved by the page. Supplied only when
   * `cta.opensRequestModal` is true — a visitor who cannot buy never downloads
   * the bank coordinates.
   */
  enrollment?: EnrollmentModalData;
}

/** Classes that let a long CTA label wrap onto two lines inside the mobile bar. */
const BAR_BUTTON = 'h-auto min-h-12 whitespace-normal px-4 py-1.5 text-center text-sm leading-tight text-balance';

export async function PurchaseCard({
  locale,
  course,
  cta,
  enrollment,
}: PurchaseCardProps): Promise<React.JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'course' });

  const price = formatMoney(course.priceCentimes, locale);
  const label = t(`cta.${cta.kind}`, { price });

  const renderButton = (compact: boolean): React.JSX.Element =>
    cta.opensRequestModal && enrollment !== undefined ? (
      // The buying state: the request is created here, in a dialog, rather than
      // on a page of its own (§9.2).
      <EnrollCtaButton
        label={label}
        data={enrollment}
        size={compact ? 'md' : 'lg'}
        className={compact ? BAR_BUTTON : undefined}
      />
    ) : cta.href === null ? (
      <Button
        size={compact ? 'md' : 'lg'}
        fullWidth
        disabled={!cta.actionable}
        className={compact ? BAR_BUTTON : undefined}
      >
        {label}
      </Button>
    ) : (
      <Button asChild size={compact ? 'md' : 'lg'} fullWidth className={compact ? BAR_BUTTON : undefined}>
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
      <aside aria-label={t('purchase.stickyLabel')} className="hidden lg:block">
        <div className="sticky top-24 flex flex-col gap-5 overflow-hidden rounded-lg border border-hairline bg-surface p-6 shadow-e3">
          {/* A hairline of the brand accent across the top of the card. */}
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-strait" />

          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted rtl:tracking-normal">
              {t('purchase.priceLabel')}
            </p>
            <PriceTag
              centimes={course.priceCentimes}
              compareAtCentimes={course.comparePriceCentimes}
              locale={locale}
              size="xl"
              freeLabel={t('purchase.free')}
              compareAtSrLabel={t('purchase.comparePrefix')}
            />
          </div>

          {renderButton(false)}

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

          <div className="flex flex-col gap-3 border-t border-hairline pt-5">
            <p className="text-sm font-medium text-ink">{t('purchase.includedTitle')}</p>
            <ul className="flex flex-col gap-2.5">
              {includes.map(({ key, icon: Icon, text }) => (
                <li key={key} className="flex items-start gap-2.5 text-sm text-ink-muted">
                  <Icon className="mt-0.5 size-4 shrink-0 text-strait" aria-hidden="true" />
                  <span className="text-pretty">{text}</span>
                </li>
              ))}
            </ul>
          </div>

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

          <p className="border-t border-hairline pt-4 text-xs text-pretty text-ink-muted">
            {t('purchase.paymentNote')}
          </p>
        </div>
      </aside>

      {/* Mobile: price and CTA within thumb reach, above the safe-area inset. */}
      <style href="cfi-purchase-bar" precedence="medium">
        {barReserveCss}
      </style>
      <div
        data-cfi-bottom-bar=""
        role="region"
        aria-label={t('purchase.stickyLabel')}
        className="surface-blur fixed inset-x-0 bottom-0 z-40 border-t border-hairline pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] lg:hidden"
      >
        <div className="mx-auto flex min-h-12 w-full max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
          <PriceTag
            centimes={course.priceCentimes}
            compareAtCentimes={course.comparePriceCentimes}
            locale={locale}
            size="md"
            stacked
            freeLabel={t('purchase.free')}
            compareAtSrLabel={t('purchase.comparePrefix')}
            className="min-w-0 shrink gap-y-0.5 [&>span:first-child]:font-display [&>span:first-child]:text-heading"
          />
          <div className="min-w-0 flex-1 sm:ms-auto sm:w-72 sm:flex-none">{renderButton(true)}</div>
        </div>
      </div>
    </>
  );
}

/**
 * The reason a CTA is disabled, and the reference of a pending request — on a
 * phone. The desktop card carries both beside the button; the mobile bar has
 * room for a price and a button only, so this renders once, in the flow, at the
 * top of the content, where it is read before the bar is ever tapped.
 */
export async function PurchaseNotice({
  locale,
  course,
  cta,
}: {
  locale: Locale;
  course: Pick<CourseDetail, 'priceCentimes'>;
  cta: EnrollCta;
}): Promise<React.JSX.Element | null> {
  if (cta.actionable && cta.requestReference === null) return null;

  const t = await getTranslations({ locale, namespace: 'course' });
  const label = t(`cta.${cta.kind}`, { price: formatMoney(course.priceCentimes, locale) });

  return (
    <div className="flex flex-col gap-3 lg:hidden">
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
    </div>
  );
}
