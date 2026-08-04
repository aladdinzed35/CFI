'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FileText, MessageCircle, ReceiptText } from 'lucide-react';

import { Alert, Callout } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { StatusPill } from '@/components/ui/status-pill';
import { ReceiptForm } from '@/components/enrollment/receipt-form';
import { RequestTimeline } from '@/components/enrollment/request-timeline';
import type { BankDetailsView, ReceiptConstraints } from '@/components/enrollment/types';
import { useActionErrorMessage } from '@/components/enrollment/action-error';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { cancelEnrollmentRequest } from '@/server/actions/enrollment';
import type { StudentRequestCard } from '@/server/services/enrollment/queries';

/**
 * One request, as §1897 describes it: reference, amount, transfer type,
 * submitted date, the student's own receipt, the §9.2 timeline, the current
 * state with its explanation, and the actions that state actually allows.
 *
 * ## The actions are derived from the status, never from a flag
 * Every button here exists because the state machine allows the transition it
 * triggers, and the server refuses it anyway if the request moved on in the
 * meantime (`cancelRequest` compare-and-sets, `submitReceipt` re-runs the
 * edge). What the student sees and what the server permits therefore agree by
 * construction, and a stale tab produces a translated refusal rather than a
 * silent no-op.
 *
 * ## The receipt is fetched, not stored
 * `receiptPath` is a `/api/files/...` gateway path, not a public URL: the
 * request carries the session cookie, the gateway re-checks ownership and
 * answers 404 to anyone else (§9.2 rule 5). `unoptimized` is required — the
 * Next image optimiser fetches upstream without the session and would only ever
 * see that 404.
 */

const STATUS_KEY: Readonly<Record<string, string>> = {
  AWAITING_RECEIPT: 'awaitingReceipt',
  UNDER_REVIEW: 'underReview',
  INFO_REQUESTED: 'infoRequested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
};

const TRANSFER_KEY: Readonly<Record<string, string>> = {
  INSTANT: 'instant',
  STANDARD_48H: 'standard',
  CASH_AT_CENTER: 'cash',
};

export interface RequestCardProps {
  readonly locale: Locale;
  readonly request: StudentRequestCard;
  readonly bank: BankDetailsView;
  readonly constraints: ReceiptConstraints;
  readonly whatsappUrl: string | null;
}

