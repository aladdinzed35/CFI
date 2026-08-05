'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  ExternalLink,
  FileText,
  Keyboard,
  Maximize2,
  MessageCircle,
  RotateCw,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import type { ActionErrorCode } from '@/server/auth/guards';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/alert';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { FormField } from '@/components/ui/form-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { Textarea } from '@/components/ui/textarea';
import { Timeline, type TimelineNode, type TimelineNodeState } from '@/components/ui/timeline';
import { toast } from '@/components/ui/use-toast';
import {
  approveRequestAction,
  rejectRequestAction,
  requestInfoAction,
  updateRequestNoteAction,
  type RequestDecision,
} from '@/server/actions/admin-requests';

import {
  ACCOUNT_STATUS_LABEL_KEY,
  ACTION_ERROR_KEY,
  REJECT_REASON_KEYS,
  REQUEST_MESSAGE_MIN,
  STATUS_LABEL_KEY,
  TRANSFER_TYPE_LABEL_KEY,
  type FlagView,
  type QueueEntry,
  type RequestReviewView,
} from './request-view';

/**
 * The §17.3 verification drawer — the thirty-second workflow.
 *
 * ## Two panes, one decision
 * Left, the justificatif: a large preview with zoom, rotation and
 * brightness/contrast, because bank slips are photographed badly and squinting
 * at a dark 800×600 JPEG is the actual job. Right, the context an approval needs
 * — the amount the request was made for against the course's price today, the
 * student's history, the immutable timeline — and the three decisions.
 *
 * ## Keyboard-first, like the accounts queue
 * `A` approves, `I` asks for a better justificatif, `R` refuses, `J`/`K` walk
 * the queue, `Esc` closes. Bound with `onKeyDownCapture` on the panel rather
 * than on `document`: focus is trapped inside the dialog, so every key passes
 * through here and nothing fires while another screen is in front. A shortcut
 * never fires while a text field has focus — typing « Reçu illisible » into the
 * refusal must not approve the request.
 *
 * ## It decides nothing itself
 * All three buttons call a server action, which calls the domain service, which
 * owns the one transaction that writes the Payment, the invoice number, the
 * Enrollment, the counters, the coupon, the e-mail and the audit row. The drawer
 * only reports what came back — including « déjà approuvée », which is a real
 * answer and not a silent success.
 */

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

export interface VerificationDrawerProps {
  /** `null` closes the drawer — the open state lives in the URL, not here. */
  readonly review: RequestReviewView | null;
  /** The requests of the current page, in display order, for `J` / `K`. */
  readonly queue: readonly QueueEntry[];
  /** Select another request, or close when given `null`. */
  readonly onSelect: (requestId: string | null) => void;
  /** Called after a decision landed, so the list and the counters refresh. */
  readonly onDecided: () => void;
}

