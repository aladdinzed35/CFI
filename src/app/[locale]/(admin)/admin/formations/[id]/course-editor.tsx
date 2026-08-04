'use client';

import { useTranslations } from 'next-intl';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusPill } from '@/components/ui/status-pill';

import {
  COURSE_STATUS_LABEL_KEY,
  type CourseEditorView,
} from '../course-view';
import { InfosTab } from './infos-tab';
import { ProgrammeTab } from './programme-tab';
import { PublicationTab } from './publication-tab';

/**
 * The editor shell: a header that never moves, and three tabs.
 *
 * Tab state is local rather than in the URL. Every tab writes through a server
 * action followed by `router.refresh()`, so the page re-renders from the
 * database on each save; keeping the active tab in React state is what stops a
 * save from bouncing the author back to « Infos » mid-edit.
 */

export interface CourseEditorProps {
  readonly course: CourseEditorView;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
}

export function CourseEditor({ course, categories }: CourseEditorProps): React.JSX.Element {
  const t = useTranslations('admin.courses');

  const frenchTitle = course.translations.find((entry) => entry.locale === 'fr')?.title ?? '';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 font-display text-title text-ink">
            {frenchTitle === '' ? course.slug : frenchTitle}
          </h1>
          <StatusPill
            domain="course"
            status={course.status}
            label={t(COURSE_STATUS_LABEL_KEY[course.status])}
            srPrefix={t('columns.status')}
          />
        </div>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          <span className="force-ltr font-mono text-xs" dir="ltr">
            {course.slug}
          </span>
          <span>{`${t('columns.updatedAt')} ${course.updatedAtLabel}`}</span>
        </p>
      </header>

      <Tabs defaultValue="infos" variant="line">
        <TabsList>
          <TabsTrigger value="infos">{t('editor.tabs.general')}</TabsTrigger>
          <TabsTrigger value="programme">{t('editor.tabs.curriculum')}</TabsTrigger>
          <TabsTrigger value="publication">{t('checklist.title')}</TabsTrigger>
        </TabsList>

        <TabsContent value="infos">
          <InfosTab course={course} categories={categories} />
        </TabsContent>

        <TabsContent value="programme">
          <ProgrammeTab course={course} />
        </TabsContent>

        <TabsContent value="publication">
          <PublicationTab course={course} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