export function RequestCard({
  locale,
  request,
  bank,
  constraints,
  whatsappUrl,
}: RequestCardProps): React.JSX.Element {
  const t = useTranslations('enrollment.status');
  const tTransfer = useTranslations('enrollment.transferTypes');
  const tModal = useTranslations('enrollment.modal');
  const describeError = useActionErrorMessage();
  const router = useRouter();

  const [uploading, setUploading] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusKey = STATUS_KEY[request.status] ?? 'awaitingReceipt';
  const transferKey = TRANSFER_KEY[request.transferType] ?? 'instant';

  const awaitsStudent =
    request.status === 'AWAITING_RECEIPT' || request.status === 'INFO_REQUESTED';
  const canCancel = !request.isFinal;
  const canAskAgain =
    request.courseSlug !== null &&
    (request.status === 'REJECTED' ||
      request.status === 'EXPIRED' ||
      request.status === 'CANCELLED');

  async function cancel(): Promise<void> {
    if (cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      const result = await cancelEnrollmentRequest({ requestId: request.id });
      if (!result.ok) {
        setError(describeError(result));
        return;
      }
      setConfirmCancel(false);
      setNotice(t('cancelDialog.success'));
      router.refresh();
    } catch {
      setError(tModal('errors.generic'));
    } finally {
      setCancelling(false);
    }
  }

  const reviewSlot = awaitsStudent || request.status === 'REJECTED' ? (
    <div className="flex flex-col gap-3 pt-2">
      {request.infoRequestedMessage === null ? null : (
        <Callout variant="warning" title={t('card.adminMessageTitle')}>
          {request.infoRequestedMessage}
        </Callout>
      )}
      {request.rejectionReason === null ? null : (
        <Callout variant="error" title={t('card.rejectionReasonTitle')}>
          {request.rejectionReason}
        </Callout>
      )}

      {awaitsStudent && !uploading ? (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setUploading(true);
            }}
          >
            {t('actions.resendReceipt')}
          </Button>
        </div>
      ) : null}

      {awaitsStudent && uploading ? (
        <div className="rounded-md border border-hairline bg-surface p-3 sm:p-4">
          <p className="pb-3 text-sm font-medium text-ink">{t('reupload.title')}</p>
          <ReceiptForm
            locale={locale}
            requestId={request.id}
            reference={request.reference}
            amountDueCentimes={request.amountDueCentimes}
            constraints={constraints}
            bank={bank}
            onSubmitted={() => {
              setUploading(false);
              setNotice(t('reupload.success'));
              router.refresh();
            }}
            secondaryAction={
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={() => {
                  setUploading(false);
                }}
              >
                {tModal('actions.back')}
              </Button>
            }
          />
        </div>
      ) : null}

      {request.status === 'REJECTED' && whatsappUrl !== null ? (
        <div>
          <Button asChild size="sm" variant="secondary">
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" aria-hidden="true" />
              {t('actions.whatsapp')}
            </a>
          </Button>
        </div>
      ) : null}
    </div>
  ) : undefined;

  return (
    <Card elevation={1}>
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-lead text-ink">
              {request.courseSlug === null ? (
                request.courseTitle
              ) : (
                <Link
                  href={`/formations/${request.courseSlug}`}
                  className="underline-offset-4 hover:underline"
                >
                  {request.courseTitle}
                </Link>
              )}
            </h2>
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
              <span>{t('card.referenceLabel')}</span>
              <span dir="ltr" data-numeric className="force-ltr text-ink">
                {request.reference}
              </span>
              <CopyButton
                value={request.reference}
                label={t('card.copyReference')}
                copiedLabel={tModal('bank.copied')}
                size="sm"
              />
            </p>
          </div>

          <StatusPill
            domain="request"
            status={request.status}
            label={t(`labels.${statusKey}`)}
            srPrefix={t('timeline.label')}
          />
        </div>

        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-ink-muted">{t('card.amountLabel')}</dt>
            <dd dir="ltr" data-numeric className="force-ltr text-body font-medium text-brass">
              {formatMoney(request.amountDueCentimes, locale)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-ink-muted">{t('card.transferTypeLabel')}</dt>
            <dd className="text-body text-ink">{tTransfer(transferKey)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-ink-muted">{t('card.submittedLabel')}</dt>
            <dd className="text-body text-ink">{formatDate(request.createdAt, locale)}</dd>
          </div>
        </dl>

        <p className="text-sm text-ink-muted">{t(`explanations.${statusKey}`)}</p>

        {request.status === 'AWAITING_RECEIPT' ? (
          <p className="text-xs text-ink-muted">
            {t('card.expiresOn', { date: formatDate(request.expiresAt, locale) })}
          </p>
        ) : null}

        {request.receiptPath === null ? null : (
          <a
            href={request.receiptPath}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-3 rounded-md border border-hairline bg-raised p-2 text-sm text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-surface"
          >
            {request.receiptPath.endsWith('.pdf') ? (
              <span className="grid size-14 place-items-center rounded-sm bg-surface text-ink-muted">
                <FileText className="size-6" aria-hidden="true" />
              </span>
            ) : (
              <Image
                src={request.receiptPath}
                alt={t('card.receiptAlt')}
                width={56}
                height={56}
                unoptimized
                className="size-14 rounded-sm object-cover"
              />
            )}
            <span className="pe-2">
              {request.receiptPath.endsWith('.pdf')
                ? tModal('upload.pdfFile')
                : t('card.receiptAlt')}
            </span>
          </a>
        )}

        <RequestTimeline
          locale={locale}
          status={request.status}
          receiptUploadedAt={request.receiptUploadedAt}
          events={request.events}
          reviewSlot={reviewSlot}
        />

        {notice === null ? null : <Alert variant="success" title={notice} />}
        {error === null ? null : <Alert variant="error" title={error} />}

        <div className="flex flex-wrap gap-2">
          {request.invoicePath === null ? null : (
            <Button asChild variant="brass" size="md">
              <a href={request.invoicePath}>
                <ReceiptText className="size-5" aria-hidden="true" />
                {t('actions.downloadInvoice')}
              </a>
            </Button>
          )}

          {canAskAgain && request.courseSlug !== null ? (
            <Button asChild variant="secondary" size="md">
              <Link href={`/formations/${request.courseSlug}`}>{t('actions.newRequest')}</Link>
            </Button>
          ) : null}

          {request.status === 'UNDER_REVIEW' && whatsappUrl !== null ? (
            <Button asChild variant="ghost" size="md">
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-5" aria-hidden="true" />
                {t('actions.whatsapp')}
              </a>
            </Button>
          ) : null}

          {canCancel ? (
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setConfirmCancel(true);
              }}
            >
              {t('actions.cancel')}
            </Button>
          ) : null}
        </div>
      </div>

      <Modal open={confirmCancel} onOpenChange={setConfirmCancel}>
        <ModalContent size="sm" closeLabel={tModal('actions.close')}>
          <ModalHeader>
            <ModalTitle>{t('cancelDialog.title')}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-body text-ink-muted">
              {t('cancelDialog.body', { reference: request.reference })}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmCancel(false);
              }}
            >
              {t('cancelDialog.keep')}
            </Button>
            <Button
              variant="danger"
              loading={cancelling}
              onClick={() => {
                void cancel();
              }}
            >
              {t('cancelDialog.confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Card>
  );
}
