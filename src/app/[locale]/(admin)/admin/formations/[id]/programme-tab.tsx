'use client';

import { useId, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Plus, Settings2, Trash2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { locales, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createLessonAction,
  createModuleAction,
  deleteLessonAction,
  deleteModuleAction,
  moveLessonAction,
  moveModuleAction,
  updateLessonAction,
  updateModuleAction,
} from '@/server/actions/admin-courses';

import {
  EDITABLE_LESSON_TYPES,
  LESSON_TYPE_LABEL_KEY,
  type CourseEditorView,
  type LessonView,
  type ModuleView,
} from '../course-view';
import { useEditorFeedback } from './use-editor-feedback';

/**
 * « Programme » — the curriculum builder (§17.5.3).
 *
 * ## Reordering is buttons first
 * §17.5 asks for drag-and-drop *and* keyboard reordering. This builds the
 * keyboard half and nothing else: a pair of « Monter » / « Descendre » buttons
 * is operable by every input device including a screen reader and a phone, and
 * each press is one server action that swaps two `order` values inside a
 * transaction. A drag surface can be layered on top later; it cannot be layered
 * *under* a missing keyboard path, which is why this is the half that ships.
 *
 * The first row's « Monter » and the last row's « Descendre » are disabled
 * rather than hidden, so the control column does not reflow as the list moves.
 *
 * ## Every panel saves explicitly
 * Titles, durations and flags are edited in a disclosure panel with its own
 * « Enregistrer ». Switches that commit on change would fire one action per
 * keystroke of the title beside them, and a half-typed lesson name is not a
 * thing anybody wants written to a public catalogue.
 */

export interface ProgrammeTabProps {
  readonly course: CourseEditorView;
}

export function ProgrammeTab({ course }: ProgrammeTabProps): React.JSX.Element {
  const t = useTranslations('admin.courses');

  return (
    <div className="flex flex-col gap-6">
      {course.modules.length === 0 ? (
        <EmptyState
          illustration={<Settings2 aria-hidden="true" />}
          title={t('checklist.module')}
          description={t('checklist.blocked')}
        />
      ) : (
        <ol className="flex flex-col gap-4">
          {course.modules.map((module, index) => (
            <li key={module.id}>
              <ModuleCard module={module} index={index} count={course.modules.length} />
            </li>
          ))}
        </ol>
      )}

      <AddModuleForm courseId={course.id} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Module                                                                      */
/* -------------------------------------------------------------------------- */

function ModuleCard({
  module,
  index,
  count,
}: {
  module: ModuleView;
  index: number;
  count: number;
}): React.JSX.Element {
  const t = useTranslations('admin.courses');
  const tCms = useTranslations('admin.cms.common');
  const { succeed, fail } = useEditorFeedback();

  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const title = module.titles.fr === '' ? t('curriculum.moduleTitle') : module.titles.fr;

  const move = (direction: 'up' | 'down'): void => {
    startTransition(async () => {
      const result = await moveModuleAction({ id: module.id, direction });
      if (!result.ok) {
        fail(result.error);
        return;
      }
      succeed({ changed: result.data.changed });
    });
  };

  const remove = (): void => {
    startTransition(async () => {
      const result = await deleteModuleAction({ moduleId: module.id });
      if (!result.ok) {
        fail(result.error);
        return;
      }
      setConfirming(false);
      succeed({ changed: result.data.changed });
    });
  };

  return (
    <article className="rounded-md border border-hairline bg-surface">
      <header className="flex flex-wrap items-center gap-2 border-b border-hairline p-3">
        <span
          data-numeric
          dir="ltr"
          className="force-ltr grid size-8 shrink-0 place-items-center rounded-sm bg-raised text-sm text-ink-muted"
        >
          {index + 1}
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-ink">{title}</span>
          <span className="text-xs text-ink-muted" data-numeric>
            {t('curriculum.lessonCount', { count: module.lessons.length })}
          </span>
        </span>

        <Badge tone={module.isPublished ? 'success' : 'neutral'} variant="soft" size="sm">
          {module.isPublished ? tCms('visible') : tCms('hidden')}
        </Badge>

        <span className="flex items-center gap-0.5">
          <IconButton
            aria-label={`${t('curriculum.moveUp')} — ${title}`}
            icon={<ChevronUp aria-hidden="true" />}
            size="sm"
            disabled={index === 0 || pending}
            onClick={() => move('up')}
          />
          <IconButton
            aria-label={`${t('curriculum.moveDown')} — ${title}`}
            icon={<ChevronDown aria-hidden="true" />}
            size="sm"
            disabled={index === count - 1 || pending}
            onClick={() => move('down')}
          />
          <IconButton
            aria-label={`${t('curriculum.deleteModule')} — ${title}`}
            icon={<Trash2 aria-hidden="true" />}
            size="sm"
            disabled={pending}
            onClick={() => setConfirming(true)}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            {t('rowActions.edit')}
          </Button>
        </span>
      </header>

      {open ? (
        <div id={panelId} className="border-b border-hairline p-3">
          <ModuleForm module={module} onDone={() => setOpen(false)} />
        </div>
      ) : null}

      <ol className="flex flex-col divide-y divide-hairline">
        {module.lessons.map((lesson, lessonIndex) => (
          <li key={lesson.id}>
            <LessonRow lesson={lesson} index={lessonIndex} count={module.lessons.length} />
          </li>
        ))}
      </ol>

      <div className="border-t border-hairline p-3">
        <AddLessonForm moduleId={module.id} />
      </div>

      <ConfirmDialog
        open={confirming}
        title={t('curriculum.deleteModule')}
        description={t('curriculum.deleteModuleBody', { title })}
        confirmLabel={t('curriculum.deleteModule')}
        pending={pending}
        onConfirm={remove}
        onClose={() => setConfirming(false)}
      />
    </article>
  );
}

function ModuleForm({
  module,
  onDone,
}: {
  module: ModuleView;
  onDone: () => void;
}): React.JSX.Element {
  const t = useTranslations('admin.courses');
  const tCms = useTranslations('admin.cms.common');
  const tCommon = useTranslations('common');
  const tLocale = useTranslations('locale');
  const { succeed, fail } = useEditorFeedback();

  const [titles, setTitles] = useState<Record<Locale, string>>({ ...module.titles });
  const [summary, setSummary] = useState(module.summaryFr);
  const [isPublished, setPublished] = useState(module.isPublished);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    if (titles.fr.trim() === '') {
      setError(t('curriculum.moduleTitle'));
      return;
    }

    startTransition(async () => {
      const result = await updateModuleAction({
        moduleId: module.id,
        titles: locales.map((locale) => ({ locale, title: titles[locale] })),
        summaryFr: summary,
        isPublished,
      });

      if (!result.ok) {
        fail(result.error);
        return;
      }
      onDone();
      succeed({ changed: result.data.changed });
    });
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {locales.map((locale) => (
          <FormField
            key={locale}
            label={`${t('curriculum.moduleTitle')} · ${tLocale(locale)}`}
            required={locale === 'fr'}
            requiredHint={locale === 'fr' ? tCommon('required') : undefined}
            error={locale === 'fr' ? error : undefined}
          >
            {(field) => (
              <Input
                id={field.id}
                aria-describedby={field['aria-describedby']}
                aria-invalid={field['aria-invalid']}
                invalid={field['aria-invalid'] === true}
                inputSize="sm"
                dir={locale === 'ar' ? 'rtl' : 'ltr'}
                value={titles[locale]}
                onChange={(event) => {
                  setTitles((current) => ({ ...current, [locale]: event.target.value }));
                  if (error !== null) setError(null);
                }}
              />
            )}
          </FormField>
        ))}
      </div>

      <FormField label={t('description.editorLabel')}>
        {(field) => (
          <Textarea
            id={field.id}
            rows={3}
            textareaSize="sm"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        )}
      </FormField>

      <CheckboxField
        label={tCms('visible')}
        checked={isPublished}
        onCheckedChange={(checked) => setPublished(checked === true)}
      />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={pending}>
          {tCommon('save')}
        </Button>
      </div>
    </form>
  );
}

function AddModuleForm({ courseId }: { courseId: string }): React.JSX.Element {
  const t = useTranslations('admin.courses');
  const { succeed, fail } = useEditorFeedback();

  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    const value = title.trim();
    if (value === '') {
      setError(t('curriculum.moduleTitle'));
      return;
    }

    startTransition(async () => {
      const result = await createModuleAction({ courseId, title: value });
      if (!result.ok) {
        fail(result.error);
        return;
      }
      setTitle('');
      succeed();
    });
  };

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-hairline p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <FormField
        label={t('curriculum.moduleTitle')}
        error={error}
        className="min-w-0 flex-1 sm:max-w-md"
      >
        {(field) => (
          <Input
            id={field.id}
            aria-describedby={field['aria-describedby']}
            aria-invalid={field['aria-invalid']}
            invalid={field['aria-invalid'] === true}
            inputSize="sm"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error !== null) setError(null);
            }}
          />
        )}
      </FormField>

      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={pending}
        iconStart={<Plus aria-hidden="true" />}
      >
        {t('curriculum.addModule')}
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Lesson                                                                      */
/* -------------------------------------------------------------------------- */

