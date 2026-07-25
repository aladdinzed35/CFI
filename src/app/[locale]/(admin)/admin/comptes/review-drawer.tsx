'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Keyboard,
  MailCheck,
  MailWarning,
  MessageCircle,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { ActionErrorCode } from '@/server/auth/guards';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
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
import { toast } from '@/components/ui/use-toast';
import {
  approveAccountAction,
  rejectAccountAction,
  type AccountOutcome,
} from '@/server/actions/admin-accounts';
import {
  ACTION_ERROR_KEY,
  REJECTION_DETAILS_MIN,
  REJECTION_REASONS,
  STATUS_LABEL_KEY,
  type AccountReviewView,
  type QueueEntry,
  type RejectionCode,
} from './account-view';

/**
 * The review drawer of §17.2 — « everything at once », then one of two decisions.
 *
 * ## Why it is keyboard-first
 * The centre validates in batches: an administrator opens the queue in the
 * evening and clears it. `A` approves, `R` opens the refusal, `J`/`K` walk the
 * queue and `Esc` closes — so fifty accounts take two minutes rather than fifty
 * round trips through a mouse. The shortcuts are listed in the drawer behind a
 * `?` button, because an undiscoverable shortcut is not a feature.
 *
 * They are bound with `onKeyDownCapture` on the panel rather than on `document`:
 * focus is trapped inside the dialog, so every key the administrator presses
 * passes through here, and nothing fires while another screen is in front. A
 * shortcut never fires while a text field, a textarea or a select has focus —
 * typing « Adresse incomplète » into the refusal must not approve the account.
 *
 * ## What it does not do
 * It never decides anything itself: both buttons call a server action, which
 * calls the moderation service, which owns the state machine, the e-mails and
 * the audit row. The drawer only reports what came back — including
 * « déjà validé », which is a real answer and not a silent success.
 */

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

