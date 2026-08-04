'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Save } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useRouter } from '@/i18n/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { saveSettingsGroupAction, setFeatureFlagAction } from '@/server/actions/admin-settings';

import {
  ACTION_ERROR_KEY,
  INPUT_TYPE,
  type FeatureFlagView,
  type SettingFieldView,
  type SettingGroupView,
} from './settings-view';

/**
 * The §17.12 settings forms.
 *
 * ## One form per group, one save per group
 * The centre's identity, its bank account and its invoice mentions are three
 * different decisions taken at three different moments. A single « Enregistrer »
 * spanning all of them would make an administrator who came to fix a phone
 * number re-post the RIB, and the audit row would then claim they changed it.
 *
 * ## The save says what moved
 * The server returns the keys whose stored value actually changed, and the form
 * names them back in French. A save that changed nothing says so by naming
 * nothing — it does not invent a success story for a double-click.
 *
 * ## Read-only is a real state, not a hidden form
 * A group this actor may not edit still renders its values, disabled and with
 * no submit button (`bank` for an `ADMIN`, §8 row 15). Hiding it would leave
 * the administrator unable to *read* the account number students are being
 * asked to pay into, which they legitimately need.
 */

export interface SettingsFormProps {
  readonly groups: readonly SettingGroupView[];
  readonly flags: readonly FeatureFlagView[];
  /** Translated title of the feature-flag block. */
  readonly featuresTitle: string;
}

export function SettingsForm({ groups, flags, featuresTitle }: SettingsFormProps): React.JSX.Element {
  return (
    <div className="mt-8 flex flex-col gap-10">
      {groups.map((group) => (
        <SettingsGroupForm key={group.id} group={group} />
      ))}
      <FeatureFlagsBlock flags={flags} title={featuresTitle} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One group                                                                   */
/* -------------------------------------------------------------------------- */

function initialValues(group: SettingGroupView): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of group.fields) values[field.key] = field.value;
  return values;
}

