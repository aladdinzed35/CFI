'use server';

/**
 * The contact form's server action (§12.5, §20).
 *
 * ## One schema, and it lives somewhere else
 * `contactSchema` is imported from `@/lib/validation/contact`, which is the same
 * module `contact-form.tsx` hands to `zodResolver`. A `'use server'` file may
 * only export async functions, so the schema could not have lived here even if
 * we had wanted it to — and that constraint is a feature: there is exactly one
 * definition of what a valid message is, and the browser and the server cannot
 * disagree about it. The schema carries the honeypot and the render-timestamp
 * check, so both are enforced server-side rather than being decoration in the
 * markup.
 *
 * ## Defences, in the order `withAction` applies them
 * Origin/Host assertion → `.strict()` validation (unknown keys rejected) → a
 * rate limit of three submissions per IP per hour. No session: the whole point
 * of a contact form is that a stranger can use it, so `auth: 'public'` and
 * `ctx.user` is allowed to be `null`.
 *
 * ## No acknowledgement e-mail is queued, deliberately
 * §12.5 asks for a confirmation to the sender and a notification to the staff.
 * `src/server/mail/templates/` currently holds seven templates — the account
 * lifecycle and the password events — and none of them is a contact
 * acknowledgement or a "new lead" notice. Inventing one here would mean writing
 * a template outside this file's ownership and enqueueing a job against a
 * `template` id that `EMAIL_TEMPLATE_IDS` does not know, which the mail layer
 * would reject at drain time: a message that appears to have been sent and
 * silently was not. The row is written, the admin leads screen (§17.9) reads it,
 * and the success panel tells the visitor when to expect a reply — which is the
 * promise the product can actually keep today.
 */

import { CONTACT_FORM } from '@/lib/rate-limit';
import { contactSchema } from '@/lib/validation/contact';
import { withAction } from '@/server/auth';
import { db } from '@/server/db';
import { getCourseTitleBySlug } from '@/server/services/public-pages';

/**
 * `ContactMessage.source` is a free string column whose vocabulary is fixed in
 * `prisma/schema.prisma`: `CONTACT_FORM | WHATSAPP_CLICK | COURSE_CTA`. This is
 * the form's value, written once, here.
 */
const CONTACT_SOURCE = 'CONTACT_FORM';

export const sendContactMessageAction = withAction(
  contactSchema,
  async (input, ctx) => {
    // The visitor picked a course from a list that was rendered when the page
    // loaded. Between that render and this submit the catalogue can change, so
    // an unknown or unpublished slug drops the *association* rather than the
    // message: losing a real enquiry over a race would be a self-inflicted
    // wound, and the message body still says what the person wants.
    const courseTitle =
      input.courseSlug === undefined ? null : await getCourseTitleBySlug(input.courseSlug);

    await db.contactMessage.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone ?? null,
        // `subject` is what the admin list shows at a glance. The French course
        // title is readable to the staff whatever language the visitor wrote
        // in; a slug is not.
        subject: courseTitle,
        courseInterest: courseTitle === null ? null : input.courseSlug,
        message: input.message,
        source: CONTACT_SOURCE,
        // The language the visitor was reading the site in, so the reply goes
        // out in the language they chose rather than the one we prefer.
        locale: input.locale,
        ip: ctx.ip,
      },
    });

    // Nothing about the visitor is echoed back: the form already holds every
    // value it needs for the confirmation panel, and a server response is the
    // wrong place to repeat an address.
    return { received: true } as const;
  },
  {
    auth: 'public',
    rateLimit: { policy: CONTACT_FORM, identify: (_input, ctx) => ctx.ip },
  },
);
