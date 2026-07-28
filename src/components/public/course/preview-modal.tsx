'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListChecks,
  Lock,
  PenLine,
  PlayCircle,
  Radio,
  type LucideIcon,
} from 'lucide-react';

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
import { Markdown } from '@/components/public/course/markdown';
import { Link } from '@/i18n/navigation';
import { formatDuration } from '@/lib/dates';
import type { Locale } from '@/i18n/routing';
import type { CourseLesson, LessonTypeKey } from '@/server/services/catalog/course-detail';

/**
 * The preview lesson, opened without an account (§12.4).
 *
 * §12.4 calls this the single most effective conversion tool on the page, and
 * the whole design follows from one constraint: **it must never show something
 * that does not work.** Video hosting is M4, so there is no player. What every
 * published course does have is at least one `ARTICLE` preview carrying real
 * MDX in `LessonTranslation.content`, and that is what this renders — through
 * the same `Markdown` component the description uses, so an author who pastes
 * `<script>` gets the literal text on screen.
 *
 * `getCourseBySlug` already refuses to mark a lesson as previewable when it has
 * neither a body nor a transcript, so the "nothing to show" branch below is a
 * belt-and-braces answer rather than the normal path: it states plainly that
 * the lesson opens once access is activated. There is no play button anywhere
 * in this file that does not lead to text.
 *
 * ## Shape and behaviour
 * A `Modal`, which is already a bottom sheet below `md` and a centred dialog
 * above it. Radix supplies the focus trap, the focus restore, `Esc`, the scroll
 * lock and the `aria-modal` wiring — none of which is re-implemented here.
 *
 * ## Navigating between previews without closing
 * A course may expose several previews (`marketing-digital-fondations` seeds
 * two). Closing the dialog to open the next one loses the reader, so the whole
 * preview set is passed in and the modal walks it. The open lesson is
 * identified by its **index** rather than its id: the previous/next affordance
 * is positional, and an index makes "is there a next one" a comparison instead
 * of a lookup. Navigation moves focus into the body so a screen reader lands on
 * the new lesson instead of staying on a button whose label did not change.
 */

/* -------------------------------------------------------------------------- */
/* Lesson type vocabulary — shared with the curriculum                         */
/* -------------------------------------------------------------------------- */

/**
 * `LessonType` → the leaf under `course.programme.lessonType`.
 *
 * The message keys are lower-case while the Prisma enum is upper-case, so the
 * mapping is written out rather than derived: a `toLowerCase()` would compile
 * happily on a seventh enum member that has no translation and render the raw
 * key on screen.
 */
export const LESSON_TYPE_MESSAGE: Record<LessonTypeKey, string> = {
  VIDEO: 'video',
  DOCUMENT: 'document',
  ARTICLE: 'article',
  QUIZ: 'quiz',
  ASSIGNMENT: 'assignment',
  LIVE: 'live',
};

/** Decorative icons. Every one is paired with a text label, never colour or shape alone (§21). */
export const LESSON_TYPE_ICON: Record<LessonTypeKey, LucideIcon> = {
  VIDEO: PlayCircle,
  DOCUMENT: FileText,
  ARTICLE: BookOpen,
  QUIZ: ListChecks,
  ASSIGNMENT: PenLine,
  LIVE: Radio,
};

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

/** One openable preview, with the module it belongs to for the dialog subtitle. */
export interface PreviewEntry {
  readonly lesson: CourseLesson;
  /** 1-based position of the module in the programme. */
  readonly moduleNumber: number;
  readonly moduleTitle: string;
}

export interface PreviewModalProps {
  readonly locale: Locale;
  /** Every previewable lesson of the course, in programme order. */
  readonly entries: readonly PreviewEntry[];
  /** Index into `entries` of the open lesson. `null` keeps the modal closed. */
  readonly index: number | null;
  /** Called with the next index, or `null` to close. */
  readonly onIndexChange: (index: number | null) => void;
  /** Published lessons in the whole course — the hint contrasts the extract with it. */
  readonly lessonCount: number;
  /**
   * Where « Créer un compte pour tout débloquer » points. `null` for anyone who
   * is already signed in: they are not being asked to register, and the sticky
   * purchase card beside the programme already carries their own call to action.
   */
  readonly registerHref?: string | null;
}

