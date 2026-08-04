'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Archive, Check, Circle, Globe, PencilLine } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { toast } from '@/components/ui/use-toast';
import { useRouter } from '@/i18n/navigation';
import type { ChecklistKey, CourseTransitionTarget } from '@/server/services/course-admin';
import { setCourseStatusAction } from '@/server/actions/admin-courses';

import {
  ACTION_ERROR_KEY,
  CHECKLIST_LABEL_KEY,
  type CourseEditorView,
} from '../course-view';

/**
 * « Liste de publication » — the checklist, and the three transitions (§17.5).
 *
 * ## A blocked publication names what is missing
 * The checklist is computed on the server from committed rows and re-computed
 * inside the publishing transaction, so a screen that has been open for an hour
 * cannot talk the server into publishing an incomplete course. When it refuses,
 * the action returns the list of unmet conditions and this panel scrolls them
 * into view rather than showing « une erreur est survenue » — the author needs
 * to know it was the cover image, not that something went wrong.
 *
 * ## Archiving warns with a number, not an adjective
 * « Attention, des étudiants sont inscrits » is not actionable. The dialog shows
 * how many enrollments are live right now, which is the fact the decision turns
 * on.
 *
 * ## Each condition carries an icon as well as a colour
 * §21: colour is never the only signal. A met condition is a check, an unmet one
 * is an empty circle, and both are readable in greyscale.
 */

export interface PublicationTabProps {
  readonly course: CourseEditorView;
}

/** Which transitions make sense from where. A no-op button is not offered. */
function availableTransitions(
  status: CourseEditorView['status'],
): readonly CourseTransitionTarget[] {
  switch (status) {
    case 'PUBLISHED':
      return ['DRAFT', 'ARCHIVED'];
    case 'ARCHIVED':
      return ['DRAFT'];
    default:
      return ['PUBLISHED', 'ARCHIVED'];
  }
}