type Panel = 'approve' | 'info' | 'reject' | null;

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function VerificationDrawer({
  review,
  queue,
  onSelect,
  onDecided,
}: VerificationDrawerProps): React.JSX.Element {
  const t = useTranslations('admin.requests');
  const tCommon = useTranslations('common');
  const tError = useTranslations('admin.actionError');

  const [panel, setPanel] = useState<Panel>(null);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pending, setPending] = useState<Panel>(null);
  const approveRef = useRef<HTMLButtonElement>(null);

  const reviewId = review?.id ?? null;

  // A new request in the panel is a new decision: the half-written refusal of
  // the previous one must not follow it.
  useEffect(() => {
    setPanel(null);
    setMessage('');
    setMessageError(null);
    setReason('');
    setReasonError(null);
  }, [reviewId]);

  const index = review === null ? -1 : queue.findIndex((entry) => entry.id === review.id);

  const move = useCallback(
    (delta: number): void => {
      if (index < 0) return;
      const next = queue[index + delta];
      if (next !== undefined) onSelect(next.id);
    },
    [index, onSelect, queue],
  );

  const close = useCallback((): void => {
    onSelect(null);
  }, [onSelect]);

  /** Advance to the next request, or close when it was the last of the page. */
  const advance = useCallback((): void => {
    if (index < 0) {
      close();
      return;
    }
    const next = queue[index + 1];
    if (next === undefined) close();
    else onSelect(next.id);
  }, [close, index, onSelect, queue]);

  const reportFailure = useCallback(
    (code: ActionErrorCode): void => {
      toast.error({ title: tError(ACTION_ERROR_KEY[code]), dismissLabel: tCommon('close') });
    },
    [tCommon, tError],
  );

  /* ── The three decisions ─────────────────────────────────────────────── */

  /**
   * « Accès activé · Facture FAC-2026-0042 générée · E-mail envoyé à salma@… »
   * — §17.3 forbids a silent success, and an unchanged request says so too.
   */
  const announceApproval = useCallback(
    (decision: RequestDecision): void => {
      if (!decision.changed) {
        toast.info({
          title: t('status.approved'),
          description: decision.reference,
          dismissLabel: tCommon('close'),
        });
        return;
      }
      const invoice = decision.invoiceNumber ?? '';
      const email = decision.studentEmail ?? '';
      toast.success({
        title:
          email === ''
            ? t('approve.successSilent', { invoice })
            : t('approve.success', { invoice, email }),
        dismissLabel: tCommon('close'),
      });
    },
    [t, tCommon],
  );

  const approve = useCallback(async (): Promise<void> => {
    if (review === null || !review.canApprove || pending !== null) return;
    setPending('approve');
    const result = await approveRequestAction({ requestId: review.id });
    setPending(null);

    if (!result.ok) {
      reportFailure(result.error);
      return;
    }
    setPanel(null);
    announceApproval(result.data);
    onDecided();
    advance();
  }, [advance, announceApproval, onDecided, pending, reportFailure, review]);

  const submitInfo = useCallback(async (): Promise<void> => {
    if (review === null || !review.canRequestInfo || pending !== null) return;

    const trimmed = message.trim();
    if (trimmed.length < REQUEST_MESSAGE_MIN) {
      setMessageError(t('info.messageRequired'));
      return;
    }

    setPending('info');
    const result = await requestInfoAction({ requestId: review.id, message: trimmed });
    setPending(null);

    if (!result.ok) {
      reportFailure(result.error);
      return;
    }
    setPanel(null);
    toast.success({
      title: t('info.success', { name: result.data.studentName }),
      dismissLabel: tCommon('close'),
    });
    onDecided();
    advance();
  }, [advance, message, onDecided, pending, reportFailure, review, t, tCommon]);

  const submitRejection = useCallback(async (): Promise<void> => {
    if (review === null || !review.canReject || pending !== null) return;

    const trimmed = reason.trim();
    if (trimmed.length < REQUEST_MESSAGE_MIN) {
      setReasonError(t('reject.detailsRequired'));
      return;
    }

    setPending('reject');
    const result = await rejectRequestAction({ requestId: review.id, reason: trimmed });
    setPending(null);

    if (!result.ok) {
      reportFailure(result.error);
      return;
    }
    setPanel(null);
    toast.success({
      title: t('reject.success', { reference: result.data.reference }),
      dismissLabel: tCommon('close'),
    });
    onDecided();
    advance();
  }, [advance, onDecided, pending, reason, reportFailure, review, t, tCommon]);

  /**
   * `A`, `I`, `R`, `J`, `K`, `?` and `Esc`.
   *
   * Suppressed whenever the event comes from a control that accepts text, which
   * is the difference between a shortcut and a trap.
   */
  const onKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.getAttribute('role') === 'combobox');

      if (event.key === 'Escape') {
        // Close the open form first: `Esc` must not throw away a typed reason.
        if (panel !== null) {
          event.preventDefault();
          event.stopPropagation();
          setPanel(null);
        } else if (shortcutsOpen) {
          event.preventDefault();
          event.stopPropagation();
          setShortcutsOpen(false);
        }
        return;
      }

      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key.toLowerCase()) {
        case 'a':
          event.preventDefault();
          if (review?.canApprove === true) setPanel('approve');
          break;
        case 'i':
          event.preventDefault();
          if (review?.canRequestInfo === true) setPanel('info');
          break;
        case 'r':
          event.preventDefault();
          if (review?.canReject === true) setPanel('reject');
          break;
        case 'j':
          event.preventDefault();
          move(1);
          break;
        case 'k':
          event.preventDefault();
          move(-1);
          break;
        case '?':
          event.preventDefault();
          setShortcutsOpen((open) => !open);
          break;
        default:
          break;
      }
    },
    [move, panel, review, shortcutsOpen],
  );

  return (
    <Drawer
      open={review !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {review === null ? null : (
        <DrawerContent
          side="end"
          size="wide"
          closeLabel={t('drawer.close')}
          onKeyDownCapture={onKeyDownCapture}
          onOpenAutoFocus={(event) => {
            // Land on the decision, not on the close button: the whole point is
            // that `A` works the instant the panel appears.
            if (approveRef.current === null) return;
            event.preventDefault();
            approveRef.current.focus();
          }}
        >
          <DrawerHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DrawerTitle>{review.studentName}</DrawerTitle>
              <StatusPill
                domain="request"
                status={review.status}
                label={t(STATUS_LABEL_KEY[review.status])}
              />
              <Badge
                tone={review.ageTone === 'late' ? 'danger' : review.ageTone === 'warn' ? 'warn' : 'neutral'}
                variant="soft"
                size="sm"
              >
                <span data-numeric>{review.ageLabel}</span>
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
              <span className="flex items-center gap-1">
                <span data-numeric dir="ltr" className="force-ltr font-mono text-xs">
                  {review.reference}
                </span>
                <CopyButton
                  value={review.reference}
                  label={tCommon('copy')}
                  copiedLabel={tCommon('copied')}
                  size="sm"
                />
              </span>
              {index < 0 ? null : (
                <span data-numeric>
                  {t('drawer.queuePosition', { index: index + 1, total: queue.length })}
                </span>
              )}
              <Link
                href={`/admin/comptes/${review.studentId}`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-strait hover:underline"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                {review.studentEmail}
              </Link>
            </div>
          </DrawerHeader>

          <DrawerBody className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-8">
            {/* ── Left: the justificatif ───────────────────────────────── */}
            <div className="flex flex-col gap-4">
              <ReceiptViewer review={review} />
              <DeclaredFacts review={review} />
            </div>

            {/* ── Right: context and decision ──────────────────────────── */}
            <div className="flex flex-col gap-6">
              <Flags flags={review.flags} />

              {review.infoRequestedMessage === null ? null : (
                <Callout variant="warning" icon={CircleAlert}>
                  {review.infoRequestedMessage}
                </Callout>
              )}

              {review.invoicePath === null || review.invoiceNumber === null ? null : (
                <a
                  href={review.invoicePath}
                  className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-hairline bg-surface px-3 text-sm text-strait transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised"
                >
                  <Download className="size-4" aria-hidden="true" />
                  <span data-numeric dir="ltr" className="force-ltr font-mono text-xs">
                    {review.invoiceNumber}
                  </span>
                </a>
              )}

              <PriceBreakdown review={review} />

              <StudentPanel review={review} />

              <History review={review} />

              <InternalNote requestId={review.id} initial={review.adminNote} />

              {shortcutsOpen ? <Shortcuts /> : null}

              {panel === 'approve' ? (
                <ApproveConfirmation
                  review={review}
                  pending={pending === 'approve'}
                  onCancel={() => setPanel(null)}
                  onConfirm={() => void approve()}
                />
              ) : null}

              {panel === 'info' ? (
                <InfoForm
                  value={message}
                  error={messageError}
                  pending={pending === 'info'}
                  onChange={(value) => {
                    setMessage(value);
                    if (messageError !== null) setMessageError(null);
                  }}
                  onCancel={() => setPanel(null)}
                  onSubmit={() => void submitInfo()}
                />
              ) : null}

              {panel === 'reject' ? (
                <RejectForm
                  value={reason}
                  error={reasonError}
                  pending={pending === 'reject'}
                  onChange={(value) => {
                    setReason(value);
                    if (reasonError !== null) setReasonError(null);
                  }}
                  onCancel={() => setPanel(null)}
                  onSubmit={() => void submitRejection()}
                />
              ) : null}
            </div>
          </DrawerBody>

          <DrawerFooter className="flex-wrap items-center gap-2 sm:justify-between">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => move(-1)}
                disabled={index <= 0}
                aria-label={t('drawer.previous')}
                className="inline-flex size-11 items-center justify-center rounded-md border border-hairline bg-surface text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink disabled:opacity-40"
              >
                <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                disabled={index < 0 || index >= queue.length - 1}
                aria-label={t('drawer.next')}
                className="inline-flex size-11 items-center justify-center rounded-md border border-hairline bg-surface text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink disabled:opacity-40"
              >
                <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setShortcutsOpen((open) => !open)}
                aria-expanded={shortcutsOpen}
                aria-label={t('shortcuts.help')}
                className="inline-flex size-11 items-center justify-center rounded-md text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink"
              >
                <Keyboard className="size-4" aria-hidden="true" />
              </button>
            </div>

            {review.canApprove || review.canRequestInfo || review.canReject ? (
              <div className="flex flex-1 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {review.canReject ? (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setPanel('reject')}
                    iconStart={<X aria-hidden="true" />}
                  >
                    {t('reject.action')}
                  </Button>
                ) : null}
                {review.canRequestInfo ? (
                  <Button variant="secondary" type="button" onClick={() => setPanel('info')}>
                    {t('info.action')}
                  </Button>
                ) : null}
                {review.canApprove ? (
                  <Button
                    ref={approveRef}
                    variant="primary"
                    type="button"
                    loading={pending === 'approve'}
                    onClick={() => setPanel('approve')}
                    iconStart={<Check aria-hidden="true" />}
                  >
                    {t('approve.action')}
                  </Button>
                ) : null}
              </div>
            ) : (
              <Outcome review={review} />
            )}
          </DrawerFooter>
        </DrawerContent>
      )}
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/* The receipt viewer                                                          */
/* -------------------------------------------------------------------------- */

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

