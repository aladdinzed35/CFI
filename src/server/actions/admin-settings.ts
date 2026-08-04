'use server';

/**
 * Server actions for `/admin/reglages` (§17.12).
 *
 * Thin on purpose. {@link withAction} enforces the §20 order — Origin check →
 * Zod `.strict()` → session → capability → handler — and everything that
 * decides anything lives in `services/settings-admin`: the catalogue of
 * editable keys, the per-field validation, the audit row, and the cache
 * invalidation that makes a corrected RIB visible to students immediately
 * instead of within the minute.
 *
 * The capability declared here is the coarse gate (`settings.edit`). The
 * service checks the *group's* capability again before it reads a column, which
 * is what keeps the bank block at `settings.editSecrets` — an `ADMIN` posting
 * the bank form by hand is refused by the service, not by the absence of a
 * button.
 */

import { z } from 'zod';
import { revalidatePath } from 'next/cache';

import { ActionError, withAction } from '@/server/auth/guards';
import {
  SETTING_GROUP_IDS,
  saveSettingsGroup,
  setFeatureFlag,
  type SaveSettingsOutcome,
  type SetFeatureFlagOutcome,
} from '@/server/services/settings-admin';

/** Longest value any settings field accepts, before its own `maxLength` runs. */
const VALUE_MAX = 2_000;

/**
 * Refresh the panel *and* the public site.
 *
 * These settings are the site's chrome: the footer address, the WhatsApp
 * number, the brand name in every e-mail header. Revalidating only `/admin`
 * would leave 142 statically rendered pages showing the old phone number.
 */
function revalidateEverything(): void {
  revalidatePath('/[locale]/admin', 'layout');
  revalidatePath('/[locale]', 'layout');
}

/* -------------------------------------------------------------------------- */
/* Save one group                                                              */
/* -------------------------------------------------------------------------- */

export const saveSettingsGroupAction = withAction(
  z
    .object({
      groupId: z.enum(SETTING_GROUP_IDS),
      /**
       * Setting key → submitted text. A record rather than a fixed object: the
       * groups have different fields, and the service ignores every key that is
       * not part of the group being saved, so an unknown one cannot write a row.
       */
      values: z.record(z.string().min(1).max(80), z.string().max(VALUE_MAX)),
    })
    .strict(),
  async (input, ctx): Promise<SaveSettingsOutcome> => {
    const result = await saveSettingsGroup(
      { groupId: input.groupId, values: input.values },
      { actor: ctx.user, ip: ctx.ip, userAgent: ctx.userAgent },
    );

    if (!result.ok) {
      if (result.code === 'FORBIDDEN') {
        throw new ActionError('forbidden', 'admin.actionError.forbidden');
      }
      throw new ActionError(
        'validation',
        'admin.actionError.validation',
        result.fieldErrors ?? undefined,
      );
    }

    if (result.data.changedKeys.length > 0) revalidateEverything();
    return result.data;
  },
  { auth: 'active', can: 'settings.edit' },
);

/* -------------------------------------------------------------------------- */
/* Feature flags                                                               */
/* -------------------------------------------------------------------------- */

export const setFeatureFlagAction = withAction(
  z.object({ key: z.string().min(1).max(80), isEnabled: z.boolean() }).strict(),
  async (input, ctx): Promise<SetFeatureFlagOutcome> => {
    const result = await setFeatureFlag(
      { key: input.key, isEnabled: input.isEnabled },
      { actor: ctx.user, ip: ctx.ip, userAgent: ctx.userAgent },
    );

    if (!result.ok) {
      if (result.code === 'FORBIDDEN') {
        throw new ActionError('forbidden', 'admin.actionError.forbidden');
      }
      throw new ActionError('not_found', 'admin.actionError.notFound');
    }

    if (result.data.changed) revalidateEverything();
    return result.data;
  },
  { auth: 'active', can: 'settings.edit' },
);
