/**
 * `/admin/reglages` — the settings catalogue, its validation and its writes (§17.12).
 *
 * ## One declared catalogue, no free-form key/value editor
 * `SiteSetting` is a key/value table, which makes it tempting to render a
 * generic "add a row" form. That would be a trap: every consumer in the
 * codebase reads a *specific* key (`bank.rib`, `contact.whatsapp`,
 * `payment.requestExpiryDays`), so a typo would create a row nothing reads and
 * leave the real setting untouched. {@link SETTING_GROUPS} is therefore the
 * closed list of what the panel may edit, each entry naming the key, its kind,
 * its label key in `admin.settings`, and the capability required to change it.
 *
 * Every key below has a reader somewhere in `src/server`:
 *   brand.* / contact.* / social.*  → `services/public-chrome`, `mail/send`
 *   brand.fullName / legal.*        → `pdf/index` (the invoice issuer block)
 *   bank.*                          → `services/enrollment/bank-details`
 *   payment.requestExpiryDays       → `services/enrollment/requests`
 * Nothing is offered that nothing reads.
 *
 * ## Authorisation, then validation, then one transaction
 * `can()` runs before a column is read (§20). The bank block is carved out to
 * `settings.editSecrets` — §8 row 15, "edit bank details" — so an `ADMIN` sees
 * the group and its values but cannot rewrite the account a student is about to
 * transfer money into.
 *
 * ## Only changed keys are written, and the audit row says which
 * A save compares the submitted values against the stored ones and writes the
 * difference. A double-click therefore reports « aucune modification » instead
 * of a second audit row claiming a change that did not happen, and the diff in
 * §17.13 lists exactly the fields that moved.
 *
 * ## Caches are dropped after the commit, never before
 * Three readers memoise for 60 s: the public chrome, the mail brand context and
 * the bank coordinates. The last one is the important one — it feeds the RIB
 * shown in the §9.2 payment modal, so an admin correcting a wrong account
 * number must not have students transferring to the old one for another minute.
 */

import { db, transaction } from '@/server/db';
import { parsePhone } from '@/lib/phone';
import { can, type PermissionAction, type PermissionUser } from '@/server/auth/permissions';
import { buildDiff, recordAudit, type AuditScalar } from '@/server/services/audit';
import { invalidateBankDetails } from '@/server/services/enrollment/bank-details';
import { invalidatePublicChrome } from '@/server/services/public-chrome';
import { invalidateBrandCache } from '@/server/mail';

/* -------------------------------------------------------------------------- */
/* Result shape                                                                */
/* -------------------------------------------------------------------------- */

export type SettingsResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: 'FORBIDDEN' | 'INVALID';
      /** Setting key → i18n message keys, ready for the form. */
      readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
    };

const FORBIDDEN = { ok: false, code: 'FORBIDDEN' } as const;
const INVALID = { ok: false, code: 'INVALID' } as const;

/* -------------------------------------------------------------------------- */
/* The catalogue                                                               */
/* -------------------------------------------------------------------------- */

/**
 * How a value is validated and how the form renders it.
 *
 * `rib`, `iban` and `swift` are separate kinds rather than one "bank string":
 * an IBAN carries a self-check the code can verify, a RIB carries a length the
 * code can verify, and a SWIFT code carries a shape — refusing all three with
 * the same rule would either let a broken IBAN through or reject a valid RIB.
 */
export type SettingKind = 'text' | 'phone' | 'email' | 'url' | 'integer' | 'rib' | 'iban' | 'swift';

