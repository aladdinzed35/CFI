'use server';

/**
 * Server actions for the §17.11 CMS.
 *
 * Every export goes through {@link withAction}: Origin check → Zod `.strict()`
 * → session → the §8 capability `cms.edit` (row 11, « Edit homepage / CMS /
 * settings ») → handler. Nothing above that line touches the database, and
 * nothing below it re-implements a write: the transaction, the audit row and the
 * ordering rules all live in `content-admin.ts`.
 *
 * ## Why the schemas are imported rather than declared here
 * A `'use server'` module may only export async functions, so a `const schema =
 * …` next to the action would be a compile error the day it is exported. The
 * schemas live in the service, which is also where the length limits belong —
 * they describe the columns, not the transport.
 *
 * ## What a save invalidates
 * The public site reads these tables through statically rendered routes and,
 * for the home page, through a 60-second in-process memo. Both are cleared here:
 * `invalidateHomeData()` drops the memo in this process, and one
 * `revalidatePath('/[locale]', 'layout')` re-renders every localised route
 * underneath — the legal documents, the FAQ, the blog index and article pages,
 * the catalogue and the admin screens. On a multi-instance deployment the other
 * instances still serve their own memo for up to a minute, which is why the
 * interface says « visible sur le site public d'ici une minute » rather than
 * claiming the change is already live.
 */

import { revalidatePath } from 'next/cache';

import { withAction } from '@/server/auth/guards';
import { invalidateHomeData } from '@/server/services/home';
import {
  deleteContentItem,
  deleteContentSchema,
  moveContentItem,
  moveContentSchema,
  saveBlogPost,
  saveBlogPostSchema,
  saveCategory,
  saveCategorySchema,
  saveFaqItem,
  saveFaqSchema,
  savePage,
  savePageSchema,
  saveTestimonial,
  saveTestimonialSchema,
  type ContentActor,
  type ContentDeleteResult,
  type ContentSaveResult,
} from '@/server/services/content-admin';

/* -------------------------------------------------------------------------- */
/* Shared plumbing                                                             */
/* -------------------------------------------------------------------------- */

/** Drop the home-page memo, then re-render every localised route. */
function revalidateContent(): void {
  invalidateHomeData();
  revalidatePath('/[locale]', 'layout');
}

function actorFrom(ctx: {
  readonly user: { readonly id: string };
  readonly ip: string | null;
  readonly userAgent: string | null;
}): ContentActor {
  return { id: ctx.user.id, ip: ctx.ip, userAgent: ctx.userAgent };
}

/* -------------------------------------------------------------------------- */
/* Pages légales                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Create or update an editorial `Page`.
 *
 * Unpublishing one of the four §12.5 documents is allowed — an editor sometimes
 * has to pull a notice while a lawyer rewrites it — but the interface asks for a
 * second confirmation first, and the audit row records the status change so the
 * gap is explainable later.
 */
export const savePageAction = withAction(
  savePageSchema,
  async (input, ctx): Promise<ContentSaveResult> => {
    const result = await savePage(input, actorFrom(ctx));
    revalidateContent();
    return result;
  },
  { auth: 'active', can: 'cms.edit' },
);

/* -------------------------------------------------------------------------- */
/* FAQ                                                                         */
/* -------------------------------------------------------------------------- */

export const saveFaqItemAction = withAction(
  saveFaqSchema,
  async (input, ctx): Promise<ContentSaveResult> => {
    const result = await saveFaqItem(input, actorFrom(ctx));
    revalidateContent();
    return result;
  },
  { auth: 'active', can: 'cms.edit' },
);

/* -------------------------------------------------------------------------- */
/* Témoignages                                                                 */
/* -------------------------------------------------------------------------- */

export const saveTestimonialAction = withAction(
  saveTestimonialSchema,
  async (input, ctx): Promise<ContentSaveResult> => {
    const result = await saveTestimonial(input, actorFrom(ctx));
    revalidateContent();
    return result;
  },
  { auth: 'active', can: 'cms.edit' },
);

/* -------------------------------------------------------------------------- */
/* Blog                                                                        */
/* -------------------------------------------------------------------------- */

export const saveBlogPostAction = withAction(
  saveBlogPostSchema,
  async (input, ctx): Promise<ContentSaveResult> => {
    const result = await saveBlogPost(input, actorFrom(ctx));
    revalidateContent();
    return result;
  },
  { auth: 'active', can: 'cms.edit' },
);

/* -------------------------------------------------------------------------- */
/* Catégories                                                                  */
/* -------------------------------------------------------------------------- */

export const saveCategoryAction = withAction(
  saveCategorySchema,
  async (input, ctx): Promise<ContentSaveResult> => {
    const result = await saveCategory(input, actorFrom(ctx));
    revalidateContent();
    return result;
  },
  { auth: 'active', can: 'cms.edit' },
);

/* -------------------------------------------------------------------------- */
/* Ordre d'affichage                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Move a FAQ question, a testimonial or a category one place up or down.
 *
 * `moved: false` is a real answer, not a failure: the first row pressed « up »
 * has nowhere to go, and the interface stays quiet rather than claiming a move.
 */
export const moveContentItemAction = withAction(
  moveContentSchema,
  async (input, ctx): Promise<{ readonly moved: boolean }> => {
    const result = await moveContentItem(input, actorFrom(ctx));
    if (result.moved) revalidateContent();
    return result;
  },
  { auth: 'active', can: 'cms.edit' },
);

/* -------------------------------------------------------------------------- */
/* Suppression                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Delete one editorial row, behind the typed confirmation the interface asks
 * for. Refused with `conflict` for a legal slug or a category that still files
 * courses — the service owns that rule, because a disabled button is a hint and
 * not a guarantee.
 */
export const deleteContentItemAction = withAction(
  deleteContentSchema,
  async (input, ctx): Promise<ContentDeleteResult> => {
    const result = await deleteContentItem(input, actorFrom(ctx));
    revalidateContent();
    return result;
  },
  { auth: 'active', can: 'cms.edit' },
);
