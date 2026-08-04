'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import { toast } from '@/components/ui/use-toast';
import type { ActionErrorCode } from '@/server/auth/guards';

import { ACTION_ERROR_KEY } from '../course-view';

/**
 * The three sentences every tab of the editor needs, in one place.
 *
 * Every mutation ends the same way — say what happened, then re-read the course
 * from the database — and three tabs writing that themselves is three chances
 * to forget the refresh and leave the screen showing a curriculum that no
 * longer exists.
 *
 * `succeed` deliberately distinguishes a real change from a no-op. A
 * double-clicked button comes back `changed: false`, and claiming
 * « enregistré » about a write that matched zero rows is how an interface
 * teaches an author to distrust it.
 */
export interface EditorFeedback {
  /** Something was written. Refreshes the server component tree. */
  readonly succeed: (options?: { readonly changed?: boolean }) => void;
  /** An action came back `{ ok: false }`. */
  readonly fail: (code: ActionErrorCode) => void;
}

export function useEditorFeedback(): EditorFeedback {
  const t = useTranslations('admin.courses');
  const tCms = useTranslations('admin.cms.common');
  const tCommon = useTranslations('common');
  const tError = useTranslations('admin.actionError');
  const router = useRouter();

  const succeed = useCallback(
    (options?: { readonly changed?: boolean }): void => {
      const changed = options?.changed ?? true;

      toast.success({
        title: changed ? tCms('saved') : t('editor.saved'),
        // Saves reach the public catalogue on the next revalidation rather than
        // instantly; the author is told the change is live on the site, not
        // merely stored.
        description: t('editor.saved'),
        dismissLabel: tCommon('close'),
      });

      router.refresh();
    },
    [router, t, tCms, tCommon],
  );

  const fail = useCallback(
    (code: ActionErrorCode): void => {
      toast.error({
        title: t('editor.saveError'),
        description: tError(ACTION_ERROR_KEY[code]),
        dismissLabel: tCommon('close'),
      });
    },
    [t, tCommon, tError],
  );

  return { succeed, fail };
}
