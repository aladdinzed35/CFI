'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff } from 'lucide-react';

import { slugify } from '@/lib/slug';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/use-toast';
import { Markdown } from '@/components/public/course/markdown';
import { useRouter } from '@/i18n/navigation';
import { deleteContentItemAction, saveBlogPostAction } from '@/server/actions/admin-content';

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
import { emptyLocalised, type BlogItem, type LocalisedDraft } from './content-view';

/**
 * « Blog » — the `BlogPost` table (§17.11).
 *
 * ## The address is locked once the post is published
 * A published article has a URL in the sitemap, in search results and quite
 * possibly in somebody's WhatsApp message. Renaming it turns all of those into
 * 404s with no redirect behind them. So the slug field is proposed from the
 * French title while the post is a draft, and frozen the moment it goes live —
 * the server applies the same rule, because a disabled input is a hint and not a
 * guarantee.
 *
 * ## Scheduling is a date, not a second state machine
 * `BlogPost.status` says whether the post is meant to be public and
 * `publishedAt` says from when. The public reader asks for both — `status =
 * PUBLISHED AND publishedAt <= now` — so a published post dated next Tuesday is
 * simply invisible until Tuesday, with no cron job and no third status column.
 * The list says « Programmé » for exactly that combination.
 *
 * ## Reading time is computed, never typed
 * `readMinutes` is recomputed from the French body on every save. An editor who
 * cuts a thousand words out of an article should not have to remember to change
 * a number that the card underneath it displays.
 */

/* -------------------------------------------------------------------------- */
/* Draft                                                                       */
/* -------------------------------------------------------------------------- */

interface BlogDraft {
  readonly id: string | null;
  readonly slug: string;
  /** `true` when the slug is frozen: the post was already public when opened. */
  readonly slugLocked: boolean;
  readonly title: LocalisedDraft;
  readonly excerpt: LocalisedDraft;
  readonly body: LocalisedDraft;
  readonly tags: string;
  readonly published: boolean;
  /** `YYYY-MM-DD`, or `''` for « publier maintenant ». */
  readonly publishedOn: string;
}

const SLUG_MAX = 80;
const TITLE_MAX = 200;
const EXCERPT_MAX = 600;
const BODY_MAX = 60_000;
const TAGS_MAX = 300;

function newDraft(): BlogDraft {
  return {
    id: null,
    slug: '',
    slugLocked: false,
    title: emptyLocalised(),
    excerpt: emptyLocalised(),
    body: emptyLocalised(),
    tags: '',
    published: false,
    publishedOn: '',
  };
}

function draftOf(item: BlogItem): BlogDraft {
  return {
    id: item.id,
    slug: item.slug,
    slugLocked: item.published,
    title: { ...item.title },
    excerpt: { ...item.excerpt },
    body: { ...item.body },
    tags: item.tags,
    published: item.published,
    publishedOn: item.publishedOn,
  };
}

/* -------------------------------------------------------------------------- */
/* Tab                                                                         */
/* -------------------------------------------------------------------------- */