function SettingsGroupForm({ group }: { group: SettingGroupView }): React.JSX.Element {
  const t = useTranslations('admin.settings');
  const tCommon = useTranslations('common');
  const tError = useTranslations('admin.actionError');
  // Field refusals arrive as full message paths (`errors.required`), so the
  // translator that resolves them is the root-scoped one.
  const tRoot = useTranslations();

  const router = useRouter();

  const [values, setValues] = useState<Record<string, string>>(() => initialValues(group));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [changedLabels, setChangedLabels] = useState<readonly string[] | null>(null);

  const headingId = `reglages-${group.id}`;

  const labelOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const field of group.fields) map.set(field.key, field.label);
    return map;
  }, [group.fields]);

  const setValue = useCallback((key: string, value: string): void => {
    setValues((previous) => ({ ...previous, [key]: value }));
  }, []);

  /**
   * Re-seed the controls from the server after a save.
   *
   * The stored value is not always the typed one: a phone number is normalised
   * to E.164 and a SWIFT code is upper-cased, so a form that kept its own text
   * would show something the database does not contain. `group` is a fresh
   * object on every server render, which happens here only after `router.refresh()`.
   */
  useEffect(() => {
    setValues(initialValues(group));
  }, [group]);

  const submit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setPending(true);
      setChangedLabels(null);

      const result = await saveSettingsGroupAction({ groupId: group.id, values });
      setPending(false);

      if (!result.ok) {
        if (result.fieldErrors !== undefined) {
          const next: Record<string, string> = {};
          for (const [key, messages] of Object.entries(result.fieldErrors)) {
            const first = messages[0];
            if (first !== undefined) next[key] = first;
          }
          setFieldErrors(next);
        }
        toast.error({
          title: tError(ACTION_ERROR_KEY[result.error]),
          dismissLabel: tCommon('close'),
        });
        return;
      }

      setFieldErrors({});
      const labels = result.data.changedKeys.map((key) => labelOf.get(key) ?? key);
      setChangedLabels(labels);

      toast.success({
        title: t('saved'),
        ...(labels.length > 0 ? { description: labels.join(' · ') } : {}),
        dismissLabel: tCommon('close'),
      });

      // The values the *server* now holds — a phone number is stored in E.164,
      // not as it was typed, and the form must show what was actually saved.
      router.refresh();
    },
    [group.id, labelOf, router, t, tCommon, tError, values],
  );

  return (
    <section aria-labelledby={headingId}>
      <Card elevation={1} padding="none">
        <CardContent className="flex flex-col gap-5 p-5 sm:p-6">
          <header className="flex flex-col gap-1">
            <h2 id={headingId} className="font-display text-heading text-ink">
              {group.title}
            </h2>
            {group.intro === null ? null : (
              <p className="max-w-prose text-sm text-ink-muted">{group.intro}</p>
            )}
          </header>

          {group.placeholderWarning === null ? null : (
            <Alert variant="warning" title={group.placeholderWarning} />
          )}

          <form onSubmit={submit} className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {group.fields.map((field) => {
                const errorKey = fieldErrors[field.key];
                return (
                  <SettingInput
                    key={field.key}
                    field={field}
                    value={values[field.key] ?? ''}
                    error={errorKey === undefined ? undefined : tRoot(errorKey)}
                    disabled={!group.editable || pending}
                    onChange={setValue}
                  />
                );
              })}
            </div>

            {group.editable ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" size="sm" loading={pending} iconStart={<Save aria-hidden="true" />}>
                  {tCommon('save')}
                </Button>

                <p role="status" aria-live="polite" className="text-sm text-ink-muted">
                  {changedLabels === null
                    ? ''
                    : changedLabels.length === 0
                      ? t('saved')
                      : `${t('saved')} ${changedLabels.join(' · ')}`}
                </p>
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* One field                                                                   */
/* -------------------------------------------------------------------------- */

function SettingInput({
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  field: SettingFieldView;
  value: string;
  error: string | undefined;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
}): React.JSX.Element {
  const numeric = field.kind === 'integer';

  return (
    <FormField
      label={field.label}
      {...(field.hint === null ? {} : { description: field.hint })}
      {...(error === undefined ? {} : { error })}
      required={field.required}
    >
      {(fieldProps) => (
        <Input
          {...fieldProps}
          name={field.key}
          type={INPUT_TYPE[field.kind]}
          value={value}
          disabled={disabled}
          invalid={error !== undefined}
          inputSize="sm"
          {...(field.maxLength === null ? {} : { maxLength: field.maxLength })}
          {...(numeric ? { inputMode: 'numeric' as const } : {})}
          {...(field.ltr ? { dir: 'ltr' as const, className: 'force-ltr' } : {})}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      )}
    </FormField>
  );
}

/* -------------------------------------------------------------------------- */
/* Feature flags                                                               */
/* -------------------------------------------------------------------------- */

function FeatureFlagsBlock({
  flags,
  title,
}: {
  flags: readonly FeatureFlagView[];
  title: string;
}): React.JSX.Element | null {
  const tCommon = useTranslations('common');
  const tError = useTranslations('admin.actionError');
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const toggle = useCallback(
    async (key: string, next: boolean): Promise<void> => {
      setPendingKey(key);
      const result = await setFeatureFlagAction({ key, isEnabled: next });
      setPendingKey(null);

      if (!result.ok) {
        toast.error({
          title: tError(ACTION_ERROR_KEY[result.error]),
          dismissLabel: tCommon('close'),
        });
        return;
      }
      router.refresh();
    },
    [router, tCommon, tError],
  );

  if (flags.length === 0) return null;

  return (
    <section aria-labelledby="reglages-fonctionnalites">
      <Card elevation={1} padding="none">
        <CardContent className="flex flex-col gap-5 p-5 sm:p-6">
          <h2 id="reglages-fonctionnalites" className="font-display text-heading text-ink">
            {title}
          </h2>

          <ul role="list" className="flex flex-col gap-3">
            {flags.map((flag) => {
              const id = `flag-${flag.key.replace(/\./gu, '-')}`;
              return (
                <li
                  key={flag.key}
                  className={cn(
                    'flex items-start gap-4 rounded-md border border-hairline bg-raised p-3',
                    pendingKey === flag.key ? 'opacity-70' : null,
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <label htmlFor={id} className="text-sm font-medium text-ink">
                      {flag.label}
                    </label>
                    {flag.note === null ? null : (
                      <p className="mt-0.5 text-xs text-ink-muted">{flag.note}</p>
                    )}
                  </div>

                  <Switch
                    id={id}
                    checked={flag.isEnabled}
                    disabled={pendingKey !== null}
                    onCheckedChange={(next) => {
                      void toggle(flag.key, next);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
