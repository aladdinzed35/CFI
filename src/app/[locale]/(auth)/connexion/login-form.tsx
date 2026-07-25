'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { loginFormSchema } from '@/lib/validation/auth';
import { Link, useRouter } from '@/i18n/navigation';
import { loginAction } from '@/server/actions/auth';

/**
 * The sign-in form (§9.1, §20).
 *
 * ## One failure, one sentence
 * An unknown address and a wrong password produce the *same* message — « L'adresse
 * e-mail ou le mot de passe ne correspond pas. » — because anything finer turns
 * the form into a "does this person study here?" oracle. The two refusals that
 * *are* distinguishable are the ones a student can act on: a lockout, which says
 * how many minutes are left and offers the password reset, and a rejected or
 * suspended account, which points at WhatsApp. That trade-off is documented in
 * `server/auth/config.ts`.
 *
 * ## Where you were going
 * `returnTo` travels with the credentials and is sanitised by the action. The
 * form never navigates to it directly: it navigates to whatever the action
 * hands back, which is that path only when the account is allowed to reach it,
 * and the waiting screen otherwise.
 *
 * The password field carries no strength meter. Scoring a password its owner
 * chose months ago tells them nothing they can use at the moment they are trying
 * to get in.
 */

interface LoginFormValues {
  email: string;
  password: string;
  rememberMe: boolean;
  /** Honeypot. Always empty for a human. */
  website: string;
  /** Epoch milliseconds, written after mount. */
  formLoadedAt: string;
}

export interface LoginFormProps {
  /** Raw `?suivant=` / `?next=`, straight from the URL. Sanitised server-side. */
  returnTo?: string | undefined;
}

export function LoginForm({ returnTo }: LoginFormProps): React.JSX.Element {
  const t = useTranslations();
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [signedIn, setSignedIn] = React.useState(false);

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setValue,
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    mode: 'onSubmit',
    reValidateMode: 'onBlur',
    defaultValues: {
      email: '',
      password: '',
      rememberMe: false,
      website: '',
      formLoadedAt: '',
    },
  });

  React.useEffect(() => {
    setValue('formLoadedAt', String(Date.now()));
  }, [setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const result = await loginAction({ ...values, suivant: returnTo });

    if (result.ok) {
      setSignedIn(true);
      router.replace(result.data.redirectTo);
      // The session cookie was set during the action; without this the RSC tree
      // would be re-rendered from a cache that predates it.
      router.refresh();
      return;
    }

    if (result.error === 'rate_limited') {
      setFormError(
        t('errors.accountLocked', {
          minutes: Math.max(1, Math.ceil((result.retryAfterSec ?? 60) / 60)),
        }),
      );
      return;
    }

    if (result.error === 'validation') {
      // Shape-level failure only — login never applies the password policy, so
      // the single generic sentence is still the right one to show.
      setFormError(t('auth.login.failed'));
      return;
    }

    if (result.error === 'csrf') {
      setFormError(t('errors.botDetected'));
      return;
    }

    const key = result.message;
    setFormError(
      key !== undefined && t.has(key) ? t(key) : t('auth.login.failed'),
    );
  });

  const busy = isSubmitting || signedIn;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {formError === null ? null : (
        <Alert variant="error" title={t('errors.serverError.title')}>
          {formError}
        </Alert>
      )}

      {signedIn ? (
        <Alert variant="success" title={t('auth.login.success')} />
      ) : null}

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
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            dir="ltr"
            className="force-ltr"
            placeholder={t('auth.login.emailPlaceholder')}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>

      <FormField
        label={t('auth.fields.password')}
        error={errors.password?.message !== undefined ? t('errors.required') : undefined}
        required
        requiredHint={t('a11y.requiredField')}
      >
        {(field) => (
          <PasswordInput
            {...field}
            {...register('password')}
            autoComplete="current-password"
            enterKeyHint="go"
            showStrength={false}
            placeholder={t('auth.login.passwordPlaceholder')}
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

      {/* Honeypot — off-screen, out of the accessibility tree, out of the tab
          order. A form filler trips it; nobody else can reach it. */}
      <div aria-hidden="true" className="sr-only">
        <label htmlFor="cfi-login-website">{t('auth.fields.honeypot')}</label>
        <input
          id="cfi-login-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...register('website')}
        />
      </div>

      <input type="hidden" {...register('formLoadedAt')} />

      <Button type="submit" size="lg" fullWidth loading={busy}>
        {busy ? t('auth.login.submitting') : t('auth.login.submit')}
      </Button>

      <Link
        href="/mot-de-passe-oublie"
        className="self-start rounded-sm text-sm font-medium text-strait underline underline-offset-4 hover:text-ink"
      >
        {t('auth.login.forgotPassword')}
      </Link>
    </form>
  );
}