export interface ReviewDrawerProps {
  /** `null` closes the drawer — the open state lives in the URL, not here. */
  readonly review: AccountReviewView | null;
  /** The accounts of the current page, in display order, for `J` / `K`. */
  readonly queue: readonly QueueEntry[];
  /** Select another account, or close when given `null`. */
  readonly onSelect: (userId: string | null) => void;
  /** Called after a decision landed, so the list and the counters refresh. */
  readonly onDecided: () => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function ReviewDrawer({
  review,
  queue,
  onSelect,
  onDecided,
}: ReviewDrawerProps): React.JSX.Element {
  const t = useTranslations('admin.accounts');
  const tCommon = useTranslations('common');
  const tError = useTranslations('admin.actionError');

  const [rejecting, setRejecting] = useState(false);
  const [reasonCode, setReasonCode] = useState<RejectionCode>('INCOMPLETE_INFO');
  const [details, setDetails] = useState('');
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const approveRef = useRef<HTMLButtonElement>(null);

  const reviewId = review?.id ?? null;

  // A new account in the panel is a new decision: the half-written refusal of
  // the previous one must not follow it.
  useEffect(() => {
    setRejecting(false);
    setDetails('');
    setDetailsError(null);
    setReasonCode('INCOMPLETE_INFO');
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

  /** Advance to the next account in the queue, or close when it was the last. */
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

  const announce = useCallback(
    (outcome: AccountOutcome, kind: 'approve' | 'reject'): void => {
      const name = outcome.fullName ?? '';
      if (outcome.result === 'changed') {
        toast.success({
          // « Compte validé · e-mail envoyé à salma@… » — never a silent success.
          title: kind === 'approve' ? t('approve.success', { name }) : t('reject.success', { name }),
          description: outcome.email ?? undefined,
          dismissLabel: tCommon('close'),
        });
        return;
      }
      toast.info({
        title: kind === 'approve' ? t('approve.unchanged', { name }) : t('reject.unchanged', { name }),
        dismissLabel: tCommon('close'),
      });
    },
    [t, tCommon],
  );

  const approve = useCallback(async (): Promise<void> => {
    if (review === null || !review.canApprove || pending !== null) return;
    setPending('approve');
    const result = await approveAccountAction({ userId: review.id });
    setPending(null);

    if (!result.ok) {
      reportFailure(result.error);
      return;
    }
    announce(result.data, 'approve');
    onDecided();
    advance();
  }, [advance, announce, onDecided, pending, reportFailure, review]);

  const submitRejection = useCallback(async (): Promise<void> => {
    if (review === null || !review.canReject || pending !== null) return;

    const trimmed = details.trim();
    if (reasonCode === 'OTHER' && trimmed.length < REJECTION_DETAILS_MIN) {
      setDetailsError(t('reject.detailsRequired'));
      return;
    }

    setPending('reject');
    const result = await rejectAccountAction({
      userId: review.id,
      code: reasonCode,
      ...(trimmed === '' ? {} : { details: trimmed }),
    });
    setPending(null);

    if (!result.ok) {
      reportFailure(result.error);
      return;
    }
    setRejecting(false);
    announce(result.data, 'reject');
    onDecided();
    advance();
  }, [advance, announce, details, onDecided, pending, reasonCode, reportFailure, review, t]);

  /**
   * `A`, `R`, `J`, `K`, `?` and `Esc`.
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
        // Close the refusal first: `Esc` must not throw away a typed reason.
        if (rejecting) {
          event.preventDefault();
          event.stopPropagation();
          setRejecting(false);
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
          void approve();
          break;
        case 'r':
          event.preventDefault();
          if (review?.canReject === true) setRejecting(true);
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
    [approve, move, rejecting, review, shortcutsOpen],
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
          size="lg"
          closeLabel={t('drawer.close')}
          onKeyDownCapture={onKeyDownCapture}
          onOpenAutoFocus={(event) => {
            // Land on the decision, not on the close button: the whole point is
            // that `A` and `R` work the instant the panel appears. When there is
            // no decision to take, Radix keeps its own initial focus — moving it
            // nowhere would leave the panel unfocused and the shortcuts deaf.
            if (approveRef.current === null) return;
            event.preventDefault();
            approveRef.current.focus();
          }}
        >
          <DrawerHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DrawerTitle>{review.fullName}</DrawerTitle>
              <StatusPill
                domain="account"
                status={review.status}
                label={t(STATUS_LABEL_KEY[review.status])}
                srPrefix={t('drawer.status')}
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
              {index < 0 ? null : (
                <span data-numeric>
                  {t('drawer.queuePosition', { index: index + 1, total: queue.length })}
                </span>
              )}
              <Link
                href={`/admin/comptes/${review.id}`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-strait hover:underline"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                {t('drawer.openDetail')}
              </Link>
            </div>
          </DrawerHeader>

          <DrawerBody className="flex flex-col gap-6">
            <Warnings review={review} />

            <Duplicates review={review} />

            <section className="flex flex-col gap-3">
              <h3 className="font-display text-heading text-ink">{t('drawer.profile')}</h3>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <Field label={t('drawer.fullName')} value={review.fullName} />
                <Field label={t('drawer.email')} value={review.email} ltr />
                <Field label={t('drawer.phoneE164')} value={review.phoneDisplay} ltr copyable />
                <Field label={t('drawer.phoneNational')} value={review.phoneNational} ltr copyable />
                <Field label={t('drawer.city')} value={review.city} />
                <Field label={t('drawer.professionalStatus')} value={review.professionalStatus} />
                <Field label={t('drawer.locale')} value={review.localeLabel} />
                <Field label={t('drawer.registeredAt')} value={review.registeredAt} />
                <Field label={t('drawer.verifiedAt')} value={review.verifiedAt} />
                <Field label={t('drawer.approvedAt')} value={review.approvedAt} />
                <Field label={t('drawer.lastLogin')} value={review.lastLoginAt} />
              </dl>
            </section>

            {review.rejection === null ? null : (
              <section className="flex flex-col gap-2 rounded-md border border-hairline bg-raised p-4">
                <h3 className="text-sm font-medium text-ink">{t('drawer.rejectionReason')}</h3>
                <p className="text-sm text-ink-muted">{review.rejection.reasonLabel}</p>
                {review.rejection.details === null ? null : (
                  <p className="text-sm text-ink">{review.rejection.details}</p>
                )}
              </section>
            )}

            <section className="flex flex-col gap-3">
              <h3 className="font-display text-heading text-ink">{t('drawer.signals')}</h3>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <Field label={t('drawer.ip')} value={review.registrationIp} ltr />
                <Field label={t('drawer.userAgent')} value={review.registrationUserAgent} ltr />
              </dl>
            </section>

            {review.whatsappHref === null ? null : (
              <a
                href={review.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 w-fit items-center gap-2 rounded-pill border border-hairline bg-surface px-4 text-sm text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink"
              >
                <MessageCircle className="size-4" aria-hidden="true" />
                {t('whatsapp', { name: review.fullName })}
              </a>
            )}

            {shortcutsOpen ? (
              <section
                aria-label={t('drawer.shortcutsTitle')}
                className="rounded-md border border-hairline bg-raised p-4"
              >
                <h3 className="text-sm font-medium text-ink">{t('drawer.shortcutsTitle')}</h3>
                <dl className="mt-2 flex flex-col gap-1.5 text-sm">
                  <Shortcut keys="A" label={t('drawer.shortcutApprove')} />
                  <Shortcut keys="R" label={t('drawer.shortcutReject')} />
                  <Shortcut keys="J" label={t('drawer.shortcutNext')} />
                  <Shortcut keys="K" label={t('drawer.shortcutPrevious')} />
                  <Shortcut keys="Esc" label={t('drawer.shortcutClose')} />
                </dl>
              </section>
            ) : null}

            {rejecting ? (
              <section
                aria-label={t('reject.title')}
                className="flex flex-col gap-4 rounded-md border border-danger/40 bg-danger-wash p-4"
              >
                <div>
                  <h3 className="font-display text-heading text-ink">{t('reject.title')}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{t('reject.body')}</p>
                </div>

                <FormField label={t('reject.reasonLabel')} required requiredHint={tCommon('required')}>
                  {(field) => (
                    <Select
                      value={reasonCode}
                      onValueChange={(value) => setReasonCode(value as RejectionCode)}
                    >
                      <SelectTrigger id={field.id} aria-describedby={field['aria-describedby']}>
                        <SelectValue placeholder={t('reject.reasonPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {REJECTION_REASONS.map((reason) => (
                          <SelectItem key={reason.code} value={reason.code}>
                            {t(reason.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>

                <FormField
                  label={t('reject.detailsLabel')}
                  required={reasonCode === 'OTHER'}
                  requiredHint={tCommon('required')}
                  optionalHint={reasonCode === 'OTHER' ? undefined : tCommon('optional')}
                  error={detailsError}
                >
                  {(field) => (
                    <Textarea
                      id={field.id}
                      aria-describedby={field['aria-describedby']}
                      aria-invalid={field['aria-invalid']}
                      invalid={field['aria-invalid'] === true}
                      value={details}
                      placeholder={t('reject.detailsPlaceholder')}
                      textareaSize="sm"
                      onChange={(event) => {
                        setDetails(event.target.value);
                        if (detailsError !== null) setDetailsError(null);
                      }}
                    />
                  )}
                </FormField>

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="ghost" onClick={() => setRejecting(false)} type="button">
                    {tCommon('cancel')}
                  </Button>
                  <Button
                    variant="danger"
                    type="button"
                    loading={pending === 'reject'}
                    onClick={() => void submitRejection()}
                    iconStart={<X aria-hidden="true" />}
                  >
                    {pending === 'reject' ? t('reject.pending') : t('reject.submit')}
                  </Button>
                </div>
              </section>
            ) : null}
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
                aria-label={t('drawer.shortcutsHelp')}
                className="inline-flex size-11 items-center justify-center rounded-md text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink"
              >
                <Keyboard className="size-4" aria-hidden="true" />
              </button>
            </div>

            {review.canApprove || review.canReject ? (
              <div className="flex flex-1 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {review.canReject ? (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setRejecting(true)}
                    iconStart={<X aria-hidden="true" />}
                  >
                    {t('reject.action')}
                  </Button>
                ) : null}
                {review.canApprove ? (
                  <Button
                    ref={approveRef}
                    variant="primary"
                    type="button"
                    loading={pending === 'approve'}
                    onClick={() => void approve()}
                    iconStart={<Check aria-hidden="true" />}
                  >
                    {pending === 'approve' ? t('approve.pending') : t('approve.action')}
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="flex-1 text-sm text-ink-muted sm:text-end">
                {t('drawer.decisionUnavailable')}
              </p>
            )}
          </DrawerFooter>
        </DrawerContent>
      )}
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
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
  const tCommon = useTranslations('common');
  const tAccounts = useTranslations('admin.accounts');

  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span
          className={cn('min-w-0 break-words text-sm text-ink', ltr ? 'force-ltr' : null)}
          dir={ltr ? 'ltr' : undefined}
        >
          {value ?? tAccounts('drawer.notProvided')}
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

/** The e-mail-domain and phone signals §17.2 wants in front of the decision. */
function Warnings({ review }: { review: AccountReviewView }): React.JSX.Element | null {
  const t = useTranslations('admin.accounts');
  const items: React.JSX.Element[] = [];

  if (review.emailDisposable) {
    items.push(
      <Callout key="disposable" variant="warning" icon={MailWarning}>
        {t('warnings.disposableDomain')}
      </Callout>,
    );
  }
  if (review.emailTypoSuggestion !== null) {
    items.push(
      <Callout key="typo" variant="warning" icon={MailCheck}>
        {t('warnings.typoDomain', { suggestion: review.emailTypoSuggestion })}
      </Callout>,
    );
  }
  if (!review.phoneIsMoroccan) {
    items.push(
      <Callout key="foreign" variant="info" icon={CircleAlert}>
        {t('warnings.foreignPhone')}
      </Callout>,
    );
  }

  if (items.length === 0) return null;
  return <div className="flex flex-col gap-2">{items}</div>;
}

/** Duplicate detection (§17.2): prominent, with a link to every match. */
function Duplicates({ review }: { review: AccountReviewView }): React.JSX.Element | null {
  const t = useTranslations('admin.accounts');
  const groups = [
    { key: 'phone', message: t('warnings.duplicatePhone'), rows: review.duplicatesByPhone },
    { key: 'name', message: t('warnings.duplicateName'), rows: review.duplicatesByNameAndCity },
  ].filter((group) => group.rows.length > 0);

  if (groups.length === 0) return null;

  return (
    <section
      aria-label={t('drawer.duplicatesTitle')}
      className="flex flex-col gap-3 rounded-md border border-danger/40 bg-danger-wash p-4"
    >
      <h3 className="flex items-center gap-2 font-display text-heading text-ink">
        <TriangleAlert className="size-5 shrink-0 text-danger" aria-hidden="true" />
        {t('drawer.duplicatesTitle')}
      </h3>

      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-2">
          <p className="text-sm text-ink">{group.message}</p>
          <ul role="list" className="flex flex-col gap-2">
            {group.rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/admin/comptes/${row.id}`}
                  className="flex min-h-11 flex-col justify-center rounded-md border border-hairline bg-surface px-3 py-2 transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised"
                >
                  <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                    {row.fullName}
                    <StatusPill
                      domain="account"
                      status={row.status}
                      label={t(STATUS_LABEL_KEY[row.status])}
                    />
                  </span>
                  <span className="force-ltr text-xs text-ink-muted" dir="ltr">
                    {row.email} · {row.phoneDisplay}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {row.city ?? t('drawer.notProvided')} · {row.registeredAt}
                  </span>
                  <span className="sr-only">{t('warnings.seeAccount')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
