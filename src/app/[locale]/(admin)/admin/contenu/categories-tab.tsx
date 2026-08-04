'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { cn } from '@/lib/cn';
import { slugify } from '@/lib/slug';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/use-toast';
import { useRouter } from '@/i18n/navigation';
import {
  deleteContentItemAction,
  moveContentItemAction,
  saveCategoryAction,
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
  CATEGORY_COLORS,
  emptyLocalised,
  isCategoryColor,
  type CategoryColor,
  type CategoryItem,
  type LocalisedDraft,
} from './content-view';

/**
 * « Catégories » — the `Category` table and its `CategoryTranslation` rows
 * (§17.11).
 *
 * ## The one tab whose translations are rows, not columns
 * Every other CMS table stores `titleFr`, `titleAr`… as columns. A category
 * stores one `CategoryTranslation` per locale, so emptying the Arabic name here
 * deletes a row rather than nulling a column. The editor cannot tell the
 * difference, which is the point; the service absorbs it.
 *
 * ## A category with courses cannot be deleted
 * `Course.categoryId` is `onDelete: SetNull`, so the database would happily let
 * the category go and leave every one of its courses unfiled — invisible in the
 * catalogue filter, and impossible to find again without a query. The delete
 * panel says how many courses are in the way instead, and the server refuses the
 * same case.
 *
 * ## The colour is a token, never a hex
 * §3: the palette is closed. The picker offers the six semantic tokens and shows
 * each one's swatch next to its name, so what an administrator chooses is the
 * same word the stylesheet uses.
 */

/* -------------------------------------------------------------------------- */
/* Colour swatches                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Static class per token — Tailwind never sees a class it can generate at
 * runtime, so `bg-${token}` would produce nothing at all.
 */
const SWATCH: Record<CategoryColor, string> = {
  strait: 'bg-strait',
  brass: 'bg-brass',
  success: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger',
  ink: 'bg-ink',
};

/* -------------------------------------------------------------------------- */
/* Draft                                                                       */
/* -------------------------------------------------------------------------- */

interface CategoryDraft {
  readonly id: string | null;
  readonly slug: string;
  readonly icon: string;
  readonly color: CategoryColor | null;
  readonly isActive: boolean;
  readonly name: LocalisedDraft;
  readonly description: LocalisedDraft;
  readonly courseCount: number;
}

const SLUG_MAX = 80;
const ICON_MAX = 40;
const NAME_MAX = 200;
const DESCRIPTION_MAX = 600;

function newDraft(): CategoryDraft {
  return {
    id: null,
    slug: '',
    icon: '',
    color: null,
    isActive: true,
    name: emptyLocalised(),
    description: emptyLocalised(),
    courseCount: 0,
  };
}

