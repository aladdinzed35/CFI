'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/use-toast';
import { useRouter } from '@/i18n/navigation';
import {
  deleteContentItemAction,
  moveContentItemAction,
  saveFaqItemAction,
} from '@/server/actions/admin-content';

import {
  DangerZone,
  EditorDrawer,
  ListRow,
  LocalisedField,
  PublishSwitch,
  TabHeader,
  TranslationMeter,
  hasFrench,
  useAction,
  withLocale,
} from './content-editor';
import {
  FAQ_CATEGORY_FALLBACK_KEY,
  FAQ_CATEGORY_LABEL_KEY,
  emptyLocalised,
  type FaqItemView,
  type LocalisedDraft,
} from './content-view';

/**
 * « FAQ » — the `FaqItem` table (§17.11).
 *
 * ## The list is grouped, because the order is
 * `FaqItem.order` is scoped to a category: three questions numbered 1–3 under
 * `INSCRIPTION`, three more numbered 1–3 under `PAIEMENT`. A flat list sorted by
 * `order` would interleave them and make the arrows lie. So the list renders one
 * group per rubric, in the reading order `/faq` itself uses, and « Monter »
 * moves a question within its own rubric only. Changing a question's rubric in
 * the editor moves it to the end of the new one, which is the only position that
 * does not silently push somebody else down.
 *
 * ## The rubric labels are the visitor's, not an internal code
 * The select shows « Inscription et compte », the heading a reader will see on
 * `/faq`, rather than `INSCRIPTION`. An editor files a question by where it will
 * appear, not by an enum.
 */

/* -------------------------------------------------------------------------- */
/* Draft                                                                       */
/* -------------------------------------------------------------------------- */

interface FaqDraft {
  readonly id: string | null;
  readonly category: string;
  readonly question: LocalisedDraft;
  readonly answer: LocalisedDraft;
  readonly published: boolean;
}

const QUESTION_MAX = 300;
const ANSWER_MAX = 8_000;

function draftOf(item: FaqItemView): FaqDraft {
  return {
    id: item.id,
    category: item.category,
    question: { ...item.question },
    answer: { ...item.answer },
    published: item.published,
  };
}

/* -------------------------------------------------------------------------- */
/* Tab                                                                         */
/* -------------------------------------------------------------------------- */

export interface FaqTabProps {
  readonly items: readonly FaqItemView[];
  /** The fixed §17.11 rubrics, in the order `/faq` renders them. */
  readonly categories: readonly string[];
}

