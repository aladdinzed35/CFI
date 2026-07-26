'use server';

/**
 * Newsletter subscription (§12.1 — the footer row).
 *
 * There is no `Subscriber` table, and that is deliberate: §12.1 says the row
 * "stores a `ContactMessage` with `source: NEWSLETTER`", which puts a newsletter
 * signup in the same lead inbox as a contact form or a WhatsApp click. The
 * admin's leads screen (§17.9) is therefore the one place where every inbound
 * contact lives, and the newsletter needs no second moderation surface.
 *
 * ## A duplicate address is a success
 * Re-submitting an address that is already on the list returns exactly the same
 * result as a first submission. Two reasons, and both matter:
 *
 * - **Honesty toward the visitor.** Someone who cannot remember whether they
 *   already subscribed has done nothing wrong; « vous êtes déjà inscrit » is a
 *   reproach for a non-mistake, and it is what the confirmation copy already
 *   promises anyway.
 * - **Enumeration.** An error that only fires for known addresses turns the
 *   footer of every public page into a free membership oracle (§20). The two
 *   branches return the same shape after the same work.
 *
 * ## Defences, in the order `withAction` applies them
 * Origin assertion → `.strict()` Zod validation (which carries the honeypot) →
 * a rate limit of three submissions per IP per hour. No session is required:
 * the whole point of the row is that anonymous visitors can use it.
 */

import { z } from 'zod';

import { emailSchema, honeypotSchema, localeSchema } from '@/lib/validation/auth';
import { CONTACT_FORM } from '@/lib/rate-limit';
import { withAction } from '@/server/auth';
import { db } from '@/server/db';

/**
 * `ContactMessage.source` is a free string column (see `prisma/schema.prisma`);
 * this is the value §12.1 names. Written once, here.
 */
const NEWSLETTER_SOURCE = 'NEWSLETTER';

/**
 * `locale` is not a form field the visitor fills in — it is the interface
 * language they are reading the footer in, so the eventual mailing goes out in
 * the language they chose. `website` is the honeypot: a human never sees it.
 */
const newsletterSchema = z
  .object({
    email: emailSchema,
    locale: localeSchema,
    website: honeypotSchema,
  })
  .strict();

export const subscribeToNewsletterAction = withAction(
  newsletterSchema,
  async (input, ctx) => {
    // Indexed by `@@index([email])`. Scoped to the newsletter source so that
    // having once written to the contact form does not silently swallow a
    // genuine subscription.
    const existing = await db.contactMessage.findFirst({
      where: { email: input.email, source: NEWSLETTER_SOURCE },
      select: { id: true },
    });

    if (existing === null) {
      await db.contactMessage.create({
        data: {
          // The address is the only identity a newsletter row has; inventing a
          // name would be worse than repeating it, and an empty one would make
          // the lead list unreadable.
          fullName: input.email,
          email: input.email,
          message: '',
          source: NEWSLETTER_SOURCE,
          locale: input.locale,
          ip: ctx.ip,
        },
      });
    }

    return { subscribed: true } as const;
  },
  {
    auth: 'public',
    rateLimit: { policy: CONTACT_FORM, identify: (_input, ctx) => ctx.ip },
  },
);
