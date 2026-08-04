'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox';
import { CopyButton } from '@/components/ui/copy-button';
import { FileDropzone, type FileDropzoneItem, type FileRejection } from '@/components/ui/file-dropzone';
import { FormError, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from '@/lib/money';
import type { Locale } from '@/i18n/routing';
import { submitEnrollmentReceipt } from '@/server/actions/enrollment';

import { useActionErrorMessage } from './action-error';
import { BankBlock } from './bank-block';
import { compressReceiptImage } from './compress-image';
import { RECEIPT_ACCEPT, type BankDetailsView, type ReceiptConstraints } from './types';

/**
 * §9.2 step 2 — « Justificatif de virement ».
 *
 * The same component serves three places, because they are the same act: the
 * modal's second step, the re-upload box under an `INFO_REQUESTED` request
 * (§1682), and the « Envoyer le justificatif » panel of a request that was
 * saved without one (§13.3). Three copies would drift, and the one that drifted
 * would be the one a student uses after being told their receipt was unreadable.
 *
 * ## The upload budget is spent in the browser first
 * A receipt photographed on a phone is 9 MB and 4000 px wide; the server ceiling
 * is 5 MB. {@link compressReceiptImage} redraws it at 2000 px before it is ever
 * sent, so the student uploads ~300 kB over 3G instead of failing at 90 %. The
 * dropzone therefore accepts a *larger* intake than the server does — otherwise
 * it would refuse the very file compression exists to rescue — and the real
 * ceiling is asserted after compression, in this component and again server-side
 * from the actual bytes.
 *
 * ## Nothing is validated twice with different rules
 * The declared date bounds, the size ceiling and the confirmation checkbox are
 * enforced here so the student is told immediately, and enforced again by
 * `submitEnrollmentReceipt` because a client check is a courtesy, not a control.
 */

/** What the dropzone will hand us before compression has had its say. */
const INTAKE_MAX_BYTES = 32 * 1024 * 1024;

export interface ReceiptFormProps {
  readonly locale: Locale;
  readonly requestId: string;
  /** `CFI-2026-000123` — shown with the transfer instructions. */
  readonly reference: string;
  readonly amountDueCentimes: number;
  readonly constraints: ReceiptConstraints;
  /** Omit to hide the transfer instructions (the caller already showed them). */
  readonly bank?: BankDetailsView;
  /** Called once the receipt is accepted and the request is under review. */
  readonly onSubmitted: (result: { readonly reference: string }) => void;
  /** Told whenever a receipt is attached but not yet sent — drives the exit guard. */
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Extra controls rendered beside the submit button (« Retour »). */
  readonly secondaryAction?: React.ReactNode;
  readonly className?: string;
}

/** `YYYY-MM-DD` in the Casablanca-facing sense: what the date input speaks. */
function toDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ReceiptForm({
  locale,
  requestId,
  reference,
  amountDueCentimes,
  constraints,
  bank,
  onSubmitted,
  onDirtyChange,
  secondaryAction,
  className,
}: ReceiptFormProps): React.JSX.Element {
  const t = useTranslations('enrollment.modal');
  const tCommon = useTranslations('common');
  const describeError = useActionErrorMessage();
  const formId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [transferDate, setTransferDate] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [bankReference, setBankReference] = useState('');
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { minDate, maxDate } = useMemo(() => {
    const today = new Date();
    const min = new Date(today.getTime() - constraints.maxAgeDays * 24 * 60 * 60 * 1000);
    return { minDate: toDateValue(min), maxDate: toDateValue(today) };
  }, [constraints.maxAgeDays]);

  const markDirty = useCallback(
    (next: File | null): void => {
      setFile(next);
      onDirtyChange?.(next !== null);
    },
    [onDirtyChange],
  );

  const onSelect = useCallback(
    (files: File[]): void => {
      const picked = files[0];
      if (picked === undefined) return;

      setFileError(null);
      setFormError(null);
      setPreparing(true);

      void compressReceiptImage(picked, constraints.maxBytes)
        .then((prepared) => {
          if (prepared.size > constraints.maxBytes) {
            markDirty(null);
            setFileError(t('errors.fileTooLarge'));
            return;
          }
          markDirty(prepared);
        })
        .catch(() => {
          markDirty(null);
          setFileError(t('errors.uploadFailed'));
        })
        .finally(() => {
          setPreparing(false);
        });
    },
    [constraints.maxBytes, markDirty, t],
  );

  const onReject = useCallback(
    (rejections: readonly FileRejection[]): void => {
      const first = rejections[0];
      if (first === undefined) return;
      setFileError(first.reason === 'size' ? t('errors.fileTooLarge') : t('errors.fileWrongType'));
    },
    [t],
  );

  const items: readonly FileDropzoneItem[] = useMemo(
    () =>
      file === null
        ? []
        : [{ id: 'receipt', file, status: submitting ? ('uploading' as const) : ('pending' as const) }],
    [file, submitting],
  );

  function validate(): boolean {
    let ok = true;

    if (file === null) {
      setFileError(t('errors.receiptRequired'));
      ok = false;
    }

    if (transferDate === '') {
      setDateError(t('errors.transferDateRequired'));
      ok = false;
    } else if (transferDate > maxDate) {
      setDateError(t('errors.transferDateFuture'));
      ok = false;
    } else if (transferDate < minDate) {
      setDateError(t('errors.transferDateTooOld'));
      ok = false;
    } else {
      setDateError(null);
    }

    if (!confirmed) {
      setConfirmError(t('errors.confirmRequired'));
      ok = false;
    } else {
      setConfirmError(null);
    }

    return ok;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || preparing) return;

    setFormError(null);
    if (!validate() || file === null) return;

    setSubmitting(true);
    try {
      const payload = new FormData();
      payload.set('requestId', requestId);
      payload.set('file', file);
      payload.set('transferDate', transferDate);
      payload.set('confirmed', 'true');
      const trimmedReference = bankReference.trim();
      if (trimmedReference !== '') payload.set('bankReference', trimmedReference);
      const trimmedMessage = message.trim();
      if (trimmedMessage !== '') payload.set('message', trimmedMessage);

      const result = await submitEnrollmentReceipt(payload);

      if (!result.ok) {
        const fields = result.fieldErrors;
        const dateIssue = fields?.['transferDate']?.[0];
        const fileIssue = fields?.['file']?.[0];
        if (dateIssue !== undefined) setDateError(t('errors.transferDateRequired'));
        if (fileIssue !== undefined) {
          setFileError(
            fileIssue === 'errors.fileTooLarge'
              ? t('errors.fileTooLarge')
              : t('errors.fileWrongType'),
          );
        }
        setFormError(describeError(result));
        return;
      }

      onDirtyChange?.(false);
      onSubmitted({ reference: result.data.reference });
    } catch {
      // A dropped connection mid-upload: the request never reached the server,
      // so retrying is safe and is what the message tells them to do.
      setFormError(t('errors.uploadFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      id={formId}
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
      className={className}
    >
      <div className="flex flex-col gap-5">
        {/* The reference is the single thing that makes a transfer traceable. */}
        <div className="flex flex-col gap-2 rounded-md border border-strait/30 bg-strait-wash p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-ink-muted">{t('reference.label')}</span>
            <span className="flex items-center gap-1">
              <span dir="ltr" data-numeric className="force-ltr text-body font-medium text-ink">
                {reference}
              </span>
              <CopyButton
                value={reference}
                label={t('reference.copy')}
                copiedLabel={t('bank.copied')}
                size="sm"
              />
            </span>
          </div>
          <p className="text-sm text-ink">{t('reference.instruction', { reference })}</p>
          <p className="flex flex-wrap items-center justify-between gap-2 border-t border-strait/30 pt-2 text-xs text-ink-muted">
            {t('price.totalLabel')}
            <span dir="ltr" data-numeric className="force-ltr text-body font-medium text-brass">
              {formatMoney(amountDueCentimes, locale)}
            </span>
          </p>
        </div>

        {bank === undefined || !bank.usable ? null : <BankBlock bank={bank} compact />}

        {/* Not a FormField: a dropzone is a group of controls, not one labelable
            element, so a `<label for>` would point at nothing. The zone carries
            its own accessible name through `title` and `browseLabel`. */}
        <div role="group" aria-labelledby={`${formId}-upload`} className="flex flex-col gap-1.5">
          <p id={`${formId}-upload`} className="text-sm font-medium text-ink">
            {t('upload.title')}
          </p>
          <FileDropzone
            items={items}
            onSelect={onSelect}
            onRemove={() => {
              markDirty(null);
              setFileError(null);
            }}
            onReject={onReject}
            accept={RECEIPT_ACCEPT}
            maxSizeBytes={INTAKE_MAX_BYTES}
            maxFiles={1}
            title={t('upload.dropzone')}
            hint={t('upload.constraints')}
            browseLabel={t('upload.browse')}
            cameraLabel={t('upload.camera')}
            removeLabel={() => t('upload.remove')}
            disabled={submitting}
            invalid={fileError !== null}
          />
          {preparing ? (
            <p aria-live="polite" className="text-sm text-ink-muted">
              {tCommon('loading')}
            </p>
          ) : null}
          {fileError === null ? null : <FormError>{fileError}</FormError>}
        </div>

        <FormField
          label={t('fields.transferDate')}
          description={t('fields.transferDateHint')}
          required
          requiredHint={tCommon('required')}
          error={dateError ?? undefined}
        >
          {(field) => (
            <Input
              id={field.id}
              aria-describedby={field['aria-describedby']}
              aria-invalid={field['aria-invalid']}
              invalid={field['aria-invalid'] === true}
              type="date"
              name="transferDate"
              value={transferDate}
              min={minDate}
              max={maxDate}
              disabled={submitting}
              onChange={(event) => {
                setTransferDate(event.target.value);
                setDateError(null);
              }}
            />
          )}
        </FormField>

        <FormField
          label={t('fields.bankReference')}
          description={t('fields.bankReferenceHint')}
          optionalHint={tCommon('optional')}
        >
          {(field) => (
            <Input
              id={field.id}
              aria-describedby={field['aria-describedby']}
              name="bankReference"
              value={bankReference}
              maxLength={64}
              dir="ltr"
              className="force-ltr"
              disabled={submitting}
              onChange={(event) => {
                setBankReference(event.target.value);
              }}
            />
          )}
        </FormField>

        <FormField label={t('fields.message')} optionalHint={tCommon('optional')}>
          {(field) => (
            <Textarea
              id={field.id}
              aria-describedby={field['aria-describedby']}
              name="message"
              value={message}
              maxLength={1000}
              textareaSize="sm"
              placeholder={t('fields.messagePlaceholder')}
              disabled={submitting}
              onChange={(event) => {
                setMessage(event.target.value);
              }}
            />
          )}
        </FormField>

        <CheckboxField
          label={t('fields.confirmTransfer')}
          checked={confirmed}
          disabled={submitting}
          error={confirmError ?? undefined}
          onCheckedChange={(next) => {
            setConfirmed(next === true);
            setConfirmError(null);
          }}
        />

        {formError === null ? null : <Alert variant="error" title={formError} />}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {secondaryAction}
          <Button type="submit" size="lg" loading={submitting} disabled={preparing}>
            {submitting ? t('actions.submitting') : t('actions.submit')}
          </Button>
        </div>
      </div>
    </form>
  );
}
