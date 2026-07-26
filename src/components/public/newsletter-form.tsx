'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { emailSchema, honeypotSchema } from '@/lib/validation/auth';
import { defaultLocale, isLocale } from '@/i18n/routing';
import { subscribeToNewsletterAction } from '@/server/actions/newsletter';

/**
 * The newsletter row of the public footer (§12.1).
 *
 * ## Never a silent submit
 * Exactly three outcomes are reachable and each one is stated:
 *
 * - **Success** — the form is replaced by a confirmation panel, and the same
 *   sentence is pushed into a live region that was already in the DOM before the
 *   submission, so a screen reader announces it. A region mounted *with* its
 *   content is not reliably announced; this one is mounted empty on first paint.
 * - **A rejected address** — reported under the field, through `FormField`,
 *   which pairs the message with an icon and `role="alert"` (never colour alone).
 * - **Anything else** — rate limit, network, server — reported above the field
 *   with the reason and what to do about it. The button never just stops.
 *
 * ## Validation happens twice, from one set of primitives
 * `emailSchema` and `honeypotSchema` come from `@/lib/validation/auth`, and the
 * server action composes its own `.strict()` object from the *same two*. A
 * `'use server'` module may only export async functions, so the composed schema
 * itself cannot be shared — sharing the primitives is what keeps the two sides
 * from drifting on what an acceptable address is.
 */

/** The client half of the action's schema. The primitives are the shared part. */
const newsletterFormSchema = z.object({
  email: emailSchema,
  website: honeypotSchema,
});

interface NewsletterFormValues {
  email: string;
  /** Honeypot. Always empty for a human. */
  website: string;
}

/**
 * `emailSchema` reports its refusals as i18n keys. Only these two carry
 * information the visitor can act on differently; everything else — a malformed
 * address, an over-long one — is the same instruction: fix the address.
 */
const EMAIL_ERROR_KEYS = new Set(['errors.required', 'errors.disposableEmail']);

export function NewsletterForm(): React.JSX.Element {
  const t = useTranslations();
  const rawLocale = useLocale();
  const locale = isLocale(rawLocale) ? rawLocale : defaultLocale;

  const [subscribed, setSubscribed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<NewsletterFormValues>({
    resolver: zodResolver(newsletterFormSchema),
    mode: 'onSubmit',
    reValidateMode: 'onBlur',
    defaultValues: { email: '', website: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const result = await subscribeToNewsletterAction({ ...values, locale });

    if (result.ok) {
      setSubscribed(true);
      setAnnouncement(t('footer.newsletter.success'));
      return;
    }

    switch (result.error) {
      case 'validation': {
        const emailIssue = result.fieldErrors?.email?.[0];
        if (emailIssue !== undefined) {
          setError('email', { type: 'server', message: emailIssue });
          return;
        }
        // No issue on the address means a trap fired — most often a password
        // manager filling the honeypot for a real person. Say what to do rather
        // than blame the address they typed correctly.
        setFormError(t('errors.botDetected'));
        return;
      }
      case 'rate_limited':
        setFormError(
          t('errors.rateLimited', {
            minutes: Math.max(1, Math.ceil((result.retryAfterSec ?? 60) / 60)),
          }),
        );
        return;
      case 'csrf':
        setFormError(t('errors.botDetected'));
        return;
      default:
        setFormError(t('errors.serverError.body'));
    }
  });

  const emailErrorKey = errors.email?.message;
  const emailError =
    emailErrorKey === undefined
      ? undefined
      : EMAIL_ERROR_KEYS.has(emailErrorKey)
        ? t(emailErrorKey)
        : t('errors.invalidEmail');

  return (
    <div className="w-full">
      {/* Mounted empty on first paint so the success sentence is announced when
          it arrives, not silently swapped in. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {subscribed ? (
        <p className="flex items-start gap-2 text-sm text-success">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span className="text-pretty">{t('footer.newsletter.success')}</span>
        </p>
      ) : (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
          {formError === null ? null : (
            <p role="alert" className="text-sm text-danger text-pretty">
              {formError}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <FormField
              label={t('auth.fields.email')}
              error={emailError}
              required
              requiredHint={t('a11y.requiredField')}
              className="sm:flex-1"
            >
              {(field) => (
                <Input
                  {...field}
                  {...register('email')}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="send"
                  dir="ltr"
                  className="force-ltr"
                  placeholder={t('footer.newsletter.placeholder')}
                  invalid={field['aria-invalid'] === true}
                />
              )}
            </FormField>

            <Button type="submit" size="md" loading={isSubmitting} className="sm:shrink-0">
              {t('footer.newsletter.submit')}
            </Button>
          </div>

          {/* Honeypot — off-screen, out of the accessibility tree and out of the
              tab order. A human never sees it; a form-filling bot fills it. */}
          <div aria-hidden="true" className="sr-only">
            <label htmlFor="cfi-newsletter-website">{t('auth.fields.honeypot')}</label>
            <input
              id="cfi-newsletter-website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              {...register('website')}
            />
          </div>
        </form>
      )}
    </div>
  );
}