export function PublicationTab({ course }: PublicationTabProps): React.JSX.Element {
  const t = useTranslations('admin.courses');
  const tCommon = useTranslations('common');
  const tError = useTranslations('admin.actionError');
  const router = useRouter();

  const [target, setTarget] = useState<CourseTransitionTarget | null>(null);
  const [missing, setMissing] = useState<readonly ChecklistKey[]>([]);
  const [pending, startTransition] = useTransition();

  const transitions = availableTransitions(course.status);

  const apply = (status: CourseTransitionTarget): void => {
    startTransition(async () => {
      const result = await setCourseStatusAction({ courseId: course.id, status });

      if (!result.ok) {
        toast.error({
          title: t('editor.saveError'),
          description: tError(ACTION_ERROR_KEY[result.error]),
          dismissLabel: tCommon('close'),
        });
        return;
      }

      setTarget(null);

      // A refused publication is a successful action carrying the reasons.
      if (result.data.missing.length > 0) {
        setMissing(result.data.missing);
        toast.warning({
          title: t('checklist.blocked'),
          description: result.data.missing
            .map((key) => t(CHECKLIST_LABEL_KEY[key]))
            .join(' · '),
          dismissLabel: tCommon('close'),
        });
        return;
      }

      setMissing([]);

      if (result.data.changed) {
        toast.success({
          title: t(TRANSITION_TOAST_KEY[status]),
          dismissLabel: tCommon('close'),
        });
      } else {
        toast.info({ title: t('editor.saved'), dismissLabel: tCommon('close') });
      }

      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section
        className="flex flex-col gap-3 rounded-md border border-hairline bg-surface p-4"
        aria-labelledby="publication-checklist"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="publication-checklist" className="text-lead text-ink">
            {t('checklist.title')}
          </h2>
          <p className="text-sm text-ink-muted" data-numeric>
            {t('checklist.progress', {
              done: course.checklistDone,
              total: course.checklistTotal,
            })}
          </p>
        </div>

        <ul className="flex flex-col gap-2">
          {course.checklist.map((item) => (
            <li key={item.key} className="flex items-center gap-2 text-sm">
              {item.done ? (
                <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Circle className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
              )}
              <span className={item.done ? 'text-ink' : 'text-ink-muted'}>
                {t(CHECKLIST_LABEL_KEY[item.key])}
              </span>
              <span className="sr-only">{item.done ? tCommon('yes') : tCommon('no')}</span>
            </li>
          ))}
        </ul>

        <Alert
          variant={course.checklistReady ? 'success' : 'warning'}
          title={course.checklistReady ? t('checklist.ready') : t('checklist.blocked')}
        >
          {missing.length === 0
            ? null
            : missing.map((key) => t(CHECKLIST_LABEL_KEY[key])).join(' · ')}
        </Alert>
      </section>

      <section className="flex flex-wrap gap-3" aria-label={t('editor.tabs.general')}>
        {transitions.map((status) => (
          <Button
            key={status}
            type="button"
            variant={status === 'PUBLISHED' ? 'primary' : 'secondary'}
            disabled={status === 'PUBLISHED' && !course.checklistReady}
            iconStart={TRANSITION_ICON[status]}
            onClick={() => setTarget(status)}
          >
            {t(TRANSITION_LABEL_KEY[status])}
          </Button>
        ))}
      </section>

      <ConfirmTransition
        course={course}
        target={target}
        pending={pending}
        onConfirm={apply}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

const TRANSITION_LABEL_KEY: Record<CourseTransitionTarget, string> = {
  PUBLISHED: 'checklist.publish',
  DRAFT: 'checklist.unpublish',
  ARCHIVED: 'rowActions.archive',
};

const TRANSITION_TOAST_KEY: Record<CourseTransitionTarget, string> = {
  PUBLISHED: 'toasts.published',
  DRAFT: 'toasts.unpublished',
  ARCHIVED: 'toasts.archived',
};

const TRANSITION_ICON: Record<CourseTransitionTarget, React.ReactNode> = {
  PUBLISHED: <Globe aria-hidden="true" />,
  DRAFT: <PencilLine aria-hidden="true" />,
  ARCHIVED: <Archive aria-hidden="true" />,
};

/* -------------------------------------------------------------------------- */
/* Confirmation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One dialog for the three transitions.
 *
 * The archive branch is the only one with a body: it is the transition that
 * takes something away from people who paid for it, so it states how many
 * enrollments are live before the button is pressed.
 */
function ConfirmTransition({
  course,
  target,
  pending,
  onConfirm,
  onClose,
}: {
  course: CourseEditorView;
  target: CourseTransitionTarget | null;
  pending: boolean;
  onConfirm: (status: CourseTransitionTarget) => void;
  onClose: () => void;
}): React.JSX.Element {
  const t = useTranslations('admin.courses');
  const tCommon = useTranslations('common');

  return (
    <Modal
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {target === null ? null : (
        <ModalContent size="sm" closeLabel={tCommon('close')}>
          <ModalHeader>
            <ModalTitle>{t(TRANSITION_LABEL_KEY[target])}</ModalTitle>
            <ModalDescription>{t(TRANSITION_TOAST_KEY[target])}</ModalDescription>
          </ModalHeader>

          {target === 'ARCHIVED' ? (
            <ModalBody>
              <Alert
                variant={course.activeEnrollments > 0 ? 'warning' : 'info'}
                title={t('columns.enrollments')}
              >
                {course.activeEnrollments === 0 ? (
                  t('students.empty')
                ) : (
                  <span data-numeric dir="ltr" className="force-ltr">
                    {course.activeEnrollments}
                  </span>
                )}
              </Alert>
            </ModalBody>
          ) : null}

          <ModalFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              variant={target === 'ARCHIVED' ? 'danger' : 'primary'}
              loading={pending}
              iconStart={TRANSITION_ICON[target]}
              onClick={() => onConfirm(target)}
              className={cn(target === 'PUBLISHED' && 'min-w-40')}
            >
              {t(TRANSITION_LABEL_KEY[target])}
            </Button>
          </ModalFooter>
        </ModalContent>
      )}
    </Modal>
  );
}
