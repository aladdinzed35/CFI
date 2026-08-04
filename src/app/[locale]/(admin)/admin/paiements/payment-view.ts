import type { ActionErrorCode } from '@/server/auth/guards';

/**
 * The contract between `/admin/paiements` and its table: URL parameter names,
 * the label maps and the view-model shapes.
 *
 * Neutral module, no directive — the same reasoning as `demandes/request-view.ts`.
 */

/** Mirrors `PaymentMethod` in prisma/schema.prisma; `src/app/**` may not import Prisma (§5). */
export type PaymentMethod = 'BANK_TRANSFER' | 'CASH_AT_CENTER' | 'OTHER';

/* -------------------------------------------------------------------------- */
/* URL contract                                                                */
/* -------------------------------------------------------------------------- */

export const PARAM = {
  search: 'q',
  page: 'page',
  pageSize: 'taille',
  sortBy: 'tri',
  sortDir: 'sens',
  course: 'formation',
  method: 'moyen',
  from: 'du',
  to: 'au',
} as const;

export const SORT_KEYS = {
  date: 'receivedAt',
  montant: 'amountCentimes',
} as const;

export type SortParam = keyof typeof SORT_KEYS;

export const COLUMN_TO_SORT: Record<string, SortParam> = {
  receivedAt: 'date',
  amountCentimes: 'montant',
};

export const SORT_COLUMN_ID: Record<SortParam, string> = {
  date: 'receivedAt',
  montant: 'amountCentimes',
};

/* -------------------------------------------------------------------------- */
/* Label maps — sub-keys of the `admin.payments` namespace                     */
/* -------------------------------------------------------------------------- */

export const METHOD_LABEL_KEY: Record<PaymentMethod, string> = {
  BANK_TRANSFER: 'methods.bankTransfer',
  CASH_AT_CENTER: 'methods.cash',
  OTHER: 'methods.other',
};

export const METHOD_PARAM: Record<PaymentMethod, string> = {
  BANK_TRANSFER: 'virement',
  CASH_AT_CENTER: 'especes',
  OTHER: 'autre',
};

export const METHOD_FROM_PARAM: Record<string, PaymentMethod> = {
  virement: 'BANK_TRANSFER',
  especes: 'CASH_AT_CENTER',
  autre: 'OTHER',
};

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'BANK_TRANSFER',
  'CASH_AT_CENTER',
  'OTHER',
];

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
/* View models                                                                 */
/* -------------------------------------------------------------------------- */

/** One ledger row. Money and dates arrive formatted (§28.1, Africa/Casablanca). */
export interface PaymentRowView {
  readonly id: string;
  readonly requestId: string;
  readonly reference: string;
  readonly receivedAtLabel: string;
  readonly receivedAtIso: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly studentEmail: string;
  readonly courseTitle: string;
  readonly amountLabel: string;
  readonly method: PaymentMethod;
  readonly invoiceNumber: string | null;
  /** Gateway path of the PDF; `null` until the `GENERATE_INVOICE` job has run. */
  readonly invoicePath: string | null;
  readonly confirmedByName: string | null;
}

/** Sum and count over exactly the rows the filters select — nothing projected. */
export interface PaymentTotalsView {
  readonly count: number;
  readonly totalLabel: string;
  readonly byMethod: readonly {
    readonly method: PaymentMethod;
    readonly count: number;
    readonly totalLabel: string;
  }[];
}

export interface PaymentsFilterState {
  readonly course: string | null;
  readonly method: string | null;
  readonly from: string | null;
  readonly to: string | null;
}