/**
 * Large preview with zoom, rotation and brightness/contrast.
 *
 * The transforms are CSS only — nothing is re-encoded, nothing is uploaded, and
 * the stored justificatif is never touched. Panning is the scroll container's
 * job so it stays keyboard- and trackpad-operable rather than mouse-drag-only.
 */
function ReceiptViewer({ review }: { review: RequestReviewView }): React.JSX.Element {
  const t = useTranslations('admin.requests');
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [rotation, setRotation] = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);

  const reset = useCallback((): void => {
    setZoom(ZOOM_MIN);
    setRotation(0);
    setBrightness(100);
    setContrast(100);
  }, []);

  useEffect(() => {
    reset();
  }, [reset, review.id]);

  if (review.receiptPath === null) {
    return (
      <section aria-label={t('drawer.receiptTitle')}>
        <Callout variant="warning" icon={CircleAlert}>
          {t('drawer.noReceipt')}
        </Callout>
      </section>
    );
  }

  const path = review.receiptPath;

  return (
    <section aria-label={t('drawer.receiptTitle')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1">
        <h3 className="me-auto font-display text-heading text-ink">{t('drawer.receiptTitle')}</h3>

        {review.receiptIsImage ? (
          <>
            <IconButton
              label={t('drawer.zoomOut')}
              onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value - ZOOM_STEP))}
              disabled={zoom <= ZOOM_MIN}
            >
              <ZoomOut className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={t('drawer.zoomIn')}
              onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value + ZOOM_STEP))}
              disabled={zoom >= ZOOM_MAX}
            >
              <ZoomIn className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={t('drawer.rotate')}
              onClick={() => setRotation((value) => (value + 90) % 360)}
            >
              <RotateCw className="size-4" aria-hidden="true" />
            </IconButton>
          </>
        ) : null}

        <a
          href={path}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('drawer.fullscreen')}
          title={t('drawer.fullscreen')}
          className="inline-flex size-11 items-center justify-center rounded-md text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink"
        >
          <Maximize2 className="size-4" aria-hidden="true" />
        </a>
        <a
          href={path}
          download
          aria-label={t('drawer.download')}
          title={t('drawer.download')}
          className="inline-flex size-11 items-center justify-center rounded-md text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink"
        >
          <Download className="size-4" aria-hidden="true" />
        </a>
      </div>

      <div className="max-h-[60vh] overflow-auto rounded-md border border-hairline bg-raised p-2">
        {review.receiptIsImage ? (
          <div className="flex min-h-64 items-center justify-center">
            <Image
              src={path}
              alt={t('drawer.receiptTitle')}
              width={1200}
              height={1600}
              unoptimized
              className="h-auto w-full max-w-none origin-center"
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                filter: `brightness(${brightness}%) contrast(${contrast}%)`,
              }}
            />
          </div>
        ) : (
          <a
            href={path}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-sm text-sm text-strait hover:underline"
          >
            <FileText className="size-10 text-ink-muted" aria-hidden="true" />
            {t('drawer.fullscreen')}
          </a>
        )}
      </div>

      {review.receiptIsImage ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Slider
            label={t('drawer.brightness')}
            value={brightness}
            onChange={setBrightness}
          />
          <Slider label={t('drawer.contrast')} value={contrast} onChange={setContrast} />
          <div className="sm:col-span-2">
            <Button variant="ghost" size="sm" type="button" onClick={reset}>
              {t('drawer.resetView')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <FormField label={label}>
      {(field) => (
        <input
          id={field.id}
          type="range"
          min={50}
          max={200}
          step={5}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-11 w-full accent-strait"
        />
      )}
    </FormField>
  );
}

function IconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex size-11 items-center justify-center rounded-md text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Panes                                                                       */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  value,
  ltr = false,
  copyable = false,
}: {
  label: string;
  value: string | null;
  ltr?: boolean;
  copyable?: boolean;
}): React.JSX.Element {
  const t = useTranslations('admin.requests');
  const tCommon = useTranslations('common');

  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span
          className={cn('min-w-0 break-words text-sm text-ink', ltr ? 'force-ltr' : null)}
          dir={ltr ? 'ltr' : undefined}
        >
          {value ?? t('drawer.noBankReference')}
        </span>
        {copyable && value !== null ? (
          <CopyButton
            value={value}
            label={tCommon('copy')}
            copiedLabel={tCommon('copied')}
            size="sm"
          />
        ) : null}
      </dd>
    </div>
  );
}

/** What the student declared, beside the image they declared it about. */
function DeclaredFacts({ review }: { review: RequestReviewView }): React.JSX.Element {
  const t = useTranslations('admin.requests');

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      <Field label={t('drawer.declaredDate')} value={review.transferDateLabel} />
      <Field
        label={t('drawer.bankReference')}
        value={review.transferBankRef}
        ltr
        copyable={review.transferBankRef !== null}
      />
      <Field label={t('columns.transferType')} value={t(TRANSFER_TYPE_LABEL_KEY[review.transferType])} />
      <Field label={t('columns.submittedAt')} value={review.submittedAtLabel} />
      <Field label={t('columns.receipt')} value={review.receiptUploadedAtLabel} />
      <div className="min-w-0 sm:col-span-2">
        <dt className="text-xs text-ink-muted">{t('drawer.studentMessage')}</dt>
        <dd className="text-sm text-ink">{review.studentMessage ?? t('drawer.noMessage')}</dd>
      </div>
    </dl>
  );
}

