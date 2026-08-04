'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Star } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Rating } from '@/components/ui/rating';
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
  saveTestimonialAction,
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
  emptyLocalised,
  type CourseOption,
  type LocalisedDraft,
  type TestimonialItem,
} from './content-view';

/**
 * « Témoignages » — the `Testimonial` table (§17.11).
 *
 * ## `isPublished` is an approval flag, not a draft flag
 * The public site — the home page carousel and nothing else, today — reads
 * `isPublished: true` only. A testimonial arrives from a student by e-mail or in
 * person; somebody types it in, and somebody decides it may be quoted. The
 * switch is that decision, which is why a new testimonial starts **off** rather
 * than on: an unapproved quote must never appear because a form defaulted to
 * visible.
 *
 * ## The rating is the student's, not a score we compute
 * `Testimonial.rating` is the number of stars shown beside the quote. It is not
 * the course rating (`Course.ratingAvg`, derived from `Review` rows) and editing
 * it here changes nothing in the catalogue — two different things that happen to
 * be drawn with the same stars.
 *
 * ## The course link is optional and one-way
 * A testimonial may name the formation it is about, which lets the home page put
 * the quote next to the right card. Nothing points back: deleting a testimonial
 * never touches a course, and a course keeps its testimonials when its title
 * changes.
 */

/* -------------------------------------------------------------------------- */
/* Draft                                                                       */
/* -------------------------------------------------------------------------- */

interface TestimonialDraft {
  readonly id: string | null;
  readonly authorName: string;
  readonly authorRole: string;
  readonly rating: number;
  readonly quote: LocalisedDraft;
  readonly courseId: string | null;
  readonly featured: boolean;
  readonly published: boolean;
}

const NAME_MAX = 120;
const QUOTE_MAX = 2_000;
const DEFAULT_RATING = 5;

function draftOf(item: TestimonialItem): TestimonialDraft {
  return {
    id: item.id,
    authorName: item.authorName,
    authorRole: item.authorRole,
    rating: item.rating,
    quote: { ...item.quote },
    courseId: item.courseId,
    featured: item.featured,
    published: item.published,
  };
}

/* -------------------------------------------------------------------------- */
/* Tab                                                                         */
/* -------------------------------------------------------------------------- */

export interface TestimonialsTabProps {
  readonly items: readonly TestimonialItem[];
  readonly courses: readonly CourseOption[];
}