export function FaqTab({ items, categories }: FaqTabProps): React.JSX.Element {
  const t = useTranslations('admin.cms');
  const tCommon = useTranslations('common');
  const tCourses = useTranslations('admin.courses');
  const tGroups = useTranslations('pages.faq.groups');
  const tFaq = useTranslations('pages.faq');

  const router = useRouter();
  const { pending, run } = useAction();

  const [draft, setDraft] = useState<FaqDraft | null>(null);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);

  const groupLabel = useCallback(
    (category: string): string => tGroups(FAQ_CATEGORY_LABEL_KEY[category] ?? FAQ_CATEGORY_FALLBACK_KEY),
    [tGroups],
  );

  const close = useCallback((): void => {
    setDraft(null);
    setQuestionError(null);
    setAnswerError(null);
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (draft === null) return;

    const missingQuestion = !hasFrench(draft.question);
    const missingAnswer = !hasFrench(draft.answer);
    setQuestionError(missingQuestion ? tCommon('required') : null);
    setAnswerError(missingAnswer ? tCommon('required') : null);
    if (missingQuestion || missingAnswer) return;

    const data = await run(() =>
      saveFaqItemAction({
        id: draft.id,
        category: draft.category,
        question: draft.question,
        answer: draft.answer,
        published: draft.published,
      }),
    );
    if (data === null) return;

    toast.success({
      title: t('faq.saved'),
      description: draft.published ? t('common.visible') : t('common.hidden'),
      dismissLabel: tCommon('close'),
    });
    close();
    router.refresh();
  }, [close, draft, router, run, t, tCommon]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      const data = await run(() => deleteContentItemAction({ kind: 'faq', id }));
      if (data === null) return;

      toast.success({ title: t('common.deleted'), dismissLabel: tCommon('close') });
      close();
      router.refresh();
    },
    [close, router, run, t, tCommon],
  );

  const move = useCallback(
    async (id: string, direction: 'up' | 'down'): Promise<void> => {
      const data = await run(() => moveContentItemAction({ kind: 'faq', id, direction }));
      if (data === null || !data.moved) return;
      router.refresh();
    },
    [router, run],
  );

  return (
    <div>
      <TabHeader
        countLabel={tFaq('resultCount', { count: items.length })}
        createLabel={t('faq.newQuestion')}
        onCreate={() => {
          setDraft({
            id: null,
            category: categories[0] ?? 'INSCRIPTION',
            question: emptyLocalised(),
            answer: emptyLocalised(),
            published: true,
          });
        }}
      />

      <div className="flex flex-col gap-6">
        {categories.map((category) => {
          const group = items.filter((item) => item.category === category);
          if (group.length === 0) return null;

          return (
            <section key={category}>
              {/* `h2` and not `h3`: the page's only `h1` is its title, and the
                  heading order is a hard accessibility gate (§21). */}
              <h2 className="pb-2 font-display text-lead text-ink">{groupLabel(category)}</h2>
              <ul className="flex flex-col gap-2">
                {group.map((item, index) => (
                  <ListRow
                    key={item.id}
                    title={<span className="text-body font-medium text-ink">{item.question.fr}</span>}
                    meta={
                      <span>
                        {t('pages.columns.updatedAt')}{' '}
                        <time dateTime={item.updatedAtIso}>{item.updatedAtLabel}</time>
                      </span>
                    }
                    badges={
                      <>
                        <StatusPill
                          domain="course"
                          status={item.published ? 'PUBLISHED' : 'DRAFT'}
                          label={
                            item.published ? tCourses('status.published') : tCourses('status.draft')
                          }
                        />
                        <TranslationMeter fields={[item.question, item.answer]} />
                      </>
                    }
                    actions={
                      <>
                        <IconButton
                          aria-label={tCourses('curriculum.moveUp')}
                          icon={<ChevronUp aria-hidden="true" />}
                          variant="ghost"
                          disabled={index === 0 || pending}
                          onClick={() => {
                            void move(item.id, 'up');
                          }}
                        />
                        <IconButton
                          aria-label={tCourses('curriculum.moveDown')}
                          icon={<ChevronDown aria-hidden="true" />}
                          variant="ghost"
                          disabled={index === group.length - 1 || pending}
                          onClick={() => {
                            void move(item.id, 'down');
                          }}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setDraft(draftOf(item));
                          }}
                        >
                          {tCourses('rowActions.edit')}
                        </Button>
                      </>
                    }
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {draft === null ? null : (
        <EditorDrawer
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
          title={draft.id === null ? t('faq.newQuestion') : tCourses('rowActions.edit')}
          description={t('pages.perLocale')}
          saving={pending}
          onSave={() => {
            void save();
          }}
          danger={
            draft.id === null ? undefined : (
              <DangerZone
                title={t('faq.deleteConfirm')}
                blocked={null}
                deleting={pending}
                onDelete={() => {
                  const id = draft.id;
                  if (id !== null) void remove(id);
                }}
              />
            )
          }
        >
          <FormField id="faq-category" label={t('faq.category')} required requiredHint={tCommon('required')}>
            {(field) => (
              <Select
                value={draft.category}
                onValueChange={(next) => {
                  setDraft({ ...draft, category: next });
                }}
              >
                <SelectTrigger id={field.id} aria-describedby={field['aria-describedby']}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {groupLabel(category)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <LocalisedField
            legend={t('faq.question')}
            idPrefix="faq-question"
            maxLength={QUESTION_MAX}
            values={draft.question}
            error={questionError}
            onChange={(locale, value) => {
              setDraft({ ...draft, question: withLocale(draft.question, locale, value) });
            }}
          />

          <LocalisedField
            legend={t('faq.answer')}
            idPrefix="faq-answer"
            maxLength={ANSWER_MAX}
            multiline
            rows={5}
            values={draft.answer}
            error={answerError}
            onChange={(locale, value) => {
              setDraft({ ...draft, answer: withLocale(draft.answer, locale, value) });
            }}
          />

          <PublishSwitch
            id="faq-published"
            label={t('common.visible')}
            checked={draft.published}
            onCheckedChange={(next) => {
              setDraft({ ...draft, published: next });
            }}
          />
        </EditorDrawer>
      )}
    </div>
  );
}