export function BlogTab({ items }: { readonly items: readonly BlogItem[] }): React.JSX.Element {
  const t = useTranslations('admin.cms');
  const tCommon = useTranslations('common');
  const tCourses = useTranslations('admin.courses');

  const router = useRouter();
  const { pending, run } = useAction();

  const [draft, setDraft] = useState<BlogDraft | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  const statusLabel = useCallback(
    (status: BlogItem['status']): string => {
      if (status === 'PUBLISHED') return t('blog.statusPublished');
      if (status === 'SCHEDULED') return t('blog.statusScheduled');
      return t('blog.statusDraft');
    },
    [t],
  );

  const close = useCallback((): void => {
    setDraft(null);
    setSlugError(null);
    setTitleError(null);
    setBodyError(null);
    setPreview(false);
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (draft === null) return;

    const slug = draft.slug.trim();
    const missingSlug = slug === '';
    const missingTitle = !hasFrench(draft.title);
    const missingBody = !hasFrench(draft.body);
    setSlugError(missingSlug ? tCommon('required') : null);
    setTitleError(missingTitle ? tCommon('required') : null);
    setBodyError(missingBody ? tCommon('required') : null);
    if (missingSlug || missingTitle || missingBody) return;

    const data = await run(() =>
      saveBlogPostAction({
        id: draft.id,
        slug,
        title: draft.title,
        excerpt: draft.excerpt,
        body: draft.body,
        tags: draft.tags,
        published: draft.published,
        publishedOn: draft.publishedOn === '' ? null : draft.publishedOn,
      }),
    );
    if (data === null) return;

    toast.success({
      title: t('blog.saved'),
      description: draft.published ? t('common.visible') : t('common.hidden'),
      dismissLabel: tCommon('close'),
    });
    close();
    router.refresh();
  }, [close, draft, router, run, t, tCommon]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      const data = await run(() => deleteContentItemAction({ kind: 'blog', id }));
      if (data === null) return;

      toast.success({ title: t('common.deleted'), dismissLabel: tCommon('close') });
      close();
      router.refresh();
    },
    [close, router, run, t, tCommon],
  );

  /** Propose an address from the French title, while the post is still a draft. */
  const onTitleChange = useCallback(
    (current: BlogDraft, locale: Parameters<typeof withLocale>[1], value: string): BlogDraft => {
      const title = withLocale(current.title, locale, value);
      if (locale !== 'fr' || current.slugLocked) return { ...current, title };

      const previous = slugify(current.title.fr);
      // Only follow the title while the editor has not typed an address of
      // their own — an edited slug is a decision, not a leftover.
      const following = current.slug === '' || current.slug === previous;
      return { ...current, title, slug: following ? slugify(value) : current.slug };
    },
    [],
  );

  return (
    <div>
      <TabHeader
        createLabel={t('blog.newPost')}
        onCreate={() => {
          setDraft(newDraft());
        }}
      />

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <ListRow
            key={item.id}
            title={<span className="font-display text-lead text-ink">{item.title.fr}</span>}
            meta={
              <>
                <code className="force-ltr rounded-sm bg-raised px-1.5 py-0.5 font-mono text-xs">
                  /blog/{item.slug}
                </code>
                {item.publishedAtLabel === '' ? null : <span>{item.publishedAtLabel}</span>}
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
                  status={item.status}
                  label={statusLabel(item.status)}
                />
                {item.tags === '' ? null : <Badge tone="neutral">{item.tags}</Badge>}
                <TranslationMeter fields={[item.title, item.body]} />
              </>
            }
            actions={
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
          title={draft.id === null ? t('blog.newPost') : tCourses('rowActions.edit')}
          description={t('pages.perLocale')}
          saving={pending}
          onSave={() => {
            void save();
          }}
          danger={
            draft.id === null ? undefined : (
              <DangerZone
                title={t('blog.deleteConfirm')}
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
          <LocalisedField
            legend={t('blog.postTitle')}
            idPrefix="post-title"
            maxLength={TITLE_MAX}
            values={draft.title}
            error={titleError}
            onChange={(locale, value) => {
              setDraft(onTitleChange(draft, locale, value));
            }}
          />

          <FormField
            id="post-slug"
            label={t('pages.columns.slug')}
            required
            requiredHint={tCommon('required')}
            {...(draft.slugLocked ? {} : { description: tCourses('general.slugHint') })}
            {...(slugError === null ? {} : { error: slugError })}
          >
            {(field) => (
              <Input
                {...field}
                className="force-ltr"
                dir="ltr"
                maxLength={SLUG_MAX}
                disabled={draft.slugLocked}
                value={draft.slug}
                invalid={slugError !== null}
                onChange={(event) => {
                  setDraft({ ...draft, slug: event.target.value });
                }}
              />
            )}
          </FormField>

          <LocalisedField
            legend={t('blog.excerpt')}
            idPrefix="post-excerpt"
            maxLength={EXCERPT_MAX}
            multiline
            rows={3}
            frenchOptional
            values={draft.excerpt}
            onChange={(locale, value) => {
              setDraft({ ...draft, excerpt: withLocale(draft.excerpt, locale, value) });
            }}
          />

          <div>
            <div className="flex flex-wrap items-center justify-end pb-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={preview}
                iconStart={preview ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                onClick={() => {
                  setPreview(!preview);
                }}
              >
                {tCourses('description.livePreview')}
              </Button>
            </div>

            <LocalisedField
              legend={t('blog.body')}
              idPrefix="post-body"
              maxLength={BODY_MAX}
              multiline
              rows={10}
              values={draft.body}
              error={bodyError}
              onChange={(locale, value) => {
                setDraft({ ...draft, body: withLocale(draft.body, locale, value) });
              }}
            />

            {preview ? (
              <div className="mt-4 rounded-md border border-hairline bg-raised px-4 py-4">
                <Markdown source={draft.body.fr} headingLevel="h4" />
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="post-tags" label={t('blog.tags')} optionalHint={tCommon('optional')}>
              {(field) => (
                <Input
                  {...field}
                  maxLength={TAGS_MAX}
                  value={draft.tags}
                  onChange={(event) => {
                    setDraft({ ...draft, tags: event.target.value });
                  }}
                />
              )}
            </FormField>

            <FormField
              id="post-published-on"
              label={t('blog.publishAt')}
              optionalHint={tCommon('optional')}
            >
              {(field) => (
                <Input
                  {...field}
                  type="date"
                  className="force-ltr"
                  value={draft.publishedOn}
                  onChange={(event) => {
                    setDraft({ ...draft, publishedOn: event.target.value });
                  }}
                />
              )}
            </FormField>
          </div>

          <PublishSwitch
            id="post-published"
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