export function TestimonialsTab({ items, courses }: TestimonialsTabProps): React.JSX.Element {
  const t = useTranslations('admin.cms');
  const tCommon = useTranslations('common');
  const tCourses = useTranslations('admin.courses');
  const tPayments = useTranslations('admin.payments');

  const router = useRouter();
  const { pending, run } = useAction();

  const [draft, setDraft] = useState<TestimonialDraft | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const close = useCallback((): void => {
    setDraft(null);
    setNameError(null);
    setQuoteError(null);
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (draft === null) return;

    const name = draft.authorName.trim();
    const missingName = name.length < 2;
    const missingQuote = !hasFrench(draft.quote);
    setNameError(missingName ? tCommon('required') : null);
    setQuoteError(missingQuote ? tCommon('required') : null);
    if (missingName || missingQuote) return;

    const data = await run(() =>
      saveTestimonialAction({
        id: draft.id,
        authorName: name,
        authorRole: draft.authorRole,
        rating: draft.rating,
        quote: draft.quote,
        courseId: draft.courseId,
        featured: draft.featured,
        published: draft.published,
      }),
    );
    if (data === null) return;

    toast.success({
      title: t('testimonials.saved'),
      description: draft.published ? t('common.visible') : t('common.hidden'),
      dismissLabel: tCommon('close'),
    });
    close();
    router.refresh();
  }, [close, draft, router, run, t, tCommon]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      const data = await run(() => deleteContentItemAction({ kind: 'testimonial', id }));
      if (data === null) return;

      toast.success({ title: t('common.deleted'), dismissLabel: tCommon('close') });
      close();
      router.refresh();
    },
    [close, router, run, t, tCommon],
  );

  const move = useCallback(
    async (id: string, direction: 'up' | 'down'): Promise<void> => {
      const data = await run(() => moveContentItemAction({ kind: 'testimonial', id, direction }));
      if (data === null || !data.moved) return;
      router.refresh();
    },
    [router, run],
  );

  const courseTitle = useCallback(
    (courseId: string | null): string | null =>
      courseId === null ? null : (courses.find((course) => course.id === courseId)?.title ?? null),
    [courses],
  );

  return (
    <div>
      <TabHeader
        createLabel={t('testimonials.new')}
        onCreate={() => {
          setDraft({
            id: null,
            authorName: '',
            authorRole: '',
            rating: DEFAULT_RATING,
            quote: emptyLocalised(),
            courseId: null,
            featured: false,
            // A quote nobody has approved yet must not reach the home page.
            published: false,
          });
        }}
      />

      <ul className="flex flex-col gap-2">
        {items.map((item, index) => {
          const linked = courseTitle(item.courseId);

          return (
            <ListRow
              key={item.id}
              title={
                <>
                  <span className="text-body font-medium text-ink">{item.authorName}</span>
                  {item.authorRole === '' ? null : (
                    <span className="text-sm text-ink-muted">{item.authorRole}</span>
                  )}
                </>
              }
              meta={
                <>
                  <Rating
                    value={item.rating}
                    size="sm"
                    label={tCourses('columns.rating')}
                    valueText={`${item.rating}/5`}
                  />
                  {linked === null ? null : <span>{linked}</span>}
                </>
              }
              badges={
                <>
                  <StatusPill
                    domain="course"
                    status={item.published ? 'PUBLISHED' : 'DRAFT'}
                    label={item.published ? tCourses('status.published') : tCourses('status.draft')}
                  />
                  {item.featured ? (
                    <Badge tone="brass" icon={<Star aria-hidden="true" className="size-3" />}>
                      {t('testimonials.featured')}
                    </Badge>
                  ) : null}
                  <TranslationMeter fields={[item.quote]} />
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
                    disabled={index === items.length - 1 || pending}
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
          );
        })}
      </ul>

      {draft === null ? null : (
        <EditorDrawer
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
          title={draft.id === null ? t('testimonials.new') : tCourses('rowActions.edit')}
          description={t('pages.perLocale')}
          saving={pending}
          onSave={() => {
            void save();
          }}
          danger={
            draft.id === null ? undefined : (
              <DangerZone
                title={t('testimonials.deleteConfirm')}
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
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              id="testimonial-author"
              label={t('testimonials.author')}
              required
              requiredHint={tCommon('required')}
              {...(nameError === null ? {} : { error: nameError })}
            >
              {(field) => (
                <Input
                  {...field}
                  maxLength={NAME_MAX}
                  value={draft.authorName}
                  invalid={nameError !== null}
                  onChange={(event) => {
                    setDraft({ ...draft, authorName: event.target.value });
                  }}
                />
              )}
            </FormField>

            <FormField
              id="testimonial-role"
              label={t('testimonials.role')}
              optionalHint={tCommon('optional')}
            >
              {(field) => (
                <Input
                  {...field}
                  maxLength={NAME_MAX}
                  value={draft.authorRole}
                  onChange={(event) => {
                    setDraft({ ...draft, authorRole: event.target.value });
                  }}
                />
              )}
            </FormField>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-body font-medium text-ink">{tCourses('columns.rating')}</span>
            <Rating
              value={draft.rating}
              label={tCourses('columns.rating')}
              valueText={`${draft.rating}/5`}
              step={1}
              onValueChange={(next) => {
                setDraft({ ...draft, rating: next });
              }}
            />
          </div>

          <LocalisedField
            legend={t('testimonials.quote')}
            idPrefix="testimonial-quote"
            maxLength={QUOTE_MAX}
            multiline
            rows={4}
            values={draft.quote}
            error={quoteError}
            onChange={(locale, value) => {
              setDraft({ ...draft, quote: withLocale(draft.quote, locale, value) });
            }}
          />

          <FormField
            id="testimonial-course"
            label={tPayments('columns.course')}
            optionalHint={tCommon('optional')}
          >
            {(field) => (
              <div className="flex items-center gap-2">
                <Select
                  value={draft.courseId ?? ''}
                  onValueChange={(next) => {
                    setDraft({ ...draft, courseId: next });
                  }}
                >
                  <SelectTrigger
                    id={field.id}
                    className="flex-1"
                    aria-describedby={field['aria-describedby']}
                  >
                    <SelectValue placeholder={tCommon('optional')} />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((course) => (
                      <SelectItem key={course.id} value={course.id}>
                        {course.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={draft.courseId === null}
                  onClick={() => {
                    setDraft({ ...draft, courseId: null });
                  }}
                >
                  {tCommon('reset')}
                </Button>
              </div>
            )}
          </FormField>

          <PublishSwitch
            id="testimonial-featured"
            label={t('testimonials.featured')}
            checked={draft.featured}
            onCheckedChange={(next) => {
              setDraft({ ...draft, featured: next });
            }}
          />

          <PublishSwitch
            id="testimonial-published"
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
