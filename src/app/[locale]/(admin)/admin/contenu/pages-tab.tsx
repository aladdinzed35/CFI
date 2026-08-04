'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/use-toast';
import { Markdown } from '@/components/public/course/markdown';
import { useRouter } from '@/i18n/navigation';
import { deleteContentItemAction, savePageAction } from '@/server/actions/admin-content';

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
import { emptyLocalised, type LocalisedDraft, type PageItem } from './content-view';

/**
 * « Pages légales » — the `Page` table (§17.11).
 *
 * These are the documents the footer links to and `[...legal]` serves: the terms,
 * the privacy notice, the legal mentions and the cookie policy. Four of them are
 * **locked**: their address is printed on invoices and named in the route, so it
 * can be edited in every language but never renamed and never deleted.
 *
 * ## Unpublishing is a compliance decision, not a toggle
 * Law 09-08 requires the privacy notice to be *available*. Turning a locked
 * document off replaces it, for every visitor in every language, with the
 * « pas encore publié » panel — so the switch shows that panel's own wording
 * before the save, rather than a generic « êtes-vous sûr ». The administrator
 * sees exactly what the public will see.
 *
 * ## The body is Markdown, and it is never markup
 * The preview goes through the same `Markdown` renderer the public page uses,
 * which builds React elements rather than HTML. What the editor sees here is
 * what a visitor gets, including the fact that a pasted `<script>` renders as
 * literal text (§20).
 */

/* -------------------------------------------------------------------------- */
/* Draft                                                                       */
/* -------------------------------------------------------------------------- */

interface PageDraft {
  readonly id: string | null;
  readonly slug: string;
  readonly title: LocalisedDraft;
  readonly body: LocalisedDraft;
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly published: boolean;
  readonly locked: boolean;
  /** The status the row had when the drawer opened — the unpublish warning needs it. */
  readonly wasPublished: boolean;
}

function newDraft(): PageDraft {
  return {
    id: null,
    slug: '',
    title: emptyLocalised(),
    body: emptyLocalised(),
    seoTitle: '',
    seoDescription: '',
    published: false,
    locked: false,
    wasPublished: false,
  };
}

function draftOf(item: PageItem): PageDraft {
  return {
    id: item.id,
    slug: item.slug,
    title: { ...item.title },
    body: { ...item.body },
    seoTitle: item.seoTitle,
    seoDescription: item.seoDescription,
    published: item.published,
    locked: item.locked,
    wasPublished: item.published,
  };
}

const SLUG_MAX = 80;
const TITLE_MAX = 200;
const SEO_DESCRIPTION_MAX = 600;
const BODY_MAX = 60_000;

/* -------------------------------------------------------------------------- */
/* Tab                                                                         */
/* -------------------------------------------------------------------------- */

export function PagesTab({ items }: { readonly items: readonly PageItem[] }): React.JSX.Element {
  const t = useTranslations('admin.cms');
  const tCommon = useTranslations('common');
  const tCourses = useTranslations('admin.courses');
  const tLegal = useTranslations('legal');

  const router = useRouter();
  const { pending, run } = useAction();

  const [draft, setDraft] = useState<PageDraft | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

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
      savePageAction({
        id: draft.id,
        slug,
        title: draft.title,
        body: draft.body,
        seoTitle: draft.seoTitle,
        seoDescription: draft.seoDescription,
        published: draft.published,
      }),
    );
    if (data === null) return;

    toast.success({
      title: t('pages.saved'),
      description: draft.published ? t('common.visible') : t('common.hidden'),
      dismissLabel: tCommon('close'),
    });
    close();
    router.refresh();
  }, [close, draft, router, run, t, tCommon]);

  const remove = useCallback(async (id: string): Promise<void> => {
    const data = await run(() => deleteContentItemAction({ kind: 'page', id }));
    if (data === null) return;

    toast.success({ title: t('common.deleted'), dismissLabel: tCommon('close') });
    close();
    router.refresh();
  }, [close, router, run, t, tCommon]);

  const unpublishingLegal = draft !== null && draft.locked && draft.wasPublished && !draft.published;

  return (
    <div>
      <TabHeader
        createLabel={t('pages.newPage')}
        onCreate={() => {
          setDraft(newDraft());
        }}
      />

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <ListRow
            key={item.id}
            title={
              <>
                <span className="font-display text-lead text-ink">{item.title.fr}</span>
                {item.locked ? <Badge tone="strait">{tLegal('sectionLabel')}</Badge> : null}
              </>
            }
            meta={
              <>
                <code className="force-ltr rounded-sm bg-raised px-1.5 py-0.5 font-mono text-xs">
                  /legal/{item.slug}
                </code>
                <span>
                  {t('pages.columns.updatedAt')} <time dateTime={item.updatedAtIso}>{item.updatedAtLabel}</time>
                </span>
              </>
            }
            badges={
              <>
                <StatusPill
                  domain="course"
                  status={item.published ? 'PUBLISHED' : 'DRAFT'}
                  label={item.published ? tCourses('status.published') : tCourses('status.draft')}
                />
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
                {t('pages.edit')}
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
          title={draft.id === null ? t('pages.newPage') : t('pages.edit')}
          description={t('pages.perLocale')}
          saving={pending}
          onSave={() => {
            void save();
          }}
          danger={
            draft.id === null || draft.locked ? undefined : (
              <DangerZone
                title={tCommon('delete')}
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
          <FormField
            id="page-slug"
            label={t('pages.columns.slug')}
            required
            requiredHint={tCommon('required')}
            {...(slugError === null ? {} : { error: slugError })}
          >
            {(field) => (
              <Input
                {...field}
                className="force-ltr"
                dir="ltr"
                maxLength={SLUG_MAX}
                disabled={draft.locked}
                value={draft.slug}
                invalid={slugError !== null}
                onChange={(event) => {
                  setDraft({ ...draft, slug: event.target.value });
                }}
              />
            )}
          </FormField>

          <LocalisedField
            legend={t('pages.columns.title')}
            idPrefix="page-title"
            maxLength={TITLE_MAX}
            values={draft.title}
            error={titleError}
            onChange={(locale, value) => {
              setDraft({ ...draft, title: withLocale(draft.title, locale, value) });
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
              legend={t('pages.contentLabel')}
              idPrefix="page-body"
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
            <FormField id="page-seo-title" label={tCourses('seo.title')} optionalHint={tCommon('optional')}>
              {(field) => (
                <Input
                  {...field}
                  maxLength={TITLE_MAX}
                  value={draft.seoTitle}
                  onChange={(event) => {
                    setDraft({ ...draft, seoTitle: event.target.value });
                  }}
                />
              )}
            </FormField>
            <FormField
              id="page-seo-description"
              label={tCourses('seo.description')}
              optionalHint={tCommon('optional')}
            >
              {(field) => (
                <Input
                  {...field}
                  maxLength={SEO_DESCRIPTION_MAX}
                  value={draft.seoDescription}
                  onChange={(event) => {
                    setDraft({ ...draft, seoDescription: event.target.value });
                  }}
                />
              )}
            </FormField>
          </div>

          <PublishSwitch
            id="page-published"
            label={t('common.visible')}
            checked={draft.published}
            onCheckedChange={(next) => {
              setDraft({ ...draft, published: next });
            }}
          />

          {unpublishingLegal ? (
            <Callout variant="warning" title={tLegal('notFound.title')}>
              {tLegal('notFound.body')}
            </Callout>
          ) : null}
        </EditorDrawer>
      )}
    </div>
  );
}
