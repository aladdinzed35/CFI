'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Award, BookOpen, Clock, Download, MessageCircle } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { PriceTag } from '@/components/ui/price-tag';
import { RadioCard, RadioCardGroup } from '@/components/ui/radio-card';
import { Stepper } from '@/components/ui/stepper';
import { formatDateTime, formatDuration } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { createEnrollmentRequest } from '@/server/actions/enrollment';

import { useActionErrorMessage } from './action-error';
import { BankBlock } from './bank-block';
import { ReceiptForm } from './receipt-form';
import { RequestTimeline } from './request-timeline';
import type { EnrollmentModalData } from './types';

/**
 * The §9.2 enrollment modal — three steps, one request, one reference.
 *
 * ```
 * 1 Prix et conditions   → createEnrollmentRequest  (the reference is minted here)
 * 2 Justificatif         → submitEnrollmentReceipt  (UNDER_REVIEW)
 * 3 Confirmation         → reference, timeline, WhatsApp, « Voir mes demandes »
 * ```
 *
 * ## Why the request is created between step 1 and step 2
 * The reference `CFI-2026-000123` is what makes a transfer traceable, and only
 * the server can mint it (`EnrollmentRequest.reference` is unique and allocated
 * inside the creating transaction). It therefore cannot be shown before the row
 * exists — so step 1 ends by creating it, and the transfer instructions,
 * reference included, open step 2. Nothing is invented on the client and no
 * placeholder reference is ever displayed.
 *
 * Creating it early also matches §9.2's own state machine: a student who closes
 * the modal after step 1 leaves an `AWAITING_RECEIPT` request that «Mes
 * demandes» picks up with the same instructions and the same upload box, and
 * that the reminder cron chases at +24 h and +72 h. Abandoning the modal is a
 * state the product has, not an accident.
 *
 * §9.2 rule 1 is enforced server-side: a second attempt on a course that
 * already has a live request returns that request instead of creating another.
 * When the returned one is already under review, this modal says so and points
 * at « Mes demandes » rather than offering to upload a second receipt.
 *
 * ## Leaving with an attached receipt
 * Radix closes a dialog on Escape, on outside press and on the corner button.
 * All three funnel through `onOpenChange`, which is why the exit guard lives
 * there: once a file is attached and not yet sent, closing asks first. Losing a
 * photographed receipt to a stray tap on a phone is the cheapest possible way
 * to lose a sale.
 */

/** The §28.3 transfer options. `CASH_AT_CENTER` appears only when enabled. */
type TransferType = 'INSTANT' | 'STANDARD_48H' | 'CASH_AT_CENTER';

interface CreatedRequest {
  readonly id: string;
  readonly reference: string;
  readonly amountDueCentimes: number;
  readonly discountCentimes: number;
}

export interface RequestModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly data: EnrollmentModalData;
}