function LessonRow({
  lesson,
  index,
  count,
}: {
  lesson: LessonView;
  index: number;
  count: number;
}): React.JSX.Element {
  const t = useTranslations('admin.courses');
  const tCms = useTranslations('admin.cms.common');
  const { succeed, fail } = useEditorFeedback();

  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const title = lesson.titles.fr === '' ? t('curriculum.lessonTitle') : lesson.titles.fr;

  const move = (direction: 'up' | 'down'): void => {
    startTransition(async () => {
      const result = await moveLessonAction({ id: lesson.id, direction });
      if (!result.ok) {
        fail(result.error);
        return;
      }
      succeed({ changed: result.data.changed });
    });
  };

  const remove = (): void => {
    startTransition(async () => {
      const result = await deleteLessonAction({ lessonId: lesson.id });
      if (!result.ok) {
        fail(result.error);
        return;
      }
      setConfirming(false);
      succeed({ changed: result.data.changed });
    });
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <span
          data-numeric
          dir="ltr"
          className="force-ltr w-6 shrink-0 text-center text-xs text-ink-muted"
        >
          {index + 1}
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-ink">{title}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
            <span>{t(LESSON_TYPE_LABEL_KEY[lesson.type])}</span>
            {lesson.estimatedMinutes > 0 ? (
              <span data-numeric dir="ltr" className="force-ltr">
                {`${t('curriculum.duration')} ${lesson.estimatedMinutes}`}
              </span>
            ) : null}
          </span>
        </span>

        {lesson.isPreview ? (
          <Badge tone="strait" variant="soft" size="sm">
            {t('curriculum.freePreview')}
          </Badge>
        ) : null}

        {lesson.isPublished ? null : (
          <Badge tone="neutral" variant="soft" size="sm">
            {tCms('hidden')}
          </Badge>
        )}

        <span className="flex items-center gap-0.5">
          <IconButton
            aria-label={`${t('curriculum.moveUp')} — ${title}`}
            icon={<ChevronUp aria-hidden="true" />}
            size="sm"
            disabled={index === 0 || pending}
            onClick={() => move('up')}
          />
          <IconButton
            aria-label={`${t('curriculum.moveDown')} — ${title}`}
            icon={<ChevronDown aria-hidden="true" />}
            size="sm"
            disabled={index === count - 1 || pending}
            onClick={() => move('down')}
          />
          <IconButton
            aria-label={`${t('curriculum.deleteLesson')} — ${title}`}
            icon={<Trash2 aria-hidden="true" />}
            size="sm"
            disabled={pending}
            onClick={() => setConfirming(true)}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            {t('curriculum.editLesson')}
          </Button>
        </span>
      </div>

      {open ? (
        <div id={panelId} className="border-t border-hairline bg-raised p-3">
          <LessonForm lesson={lesson} onDone={() => setOpen(false)} />
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={t('curriculum.deleteLesson')}
        description={title}
        confirmLabel={t('curriculum.deleteLesson')}
        pending={pending}
        onConfirm={remove}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

function LessonForm({
  lesson,
  onDone,
}: {
  lesson: LessonView;
  onDone: () => void;
}): React.JSX.Element {
  const t = useTranslations('admin.courses');
  const tCms = useTranslations('admin.cms.common');
  const tCommon = useTranslations('common');
  const tLocale = useTranslations('locale');
  const { succeed, fail } = useEditorFeedback();

  const [titles, setTitles] = useState<Record<Locale, string>>({ ...lesson.titles });
  const [type, setType] = useState<string>(lesson.type);
  const [minutes, setMinutes] = useState(String(lesson.estimatedMinutes));
  const [isPreview, setPreview] = useState(lesson.isPreview);
  const [isPublished, setPublished] = useState(lesson.isPublished);
  const [isMandatory, setMandatory] = useState(lesson.isMandatory);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    if (titles.fr.trim() === '') {
      setError(t('curriculum.lessonTitle'));
      return;
    }

    const parsed = Number.parseInt(minutes.trim() === '' ? '0' : minutes.trim(), 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      setError(t('curriculum.duration'));
      return;
    }

    startTransition(async () => {
      const result = await updateLessonAction({
        lessonId: lesson.id,
        titles: locales.map((locale) => ({ locale, title: titles[locale] })),
        type,
        estimatedMinutes: parsed,
        isPreview,
        isPublished,
        isMandatory,
      });

      if (!result.ok) {
        fail(result.error);
        return;
      }
      onDone();
      succeed({ changed: result.data.changed });
    });
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {locales.map((locale) => (
          <FormField
            key={locale}
            label={`${t('curriculum.lessonTitle')} · ${tLocale(locale)}`}
            required={locale === 'fr'}
            requiredHint={locale === 'fr' ? tCommon('required') : undefined}
            error={locale === 'fr' ? error : undefined}
          >
            {(field) => (
              <Input
                id={field.id}
                aria-describedby={field['aria-describedby']}
                aria-invalid={field['aria-invalid']}
                invalid={field['aria-invalid'] === true}
                inputSize="sm"
                dir={locale === 'ar' ? 'rtl' : 'ltr'}
                value={titles[locale]}
                onChange={(event) => {
                  setTitles((current) => ({ ...current, [locale]: event.target.value }));
                  if (error !== null) setError(null);
                }}
              />
            )}
          </FormField>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label={t('curriculum.lessonType')}>
          {(field) => (
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id={field.id} selectSize="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EDITABLE_LESSON_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(LESSON_TYPE_LABEL_KEY[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>

        <FormField label={t('curriculum.duration')}>
          {(field) => (
            <Input
              id={field.id}
              inputSize="sm"
              inputMode="numeric"
              pattern="[0-9]*"
              dir="ltr"
              className="force-ltr"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          )}
        </FormField>
      </div>

      <div className="flex flex-col gap-2">
        <CheckboxField
          label={t('curriculum.freePreview')}
          checked={isPreview}
          onCheckedChange={(checked) => setPreview(checked === true)}
        />
        <CheckboxField
          label={t('curriculum.mandatory')}
          checked={isMandatory}
          onCheckedChange={(checked) => setMandatory(checked === true)}
        />
        <CheckboxField
          label={tCms('visible')}
          checked={isPublished}
          onCheckedChange={(checked) => setPublished(checked === true)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={pending}>
          {tCommon('save')}
        </Button>
      </div>
    </form>
  );
}

function AddLessonForm({ moduleId }: { moduleId: string }): React.JSX.Element {
  const t = useTranslations('admin.courses');
  const { succeed, fail } = useEditorFeedback();

  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>('VIDEO');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    const value = title.trim();
    if (value === '') {
      setError(t('curriculum.lessonTitle'));
      return;
    }

    startTransition(async () => {
      const result = await createLessonAction({ moduleId, title: value, type });
      if (!result.ok) {
        fail(result.error);
        return;
      }
      setTitle('');
      succeed();
    });
  };

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <FormField
        label={t('curriculum.lessonTitle')}
        error={error}
        className="min-w-0 flex-1 sm:max-w-sm"
      >
        {(field) => (
          <Input
            id={field.id}
            aria-describedby={field['aria-describedby']}
            aria-invalid={field['aria-invalid']}
            invalid={field['aria-invalid'] === true}
            inputSize="sm"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error !== null) setError(null);
            }}
          />
        )}
      </FormField>

      <FormField label={t('curriculum.lessonType')} className="w-full sm:w-44">
        {(field) => (
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id={field.id} selectSize="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITABLE_LESSON_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(LESSON_TYPE_LABEL_KEY[value])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>

      <Button
        type="submit"
        variant="ghost"
        size="sm"
        loading={pending}
        iconStart={<Plus aria-hidden="true" />}
      >
        {t('curriculum.addLesson')}
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Confirmation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The one destructive-confirmation dialog this tab uses.
 *
 * `Modal` becomes a bottom sheet under `md`, so the same component works on the
 * phone the centre's staff actually carry.
 */
function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const tCommon = useTranslations('common');

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ModalContent size="sm" closeLabel={tCommon('close')}>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription className={cn('text-sm')}>{description}</ModalDescription>
        </ModalHeader>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={pending}
            iconStart={<Trash2 aria-hidden="true" />}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