export function PreviewModal({
  locale,
  entries,
  index,
  onIndexChange,
  lessonCount,
  registerHref = null,
}: PreviewModalProps): React.JSX.Element {
  const t = useTranslations('course');
  const tCommon = useTranslations('common');

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const shownRef = useRef<number | null>(null);

  const entry = index === null ? undefined : entries[index];

  // Reset the scroll on every change, and move focus into the body when the
  // reader navigated (not when the dialog first opened — Radix has just placed
  // focus, and stealing it would skip the title it is announcing).
  useEffect(() => {
    if (index === null) {
      shownRef.current = null;
      return;
    }
    const body = bodyRef.current;
    if (body === null) return;

    body.scrollTop = 0;
    if (shownRef.current !== null && shownRef.current !== index) body.focus();
    shownRef.current = index;
  }, [index]);

  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (!next) onIndexChange(null);
    },
    [onIndexChange],
  );

  const position = index ?? 0;
  const hasPrevious = index !== null && index > 0;
  const hasNext = index !== null && index < entries.length - 1;

  return (
    <Modal open={entry !== undefined} onOpenChange={handleOpenChange}>
      {entry === undefined ? null : (
        <ModalContent size="lg" closeLabel={tCommon('close')}>
          <ModalHeader>
            <ModalTitle className="text-balance">
              {t('programme.previewModalTitle', { lessonTitle: entry.lesson.title })}
            </ModalTitle>
            <ModalDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{t('programme.moduleLabel', { number: entry.moduleNumber })}</span>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 truncate">{entry.moduleTitle}</span>
              <span aria-hidden="true">·</span>
              <span>{t(`programme.lessonType.${LESSON_TYPE_MESSAGE[entry.lesson.type]}`)}</span>
              <span aria-hidden="true">·</span>
              <span data-numeric dir="ltr" className="force-ltr">
                {formatDuration(entry.lesson.estimatedMinutes, locale)}
              </span>
            </ModalDescription>
          </ModalHeader>

          <ModalBody ref={bodyRef} tabIndex={-1} className="flex flex-col gap-4 pb-4 outline-none">
            {entry.lesson.preview === null ? (
              /* No body and no transcript: say so, and say when it opens. A play
                 button here would be a promise the platform cannot keep today. */
              <div className="flex items-start gap-3 rounded-md border border-hairline bg-raised p-4">
                <Lock className="mt-0.5 size-5 shrink-0 text-ink-muted" aria-hidden="true" />
                <p className="text-body text-pretty text-ink-muted">{t('programme.locked')}</p>
              </div>
            ) : (
              <>
                {entry.lesson.preview.kind === 'transcript' ? (
                  <p className="flex items-center gap-2 text-xs font-medium text-ink-muted">
                    <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                    {t('programme.previewTranscript')}
                  </p>
                ) : null}
                <Markdown source={entry.lesson.preview.body} headingLevel="h4" />
              </>
            )}

            <p className="rounded-sm bg-strait-wash px-3 py-2.5 text-sm text-pretty text-strait">
              {t('programme.previewModalHint', { count: lessonCount })}
            </p>
          </ModalBody>

          <ModalFooter
            className={entries.length > 1 ? 'sm:items-center sm:justify-between' : undefined}
          >
            {entries.length > 1 ? (
              <div className="flex items-center justify-between gap-2 sm:justify-start">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasPrevious}
                  onClick={() => {
                    onIndexChange(position - 1);
                  }}
                  iconStart={<ChevronLeft className="size-4 rtl:-scale-x-100" />}
                >
                  {t('programme.previewPrevious')}
                </Button>

                <span data-numeric className="shrink-0 text-xs text-ink-muted">
                  {t('programme.previewPosition', {
                    current: position + 1,
                    total: entries.length,
                  })}
                </span>

                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasNext}
                  onClick={() => {
                    onIndexChange(position + 1);
                  }}
                  iconEnd={<ChevronRight className="size-4 rtl:-scale-x-100" />}
                >
                  {t('programme.previewNext')}
                </Button>
              </div>
            ) : null}

            {registerHref === null ? null : (
              <Button asChild>
                <Link href={registerHref}>{t('programme.previewModalCta')}</Link>
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      )}
    </Modal>
  );
}