export function RequestModal({ open, onOpenChange, data }: RequestModalProps): React.JSX.Element {
  const t = useTranslations('enrollment.modal');
  const tCommon = useTranslations('common');
  const describeError = useActionErrorMessage();
  const router = useRouter();

  const { locale, course, bank, whatsappUrl, constraints } = data;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [transferType, setTransferType] = useState<TransferType>('INSTANT');
  const [couponCode, setCouponCode] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [alreadyOpen, setAlreadyOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [request, setRequest] = useState<CreatedRequest | null>(null);
  const [submittedAt, setSubmittedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const reset = useCallback((): void => {
    setStep(1);
    setCouponError(null);
    setFormError(null);
    setAlreadyOpen(false);
    setDirty(false);
    setConfirmDiscard(false);
  }, []);

  const close = useCallback((): void => {
    setConfirmDiscard(false);
    setDirty(false);
    onOpenChange(false);
    // The course page's CTA and « Mes demandes » both read this request; a
    // refresh is what turns « Demander l'accès » into « Demande en cours ».
    if (request !== null) router.refresh();
    reset();
  }, [onOpenChange, request, reset, router]);

  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (next) {
        onOpenChange(true);
        return;
      }
      // §9.2: a receipt chosen but not sent is worth one question.
      if (dirty && step === 2) {
        setConfirmDiscard(true);
        return;
      }
      close();
    },
    [close, dirty, onOpenChange, step],
  );

  async function createRequest(): Promise<void> {
    if (creating) return;
    setCouponError(null);
    setFormError(null);
    setAlreadyOpen(false);
    setCreating(true);

    try {
      const trimmedCoupon = couponCode.trim();
      const result = await createEnrollmentRequest({
        courseId: course.id,
        transferType,
        ...(trimmedCoupon === '' ? {} : { couponCode: trimmedCoupon }),
      });

      if (!result.ok) {
        if (result.fieldErrors?.['couponCode'] !== undefined) {
          setCouponError(describeError({ error: 'validation', message: 'course.request.couponInvalid' }));
          return;
        }
        setFormError(describeError(result));
        return;
      }

      const view = result.data;
      setRequest({
        id: view.id,
        reference: view.reference,
        amountDueCentimes: view.amountDueCentimes,
        discountCentimes: view.discountCentimes,
      });

      // Rule 1 sent us back to a request that is already being verified: there
      // is nothing to upload here, only somewhere to follow it.
      if (view.status !== 'AWAITING_RECEIPT') {
        setAlreadyOpen(true);
        return;
      }
      setStep(2);
    } catch {
      setFormError(t('errors.generic'));
    } finally {
      setCreating(false);
    }
  }

  const steps = [
    { id: 'price', label: t('steps.price') },
    { id: 'receipt', label: t('steps.receipt') },
    { id: 'confirmation', label: t('steps.confirmation') },
  ];

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent size="lg" closeLabel={t('actions.close')}>
        <ModalHeader>
          <ModalTitle>{t('title')}</ModalTitle>
          <ModalDescription>{course.title}</ModalDescription>
        </ModalHeader>

        <div className="shrink-0 ps-5 pe-5 pb-4 md:ps-6 md:pe-6">
          <Stepper steps={steps} current={step} label={t('stepLabel', { current: step, total: 3 })} />
        </div>

        {confirmDiscard ? (
          <>
            <ModalBody>
              {/* `info`, not `warning`: the request is already created and the
                  reference is theirs. Nothing is being lost by leaving, and
                  saying otherwise would push someone into an upload they are
                  not ready for. */}
              <Alert variant="info" title={t('discard.title')}>
                {t('discard.body')}
              </Alert>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirmDiscard(false);
                }}
              >
                {t('discard.keep')}
              </Button>
              <Button variant="ghost" onClick={close}>
                {t('discard.leave')}
              </Button>
            </ModalFooter>
          </>
        ) : null}

        {!confirmDiscard && step === 1 ? (
          <>
            <ModalBody>
              <div className="flex flex-col gap-5 pb-2">
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-ink-muted">{t('price.label')}</p>
                  <PriceTag
                    centimes={course.priceCentimes}
                    compareAtCentimes={course.comparePriceCentimes}
                    locale={locale}
                    size="lg"
                  />
                </div>

                <ul className="flex flex-col gap-2 rounded-md border border-hairline bg-raised p-3 sm:p-4">
                  <li className="text-sm font-medium text-ink">{t('price.includedTitle')}</li>
                  <li className="flex items-start gap-2.5 text-sm text-ink-muted">
                    <BookOpen className="mt-0.5 size-4 shrink-0 text-strait" aria-hidden="true" />
                    {t('price.modules', { count: course.moduleCount })}
                  </li>
                  <li className="flex items-start gap-2.5 text-sm text-ink-muted">
                    <Clock className="mt-0.5 size-4 shrink-0 text-strait" aria-hidden="true" />
                    {t('price.videoDuration', {
                      duration: formatDuration(course.durationMinutes, locale),
                    })}
                  </li>
                  {course.resourceCount === 0 ? null : (
                    <li className="flex items-start gap-2.5 text-sm text-ink-muted">
                      <Download className="mt-0.5 size-4 shrink-0 text-strait" aria-hidden="true" />
                      {t('price.resources')}
                    </li>
                  )}
                  {course.certificateEnabled ? (
                    <li className="flex items-start gap-2.5 text-sm text-ink-muted">
                      <Award className="mt-0.5 size-4 shrink-0 text-brass" aria-hidden="true" />
                      {t('price.certificate')}
                    </li>
                  ) : null}
                </ul>

                <FormField
                  label={t('coupon.label')}
                  optionalHint={tCommon('optional')}
                  error={couponError ?? undefined}
                >
                  {(field) => (
                    <Input
                      id={field.id}
                      aria-describedby={field['aria-describedby']}
                      aria-invalid={field['aria-invalid']}
                      invalid={field['aria-invalid'] === true}
                      name="couponCode"
                      value={couponCode}
                      maxLength={64}
                      dir="ltr"
                      className="force-ltr"
                      placeholder={t('coupon.placeholder')}
                      disabled={creating}
                      onChange={(event) => {
                        setCouponCode(event.target.value.toUpperCase());
                        setCouponError(null);
                      }}
                    />
                  )}
                </FormField>

                <fieldset className="flex flex-col gap-2">
                  <legend className="pb-2 text-sm font-medium text-ink">
                    {t('transferType.legend')}
                  </legend>
                  <RadioCardGroup
                    value={transferType}
                    onValueChange={(value) => {
                      setTransferType(value as TransferType);
                    }}
                    aria-label={t('transferType.legend')}
                    disabled={creating}
                  >
                    <RadioCard
                      value="INSTANT"
                      title={t('transferType.instantTitle')}
                      badge={t('transferType.instantTag')}
                      description={t('transferType.instantDescription')}
                    />
                    <RadioCard
                      value="STANDARD_48H"
                      title={t('transferType.standardTitle')}
                      warning={t('transferType.standardDescription')}
                    />
                  </RadioCardGroup>
                </fieldset>

                {/* §9.2 rule 4 — the 48 h notice, verbatim, in the modal. */}
                <Alert variant="info" title={t('transferType.standardTitle')}>
                  {t('standardNotice')}
                </Alert>

                {bank.usable ? <BankBlock bank={bank} /> : null}

                {alreadyOpen && request !== null ? (
                  <Alert
                    variant="warning"
                    title={t('errors.duplicateRequest')}
                    action={
                      <Button asChild size="sm" variant="secondary" onClick={close}>
                        <Link href="/espace/demandes">{t('success.viewRequests')}</Link>
                      </Button>
                    }
                  >
                    <span dir="ltr" data-numeric className="force-ltr">
                      {request.reference}
                    </span>
                  </Alert>
                ) : null}

                {formError === null ? null : <Alert variant="error" title={formError} />}
              </div>
            </ModalBody>

            <ModalFooter>
              <Button
                size="lg"
                loading={creating}
                disabled={alreadyOpen}
                onClick={() => {
                  void createRequest();
                }}
              >
                {t('actions.continue')}
              </Button>
            </ModalFooter>
          </>
        ) : null}

        {!confirmDiscard && step === 2 && request !== null ? (
          <ModalBody className="pb-5">
            {request.discountCentimes > 0 && couponCode.trim() !== '' ? (
              <p className="mb-4 rounded-sm bg-brass-wash px-3 py-2 text-sm text-brass">
                {t('coupon.applied', {
                  code: couponCode.trim(),
                  amount: formatMoney(request.discountCentimes, locale),
                })}
              </p>
            ) : null}

            <ReceiptForm
              locale={locale}
              requestId={request.id}
              reference={request.reference}
              amountDueCentimes={request.amountDueCentimes}
              constraints={constraints}
              bank={bank}
              onDirtyChange={setDirty}
              onSubmitted={() => {
                setSubmittedAt(new Date());
                setDirty(false);
                setStep(3);
              }}
              secondaryAction={
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={() => {
                    setStep(1);
                  }}
                >
                  {t('actions.back')}
                </Button>
              }
            />
          </ModalBody>
        ) : null}

        {!confirmDiscard && step === 3 && request !== null ? (
          <>
            <ModalBody>
              <div className="flex flex-col gap-5 pb-2">
                <div className="flex flex-col gap-2">
                  <p className="font-display text-heading text-ink">{t('success.title')}</p>
                  <p className="text-body text-ink-muted">{t('success.body')}</p>
                </div>

                <dl className="flex flex-col gap-2 rounded-md border border-hairline bg-raised p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-xs text-ink-muted">{t('success.referenceLabel')}</dt>
                    <dd className="flex items-center gap-1">
                      <span dir="ltr" data-numeric className="force-ltr text-body font-medium text-ink">
                        {request.reference}
                      </span>
                      <CopyButton
                        value={request.reference}
                        label={t('reference.copy')}
                        copiedLabel={t('bank.copied')}
                        size="sm"
                      />
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-xs text-ink-muted">{t('success.amountLabel')}</dt>
                    <dd dir="ltr" data-numeric className="force-ltr text-body font-medium text-brass">
                      {formatMoney(request.amountDueCentimes, locale)}
                    </dd>
                  </div>
                  {submittedAt === null ? null : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <dt className="text-xs text-ink-muted">{t('success.submittedAtLabel')}</dt>
                      <dd className="text-sm text-ink">{formatDateTime(submittedAt, locale)}</dd>
                    </div>
                  )}
                </dl>

                <p className="text-sm text-ink-muted">{t('success.reviewDelay')}</p>

                <RequestTimeline
                  locale={locale}
                  status="UNDER_REVIEW"
                  receiptUploadedAt={submittedAt}
                  events={[]}
                />

                {/* §9.2 rule 4 — the same notice on the confirmation screen. */}
                {transferType === 'STANDARD_48H' ? (
                  <Alert variant="warning" title={t('transferType.standardTitle')}>
                    {t('standardNotice')}
                  </Alert>
                ) : null}
              </div>
            </ModalBody>

            <ModalFooter>
              {whatsappUrl === null ? null : (
                <Button asChild variant="secondary" size="lg">
                  <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="size-5" aria-hidden="true" />
                    {t('success.whatsapp')}
                  </a>
                </Button>
              )}
              <Button asChild size="lg" onClick={close}>
                <Link href="/espace/demandes">{t('success.viewRequests')}</Link>
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </ModalContent>
    </Modal>
  );
}