export interface SettingFieldSpec {
  /** `SiteSetting.key`, verbatim. */
  readonly key: string;
  readonly kind: SettingKind;
  /**
   * Sub-key of the `admin.settings` namespace, or `null` when the label is a
   * proper noun (a social network's name) that no locale translates.
   */
  readonly labelKey: string | null;
  /** Rendered as the label when `labelKey` is `null`. */
  readonly literalLabel?: string;
  readonly hintKey?: string;
  /** An empty value is refused. Used only where a blank would break a page. */
  readonly required?: boolean;
  /**
   * Force `dir="ltr"` on the control. Account numbers, phone numbers, e-mail
   * addresses and URLs are read left-to-right in Arabic too (§10.3).
   */
  readonly ltr?: boolean;
  readonly maxLength?: number;
  /** `integer` only. */
  readonly min?: number;
  readonly max?: number;
}

export interface SettingGroupSpec {
  readonly id: SettingGroupId;
  /** Sub-key of `admin.settings.tabs`. */
  readonly titleKey: string;
  /** Sub-key of `admin.settings`, rendered above the fields. */
  readonly introKey?: string;
  readonly capability: PermissionAction;
  readonly fields: readonly SettingFieldSpec[];
  /**
   * French label written into the audit summary. The journal is read by humans
   * in one language and a service has no request locale to translate with.
   */
  readonly auditLabel: string;
}

export const SETTING_GROUP_IDS = [
  'identity',
  'contact',
  'bank',
  'payments',
  'registrations',
] as const;

export type SettingGroupId = (typeof SETTING_GROUP_IDS)[number];

export function isSettingGroupId(value: unknown): value is SettingGroupId {
  return typeof value === 'string' && (SETTING_GROUP_IDS as readonly string[]).includes(value);
}

const SOCIAL_NETWORKS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'social.facebook', label: 'Facebook' },
  { key: 'social.instagram', label: 'Instagram' },
  { key: 'social.linkedin', label: 'LinkedIn' },
  { key: 'social.tiktok', label: 'TikTok' },
  { key: 'social.youtube', label: 'YouTube' },
];

export const SETTING_GROUPS: readonly SettingGroupSpec[] = [
  {
    id: 'identity',
    titleKey: 'tabs.identity',
    capability: 'settings.edit',
    auditLabel: 'Identité',
    fields: [
      { key: 'brand.name', kind: 'text', labelKey: 'identity.brandName', required: true, maxLength: 80 },
      { key: 'brand.tagline.fr', kind: 'text', labelKey: 'identity.taglineFr', maxLength: 200 },
      { key: 'brand.tagline.ar', kind: 'text', labelKey: 'identity.taglineAr', maxLength: 200 },
    ],
  },
  {
    id: 'contact',
    titleKey: 'tabs.contact',
    capability: 'settings.edit',
    auditLabel: 'Contact',
    fields: [
      { key: 'contact.phone', kind: 'phone', labelKey: 'contact.phone', ltr: true, required: true },
      { key: 'contact.whatsapp', kind: 'phone', labelKey: 'contact.whatsappPrimary', ltr: true },
      { key: 'contact.whatsappSecondary', kind: 'phone', labelKey: 'contact.whatsappSecondary', ltr: true },
      { key: 'contact.email', kind: 'email', labelKey: 'contact.email', ltr: true, required: true },
      { key: 'contact.address', kind: 'text', labelKey: 'contact.address', maxLength: 200 },
      { key: 'contact.hours', kind: 'text', labelKey: 'contact.hours', hintKey: 'contact.hoursHint', maxLength: 120 },
      ...SOCIAL_NETWORKS.map(
        (network): SettingFieldSpec => ({
          key: network.key,
          kind: 'url',
          labelKey: null,
          literalLabel: network.label,
          ltr: true,
          maxLength: 300,
        }),
      ),
    ],
  },
  {
    id: 'bank',
    titleKey: 'tabs.bank',
    introKey: 'bank.intro',
    // §8 row 15 — bank details are the SUPER_ADMIN cell, and for a reason: this
    // is the account a student is told to transfer to.
    capability: 'settings.editSecrets',
    auditLabel: 'Coordonnées bancaires',
    fields: [
      { key: 'bank.holder', kind: 'text', labelKey: 'bank.holder', maxLength: 120 },
      { key: 'bank.name', kind: 'text', labelKey: 'bank.bankName', maxLength: 80 },
      { key: 'bank.rib', kind: 'rib', labelKey: 'bank.rib', ltr: true, maxLength: 60 },
      { key: 'bank.iban', kind: 'iban', labelKey: 'bank.iban', ltr: true, maxLength: 60 },
      { key: 'bank.swift', kind: 'swift', labelKey: 'bank.swift', ltr: true, maxLength: 40 },
    ],
  },
  {
    id: 'payments',
    titleKey: 'tabs.payments',
    capability: 'settings.edit',
    auditLabel: 'Mentions légales des factures',
    fields: [
      { key: 'brand.fullName', kind: 'text', labelKey: 'identity.legalName', required: true, maxLength: 120 },
      { key: 'legal.ice', kind: 'text', labelKey: 'payments.ice', ltr: true, maxLength: 40 },
      { key: 'legal.rc', kind: 'text', labelKey: 'payments.rc', ltr: true, maxLength: 40 },
      { key: 'legal.if', kind: 'text', labelKey: 'payments.if', ltr: true, maxLength: 40 },
    ],
  },
  {
    id: 'registrations',
    titleKey: 'tabs.registrations',
    capability: 'settings.edit',
    auditLabel: 'Inscriptions',
    fields: [
      {
        key: 'payment.requestExpiryDays',
        kind: 'integer',
        labelKey: 'payments.requestExpiryDays',
        hintKey: 'payments.requestExpiryHint',
        ltr: true,
        // The same window `requestExpiryDays()` accepts, so a value saved here
        // is a value that service will honour rather than silently replace.
        min: 1,
        max: 60,
      },
    ],
  },
];

