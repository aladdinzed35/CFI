import type { ActionErrorCode } from '@/server/auth/guards';
import type { AccountStatus, RequestStatus } from '@/components/ui/status-pill';

/**
 * The contract between `/admin/demandes` and the client components that render
 * it: URL parameter names, the queue definitions, the label maps and the
 * view-model shapes.
 *
 * No directive on purpose — the same reasoning as `comptes/account-view.ts`. A
 * `'use client'` module exports client *references* into the server graph, and
 * a server module dragged into the browser bundle would take Prisma with it. A
 * neutral module is the only place both graphs can read the same constant.
 */

export type { AccountStatus, RequestStatus };

/** Mirrors `TransferType` in prisma/schema.prisma; `src/app/**` may not import Prisma (§5). */
export type TransferType = 'INSTANT' | 'STANDARD_48H' | 'CASH_AT_CENTER';

/* -------------------------------------------------------------------------- */
/* URL contract                                                                */
/* -------------------------------------------------------------------------- */

/** Search-parameter names. French, like every URL in this application (§10.1). */
export const PARAM = {
  queue: 'onglet',
  search: 'q',
  page: 'page',
  pageSize: 'taille',
  sortBy: 'tri',
  sortDir: 'sens',
  course: 'formation',
  transferType: 'mode',
  amountMin: 'min',
  amountMax: 'max',
  from: 'du',
  to: 'au',
  flagged: 'signaux',
  review: 'fiche',
} as const;

/**
 * Tabs = queues (§17.3). Declaration order is render order, and « À vérifier »
 * comes first because that is the work.
 */
export const QUEUES = [
  {
    key: 'a-verifier',
    statuses: ['UNDER_REVIEW'],
    labelKey: 'tabs.toVerify',
    emptyKey: 'empty.toVerify',
  },
  {
    key: 'informations',
    statuses: ['INFO_REQUESTED'],
    labelKey: 'tabs.infoRequested',
    emptyKey: 'empty.infoRequested',
  },
  {
    key: 'attente-justificatif',
    statuses: ['AWAITING_RECEIPT'],
    labelKey: 'tabs.awaitingReceipt',
    emptyKey: 'empty.awaitingReceipt',
  },
  {
    key: 'approuvees',
    statuses: ['APPROVED'],
    labelKey: 'tabs.approved',
    emptyKey: 'empty.approved',
  },
  {
    key: 'refusees',
    statuses: ['REJECTED'],
    labelKey: 'tabs.rejected',
    emptyKey: 'empty.rejected',
  },
  {
    key: 'expirees',
    statuses: ['EXPIRED'],
    labelKey: 'tabs.expired',
    emptyKey: 'empty.expired',
  },
  { key: 'toutes', statuses: [], labelKey: 'tabs.all', emptyKey: 'empty.all' },
] as const satisfies readonly {
  key: string;
  statuses: readonly RequestStatus[];
  labelKey: string;
  emptyKey: string;
}[];

export type QueueKey = (typeof QUEUES)[number]['key'];

/**
 * URL sort value → read-model column.
 *
 * Two, deliberately. `expiresAt` is not offered: it is reset when a
 * justificatif is attached and again when an administrator asks for a
 * complement, so sorting the SLA column by it would order the queue by
 * something other than the waiting time the column displays.
 */
export const SORT_KEYS = {
  date: 'createdAt',
  montant: 'amountDueCentimes',
} as const;

export type SortParam = keyof typeof SORT_KEYS;

/** Table column id → URL sort value, and back. */
export const COLUMN_TO_SORT: Record<string, SortParam> = {
  createdAt: 'date',
  amountDueCentimes: 'montant',
};

export const SORT_COLUMN_ID: Record<SortParam, string> = {
  date: 'createdAt',
  montant: 'amountDueCentimes',
};

/* -------------------------------------------------------------------------- */
/* Label maps — sub-keys of the `admin.requests` namespace                     */
/* -------------------------------------------------------------------------- */

