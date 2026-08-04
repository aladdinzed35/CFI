'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';

import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
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
import { createCourseAction } from '@/server/actions/admin-courses';

import { ACTION_ERROR_KEY } from './course-view';

/**
 * « Nouvelle formation » (§17.5).
 *
 * One field. A course is opened with a title and nothing else, lands in
 * `DRAFT`, and the author continues in the editor where the publication
 * checklist can tell them what is still missing — which a ten-field creation
 * form cannot, because at that point nothing exists to check.
 *
 * On success the author is pushed straight into the editor: creating a course
 * and then hunting for it in a list of twelve is a step nobody wants.
 */
const TITLE_MIN = 3;

export function NewCourseButton(): React.JSX.Element {
  const t = useTranslations('admin.courses');
  const tCommon = useTranslations('common');
  const tError = useTranslations('admin.actionError');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    const value = title.trim();
    if (value.length < TITLE_MIN) {
      setError(tError('validation'));
      return;
    }

    startTransition(async () => {
      const result = await createCourseAction({ title: value });

      if (!result.ok) {
        setError(tError(ACTION_ERROR_KEY[result.error]));
        return;
      }

      setOpen(false);
      setTitle('');
      toast.success({
        title: t('editor.saved'),
        dismissLabel: tCommon('close'),
      });
      router.push(`/admin/formations/${result.data.courseId}`);
    });
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <Button
        type="button"
        variant="primary"
        iconStart={<Plus aria-hidden="true" />}
        onClick={() => setOpen(true)}
      >
        {t('newCourse')}
      </Button>

      <ModalContent size="sm" closeLabel={tCommon('close')}>
        <ModalHeader>
          <ModalTitle>{t('newCourse')}</ModalTitle>
          <ModalDescription>{t('general.slugHint')}</ModalDescription>
        </ModalHeader>

        <ModalBody>
          <FormField
            label={t('general.title')}
            required
            requiredHint={tCommon('required')}
            error={error}
          >
            {(field) => (
              <Input
                id={field.id}
                aria-describedby={field['aria-describedby']}
                aria-invalid={field['aria-invalid']}
                invalid={field['aria-invalid'] === true}
                value={title}
                autoComplete="off"
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (error !== null) setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
            )}
          </FormField>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" variant="primary" loading={pending} onClick={submit}>
            {t('newCourse')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
