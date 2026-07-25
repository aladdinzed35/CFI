'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Clock, ShieldCheck } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { PasswordInput } from '@/components/ui/password-input';
import { WEAK_PASSWORDS, resetPasswordFormSchema } from '@/lib/validation/auth';
import { Link } from '@/i18n/navigation';
import { resetPasswordAction } from '@/server/actions/auth';

/**
 * Choose a new password (§9.1, §20).
 *
 * ## Every session dies with the old password
 * A password is reset precisely because it may be in somebody else's hands, so
 * the server revokes every live session — including the attacker's — in the same
 * transaction that installs the new one. The form says so **before** the button
 * is pressed, not only after: being signed out of your phone is a surprise worth
 * warning about, and it is also the reassurance the person who was locked out
 * needs.
 *
 * ## Three end states
 * Success, an expired link, and a link that was already used. The last two are
 * dead ends by design — there is nothing to retype — so each one ends on the same
 * single action: ask for a new link.
 */

interface ResetFormValues {
  token: string;
  password: string;
  passwordConfirm: string;
}

/** Closest existing message for a validation key not yet in the catalogue. */
const MESSAGE_FALLBACKS: Readonly<Record<string, string>> = {
  'errors.passwordTooShort': 'errors.weakPassword',
  'errors.passwordTooLong': 'errors.weakPassword',
  'errors.commonPassword': 'errors.weakPassword',
  'errors.invalidToken': 'errors.tokenExpired',
};

type DeadEnd = { readonly bodyKey: string };

export interface ResetFormProps {
  /** Shape-validated by the page; still re-validated server-side. */
  token: string;
}

export function ResetForm({ token }: ResetFormProps): React.JSX.Element {
  const t = useTranslations();
  const [revokedSessions, setRevokedSessions] = React.useState<number | null>(null);
  const [deadEnd, setDeadEnd] = React.useState<DeadEnd | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<ResetFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { token, password: '', passwordConfirm: '' },
  });

  const message = React.useCallback(
    (key: string | undefined): string | undefined => {
      if (key === undefined || key === '') return undefined;
      if (t.has(key)) return t(key);
      const fallback = MESSAGE_FALLBACKS[key];
      if (fallback !== undefined && t.has(fallback)) return t(fallback);
      return t('errors.required');
    },
    [t],
  );

  const strengthLabels = React.useMemo(
    (): readonly [string, string, string, string, string] => [
      t('auth.register.passwordStrength.weak'),
      t('auth.register.passwordStrength.weak'),
      t('auth.register.passwordStrength.medium'),
      t('auth.register.passwordStrength.strong'),
      t('auth.register.passwordStrength.excellent'),
    ],
    [t],
  );

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const result = await resetPasswordAction(values);

    if (result.ok) {
      setRevokedSessions(result.data.revokedSessions);
      return;
    }

    // A refused token is not something the form can recover from: swap the whole
    // panel rather than pinning an error to a field the reader cannot fix.
    if (result.error === 'not_found') {
      setDeadEnd({ bodyKey: result.message ?? 'errors.tokenExpired' });
      return;
    }

    if (result.fieldErrors !== undefined) {
      const passwordIssue = result.fieldErrors.password?.[0];
      if (passwordIssue !== undefined) {
        setFormError(message(passwordIssue) ?? t('errors.serverError.body'));
        return;
      }
    }
    if (result.error === 'csrf') {
      setFormError(t('errors.botDetected'));
      return;
    }
    setFormError(t('errors.serverError.body'));
  });

  /* ── Done ────────────────────────────────────────────────────────────── */
  if (revokedSessions !== null) {
    return (
      <div className="flex flex-col gap-6">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-md border border-success/30 bg-success-wash text-success"
        >
          <ShieldCheck className="size-6" />
        </span>

        <div className="flex flex-col gap-2">
          <h2 className="font-display text-title text-balance text-ink">
            {t('auth.resetPassword.success.title')}
          </h2>
          <p className="text-body text-pretty text-ink-muted">
            {t('auth.resetPassword.success.body')}
          </p>
        </div>

        <Link
          href="/connexion"
          className="inline-flex h-12 w-full items-center justify-center rounded-md bg-strait px-6 text-sm font-medium text-on-accent shadow-e2 transition-[box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)] hover:shadow-e3 active:translate-y-px"
        >
          {t('auth.resetPassword.success.action')}
        </Link>
      </div>
    );
  }

  /* ── Dead link ───────────────────────────────────────────────────────── */
  if (deadEnd !== null) {
    return (
      <div className="flex flex-col gap-6">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-md border border-warn/30 bg-warn-wash text-warn"
        >
          <Clock className="size-6" />
        </span>

        <div className="flex flex-col gap-2">
          <h2 className="font-display text-title text-balance text-ink">
            {t('auth.resetPassword.expired.title')}
          </h2>
          <p className="text-body text-pretty text-ink-muted">
            {t.has(deadEnd.bodyKey) ? t(deadEnd.bodyKey) : t('auth.resetPassword.expired.body')}
          </p>
        </div>

        <Link
          href="/mot-de-passe-oublie"
          className="inline-flex h-12 w-full items-center justify-center rounded-md bg-strait px-6 text-sm font-medium text-on-accent shadow-e2 transition-[box-shadow,transform] duration-[120ms] ease-[var(--ease-out-strait)] hover:shadow-e3 active:translate-y-px"
        >
          {t('auth.resetPassword.expired.action')}
        </Link>
      </div>
    );
  }

  /* ── Form ────────────────────────────────────────────────────────────── */
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {formError === null ? null : (
        <Alert variant="error" title={t('errors.serverError.title')}>
          {formError}
        </Alert>
      )}

      <Alert variant="info" title={t('auth.resetPassword.sessionsRevokedNotice')} />

      <input type="hidden" {...register('token')} />

      <FormField
        label={t('auth.resetPassword.password')}
        description={t('auth.register.hints.password')}
        error={message(errors.password?.message)}
        required
        requiredHint={t('a11y.requiredField')}
      >
        {(field) => (
          <PasswordInput
            {...field}
            {...register('password')}
            autoComplete="new-password"
            enterKeyHint="next"
            placeholder={t('auth.register.placeholders.password')}
            invalid={field['aria-invalid'] === true}
            showPasswordLabel={
              t.has('auth.fields.showPassword')
                ? t('auth.fields.showPassword')
                : t('common.showMore')
            }
            hidePasswordLabel={
              t.has('auth.fields.hidePassword')
                ? t('auth.fields.hidePassword')
                : t('common.showLess')
            }
            strengthLabels={strengthLabels}
            commonPasswords={WEAK_PASSWORDS}
          />
        )}
      </FormField>

      <FormField
        label={t('auth.resetPassword.passwordConfirm')}
        error={message(errors.passwordConfirm?.message)}
        required
        requiredHint={t('a11y.requiredField')}
      >
        {(field) => (
          <PasswordInput
            {...field}
            {...register('passwordConfirm')}
            autoComplete="new-password"
            enterKeyHint="go"
            showStrength={false}
            placeholder={t('auth.register.placeholders.passwordConfirm')}
            invalid={field['aria-invalid'] === true}
            showPasswordLabel={
              t.has('auth.fields.showPassword')
                ? t('auth.fields.showPassword')
                : t('common.showMore')
            }
            hidePasswordLabel={
              t.has('auth.fields.hidePassword')
                ? t('auth.fields.hidePassword')
                : t('common.showLess')
            }
          />
        )}
      </FormField>

      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        {isSubmitting ? t('auth.resetPassword.submitting') : t('auth.resetPassword.submit')}
      </Button>
    </form>
  );
}
