'use client';

import { useTranslations } from 'next-intl';

import { Timeline, type TimelineNode, type TimelineNodeState } from '@/components/ui/timeline';
import { formatDateTime } from '@/lib/dates';
import type { Locale } from '@/i18n/routing';

/**
 * The four-node student widget of §1682, rendered from `RequestEvent` rows.
 *
 *   Demande envoyée → Justificatif reçu → Vérification en cours → Accès activé
 *
 * The state of each node is derived, never stored: the request status plus the
 * presence of a receipt places all four, and deriving them means a request that
 * moved on in another tab cannot show a stale ladder.
 *
 * §1682 fixes two exceptions, and they are why the third node takes a slot: on
 * `INFO_REQUESTED` it turns amber and carries the administrator's message with
 * an inline re-upload box; on `REJECTED` it turns red and carries the reason
 * with a WhatsApp way out. The caller owns those controls — this component
 * decides where they appear, not what they do.
 */

/** Exactly the timeline columns `listMyRequests` returns. */
export interface RequestTimelineEvent {
  readonly id: string;
  readonly type: string;
  readonly message: string | null;
  readonly createdAt: Date;
}

export interface RequestTimelineProps {
  readonly locale: Locale;
  readonly status: string;
  readonly receiptUploadedAt: Date | null;
  readonly events: readonly RequestTimelineEvent[];
  /** One or two lines under node 3 — the admin's message, the refusal reason. */
  readonly reviewDescription?: string;
  /** Rendered under node 3: the re-upload box, the WhatsApp call to action. */
  readonly reviewSlot?: React.ReactNode;
  readonly className?: string;
}

/** Timestamp of the first event of `type`, or `null`. */
function stampOf(events: readonly RequestTimelineEvent[], type: string): Date | null {
  return events.find((event) => event.type === type)?.createdAt ?? null;
}

export function RequestTimeline({
  locale,
  status,
  receiptUploadedAt,
  events,
  reviewDescription,
  reviewSlot,
  className,
}: RequestTimelineProps): React.JSX.Element {
  const t = useTranslations('enrollment.status.timeline');

  const at = (value: Date | null): string | undefined =>
    value === null ? undefined : formatDateTime(value, locale);

  const hasReceipt = receiptUploadedAt !== null;
  const approved = status === 'APPROVED';
  const rejected = status === 'REJECTED';
  const infoRequested = status === 'INFO_REQUESTED';
  const underReview = status === 'UNDER_REVIEW';
  // A cancelled or expired request stops where it stood: nothing after the last
  // thing that actually happened is claimed to be in progress.
  const stalled = status === 'CANCELLED' || status === 'EXPIRED';

  const receiptState: TimelineNodeState = hasReceipt ? 'done' : stalled ? 'pending' : 'current';

  const reviewState: TimelineNodeState = rejected
    ? 'error'
    : infoRequested
      ? 'warning'
      : approved
        ? 'done'
        : underReview
          ? 'current'
          : 'pending';

  const reviewStamp = stampOf(
    events,
    rejected ? 'REJECTED' : infoRequested ? 'INFO_REQUESTED' : 'UNDER_REVIEW',
  );

  const nodes: readonly TimelineNode[] = [
    {
      id: 'submitted',
      label: t('submitted'),
      state: 'done',
      timestamp: at(stampOf(events, 'CREATED')),
    },
    {
      id: 'receipt',
      label: t('receiptReceived'),
      state: receiptState,
      timestamp: at(receiptUploadedAt ?? stampOf(events, 'RECEIPT_UPLOADED')),
    },
    {
      id: 'review',
      label: t('verification'),
      state: reviewState,
      timestamp: at(reviewStamp),
      description: reviewDescription,
      content: reviewSlot,
    },
    {
      id: 'activated',
      label: t('activated'),
      state: approved ? 'done' : 'pending',
      timestamp: at(stampOf(events, 'APPROVED')),
    },
  ];

  return <Timeline nodes={nodes} label={t('label')} className={className} />;
}
