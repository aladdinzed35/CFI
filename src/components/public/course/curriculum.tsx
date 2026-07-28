'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Layers, Lock, PlayCircle } from 'lucide-react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  LESSON_TYPE_ICON,
  LESSON_TYPE_MESSAGE,
  PreviewModal,
  type PreviewEntry,
} from '@/components/public/course/preview-modal';
import { formatDuration } from '@/lib/dates';
import type { Locale } from '@/i18n/routing';
import type { CourseModule } from '@/server/services/catalog/course-detail';

/**
 * « Programme » — the module accordion (§12.4).
 *
 * The section owns three things the page cannot own on its own:
 *
 * 1. **Expand all / collapse all.** The accordion is therefore *controlled*:
 *    one `openModules` array is the single source of truth, and the button
 *    reads it rather than keeping a second flag that could disagree with what
 *    is on screen. The first module opens by default — a collapsed wall of
 *    titles hides the very thing this section exists to show.
 * 2. **The preview modal.** The badge on a previewable lesson is the button
 *    that opens it, and the whole preview set is handed to the modal so the
 *    reader can walk from one to the next without closing anything.
 * 3. **The locked affordance.** Every lesson that is not previewable carries a
 *    padlock, and one line under the accordion says what unlocks it. That is
 *    the difference between explaining and teasing: nothing is dressed up as
 *    clickable, and the reason is stated once, in plain words.
 *
 * ## Why a client component
 * Expand/collapse and the modal need state and handlers. Everything expensive
 * stays out: no data fetching, no formatting library beyond `formatDuration`,
 * and the lesson bodies are already in the payload because the server resolved
 * them. The rest of the page remains a Server Component.
 */

export interface CurriculumProps {
  readonly locale: Locale;
  /** Published modules, in order, exactly as `getCourseBySlug` returned them. */
  readonly modules: readonly CourseModule[];
  /** `CourseDetail.lessonCount` — the size of the whole course, for the preview hint. */
  readonly lessonCount: number;
  /** Register link for a signed-out visitor, `null` for everyone else. */
  readonly registerHref?: string | null;
  /** `https://wa.me/…`; enables the empty state's single action when the programme is not published yet. */
  readonly whatsappHref?: string | null;
}

export function Curriculum({
  locale,
  modules,
  lessonCount,
  registerHref = null,
  whatsappHref = null,
}: CurriculumProps): React.JSX.Element {
  const t = useTranslations('course');

  /** Every previewable lesson, flattened in reading order — the modal walks this. */
  const previews = useMemo<readonly PreviewEntry[]>(() => {
    const out: PreviewEntry[] = [];
    modules.forEach((entry, moduleIndex) => {
      for (const lesson of entry.lessons) {
        if (lesson.preview === null) continue;
        out.push({ lesson, moduleNumber: moduleIndex + 1, moduleTitle: entry.title });
      }
    });
    return out;
  }, [modules]);

  /** Lesson id → its position in `previews`, so a row knows which index to open. */
  const previewIndexById = useMemo<ReadonlyMap<string, number>>(
    () => new Map(previews.map((entry, position) => [entry.lesson.id, position])),
    [previews],
  );

  const [openModules, setOpenModules] = useState<string[]>(() => {
    const first = modules[0];
    return first === undefined ? [] : [first.id];
  });
  const [openPreview, setOpenPreview] = useState<number | null>(null);

  const renderedLessonCount = modules.reduce((total, entry) => total + entry.lessons.length, 0);
  const hasLockedLesson = renderedLessonCount > previews.length;
  const allExpanded = modules.length > 0 && openModules.length === modules.length;

  return (
    <section aria-labelledby="curriculum">
      <h2 id="curriculum" className="text-heading">
        {t('programme.title')}
      </h2>
      <p className="mt-2 text-sm text-pretty text-ink-muted">{t('programme.subtitle')}</p>

      {modules.length === 0 ? (
        <div className="mt-4 rounded-lg border border-hairline bg-surface">
          <EmptyState
            illustration={<Layers />}
            title={t('programme.empty.title')}
            description={t('programme.empty.body')}
            action={
              whatsappHref === null ? undefined : (
                <Button asChild variant="secondary" size="sm">
                  <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                    {t('programme.empty.action')}
                  </a>
                </Button>
              )
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-sm text-ink-muted">
              {t('programme.moduleCount', { count: modules.length })}
              <span aria-hidden="true"> · </span>
              {t('programme.lessonCount', { count: renderedLessonCount })}
            </p>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpenModules(allExpanded ? [] : modules.map((entry) => entry.id));
              }}
            >
              {allExpanded ? t('programme.collapseAll') : t('programme.expandAll')}
            </Button>
          </div>

          <Accordion
            type="multiple"
            value={openModules}
            onValueChange={setOpenModules}
            className="mt-1 border-t border-hairline"
          >
            {modules.map((entry, moduleIndex) => (
              <AccordionItem key={entry.id} value={entry.id}>
                <AccordionTrigger>
                  <span className="flex flex-col gap-1">
                    <span className="text-xs font-normal text-ink-muted">
                      {t('programme.moduleLabel', { number: moduleIndex + 1 })}
                    </span>
                    <span className="text-balance">{entry.title}</span>
                    <span className="text-xs font-normal text-ink-muted">
                      {t('programme.moduleSummary', {
                        lessons: entry.lessons.length,
                        duration: formatDuration(entry.durationMinutes, locale),
                      })}
                    </span>
                  </span>
                </AccordionTrigger>

                <AccordionContent>
                  {entry.summary === null ? null : (
                    <p className="pb-3 text-sm text-pretty text-ink-muted">{entry.summary}</p>
                  )}

                  <ul className="flex flex-col">
                    {entry.lessons.map((lesson) => {
                      const Icon = LESSON_TYPE_ICON[lesson.type];
                      const previewIndex = previewIndexById.get(lesson.id);

                      return (
                        <li
                          key={lesson.id}
                          className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline py-1.5 last:border-b-0"
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-2.5">
                            <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                            {/* The icon alone never carries the type (§21). */}
                            <span className="sr-only">
                              {t(`programme.lessonType.${LESSON_TYPE_MESSAGE[lesson.type]}`)}
                            </span>
                            <span className="min-w-0 truncate text-sm text-ink">{lesson.title}</span>
                          </span>

                          {previewIndex === undefined ? (
                            <span className="flex shrink-0 items-center text-ink-muted">
                              <Lock className="size-3.5" aria-hidden="true" />
                              <span className="sr-only">{t('programme.locked')}</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setOpenPreview(previewIndex);
                              }}
                              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill border border-strait/50 px-3 text-xs font-medium text-strait transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-strait-wash motion-reduce:transition-none"
                            >
                              <PlayCircle className="size-3.5 shrink-0" aria-hidden="true" />
                              {t('programme.previewBadge')}
                              {/* Keeps every row's button distinguishable by name. */}
                              <span className="sr-only"> : {lesson.title}</span>
                            </button>
                          )}

                          <span
                            data-numeric
                            dir="ltr"
                            className="force-ltr shrink-0 text-xs text-ink-muted"
                          >
                            {formatDuration(lesson.estimatedMinutes, locale)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          {hasLockedLesson ? (
            <p className="mt-4 flex items-start gap-2 text-xs text-ink-muted">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="text-pretty">{t('programme.locked')}</span>
            </p>
          ) : null}

          <PreviewModal
            locale={locale}
            entries={previews}
            index={openPreview}
            onIndexChange={setOpenPreview}
            lessonCount={lessonCount}
            registerHref={registerHref}
          />
        </>
      )}
    </section>
  );
}
