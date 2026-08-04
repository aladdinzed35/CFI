'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { dirFor, localeLabels, type Locale } from '@/i18n/routing';
import type { ActionErrorCode, ActionResult } from '@/server/auth/guards';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/alert';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

import {
  ACTION_ERROR_KEY,
  EDITOR_LOCALES,
  translatedPercent,
  type LocalisedDraft,
} from './content-view';

/**
 * The parts every CMS tab is built from.
 *
 * Five tables, five editors, one set of controls: a side-by-side per-locale
 * fieldset, a drawer that becomes a sheet under `md`, a publish switch, order
 * arrows and a typed-confirmation delete. Writing them once is not only shorter
 * — it is the reason an editor who has learned the FAQ tab already knows the
 * blog tab.
 *
 * ## Why the four locales sit side by side and not behind a tab
 * §17.11 asks for « MDX editor per locale ». The failure this layout prevents is
 * the one the project has actually seen: an editor rewrites the French, saves,
 * and the Arabic column keeps the previous version for a month because nobody
 * looked at it. With the columns visible, the gap is visible.
 *
 * ## Arabic is authored right-to-left
 * Each field carries the `dir` of the language it holds, not the direction of
 * the interface. An Arabic paragraph typed into an LTR textarea puts its
 * punctuation on the wrong side and nobody notices until it ships.
 */

/* -------------------------------------------------------------------------- */
/* Failure reporting                                                           */
/* -------------------------------------------------------------------------- */

/** Report a failed action with the sentence §9 asks for: what happened, what to do. */
export function useActionFailureReporter(): (code: ActionErrorCode) => void {
  const tError = useTranslations('admin.actionError');
  const tCommon = useTranslations('common');

  return useCallback(
    (code: ActionErrorCode): void => {
      toast.error({ title: tError(ACTION_ERROR_KEY[code]), dismissLabel: tCommon('close') });
    },
    [tCommon, tError],
  );
}

/**
 * Run one server action, keeping a pending flag and turning a failure into a
 * toast. Returns the payload on success and `null` on any failure, so a caller
 * can write `if (data === null) return;` and forget the error branch exists.
 */
export function useAction(): {
  readonly pending: boolean;
  readonly run: <T>(call: () => Promise<ActionResult<T>>) => Promise<T | null>;
} {
  const [pending, setPending] = useState(false);
  const report = useActionFailureReporter();

  const run = useCallback(
    async <T,>(call: () => Promise<ActionResult<T>>): Promise<T | null> => {
      setPending(true);
      let result: ActionResult<T>;
      try {
        result = await call();
      } finally {
        setPending(false);
      }

      if (!result.ok) {
        report(result.error);
        return null;
      }
      return result.data;
    },
    [report],
  );

  return { pending, run };
}

/* -------------------------------------------------------------------------- */
/* Completeness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * « 75 % traduit » next to a dot.
 *
 * The number carries the meaning and the dot only decorates it: colour alone is
 * never information (§21), so the dot is `aria-hidden` and the percentage is
 * plain text.
 */
