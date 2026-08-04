'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/cn';
import { MONEY_FORMATS } from '@/lib/money';
import { locales, type Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
// From `@/lib/course-enums`, never from the service that owns the schemas:
// importing them from there pulled Prisma into this bundle and broke the build.
import { COURSE_LEVEL_VALUES, DELIVERY_MODE_VALUES } from '@/lib/course-enums';
import { updateCourseInfoAction } from '@/server/actions/admin-courses';

import {
  COURSE_LEVEL_LABEL_KEY,
  DELIVERY_MODE_LABEL_KEY,
  completenessPercent,
  type CourseEditorView,
  type TranslationDraft,
} from '../course-view';
import { useEditorFeedback } from './use-editor-feedback';

/**
 * « Infos » — who the course is, what it costs, and in how many languages it
 * exists.
 *
 * ## The completeness indicator is the point of the locale tabs
 * A course reaches its Arabic-reading audience only if somebody finished the
 * Arabic side, and « somebody will remember » is not a process. Each locale tab
 * carries the percentage of its three fields that are filled, so an unfinished
 * translation is visible without opening it — and the French one is what the
 * publication checklist gates on.
 *
 * ## Prices are typed in dirhams and stored in centimes
 * The field holds `1200`; the action converts once, at the boundary
 * (`parseDirhams`), and everything below it is an integer. A price that cannot
 * be parsed comes back as a field error rather than as a silent zero on a live
 * sales page.
 *
 * ## The slug is frozen once the course is public
 * `/formations/marketing-digital` is a URL students bookmark and search engines
 * index. While the course is a draft the field is editable; afterwards it is
 * disabled and says why, rather than accepting an edit the server would refuse.
 */

const DIRHAM_PATTERN = '[0-9]+([.,][0-9]{1,2})?';

export interface InfosTabProps {
  readonly course: CourseEditorView;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
}

interface Draft {
  readonly slug: string;
  readonly categoryId: string;
  readonly level: string;
  readonly deliveryMode: string;
  readonly contentLocale: Locale;
  readonly price: string;
  readonly comparePrice: string;
  readonly maxSeats: string;
  readonly coverKey: string;
  readonly translations: readonly TranslationDraft[];
}

/** The sentinel a `Select` uses for « no category », since `''` is not a valid item value. */
const NO_CATEGORY = 'aucune';

export function InfosTab({ course, categories }: InfosTabProps): React.JSX.Element {
  const t = useTranslations('admin.courses');
  const tCommon = useTranslations('common');
  const tLocale = useTranslations('locale');
  const tCourse = useTranslations('course');
  const tA11y = useTranslations('a11y');
  const { succeed, fail } = useEditorFeedback();

  const [draft, setDraft] = useState<Draft>(() => ({
    slug: course.slug,
    categoryId: course.categoryId ?? NO_CATEGORY,
    level: course.level,
    deliveryMode: course.deliveryMode,
    contentLocale: course.contentLocale,
    price: course.price,
    comparePrice: course.comparePrice,
    maxSeats: course.maxSeats === null ? '' : String(course.maxSeats),
    coverKey: course.coverKey,
    translations: course.translations,
  }));

  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [pending, startTransition] = useTransition();

  const currency = MONEY_FORMATS.fr.currency;

  const patch = (next: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...next }));
  };

  const patchTranslation = (locale: Locale, next: Partial<TranslationDraft>): void => {
    setDraft((current) => ({
      ...current,
      translations: current.translations.map((entry) =>
        entry.locale === locale ? { ...entry, ...next } : entry,
      ),
    }));
  };

  const submit = (): void => {
    setFieldErrors({});

    const seats = draft.maxSeats.trim();
    const parsedSeats = seats === '' ? null : Number.parseInt(seats, 10);
    if (parsedSeats !== null && (Number.isNaN(parsedSeats) || parsedSeats < 1)) {
      setFieldErrors({ maxSeats: t('pricing.maxSeatsHint') });
      return;
    }

    startTransition(async () => {
      const result = await updateCourseInfoAction({
        courseId: course.id,
        ...(course.slugEditable ? { slug: draft.slug.trim() } : {}),
        categoryId: draft.categoryId === NO_CATEGORY ? null : draft.categoryId,
        level: draft.level,
        deliveryMode: draft.deliveryMode,
        contentLocale: draft.contentLocale,
        price: draft.price,
        comparePrice: draft.comparePrice,
        maxSeats: parsedSeats,
        coverKey: draft.coverKey.trim() === '' ? null : draft.coverKey.trim(),
        translations: draft.translations.map((entry) => ({
          locale: entry.locale,
          title: entry.title,
          subtitle: entry.subtitle,
          description: entry.description,
        })),
      });

      if (!result.ok) {
        if (result.fieldErrors !== undefined) {
          // Zod paths carry i18n keys; the labels beside the fields already say
          // what each one is, so the generic « vérifiez ce champ » is enough.
          const mapped: Record<string, string> = {};
          for (const key of Object.keys(result.fieldErrors)) {
            mapped[key] = t('editor.saveError');
          }
          setFieldErrors(mapped);
        }
        fail(result.error);
        return;
      }

      succeed({ changed: result.data.changed });
    });
  };

  const localeSummaries = useMemo(
    () =>
      draft.translations.map((entry) => ({
        locale: entry.locale,
        percent: completenessPercent(entry),
      })),
    [draft.translations],
  );

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {/* ── Per-locale content ───────────────────────────────────────────── */}
      <section className="flex flex-col gap-4" aria-labelledby="infos-traductions">
        <h2 id="infos-traductions" className="text-lead text-ink">
          {t('editor.tabs.translations')}
        </h2>

        <Tabs defaultValue="fr" variant="pill">
          <TabsList>
            {localeSummaries.map((entry) => (
              <TabsTrigger key={entry.locale} value={entry.locale}>
                <span>{tLocale(entry.locale)}</span>
                <span
                  data-numeric
                  dir="ltr"
                  className={cn(
                    'force-ltr rounded-pill px-1.5 text-xs',
                    entry.percent === 100 ? 'text-success' : 'text-ink-muted',
                  )}
                >
                  {t('translations.completeness', { percent: entry.percent })}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {draft.translations.map((entry) => (
            <TabsContent key={entry.locale} value={entry.locale} className="flex flex-col gap-4">
              <FormField
                label={t('general.title')}
                required={entry.locale === 'fr'}
                requiredHint={entry.locale === 'fr' ? tCommon('required') : undefined}
                optionalHint={entry.locale === 'fr' ? undefined : tCommon('optional')}
              >
                {(field) => (
                  <Input
                    id={field.id}
                    value={entry.title}
                    dir={entry.locale === 'ar' ? 'rtl' : 'ltr'}
                    onChange={(event) =>
                      patchTranslation(entry.locale, { title: event.target.value })
                    }
                  />
                )}
              </FormField>

              <FormField label={t('general.subtitle')}>
                {(field) => (
                  <Input
                    id={field.id}
                    value={entry.subtitle}
                    dir={entry.locale === 'ar' ? 'rtl' : 'ltr'}
                    onChange={(event) =>
                      patchTranslation(entry.locale, { subtitle: event.target.value })
                    }
                  />
                )}
              </FormField>

              <FormField label={t('description.editorLabel')}>
                {(field) => (
                  <Textarea
                    id={field.id}
                    rows={8}
                    value={entry.description}
                    dir={entry.locale === 'ar' ? 'rtl' : 'ltr'}
                    onChange={(event) =>
                      patchTranslation(entry.locale, { description: event.target.value })
                    }
                  />
                )}
              </FormField>
            </TabsContent>
          ))}
        </Tabs>
      </section>

      {/* ── Classification ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4" aria-labelledby="infos-general">
        <h2 id="infos-general" className="text-lead text-ink">
          {t('editor.tabs.general')}
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label={t('general.slug')}
            description={course.slugEditable ? t('general.slugHint') : undefined}
            error={fieldErrors['slug']}
            className="sm:col-span-2"
          >
            {(field) => (
              <Input
                id={field.id}
                aria-describedby={field['aria-describedby']}
                aria-invalid={field['aria-invalid']}
                invalid={field['aria-invalid'] === true}
                value={draft.slug}
                dir="ltr"
                className="force-ltr font-mono"
                disabled={!course.slugEditable}
                readOnly={!course.slugEditable}
                onChange={(event) => patch({ slug: event.target.value })}
              />
            )}
          </FormField>

          <FormField label={t('general.category')}>
            {(field) => (
              <Select
                value={draft.categoryId}
                onValueChange={(value) => patch({ categoryId: value })}
              >
                <SelectTrigger id={field.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CATEGORY}>{tCommon('optional')}</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label={t('general.level')}>
            {(field) => (
              <Select value={draft.level} onValueChange={(value) => patch({ level: value })}>
                <SelectTrigger id={field.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COURSE_LEVEL_VALUES.map((level) => (
                    <SelectItem key={level} value={level}>
                      {tCourse(`level.${COURSE_LEVEL_LABEL_KEY[level]}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label={t('general.deliveryMode')}>
            {(field) => (
              <Select
                value={draft.deliveryMode}
                onValueChange={(value) => patch({ deliveryMode: value })}
              >
                <SelectTrigger id={field.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERY_MODE_VALUES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {tCourse(`delivery.${DELIVERY_MODE_LABEL_KEY[mode]}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label={t('general.contentLanguage')}>
            {(field) => (
              <Select
                value={draft.contentLocale}
                onValueChange={(value) => patch({ contentLocale: value as Locale })}
              >
                <SelectTrigger id={field.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {locales.map((locale) => (
                    <SelectItem key={locale} value={locale}>
                      {tLocale(locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField
            label={t('general.cover')}
            description={t('general.coverHint')}
            error={fieldErrors['coverKey']}
            className="sm:col-span-2"
          >
            {(field) => (
              <Input
                id={field.id}
                aria-describedby={field['aria-describedby']}
                value={draft.coverKey}
                dir="ltr"
                className="force-ltr font-mono"
                placeholder="seed/courses/…"
                onChange={(event) => patch({ coverKey: event.target.value })}
              />
            )}
          </FormField>

          {/* The saved key, resolved against the bucket. A link rather than an
              image: it proves the key points at something without asking the
              image pipeline to trust a host an administrator just typed. */}
          {course.coverUrl === null ? null : (
            <a
              href={course.coverUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm text-strait hover:underline sm:col-span-2"
            >
              <span>{t('rowActions.preview')}</span>
              <span className="sr-only">{tA11y('newWindow')}</span>
            </a>
          )}
        </div>
      </section>

      {/* ── Price and seats ──────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4" aria-labelledby="infos-tarification">
        <h2 id="infos-tarification" className="text-lead text-ink">
          {t('editor.tabs.pricing')}
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField
            label={t('pricing.price')}
            required
            requiredHint={tCommon('required')}
            error={fieldErrors['price']}
          >
            {(field) => (
              <Input
                id={field.id}
                aria-describedby={field['aria-describedby']}
                aria-invalid={field['aria-invalid']}
                invalid={field['aria-invalid'] === true}
                value={draft.price}
                inputMode="decimal"
                pattern={DIRHAM_PATTERN}
                dir="ltr"
                className="force-ltr"
                iconEnd={<span className="text-xs text-ink-muted">{currency}</span>}
                onChange={(event) => patch({ price: event.target.value })}
              />
            )}
          </FormField>

          <FormField
            label={t('pricing.compareAt')}
            description={t('pricing.compareAtHint')}
            error={fieldErrors['comparePrice'] ?? fieldErrors['comparePriceCentimes']}
          >
            {(field) => (
              <Input
                id={field.id}
                aria-describedby={field['aria-describedby']}
                aria-invalid={field['aria-invalid']}
                invalid={field['aria-invalid'] === true}
                value={draft.comparePrice}
                inputMode="decimal"
                pattern={DIRHAM_PATTERN}
                dir="ltr"
                className="force-ltr"
                iconEnd={<span className="text-xs text-ink-muted">{currency}</span>}
                onChange={(event) => patch({ comparePrice: event.target.value })}
              />
            )}
          </FormField>

          <FormField
            label={t('pricing.maxSeats')}
            description={t('pricing.maxSeatsHint')}
            error={fieldErrors['maxSeats']}
          >
            {(field) => (
              <Input
                id={field.id}
                aria-describedby={field['aria-describedby']}
                aria-invalid={field['aria-invalid']}
                invalid={field['aria-invalid'] === true}
                value={draft.maxSeats}
                inputMode="numeric"
                pattern="[0-9]*"
                dir="ltr"
                className="force-ltr"
                onChange={(event) => patch({ maxSeats: event.target.value })}
              />
            )}
          </FormField>
        </div>
      </section>

      <div className="flex items-center justify-end gap-3 border-t border-hairline pt-4">
        <Button type="submit" variant="primary" loading={pending}>
          {pending ? t('editor.saving') : tCommon('save')}
        </Button>
      </div>
    </form>
  );
}
