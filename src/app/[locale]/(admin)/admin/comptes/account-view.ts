import type { ActionErrorCode } from '@/server/auth/guards';
import type { AccountStatus } from '@/components/ui/status-pill';

/**
 * The contract between `/admin/comptes` and the two client components that
 * render it: URL parameter names, the queue definitions, the label maps and the
 * view-model shapes.
 *
 * It carries **no directive on purpose**. A `'use client'` module exports client
 * *references* into the server graph — `QUEUES.map` would be a proxy, not an
 * array — and a Server Component module dragged into the browser bundle would
 * take the Prisma client with it. A neutral module is the only place both graphs
 * can read the same constant.
 *
 * Nothing here touches the database, the environment or the DOM, so it is safe
 * on either side.
 */

export type { AccountStatus };

/**
 * The roles an account can hold (§8). Spelled out rather than imported from
 * Prisma, which `src/app/**` may not import (§5); these are the same four
 * strings the database enum holds.
 */
export type AccountRole = 'STUDENT' | 'INSTRUCTOR' | 'ADMIN' | 'SUPER_ADMIN';

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
  role: 'role',
  locale: 'langue',
  city: 'ville',
  from: 'du',
  to: 'au',
  emailStatus: 'email',
  review: 'fiche',
} as const;

/** Tab = queue (§17.2). Declaration order is render order. */
export const QUEUES = [
  {
    key: 'a-valider',
    status: 'PENDING_APPROVAL',
    labelKey: 'tabs.toReview',
    emptyKey: 'empty.toReview',
  },
  { key: 'actifs', status: 'ACTIVE', labelKey: 'tabs.active', emptyKey: 'empty.active' },
  {
    key: 'attente-email',
    status: 'PENDING_EMAIL',
    labelKey: 'tabs.pendingEmail',
    emptyKey: 'empty.pendingEmail',
  },
  { key: 'refuses', status: 'REJECTED', labelKey: 'tabs.rejected', emptyKey: 'empty.rejected' },
  {
    key: 'suspendus',
    status: 'SUSPENDED',
    labelKey: 'tabs.suspended',
    emptyKey: 'empty.suspended',
  },
] as const satisfies readonly {
  key: string;
  status: AccountStatus;
  labelKey: string;
  emptyKey: string;
}[];

export type QueueKey = (typeof QUEUES)[number]['key'];

/** URL sort value → `ACCOUNT_SORT_FIELDS` column of the read model. */
export const SORT_KEYS = {
  nom: 'fullName',
  date: 'createdAt',
  statut: 'status',
  connexion: 'lastLoginAt',
} as const;

export type SortParam = keyof typeof SORT_KEYS;

/** Table column id → URL sort value. */
export const COLUMN_TO_SORT: Record<string, SortParam> = {
  fullName: 'nom',
  createdAt: 'date',
  status: 'statut',
  lastLoginAt: 'connexion',
};

/** URL sort value → table column id. */
export const SORT_COLUMN_ID: Record<SortParam, string> = {
  nom: 'fullName',
  date: 'createdAt',
  statut: 'status',
  connexion: 'lastLoginAt',
};

/** URL values for the role filter — French, like the rest of the query string. */
export const ROLE_PARAM: Record<AccountRole, string> = {
  STUDENT: 'etudiant',
  INSTRUCTOR: 'formateur',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super-admin',
};

export const ROLE_FROM_PARAM: Record<string, AccountRole> = {
  etudiant: 'STUDENT',
  formateur: 'INSTRUCTOR',
  admin: 'ADMIN',
  'super-admin': 'SUPER_ADMIN',
};

export const ACCOUNT_ROLES: readonly AccountRole[] = [
  'STUDENT',
  'INSTRUCTOR',
  'ADMIN',
  'SUPER_ADMIN',
];

/* -------------------------------------------------------------------------- */
/* Label maps — sub-keys of the `admin.accounts` namespace                     */
/* -------------------------------------------------------------------------- */

export const STATUS_LABEL_KEY: Record<AccountStatus, string> = {
  PENDING_EMAIL: 'status.pendingEmail',
  PENDING_APPROVAL: 'status.pendingApproval',
  ACTIVE: 'status.active',
  REJECTED: 'status.rejected',
  SUSPENDED: 'status.suspended',
};

