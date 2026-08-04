import type { ActionErrorCode } from '@/server/auth/guards';

/**
 * The contract between `/admin/reglages` and its form.
 *
 * Neutral module, no directive — the same reasoning as `comptes/account-view.ts`:
 * a `'use client'` module exports client *references* into the server graph, and
 * a server module dragged into the browser bundle would take Prisma with it.
 *
 * Everything the form renders arrives **already translated and already
 * validated as data**: the page is a Server Component, it owns the catalogue in
 * `services/settings-admin`, and it hands the browser plain strings. The client
 * never imports the catalogue, so it can never disagree with the server about
 * which keys exist.
 */

/** Mirrors `SettingKind` in `services/settings-admin`; kept in sync by the page. */
export type SettingKindView = 'text' | 'phone' | 'email' | 'url' | 'integer' | 'rib' | 'iban' | 'swift';

export interface SettingFieldView {
  /** `SiteSetting.key` — the name the value is posted under. */
  readonly key: string;
  readonly label: string;
  readonly hint: string | null;
  readonly kind: SettingKindView;
  readonly value: string;
  /** Account numbers, phones, addresses and URLs stay left-to-right (§10.3). */
  readonly ltr: boolean;
  readonly required: boolean;
  readonly maxLength: number | null;
  readonly min: number | null;
  readonly max: number | null;
}

export interface SettingGroupView {
  readonly id: string;
  readonly title: string;
  readonly intro: string | null;
  /** `false` renders the group read-only — the §8 row 15 carve-out for `bank`. */
  readonly editable: boolean;
  /** Sentence shown prominently while a §23 « À REMPLACER » value is still stored. */
  readonly placeholderWarning: string | null;
  readonly fields: readonly SettingFieldView[];
}

export interface FeatureFlagView {
  readonly key: string;
  readonly label: string;
  /** The stored explanation of what the flag governs. */
  readonly note: string | null;
  readonly isEnabled: boolean;
}

/** Server refusal code → sub-key of the `admin.actionError` namespace. */
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

/** `<input type>` for each kind. `integer` is numeric, never `type="number"`. */
export const INPUT_TYPE: Record<SettingKindView, string> = {
  text: 'text',
  phone: 'tel',
  email: 'email',
  url: 'url',
  integer: 'text',
  rib: 'text',
  iban: 'text',
  swift: 'text',
};
