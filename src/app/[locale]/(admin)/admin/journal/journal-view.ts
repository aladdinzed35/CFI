/**
 * The contract between `/admin/journal` and its table: URL parameter names and
 * the view-model shapes.
 *
 * Neutral module, no directive — the same reasoning as `paiements/payment-view.ts`.
 *
 * Note what is *not* here: no mutation, no row action, no identifier of an
 * "edit" endpoint. `AuditLog` is append-only, and this file is the whole surface
 * the browser is given.
 */

/** Search-parameter names. French, like every URL in this application (§10.1). */
export const PARAM = {
  actor: 'acteur',
  action: 'action',
  entityType: 'type',
  entityId: 'id',
  search: 'q',
  from: 'du',
  to: 'au',
  page: 'page',
  pageSize: 'taille',
  sortDir: 'sens',
} as const;

/** The single sortable column: the journal is a chronology. */
export const SORT_COLUMN_ID = 'createdAt';

export interface AuditDiffFieldView {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface AuditEntryView {
  readonly id: string;
  /** Already formatted in Africa/Casablanca (§28.1). */
  readonly whenLabel: string;
  readonly whenIso: string;
  readonly actorId: string | null;
  /** `null` for a system action; the table prints « Système ». */
  readonly actorName: string | null;
  readonly action: string;
  readonly summary: string | null;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly ip: string | null;
  /**
   * Empty when the row carries no diff, and equally empty when §8 row 17
   * withholds it from this administrator — the browser is never sent a
   * before/after it is not entitled to read.
   */
  readonly diff: readonly AuditDiffFieldView[];
}

export interface JournalFilterState {
  readonly actor: string | null;
  readonly action: string | null;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly from: string | null;
  readonly to: string | null;
}

export interface JournalOptions {
  readonly actors: readonly { readonly id: string; readonly fullName: string }[];
  readonly actions: readonly string[];
  readonly entityTypes: readonly string[];
}