export function TranslationMeter({
  fields,
  className,
}: {
  readonly fields: readonly LocalisedDraft[];
  readonly className?: string;
}): React.JSX.Element {
  const t = useTranslations('admin.cms.common');
  const percent = translatedPercent(...fields);

  return (
    <span className={cn('inline-flex items-center gap-2 text-sm text-ink-muted', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'size-2 shrink-0 rounded-pill',
          percent === 100 ? 'bg-success' : percent >= 50 ? 'bg-warn' : 'bg-hairline',
        )}
      />
      {t('localeCompleteness', { percent })}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-locale fieldset                                                         */
/* -------------------------------------------------------------------------- */

export interface LocalisedFieldProps {
  /** What the field holds — « Question », « Contenu (MDX) ». */
  readonly legend: string;
  readonly values: LocalisedDraft;
  readonly onChange: (locale: Locale, value: string) => void;
  readonly idPrefix: string;
  readonly maxLength: number;
  /** A textarea instead of a single-line input. */
  readonly multiline?: boolean;
  readonly rows?: number;
  /** Shown under the French field when it is empty on submit. */
  readonly error?: string | null;
  readonly description?: string;
  /** Every locale optional — an excerpt, a description. */
  readonly frenchOptional?: boolean;
}

export function LocalisedField({
  legend,
  values,
  onChange,
  idPrefix,
  maxLength,
  multiline = false,
  rows,
  error = null,
  description,
  frenchOptional = false,
}: LocalisedFieldProps): React.JSX.Element {
  const tCommon = useTranslations('common');

  return (
    <fieldset className="min-w-0">
      <legend className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 pb-2">
        <span className="text-body font-medium text-ink">{legend}</span>
        <TranslationMeter fields={[values]} />
      </legend>

      {description === undefined ? null : (
        <p className="pb-3 text-sm text-ink-muted">{description}</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {EDITOR_LOCALES.map((locale) => {
          const required = locale === 'fr' && !frenchOptional;
          const filled = values[locale].trim() !== '';

          return (
            <FormField
              key={locale}
              id={`${idPrefix}-${locale}`}
              required={required}
              requiredHint={tCommon('required')}
              optionalHint={tCommon('optional')}
              {...(required && error !== null ? { error } : {})}
              label={
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 shrink-0 rounded-pill',
                      filled ? 'bg-success' : 'bg-hairline',
                    )}
                  />
                  {localeLabels[locale]}
                </span>
              }
            >
              {(field) =>
                multiline ? (
                  <Textarea
                    {...field}
                    dir={dirFor(locale)}
                    lang={locale}
                    rows={rows ?? 6}
                    maxLength={maxLength}
                    value={values[locale]}
                    invalid={field['aria-invalid'] === true}
                    onChange={(event) => {
                      onChange(locale, event.target.value);
                    }}
                  />
                ) : (
                  <Input
                    {...field}
                    dir={dirFor(locale)}
                    lang={locale}
                    maxLength={maxLength}
                    value={values[locale]}
                    invalid={field['aria-invalid'] === true}
                    onChange={(event) => {
                      onChange(locale, event.target.value);
                    }}
                  />
                )
              }
            </FormField>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Set one locale of a localised draft without mutating the previous value. */
export function withLocale(
  draft: LocalisedDraft,
  locale: Locale,
  value: string,
): LocalisedDraft {
  return { ...draft, [locale]: value };
}

/** Is the French column — the source language — filled in? */
export function hasFrench(draft: LocalisedDraft): boolean {
  return draft.fr.trim() !== '';
}

/* -------------------------------------------------------------------------- */
/* Publish switch                                                              */
/* -------------------------------------------------------------------------- */

export function PublishSwitch({
  id,
  checked,
  onCheckedChange,
  label,
  hint,
}: {
  readonly id: string;
  readonly checked: boolean;
  readonly onCheckedChange: (next: boolean) => void;
  readonly label: string;
  readonly hint?: string;
}): React.JSX.Element {
  const hintId = `${id}-hint`;

  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-hairline bg-raised px-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-body font-medium text-ink">
          {label}
        </label>
        {hint === undefined ? null : (
          <p id={hintId} className="pt-1 text-sm text-ink-muted">
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        {...(hint === undefined ? {} : { 'aria-describedby': hintId })}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Editor drawer                                                               */
/* -------------------------------------------------------------------------- */

export interface EditorDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly onSave: () => void;
  readonly saving: boolean;
  /** The « zone dangereuse » panel, absent when the row cannot be deleted. */
  readonly danger?: ReactNode;
}

/**
 * The panel every tab edits in: a two-thirds drawer on the desktop, a full-width
 * sheet under `md` (the primitive handles the switch), with the save button
 * pinned to a footer that never scrolls away.
 */
export function EditorDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSave,
  saving,
  danger,
}: EditorDrawerProps): React.JSX.Element {
  const tCommon = useTranslations('common');

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="end" size="wide" closeLabel={tCommon('close')}>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>

        <DrawerBody>
          <div className="flex flex-col gap-6 pb-2">
            {children}
            {danger}
          </div>
        </DrawerBody>

        <DrawerFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={onSave} loading={saving}>
            {tCommon('save')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/* Delete, behind a typed word                                                 */
/* -------------------------------------------------------------------------- */

export interface DangerZoneProps {
  /** « Supprimer cette question » — the heading of the panel. */
  readonly title: string;
  /** What exactly disappears, when there is more to say than the heading. */
  readonly body?: string;
  /** Non-null when deletion is refused: the reason, in one sentence. */
  readonly blocked: string | null;
  readonly onDelete: () => void;
  readonly deleting: boolean;
}

/**
 * The only destructive control in the CMS, and it takes three deliberate acts:
 * open the panel, type the confirmation word, press the button. There is no
 * undo behind it — the row is gone, and only the audit log remembers it existed.
 *
 * When something still points at the row the panel renders the reason instead of
 * the field, so the refusal is explained where the action was expected rather
 * than as a toast after a failed press.
 */
export function DangerZone({
  title,
  body,
  blocked,
  onDelete,
  deleting,
}: DangerZoneProps): React.JSX.Element {
  const tCourses = useTranslations('admin.courses.deleteDialog');
  const tCommon = useTranslations('common');
  const [typed, setTyped] = useState('');

  const word = tCourses('confirmWord');
  const armed = typed.trim().toUpperCase() === word.toUpperCase();

  return (
    <section className="rounded-md border border-danger/30 bg-danger-wash px-4 py-4">
      <h3 className="text-body font-medium text-danger">{title}</h3>
      {body === undefined ? null : <p className="pt-1 text-sm text-ink-muted">{body}</p>}

      {blocked !== null ? (
        <Callout variant="warning" className="mt-3">
          {blocked}
        </Callout>
      ) : (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <FormField
            id="cms-delete-confirm"
            className="flex-1"
            label={tCourses('typeToConfirm', { word })}
          >
            {(field) => (
              <Input
                {...field}
                value={typed}
                autoComplete="off"
                onChange={(event) => {
                  setTyped(event.target.value);
                }}
              />
            )}
          </FormField>
          <Button
            type="button"
            variant="danger"
            disabled={!armed}
            loading={deleting}
            iconStart={<Trash2 aria-hidden="true" />}
            onClick={onDelete}
          >
            {tCommon('delete')}
          </Button>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* List scaffolding                                                            */
/* -------------------------------------------------------------------------- */

/** The header above every tab list: an optional count, and the « Créer » button. */
export function TabHeader({
  countLabel,
  createLabel,
  onCreate,
  children,
}: {
  readonly countLabel?: string;
  readonly createLabel: string;
  readonly onCreate: () => void;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
      <p className="text-sm text-ink-muted" aria-live="polite">
        {countLabel ?? ''}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <Button type="button" onClick={onCreate}>
          {createLabel}
        </Button>
      </div>
    </div>
  );
}

/** One row of a tab list: a card on every viewport, because the rows are wide. */
export function ListRow({
  title,
  meta,
  badges,
  actions,
}: {
  readonly title: ReactNode;
  readonly meta: ReactNode;
  readonly badges?: ReactNode;
  readonly actions: ReactNode;
}): React.JSX.Element {
  return (
    <li className="flex flex-col gap-3 rounded-md border border-hairline bg-surface px-4 py-3 shadow-e1 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">{title}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-sm text-ink-muted">
          {meta}
        </div>
        {badges === undefined ? null : (
          <div className="flex flex-wrap items-center gap-2 pt-2">{badges}</div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">{actions}</div>
    </li>
  );
}