export const ROLE_LABEL_KEY: Record<AccountRole, string> = {
  STUDENT: 'roles.student',
  INSTRUCTOR: 'roles.instructor',
  ADMIN: 'roles.admin',
  SUPER_ADMIN: 'roles.superAdmin',
};

/** The four §17.2 refusal reasons, in the order the drawer offers them. */
export const REJECTION_REASONS = [
  { code: 'INCOMPLETE_INFO', labelKey: 'rejectReasons.incompleteInfo' },
  { code: 'DUPLICATE', labelKey: 'rejectReasons.duplicate' },
  { code: 'INVALID_PHONE', labelKey: 'rejectReasons.invalidPhone' },
  { code: 'OTHER', labelKey: 'rejectReasons.other' },
] as const;

export type RejectionCode = (typeof REJECTION_REASONS)[number]['code'];

/** « Autre » is only a reason once it has been explained (§17.2). */
export const REJECTION_DETAILS_MIN = 5;

/**
 * `ActionErrorCode` → key of the `admin.actionError` namespace.
 *
 * The server never composes a sentence (rule 5): it returns a code, and this is
 * the one place that turns a code into something an administrator can act on.
 */
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

/* -------------------------------------------------------------------------- */
/* View models — built by the page, rendered by the client components          */
/* -------------------------------------------------------------------------- */

/** One table row. Dates arrive formatted: the browser never sees a timezone. */
export interface AccountRowView {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly emailDisposable: boolean;
  readonly phoneDisplay: string;
  /** `null` when the number cannot be reached on WhatsApp. */
  readonly whatsappHref: string | null;
  readonly phoneIsMoroccan: boolean;
  readonly city: string | null;
  readonly status: AccountStatus;
  readonly role: AccountRole;
  /** « il y a 3 heures ». */
  readonly registeredAtRelative: string;
  /** « 12 mars 2026 à 14 h 30 » — the `title`, so the exact moment is one hover away. */
  readonly registeredAtAbsolute: string;
  readonly registeredAtIso: string;
  readonly lastLoginRelative: string | null;
}

export interface AccountsFilterState {
  readonly role: string | null;
  readonly locale: string | null;
  readonly city: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly emailStatus: string | null;
}

/** A « déjà inscrit » match shown in the review drawer (§17.2). */
export interface DuplicateView {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly phoneDisplay: string;
  readonly city: string | null;
  readonly status: AccountStatus;
  readonly registeredAt: string;
}

/** Everything the review drawer shows « all at once » (§17.2). */
export interface AccountReviewView {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  /** E.164, exactly as stored. */
  readonly phone: string;
  /** `+212 6 12 34 56 78`. */
  readonly phoneDisplay: string;
  /** `06 12 34 56 78`, or the international form for a foreign number. */
  readonly phoneNational: string;
  /** `null` when the number cannot be dialled on WhatsApp. */
  readonly whatsappHref: string | null;
  readonly phoneIsMoroccan: boolean;
  readonly city: string | null;
  readonly professionalStatus: string | null;
  readonly localeLabel: string;
  readonly status: AccountStatus;
  readonly registeredAt: string;
  readonly verifiedAt: string | null;
  readonly approvedAt: string | null;
  readonly lastLoginAt: string | null;
  readonly emailDisposable: boolean;
  /** A likely correction of a mistyped domain, e.g. `gmail.com`. */
  readonly emailTypoSuggestion: string | null;
  readonly rejection: { readonly reasonLabel: string; readonly details: string | null } | null;
  readonly registrationIp: string | null;
  readonly registrationUserAgent: string | null;
  readonly duplicatesByPhone: readonly DuplicateView[];
  readonly duplicatesByNameAndCity: readonly DuplicateView[];
  /** Decided server-side from the account state machine, never from the status alone. */
  readonly canApprove: boolean;
  readonly canReject: boolean;
}

/** One entry of the `J` / `K` walk through the current page. */
export interface QueueEntry {
  readonly id: string;
  readonly fullName: string;
}