export const STATUS_LABEL_KEY: Record<RequestStatus, string> = {
  AWAITING_RECEIPT: 'status.awaitingReceipt',
  UNDER_REVIEW: 'status.underReview',
  INFO_REQUESTED: 'status.infoRequested',
  APPROVED: 'status.approved',
  REJECTED: 'status.rejected',
  EXPIRED: 'status.expired',
  CANCELLED: 'status.cancelled',
};

/** Sub-keys of the **`admin.accounts`** namespace — the account pill in the student pane. */
export const ACCOUNT_STATUS_LABEL_KEY: Record<AccountStatus, string> = {
  PENDING_EMAIL: 'status.pendingEmail',
  PENDING_APPROVAL: 'status.pendingApproval',
  ACTIVE: 'status.active',
  REJECTED: 'status.rejected',
  SUSPENDED: 'status.suspended',
};

export const TRANSFER_TYPE_LABEL_KEY: Record<TransferType, string> = {
  INSTANT: 'transferTypes.instant',
  STANDARD_48H: 'transferTypes.standard',
  CASH_AT_CENTER: 'transferTypes.cash',
};

export const TRANSFER_TYPE_PARAM: Record<TransferType, string> = {
  INSTANT: 'instantane',
  STANDARD_48H: 'standard',
  CASH_AT_CENTER: 'especes',
};

export const TRANSFER_TYPE_FROM_PARAM: Record<string, TransferType> = {
  instantane: 'INSTANT',
  standard: 'STANDARD_48H',
  especes: 'CASH_AT_CENTER',
};

export const TRANSFER_TYPES: readonly TransferType[] = [
  'INSTANT',
  'STANDARD_48H',
  'CASH_AT_CENTER',
];

/**
 * `RequestEvent.type` → a label key. The vocabulary is `RequestTimelineType`
 * plus the two creation-time rows written outside the machine.
 *
 * Two of them reach outside `admin.requests` on purpose: the student-facing
 * timeline already names « Demande envoyée », « Justificatif reçu »,
 * « Vérification en cours » and « Accès activé », and an administrator reading
 * the same history should read the same words.
 */
export const TIMELINE_LABEL_KEY: Record<string, string> = {
  CREATED: 'enrollment.status.timeline.submitted',
  RECEIPT_UPLOADED: 'enrollment.status.timeline.receiptReceived',
  UNDER_REVIEW: 'enrollment.status.timeline.verification',
  INFO_REQUESTED: 'admin.requests.status.infoRequested',
  APPROVED: 'enrollment.status.timeline.activated',
  REJECTED: 'admin.requests.status.rejected',
  EXPIRED: 'admin.requests.status.expired',
  CANCELLED: 'admin.requests.status.cancelled',
  REMINDER_SENT: 'emails.receiptReminder.subject',
};

/** `ActionErrorCode` → key of the `admin.actionError` namespace. */
export const ACTION_ERROR_KEY: Record<ActionErrorCode, string> = {
  validation: 'validation',
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  csrf: 'csrf',
  rate_limited: 'rateLimited',
  not_found: 'notFound',
  conflict: 'conflict',
  server_error: 'server',
};

/** A reason or a message an administrator writes for a student to read. */
export const REQUEST_MESSAGE_MIN = 5;

/**
 * The five refusal reasons the drawer offers. They **pre-fill** the mandatory
 * free-text field rather than replacing it: e-mail #10 shows the administrator's
 * sentence verbatim, so a bare code would reach the student as nothing at all.
 */
export const REJECT_REASON_KEYS = [
  'reject.reasons.notReceived',
  'reject.reasons.unreadable',
  'reject.reasons.amountMismatch',
  'reject.reasons.duplicate',
  'reject.reasons.other',
] as const;

/* -------------------------------------------------------------------------- */
/* View models — built by the page, rendered by the client components          */
/* -------------------------------------------------------------------------- */

/** How long a request has been waiting, and how loudly the queue should say so. */
export type AgeTone = 'calm' | 'warn' | 'late';