function draftOf(item: CategoryItem): CategoryDraft {
  return {
    id: item.id,
    slug: item.slug,
    icon: item.icon,
    color: isCategoryColor(item.color) ? item.color : null,
    isActive: item.isActive,
    name: { ...item.name },
    description: { ...item.description },
    courseCount: item.courseCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Tab                                                                         */
/* -------------------------------------------------------------------------- */

export function CategoriesTab({
  items,
}: {
  readonly items: readonly CategoryItem[];
}): React.JSX.Element {
  const t = useTranslations('admin.cms');
  const tCommon = useTranslations('common');
  const tCourses = useTranslations('admin.courses');

  const router = useRouter();
  const { pending, run } = useAction();

  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const close = useCallback((): void => {
    setDraft(null);
    setSlugError(null);
    setNameError(null);
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (draft === null) return;

    const slug = draft.slug.trim();
    const missingSlug = slug === '';
    const missingName = !hasFrench(draft.name);
    setSlugError(missingSlug ? tCommon('required') : null);
    setNameError(missingName ? tCommon('required') : null);
    if (missingSlug || missingName) return;

    const data = await run(() =>
      saveCategoryAction({
        id: draft.id,
        slug,
        icon: draft.icon,
        color: draft.color,
        isActive: draft.isActive,
        name: draft.name,
        description: draft.description,
      }),
    );
    if (data === null) return;

    toast.success({
      title: t('categories.saved'),
      description: draft.isActive ? t('common.visible') : t('common.hidden'),
      dismissLabel: tCommon('close'),
    });
    close();
    router.refresh();
  }, [close, draft, router, run, t, tCommon]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      const data = await run(() => deleteContentItemAction({ kind: 'category', id }));
      if (data === null) return;

      toast.success({ title: t('common.deleted'), dismissLabel: tCommon('close') });
      close();
      router.refresh();
    },
    [close, router, run, t, tCommon],
  );

  const move = useCallback(
    async (id: string, direction: 'up' | 'down'): Promise<void> => {
      const data = await run(() => moveContentItemAction({ kind: 'category', id, direction }));
      if (data === null || !data.moved) return;
      router.refresh();
    },
    [router, run],
  );

  return (
    <div>
      <TabHeader
        createLabel={t('categories.new')}
        onCreate={() => {
          setDraft(newDraft());
        }}
      />

      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <ListRow
            key={item.id}
            title={
              <>
                {isCategoryColor(item.color) ? (
                  <span
                    aria-hidden="true"
                    className={cn('size-3 shrink-0 rounded-pill', SWATCH[item.color])}
                  />
                ) : null}
                <span className="font-display text-lead text-ink">{item.name.fr}</span>
              </>
            }
            meta={
              <>
                <code className="force-ltr rounded-sm bg-raised px-1.5 py-0.5 font-mono text-xs">
                  {item.slug}
                </code>
                <span>
                  {t('pages.columns.updatedAt')}{' '}
                  <time dateTime={item.updatedAtIso}>{item.updatedAtLabel}</time>
                </span>
              </>
            }
            badges={
              <>
                <StatusPill
                  domain="course"
                  status={item.isActive ? 'PUBLISHED' : 'DRAFT'}
                  label={item.isActive ? tCourses('status.published') : tCourses('status.draft')}
                />
                <Badge tone="neutral">
                  {tCourses('resultCount', { count: item.courseCount })}
                </Badge>
                <TranslationMeter fields={[item.name]} />
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
        ))}
      </ul>

      {draft === null ? null : (
        <EditorDrawer
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
          title={draft.id === null ? t('categories.new') : tCourses('rowActions.edit')}
          description={t('pages.perLocale')}
          saving={pending}
          onSave={() => {
            void save();
          }}
          danger={
            draft.id === null ? undefined : (
              <DangerZone
                title={tCommon('delete')}
                blocked={draft.courseCount > 0 ? t('categories.deleteBlocked') : null}
                deleting={pending}
                onDelete={() => {
                  const id = draft.id;
                  if (id !== null) void remove(id);
                }}
              />
            )
          }
        >
          <LocalisedField
            legend={t('categories.name')}
            idPrefix="category-name"
            maxLength={NAME_MAX}
            values={draft.name}
            error={nameError}
            onChange={(locale, value) => {
              const name = withLocale(draft.name, locale, value);
              const follows =
                locale === 'fr' && (draft.slug === '' || draft.slug === slugify(draft.name.fr));
              setDraft({ ...draft, name, slug: follows ? slugify(value) : draft.slug });
            }}
          />

          <FormField
            id="category-slug"
            label={t('pages.columns.slug')}
            required
            requiredHint={tCommon('required')}
            description={tCourses('general.slugHint')}
            {...(slugError === null ? {} : { error: slugError })}
          >
            {(field) => (
              <Input
                {...field}
                className="force-ltr"
                dir="ltr"
                maxLength={SLUG_MAX}
                value={draft.slug}
                invalid={slugError !== null}
                onChange={(event) => {
                  setDraft({ ...draft, slug: event.target.value });
                }}
              />
            )}
          </FormField>

          <LocalisedField
            legend={tCourses('description.editorLabel')}
            idPrefix="category-description"
            maxLength={DESCRIPTION_MAX}
            multiline
            rows={3}
            frenchOptional
            values={draft.description}
            onChange={(locale, value) => {
              setDraft({ ...draft, description: withLocale(draft.description, locale, value) });
            }}
          />

          <FormField
            id="category-icon"
            label={t('categories.icon')}
            optionalHint={tCommon('optional')}
          >
            {(field) => (
              <Input
                {...field}
                className="force-ltr"
                dir="ltr"
                maxLength={ICON_MAX}
                value={draft.icon}
                onChange={(event) => {
                  setDraft({ ...draft, icon: event.target.value });
                }}
              />
            )}
          </FormField>

          <fieldset>
            <legend className="flex w-full items-center justify-between gap-4 pb-2">
              <span className="text-body font-medium text-ink">{t('categories.color')}</span>
              <span className="text-sm text-ink-muted">{tCommon('optional')}</span>
            </legend>

            <div className="flex flex-wrap items-center gap-2">
              {CATEGORY_COLORS.map((token) => {
                const selected = draft.color === token;
                return (
                  <button
                    key={token}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setDraft({ ...draft, color: token });
                    }}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-pill border px-3 py-2 text-sm',
                      'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                      selected
                        ? 'border-strait bg-strait-wash text-ink'
                        : 'border-hairline bg-raised text-ink-muted hover:text-ink',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn('size-3 shrink-0 rounded-pill', SWATCH[token])}
                    />
                    <code className="force-ltr font-mono">{token}</code>
                  </button>
                );
              })}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={draft.color === null}
                onClick={() => {
                  setDraft({ ...draft, color: null });
                }}
              >
                {tCommon('reset')}
              </Button>
            </div>
          </fieldset>

          <PublishSwitch
            id="category-active"
            label={t('categories.active')}
            checked={draft.isActive}
            onCheckedChange={(next) => {
              setDraft({ ...draft, isActive: next });
            }}
          />
        </EditorDrawer>
      )}
    </div>
  );
}