export function settingGroup(id: SettingGroupId): SettingGroupSpec {
  const group = SETTING_GROUPS.find((entry) => entry.id === id);
  // Total by construction: `SettingGroupId` is derived from the same list.
  if (group === undefined) throw new Error(`Groupe de réglages inconnu : ${id}`);
  return group;
}

/** `SiteSetting.group` for a key that does not exist yet, from its namespace. */
function storageGroupFor(key: string): string {
  const prefix = key.split('.')[0] ?? 'general';
  return prefix === '' ? 'general' : prefix;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The marker §23 requires in the seeded bank coordinates.
 *
 * A value still carrying it is the "not configured yet" state, not a typo: it
 * is accepted so an administrator can fix the account holder without the
 * untouched RIB blocking the save, and the screen shows a prominent warning for
 * as long as it is there.
 */
export const PLACEHOLDER_MARK = 'À REMPLACER';

export function isPlaceholderValue(value: string): boolean {
  return value.includes(PLACEHOLDER_MARK);
}

/** i18n keys used for field-level refusals. All exist in the four catalogues. */
const ERROR_REQUIRED = 'errors.required';
const ERROR_EMAIL = 'errors.invalidEmail';
const ERROR_PHONE = 'errors.invalidPhone';
const ERROR_TOO_LONG = 'errors.tooLong';
/** No dedicated key exists for « valeur non valide » — this is the closest. */
const ERROR_INVALID = 'admin.actionError.validation';

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/u;
const SWIFT_RE = /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/u;
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/u;

/** A RIB is 24 digits once the grouping spaces an admin types are removed. */
const RIB_DIGITS = 24;

function stripSeparators(value: string): string {
  return value.replace(/[\s-]/gu, '');
}

/**
 * ISO 13616 / ISO 7064 mod-97-10.
 *
 * Unambiguous and international, so a failure here really is a wrong IBAN and
 * blocking the save is the right call — an IBAN with a broken check pair cannot
 * be paid into anywhere.
 */
export function isValidIban(value: string): boolean {
  const compact = stripSeparators(value).toUpperCase();
  if (!IBAN_RE.test(compact)) return false;

  const rearranged = `${compact.slice(4)}${compact.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const code = character.charCodeAt(0);
    const digits =
      code >= 65 && code <= 90 ? String(code - 55) : character; // A→10 … Z→35
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/**
 * Validate one submitted value.
 *
 * @returns the value to store (trimmed, never reformatted — the RIB is printed
 *   to students exactly as the owner typed it), or an i18n key describing the
 *   refusal.
 */
function validateField(
  field: SettingFieldSpec,
  raw: string,
): { readonly ok: true; readonly value: string | number } | { readonly ok: false; readonly message: string } {
  const value = raw.trim();

  if (value === '') {
    // A blank number is not "zero": `payment.requestExpiryDays = 0` would fall
    // outside the window `requestExpiryDays()` accepts and be silently replaced
    // by the default, so an empty numeric field is refused outright.
    if (field.required === true || field.kind === 'integer') {
      return { ok: false, message: ERROR_REQUIRED };
    }
    return { ok: true, value: '' };
  }

  if (field.maxLength !== undefined && value.length > field.maxLength) {
    return { ok: false, message: ERROR_TOO_LONG };
  }

  switch (field.kind) {
    case 'text':
      return { ok: true, value };

    case 'email':
      return EMAIL_RE.test(value) ? { ok: true, value } : { ok: false, message: ERROR_EMAIL };

    case 'phone': {
      const parsed = parsePhone(value);
      // Stored in E.164 like every other number in the system, so `wa.me` links
      // and `formatPhoneDisplay` behave the same wherever they are built.
      return parsed === null ? { ok: false, message: ERROR_PHONE } : { ok: true, value: parsed.e164 };
    }

    case 'url': {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return { ok: false, message: ERROR_INVALID };
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { ok: false, message: ERROR_INVALID };
      }
      return { ok: true, value: parsed.toString() };
    }

    case 'integer': {
      if (!/^\d{1,9}$/u.test(value)) return { ok: false, message: ERROR_INVALID };
      const parsed = Number(value);
      if (field.min !== undefined && parsed < field.min) return { ok: false, message: ERROR_INVALID };
      if (field.max !== undefined && parsed > field.max) return { ok: false, message: ERROR_INVALID };
      return { ok: true, value: parsed };
    }

    case 'rib': {
      if (isPlaceholderValue(value)) return { ok: true, value };
      const digits = stripSeparators(value);
      if (!/^\d+$/u.test(digits) || digits.length !== RIB_DIGITS) {
        return { ok: false, message: ERROR_INVALID };
      }
      return { ok: true, value };
    }

    case 'iban': {
      if (isPlaceholderValue(value)) return { ok: true, value };
      return isValidIban(value) ? { ok: true, value } : { ok: false, message: ERROR_INVALID };
    }

    case 'swift': {
      if (isPlaceholderValue(value)) return { ok: true, value };
      const compact = stripSeparators(value).toUpperCase();
      return SWIFT_RE.test(compact) ? { ok: true, value: compact } : { ok: false, message: ERROR_INVALID };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

export interface SettingGroupState {
  readonly id: SettingGroupId;
  /** Setting key → the value as the form should render it. Never `undefined`. */
  readonly values: Readonly<Record<string, string>>;
  /** `true` when this actor may save the group; `false` renders it read-only. */
  readonly editable: boolean;
  /**
   * `true` while any value in the group still carries the §23 placeholder. Only
   * ever set on the bank group today, which is the one that matters: those
   * coordinates are printed in the payment modal.
   */
  readonly hasPlaceholder: boolean;
}

/** `SiteSetting.value` is JSON; the form only ever renders text. */
function toFormValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

/**
 * Every group at once, with the values the forms render.
 *
 * Reading is gated on `settings.edit`: an actor who may not edit any setting has
 * no business seeing the centre's bank account either. Saving is gated a second
 * time, per group, by {@link SettingGroupState.editable}.
 */
export async function readAllSettings(
  actor: PermissionUser,
): Promise<SettingsResult<readonly SettingGroupState[]>> {
  if (!can(actor, 'settings.edit')) return FORBIDDEN;

  const keys = SETTING_GROUPS.flatMap((group) => group.fields.map((field) => field.key));

  const rows = await db.siteSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });

  const stored = new Map<string, string>();
  for (const row of rows) stored.set(row.key, toFormValue(row.value));

  return {
    ok: true,
    data: SETTING_GROUPS.map((group) => {
      const values: Record<string, string> = {};
      let hasPlaceholder = false;

      for (const field of group.fields) {
        const value = stored.get(field.key) ?? '';
        values[field.key] = value;
        if (isPlaceholderValue(value)) hasPlaceholder = true;
      }

      return {
        id: group.id,
        values,
        editable: can(actor, group.capability),
        hasPlaceholder,
      };
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Write                                                                       */
/* -------------------------------------------------------------------------- */

export interface SaveSettingsInput {
  readonly groupId: SettingGroupId;
  /** Setting key → submitted text. Keys outside the group are ignored. */
  readonly values: Readonly<Record<string, string>>;
}

export interface SaveSettingsContext {
  readonly actor: PermissionUser;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface SaveSettingsOutcome {
  readonly groupId: SettingGroupId;
  /** The keys whose stored value actually moved. Empty on a repeated submit. */
  readonly changedKeys: readonly string[];
}

/**
 * Persist one group.
 *
 * The whole group is validated before anything is written: a form that would
 * save three fields and refuse the fourth leaves the settings half-applied,
 * which for the bank block means a holder that no longer matches its RIB.
 */
export async function saveSettingsGroup(
  input: SaveSettingsInput,
  context: SaveSettingsContext,
): Promise<SettingsResult<SaveSettingsOutcome>> {
  const group = SETTING_GROUPS.find((entry) => entry.id === input.groupId);
  if (group === undefined) return INVALID;
  if (!can(context.actor, group.capability)) return FORBIDDEN;

  const fieldErrors: Record<string, readonly string[]> = {};
  const validated = new Map<string, string | number>();

  for (const field of group.fields) {
    const raw = input.values[field.key];
    // A field the form did not submit keeps its stored value rather than being
    // blanked — a partial payload must never erase a RIB.
    if (raw === undefined) continue;

    const outcome = validateField(field, raw);
    if (outcome.ok) validated.set(field.key, outcome.value);
    else fieldErrors[field.key] = [outcome.message];
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, code: 'INVALID', fieldErrors };
  }

  const changedKeys = await transaction(async (tx) => {
    const existing = await tx.siteSetting.findMany({
      where: { key: { in: [...validated.keys()] } },
      select: { key: true, value: true },
    });
    const stored = new Map<string, unknown>();
    for (const row of existing) stored.set(row.key, row.value);

    const before: Record<string, AuditScalar> = {};
    const after: Record<string, AuditScalar> = {};
    const changed: string[] = [];

    for (const [key, value] of validated) {
      const current = stored.get(key);
      const currentText = toFormValue(current);
      const nextText = toFormValue(value);
      if (stored.has(key) && currentText === nextText) continue;

      changed.push(key);
      before[key] = currentText;
      after[key] = nextText;

      await tx.siteSetting.upsert({
        where: { key },
        create: { key, value, group: storageGroupFor(key), updatedById: context.actor.id },
        update: { value, updatedById: context.actor.id },
      });
    }

    if (changed.length > 0) {
      await recordAudit(
        {
          actorId: context.actor.id,
          action: 'SETTINGS_UPDATED',
          entityType: 'SiteSetting',
          entityId: group.id,
          summary: `Réglages « ${group.auditLabel} » : ${changed.length} valeur${changed.length > 1 ? 's' : ''} modifiée${changed.length > 1 ? 's' : ''} (${changed.join(', ')}).`,
          diff: buildDiff(before, after),
          ip: context.ip,
          userAgent: context.userAgent,
        },
        tx,
      );
    }

    return changed;
  });

  if (changedKeys.length > 0) invalidateCachesFor(group.id);

  return { ok: true, data: { groupId: group.id, changedKeys } };
}

/**
 * Drop every memo that could still be serving the old value.
 *
 * The bank case is not optional and not a nicety: `getBankDetails` caches for
 * 60 s and feeds the RIB the §9.2 modal shows, so without this call an
 * administrator corrects a wrong account number and students keep transferring
 * to the previous one for another minute.
 */
function invalidateCachesFor(groupId: SettingGroupId): void {
  switch (groupId) {
    case 'bank':
      invalidateBankDetails();
      return;
    case 'identity':
    case 'contact':
      invalidatePublicChrome();
      invalidateBrandCache();
      return;
    case 'payments':
      // `brand.fullName` is read by both the mail brand context and the footer.
      invalidatePublicChrome();
      invalidateBrandCache();
      return;
    case 'registrations':
      // `payment.requestExpiryDays` is read per transaction, never cached.
      return;
  }
}

/* -------------------------------------------------------------------------- */
/* Feature flags (§17.12 « Fonctionnalités »)                                  */
/* -------------------------------------------------------------------------- */

export interface FeatureFlagState {
  readonly key: string;
  readonly isEnabled: boolean;
  /** The seeded explanation of what the flag governs. Shown as the field hint. */
  readonly note: string | null;
  readonly updatedAt: Date;
}

export async function listFeatureFlags(
  actor: PermissionUser,
): Promise<SettingsResult<readonly FeatureFlagState[]>> {
  if (!can(actor, 'settings.edit')) return FORBIDDEN;

  const rows = await db.featureFlag.findMany({
    orderBy: { key: 'asc' },
    select: { key: true, isEnabled: true, note: true, updatedAt: true },
  });

  return { ok: true, data: rows };
}

export interface SetFeatureFlagOutcome {
  readonly key: string;
  readonly isEnabled: boolean;
  /** `false` when the flag was already in the requested state (double-click). */
  readonly changed: boolean;
}

/**
 * Flip one flag.
 *
 * Compare-and-set: the `WHERE` clause carries the *previous* state, so two
 * concurrent presses produce one change and one no-op instead of two audit rows
 * claiming the same transition.
 */
export async function setFeatureFlag(
  input: { readonly key: string; readonly isEnabled: boolean },
  context: SaveSettingsContext,
): Promise<SettingsResult<SetFeatureFlagOutcome>> {
  if (!can(context.actor, 'settings.edit')) return FORBIDDEN;

  const outcome = await transaction(async (tx) => {
    const flag = await tx.featureFlag.findUnique({
      where: { key: input.key },
      select: { key: true, isEnabled: true },
    });
    if (flag === null) return null;

    const result = await tx.featureFlag.updateMany({
      where: { key: input.key, isEnabled: !input.isEnabled },
      data: { isEnabled: input.isEnabled },
    });
    if (result.count === 0) {
      return { key: input.key, isEnabled: flag.isEnabled, changed: false };
    }

    await recordAudit(
      {
        actorId: context.actor.id,
        action: 'FEATURE_FLAG_UPDATED',
        entityType: 'FeatureFlag',
        entityId: input.key,
        summary: `Fonctionnalité « ${input.key} » ${input.isEnabled ? 'activée' : 'désactivée'}.`,
        diff: buildDiff({ isEnabled: !input.isEnabled }, { isEnabled: input.isEnabled }),
        ip: context.ip,
        userAgent: context.userAgent,
      },
      tx,
    );

    return { key: input.key, isEnabled: input.isEnabled, changed: true };
  });

  if (outcome === null) return INVALID;
  return { ok: true, data: outcome };
}