export interface FlagView {
  readonly key: 'duplicateReceipt' | 'amountMismatch' | 'accountNotValidated' | 'secondRequest';
  readonly labelKey: string;
  readonly tone: 'warn' | 'danger';
  /** Set on `duplicateReceipt`: the request whose justificatif this one repeats. */
  readonly relatedRequestId: string | null;
}

/** One table row. Dates and money arrive formatted — the browser sees strings. */
export interface RequestRowView {
  readonly id: string;
  readonly reference: string;
  readonly status: RequestStatus;
  readonly studentId: string;
  readonly studentName: string;
  readonly studentEmail: string;
  readonly studentPhoneDisplay: string;
  /** `null` when the number cannot be reached on WhatsApp. */
  readonly whatsappHref: string | null;
  readonly courseTitle: string;
  readonly amountLabel: string;
  readonly transferType: TransferType;
  readonly transferDateLabel: string | null;
  readonly submittedAtRelative: string;
  readonly submittedAtAbsolute: string;
  readonly submittedAtIso: string;
  readonly ageLabel: string;
  readonly ageTone: AgeTone;
  /** Gateway path of the justificatif — authenticated, audited (§19.1). */
  readonly receiptPath: string | null;
  readonly receiptIsImage: boolean;
  readonly flags: readonly FlagView[];
}

export interface RequestsFilterState {
  readonly course: string | null;
  readonly transferType: string | null;
  readonly amountMin: string | null;
  readonly amountMax: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly flagged: boolean;
}

export interface TimelineRowView {
  readonly id: string;
  readonly type: string;
  readonly labelKey: string;
  readonly message: string | null;
  readonly timestamp: string;
  readonly actorName: string | null;
}

export interface OtherRequestView {
  readonly id: string;
  readonly reference: string;
  readonly status: RequestStatus;
  readonly courseTitle: string;
  readonly amountLabel: string;
  readonly createdAtLabel: string;
}

/** Everything the verification drawer shows, in one server round trip. */
export interface RequestReviewView {
  readonly id: string;
  readonly reference: string;
  readonly status: RequestStatus;
  readonly courseTitle: string;
  readonly courseSlug: string | null;

  /* Receipt pane */
  readonly receiptPath: string | null;
  readonly receiptIsImage: boolean;
  readonly receiptIsPdf: boolean;
  readonly receiptUploadedAtLabel: string | null;
  readonly transferDateLabel: string | null;
  readonly transferBankRef: string | null;
  readonly studentMessage: string | null;

  /* Money */
  readonly priceLabel: string;
  readonly discountLabel: string | null;
  readonly dueLabel: string;
  /** The course's price today — shown only when it no longer matches. */
  readonly coursePriceLabel: string | null;
  readonly amountMismatch: boolean;
  readonly transferType: TransferType;

  /* Dates */
  readonly submittedAtLabel: string;
  readonly ageLabel: string;
  readonly ageTone: AgeTone;
  readonly reviewedAtLabel: string | null;
  readonly reviewedByName: string | null;

  /* Student pane */
  readonly studentId: string;
  readonly studentName: string;
  readonly studentEmail: string;
  readonly studentPhoneDisplay: string;
  readonly whatsappHref: string | null;
  readonly studentCity: string | null;
  readonly accountStatus: AccountStatus;
  readonly activeEnrollments: number;
  readonly previousPayments: number;
  readonly previousPaidLabel: string;
  readonly everRejected: boolean;
  readonly otherRequests: readonly OtherRequestView[];

  /* History and outcome */
  readonly events: readonly TimelineRowView[];
  readonly infoRequestedMessage: string | null;
  readonly rejectionReason: string | null;
  readonly adminNote: string;
  readonly invoiceNumber: string | null;
  readonly invoicePath: string | null;

  readonly flags: readonly FlagView[];

  /** Decided server-side from the state machine, never from the status alone. */
  readonly canApprove: boolean;
  readonly canRequestInfo: boolean;
  readonly canReject: boolean;
}

/** One entry of the `J` / `K` walk through the current page. */
export interface QueueEntry {
  readonly id: string;
  readonly reference: string;
}