/** Price − réduction = montant dû, with the §2066 amount signal spelled out. */
function PriceBreakdown({ review }: { review: RequestReviewView }): React.JSX.Element {
  const t = useTranslations('admin.requests');

  return (
    <section className="flex flex-col gap-2 rounded-md border border-hairline bg-raised p-4">
      <h3 className="font-display text-heading text-ink">{t('drawer.courseTitle')}</h3>
      {review.courseSlug === null ? (
        <p className="text-sm text-ink">{review.courseTitle}</p>
      ) : (
        <Link
          href={`/formations/${review.courseSlug}`}
          className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md text-sm text-strait hover:underline"
        >
          {review.courseTitle}
          <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
        </Link>
      )}

      <dl className="mt-2 flex flex-col gap-1 text-sm">
        <Row label={t('drawer.priceLabel')} value={review.priceLabel} />
        {review.discountLabel === null ? null : (
          <Row label={t('drawer.couponLabel')} value={`−${review.discountLabel}`} />
        )}
        <Row label={t('drawer.dueLabel')} value={review.dueLabel} strong />
      </dl>

      {review.amountMismatch && review.coursePriceLabel !== null ? (
        <Callout variant="warning" icon={TriangleAlert}>
          {t('drawer.amountMismatch')} · {t('drawer.expectedAmount')} :{' '}
          <span data-numeric dir="ltr" className="force-ltr">
            {review.coursePriceLabel}
          </span>
        </Callout>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Check className="size-4 shrink-0" aria-hidden="true" />
          {t('drawer.amountMatch')}
        </p>
      )}
    </section>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd
        data-numeric
        dir="ltr"
        className={cn('force-ltr', strong ? 'font-medium text-brass' : 'text-ink')}
      >
        {value}
      </dd>
    </div>
  );
}

