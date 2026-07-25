'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { MailCheck } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { requestPasswordResetFormSchema } from '@/lib/validation/auth';
import { Link } from '@/i18n/navigation';
import { requestPasswordResetAction } from '@/server/actions/auth';

/**
 * « Mot de passe oublié » (§9.1, §20).
 *
 * ## The two branches are one branch
 * Whether or not an account exists, the form ends on the same confirmation
 * panel, showing the same masked address, after the same server-side work. A
 * form that answered « aucun compte avec cette adresse » would be a free
 * membership oracle, and one that answered faster in that case would be the same
 * oracle with extra steps — which is why the timing is equalised in the service,
 * not here.
 *
 * ## The honeypot travels, the timing check does not
 * `requestPasswordResetFormSchema` carries both traps; the render timestamp is
 * only meaningful on a form somebody has to *fill in*. This one has a single
 * field, and someone arriving from the login page with their address in the
 * clipboard can legitimately submit it in under a second.
 */

interface ForgotFormValues {
  email: string;
  /** Honeypot. Always empty for a human. */
  website: string;
}

export function ForgotForm(): React.JSX.Element {
  const t = useTranslations();
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<ForgotFormValues>({
    resolver: zodResolver(requestPasswordResetFormSchema),
    mode: 'onSubmit',
    reValidateMode: 'onBlur',
    defaultValues: { email: '', website: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const result = await requestPasswordResetAction(values);

    if (result.ok) {
      setSentTo(result.data.emailMasked);
      return;
    }

    if (result.error === 'rate_limited') {
      setFormError(
        t('errors.rateLimited', {
          minutes: Math.max(1, Math.ceil((result.retryAfterSec ?? 60) / 60)),
        }),
      );
      return;
    }
    if (result.error === 'csrf') {
      setFormError(t('errors.botDetected'));
      return;
    }
    setFormError(t('errors.serverError.body'));
  });

  if (sentTo !== null) {
    return (
      <EmptyState
        tone="strait"
        illustration={<MailCheck aria-hidden="true" />}
        title={t('auth.forgotPassword.sent.title')}
        // U+2068 / U+2069 keep the Latin address upright inside Arabic prose.
        description={t('auth.forgotPassword.sent.body', { maskedEmail: `⁨${sentTo}⁩` })}
        action={
          <Link
            href="/connexion"
            className="inline-flex h-12 items-center justify-center rounded-md bg-strait px-6 text-sm font-medium text-on-accent shadow-e2 transition-[box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)] hover:shadow-e3 active:translate-y-px"
          >
            {t('auth.forgotPassword.sent.action')}
          </Link>
        }
      >
        <p className="max-w-prose text-sm text-pretty text-ink-muted">
          {t('auth.forgotPassword.sent.hint')}
        </p>
      </EmptyState>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {formError === null ? null : (
        <Alert variant="error" title={t('errors.serverError.title')}>
          {formError}
        </Alert>
      )}

      <FormField
        label={t('auth.fields.email')}
        error={errors.email?.message !== undefined ? t('errors.invalidEmail') : undefined}
        required
        requiredHint={t('a11y.requiredField')}
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
            placeholder={t('auth.forgotPassword.emailPlaceholder')}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>

      {/* Honeypot — off-screen, out of the accessibility tree, out of the tab order. */}
      <div aria-hidden="true" className="sr-only">
        <label htmlFor="cfi-forgot-website">{t('auth.fields.honeypot')}</label>
        <input
          id="cfi-forgot-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...register('website')}
        />
      </div>

      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        {isSubmitting ? t('auth.forgotPassword.submitting') : t('auth.forgotPassword.submit')}
      </Button>
    </form>
  );
}