/** Who they are, what they already paid, what else they have asked for. */
function StudentPanel({ review }: { review: RequestReviewView }): React.JSX.Element {
  const t = useTranslations('admin.requests');
  const tAccounts = useTranslations('admin.accounts');

  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-display text-heading text-ink">{t('drawer.studentTitle')}</h3>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-ink-muted">{t('drawer.accountStatus')}</dt>
          <dd>
            <StatusPill
              domain="account"
              status={review.accountStatus}
              label={tAccounts(ACCOUNT_STATUS_LABEL_KEY[review.accountStatus])}
            />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-muted">{t('columns.student')}</dt>
          <dd className="force-ltr text-sm text-ink" dir="ltr">
            {review.studentPhoneDisplay}
            {review.studentCity === null ? '' : ` · ${review.studentCity}`}
          </dd>
        </div>
      </dl>

      <ul role="list" className="flex flex-col gap-1 text-sm text-ink-muted">
        <li>{t('drawer.activeEnrollments', { count: review.activeEnrollments })}</li>
        <li>
          {t('drawer.previousPayments', { count: review.previousPayments })}
          {review.previousPayments === 0 ? null : (
            <>
              {' · '}
              <span data-numeric dir="ltr" className="force-ltr">
                {review.previousPaidLabel}
              </span>
            </>
          )}
        </li>
        <li>{review.everRejected ? t('drawer.hadRejectedRequest') : t('drawer.firstRequest')}</li>
      </ul>

      {review.whatsappHref === null ? null : (
        <a
          href={review.whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-pill border border-hairline bg-surface px-4 text-sm text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
          {tAccounts('whatsapp', { name: review.studentName })}
        </a>
      )}

      {review.otherRequests.length === 0 ? null : (
        <ul role="list" className="flex flex-col gap-2">
          {review.otherRequests.map((other) => (
            <li
              key={other.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-surface px-3 py-2 text-sm"
            >
              <span data-numeric dir="ltr" className="force-ltr font-mono text-xs text-ink-muted">
                {other.reference}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">{other.courseTitle}</span>
              <span data-numeric dir="ltr" className="force-ltr text-brass">
                {other.amountLabel}
              </span>
              <StatusPill
                domain="request"
                status={other.status}
                label={t(STATUS_LABEL_KEY[other.status])}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const TIMELINE_STATE: Record<string, TimelineNodeState> = {
  REJECTED: 'error',
  EXPIRED: 'error',
  CANCELLED: 'error',
  INFO_REQUESTED: 'warning',
};

/** The immutable `RequestEvent` history — facts, in the order they happened. */
function History({ review }: { review: RequestReviewView }): React.JSX.Element | null {
  const tRoot = useTranslations();

  if (review.events.length === 0) return null;

  const nodes: TimelineNode[] = review.events.map((event) => ({
    id: event.id,
    label: tRoot(event.labelKey),
    state: TIMELINE_STATE[event.type] ?? 'done',
    timestamp: event.timestamp,
    ...(event.message === null ? {} : { description: event.message }),
  }));

  return (
    <Timeline
      nodes={nodes}
      label={tRoot('enrollment.status.timeline.label')}
      /* Same reason as the student's own card: the glyph is aria-hidden, so
         without a state word the timeline reads as a flat list of events
         (WCAG 1.4.1). */
      stateLabels={{
        done: tRoot('enrollment.status.timeline.state.done'),
        current: tRoot('enrollment.status.timeline.state.current'),
        pending: tRoot('enrollment.status.timeline.state.pending'),
        warning: tRoot('enrollment.status.timeline.state.warning'),
        error: tRoot('enrollment.status.timeline.state.error'),
      }}
    />
  );
}

/** The four §2066 signals, repeated where the decision is taken. */
function Flags({ flags }: { flags: readonly FlagView[] }): React.JSX.Element | null {
  const t = useTranslations('admin.requests');

  if (flags.length === 0) return null;

  return (
    <ul role="list" className="flex flex-wrap gap-2">
      {flags.map((flag) => (
        <li key={flag.key}>
          {flag.relatedRequestId === null ? (
            <Badge tone={flag.tone} variant="soft">
              {t(flag.labelKey)}
            </Badge>
          ) : (
            <Link
              href={`/admin/demandes?fiche=${flag.relatedRequestId}`}
              className="inline-flex min-h-11 items-center"
            >
              <Badge tone={flag.tone} variant="soft">
                {t(flag.labelKey)} · {t('flags.viewOriginal')}
              </Badge>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/** What already happened to a request nobody can decide on any more. */
function Outcome({ review }: { review: RequestReviewView }): React.JSX.Element {
  const t = useTranslations('admin.requests');

  return (
    <div className="flex flex-1 flex-col gap-1 text-sm text-ink-muted sm:text-end">
      {review.invoiceNumber === null ? null : (
        <span data-numeric dir="ltr" className="force-ltr font-mono text-xs text-ink">
          {review.invoiceNumber}
        </span>
      )}
      {review.rejectionReason === null ? null : <span>{review.rejectionReason}</span>}
      {review.reviewedByName === null ? null : (
        <span>
          {review.reviewedByName}
          {review.reviewedAtLabel === null ? '' : ` · ${review.reviewedAtLabel}`}
        </span>
      )}
      {review.invoiceNumber === null &&
      review.rejectionReason === null &&
      review.reviewedByName === null ? (
        <span>{t(STATUS_LABEL_KEY[review.status])}</span>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Decision forms                                                              */
/* -------------------------------------------------------------------------- */

function ApproveConfirmation({
  review,
  pending,
  onCancel,
  onConfirm,
}: {
  review: RequestReviewView;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const t = useTranslations('admin.requests');
  const tCommon = useTranslations('common');

  return (
    <section
      aria-label={t('approve.title')}
      className="flex flex-col gap-4 rounded-md border border-brass/40 bg-brass-wash p-4"
    >
      <div>
        <h3 className="font-display text-heading text-ink">{t('approve.title')}</h3>
        <p className="mt-1 text-sm text-ink-muted">{t('approve.body')}</p>
      </div>

      <p className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink-muted">{t('drawer.dueLabel')}</span>
        <span data-numeric dir="ltr" className="force-ltr text-lead font-medium text-brass">
          {review.dueLabel}
        </span>
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" type="button" onClick={onCancel}>
          {tCommon('cancel')}
        </Button>
        <Button
          variant="primary"
          type="button"
          loading={pending}
          onClick={onConfirm}
          iconStart={<Check aria-hidden="true" />}
        >
          {pending ? t('approve.pending') : t('approve.submit')}
        </Button>
      </div>
    </section>
  );
}

function InfoForm({
  value,
  error,
  pending,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: string;
  error: string | null;
  pending: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}): React.JSX.Element {
  const t = useTranslations('admin.requests');
  const tCommon = useTranslations('common');

  return (
    <section
      aria-label={t('info.title')}
      className="flex flex-col gap-4 rounded-md border border-warn/40 bg-warn-wash p-4"
    >
      <h3 className="font-display text-heading text-ink">{t('info.title')}</h3>

      <FormField
        label={t('info.messageLabel')}
        required
        requiredHint={tCommon('required')}
        error={error}
      >
        {(field) => (
          <Textarea
            id={field.id}
            aria-describedby={field['aria-describedby']}
            aria-invalid={field['aria-invalid']}
            invalid={field['aria-invalid'] === true}
            value={value}
            placeholder={t('info.messagePlaceholder')}
            textareaSize="sm"
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </FormField>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" type="button" onClick={onCancel}>
          {tCommon('cancel')}
        </Button>
        <Button variant="primary" type="button" loading={pending} onClick={onSubmit}>
          {pending ? t('info.pending') : t('info.submit')}
        </Button>
      </div>
    </section>
  );
}

/**
 * The refusal.
 *
 * The reason is free text because e-mail #10 shows it verbatim; the select only
 * *pre-fills* it with one of the five §17.3 wordings, which is what makes a
 * one-click refusal possible without sending the student a bare code.
 */
function RejectForm({
  value,
  error,
  pending,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: string;
  error: string | null;
  pending: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}): React.JSX.Element {
  const t = useTranslations('admin.requests');
  const tCommon = useTranslations('common');
  // Empty until the administrator picks one: no item carries `''`, so the
  // placeholder is what shows, and nothing is pre-selected on their behalf.
  const [preset, setPreset] = useState<string>('');

  return (
    <section
      aria-label={t('reject.title')}
      className="flex flex-col gap-4 rounded-md border border-danger/40 bg-danger-wash p-4"
    >
      <div>
        <h3 className="font-display text-heading text-ink">{t('reject.title')}</h3>
        <p className="mt-1 text-sm text-ink-muted">{t('reject.body')}</p>
      </div>

      <FormField label={t('reject.reasonLabel')}>
        {(field) => (
          <Select
            value={preset}
            onValueChange={(selected) => {
              setPreset(selected);
              // Pre-fills rather than replaces: the administrator still owns the
              // sentence the student will read.
              onChange(t(selected));
            }}
          >
            <SelectTrigger id={field.id} selectSize="sm">
              <SelectValue placeholder={t('reject.reasonPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {REJECT_REASON_KEYS.map((key) => (
                <SelectItem key={key} value={key}>
                  {t(key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>

      <FormField
        label={t('reject.detailsLabel')}
        required
        requiredHint={tCommon('required')}
        error={error}
      >
        {(field) => (
          <Textarea
            id={field.id}
            aria-describedby={field['aria-describedby']}
            aria-invalid={field['aria-invalid']}
            invalid={field['aria-invalid'] === true}
            value={value}
            placeholder={t('reject.detailsPlaceholder')}
            textareaSize="sm"
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </FormField>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" type="button" onClick={onCancel}>
          {tCommon('cancel')}
        </Button>
        <Button
          variant="danger"
          type="button"
          loading={pending}
          onClick={onSubmit}
          iconStart={<X aria-hidden="true" />}
        >
          {pending ? t('reject.pending') : t('reject.submit')}
        </Button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Internal note                                                               */
/* -------------------------------------------------------------------------- */

function InternalNote({
  requestId,
  initial,
}: {
  requestId: string;
  initial: string;
}): React.JSX.Element {
  const t = useTranslations('admin.requests');
  const tCommon = useTranslations('common');
  const tError = useTranslations('admin.actionError');

  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(initial);
  }, [initial, requestId]);

  const save = useCallback(async (): Promise<void> => {
    setSaving(true);
    const result = await updateRequestNoteAction({ requestId, note: value });
    setSaving(false);

    if (!result.ok) {
      toast.error({
        title: tError(ACTION_ERROR_KEY[result.error]),
        dismissLabel: tCommon('close'),
      });
      return;
    }
    toast.success({ title: tCommon('save'), dismissLabel: tCommon('close') });
  }, [requestId, tCommon, tError, value]);

  return (
    <section className="flex flex-col gap-2">
      <FormField label={t('drawer.internalNote')} optionalHint={tCommon('optional')}>
        {(field) => (
          <Textarea
            id={field.id}
            value={value}
            placeholder={t('drawer.internalNotePlaceholder')}
            textareaSize="sm"
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </FormField>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        className="w-fit"
        loading={saving}
        disabled={value === initial}
        onClick={() => void save()}
      >
        {tCommon('save')}
      </Button>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Shortcuts                                                                   */
/* -------------------------------------------------------------------------- */

function Shortcuts(): React.JSX.Element {
  const t = useTranslations('admin.requests');

  return (
    <section
      aria-label={t('shortcuts.title')}
      className="rounded-md border border-hairline bg-raised p-4"
    >
      <h3 className="text-sm font-medium text-ink">{t('shortcuts.title')}</h3>
      <dl className="mt-2 flex flex-col gap-1.5 text-sm">
        <Shortcut keys="A" label={t('shortcuts.approve')} />
        <Shortcut keys="I" label={t('shortcuts.requestInfo')} />
        <Shortcut keys="R" label={t('shortcuts.reject')} />
        <Shortcut keys="J" label={t('shortcuts.next')} />
        <Shortcut keys="K" label={t('shortcuts.previous')} />
        <Shortcut keys="Esc" label={t('shortcuts.close')} />
      </dl>
      <p className="mt-2 text-xs text-ink-muted">{t('drawer.keyboardHint')}</p>
    </section>
  );
}

function Shortcut({ keys, label }: { keys: string; label: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <dt>
        <kbd className="inline-flex min-w-8 justify-center rounded-sm border border-hairline bg-surface px-2 py-0.5 font-mono text-xs text-ink">
          {keys}
        </kbd>
      </dt>
      <dd className="text-ink-muted">{label}</dd>
    </div>
  );
}
