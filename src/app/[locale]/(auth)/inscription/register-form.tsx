'use client';

import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { PhoneInput } from '@/components/ui/phone-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  PROFESSIONAL_STATUSES,
  WEAK_PASSWORDS,
  registerFormSchema,
  type ProfessionalStatus,
} from '@/lib/validation/auth';
import { useRouter } from '@/i18n/navigation';
import { localeLabels, locales, type Locale } from '@/i18n/routing';
import { registerAction } from '@/server/actions/auth';

/**
 * The registration form (§9.1, §28.1).
 *
 * ## One schema, two sides
 * `zodResolver(registerFormSchema)` runs the **same** schema the server action
 * validates with. There is no second, laxer client-side rule set to drift out of
 * sync: a value the browser accepts is by construction a value the server
 * accepts, and vice versa. The resolver hands `onValid` the *parsed* values, so
 * the payload the action receives is already normalised (trimmed name,
 * lower-cased address, E.164 phone).
 *
 * ## The two bot traps, and why they are here rather than behind a CAPTCHA
 * A honeypot field a human never sees, and the moment the form was rendered.
 * Both travel inside the shared schema, so both are enforced server-side; the
 * markup here only has to make the honeypot genuinely invisible — visually
 * hidden, `aria-hidden`, and out of the tab order, all three, because any one of
 * them alone traps a real person using a screen reader or a keyboard.
 * `formLoadedAt` is written after mount rather than during render, so the
 * server-rendered HTML and the hydrated tree agree.
 *
 * ## Errors
 * Every message is an i18n **key** produced by the schema, translated here.
 * Field errors are wired through `FormField` (`aria-describedby` +
 * `role="alert"`), so they are announced as they appear; a form-level failure
 * lands in a live `Alert` above the fields and moves focus nowhere — the reader
 * is already at the submit button, which is where the alert is announced from.
 */

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The *input* shape of the form, which is not quite the schema's input type:
 * `acceptTerms` is `z.literal(true)` there, and an unchecked box has to be
 * representable before it can be refused. Validation is still entirely the
 * schema's; this type only describes what the controls hold.
 */
interface RegisterFormValues {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  passwordConfirm: string;
  city: string;
  professionalStatus: string;
  preferredLocale: Locale;
  acceptTerms: boolean;
  /** Honeypot. Always empty for a human. */
  website: string;
  /** Epoch milliseconds, written after mount. */
  formLoadedAt: string;
}

/** `User.professionalStatus` codes → the `auth.professionalStatus.*` labels. */
const PROFESSIONAL_STATUS_KEYS: Readonly<Record<ProfessionalStatus, string>> = {
  ETUDIANT: 'student',
  SALARIE: 'employed',
  INDEPENDANT: 'entrepreneur',
  FONCTIONNAIRE: 'publicSector',
  EN_RECHERCHE: 'jobSeeker',
  AUTRE: 'other',
};

/**
 * Closest existing message for a validation key the catalogue does not carry
 * yet. Keeps a missing translation from surfacing as a raw key path; the real
 * keys are listed in the milestone manifest.
 */
const MESSAGE_FALLBACKS: Readonly<Record<string, string>> = {
  'errors.nameLength': 'errors.required',
  'errors.nameCharacters': 'errors.required',
  'errors.nameTwoWords': 'errors.required',
  'errors.emailTooLong': 'errors.invalidEmail',
  'errors.passwordTooShort': 'errors.weakPassword',
  'errors.passwordTooLong': 'errors.weakPassword',
  'errors.commonPassword': 'errors.weakPassword',
  'errors.cityLength': 'errors.required',
  'errors.invalidChoice': 'errors.required',
  'errors.termsRequired': 'errors.required',
  'errors.submittedTooFast': 'errors.botDetected',
  'errors.invalidToken': 'errors.tokenExpired',
};

/** Where the resend panel of `/verification-email` reads the address back from. */
const PENDING_EMAIL_STORAGE_KEY = 'cfi.verify-email';

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export interface RegisterFormProps {
  /** Pre-selects the language the visitor is already reading the site in. */
  locale: Locale;
}

export function RegisterForm({ locale }: RegisterFormProps): React.JSX.Element {
  const t = useTranslations();
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
    setValue,
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      password: '',
      passwordConfirm: '',
      city: '',
      professionalStatus: '',
      preferredLocale: locale,
      acceptTerms: false,
      website: '',
      formLoadedAt: '',
    },
  });

  // After mount, never during render: a value produced by `Date.now()` on the
  // server would not match the one produced in the browser.
  React.useEffect(() => {
    setValue('formLoadedAt', String(Date.now()));
  }, [setValue]);

  /** Translate a schema key, or the closest thing the catalogue carries. */
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

  const onValid = handleSubmit(async (values) => {
    setFormError(null);

    const result = await registerAction(values);

    if (result.ok) {
      // The resend panel needs the real address; the URL only ever carries the
      // masked one, so the address the visitor just typed is handed over
      // through per-tab storage instead of through the query string.
      try {
        window.sessionStorage.setItem(PENDING_EMAIL_STORAGE_KEY, values.email);
      } catch {
        // Private modes can refuse storage. The panel then asks for the address.
      }
      router.replace(
        `/verification-email?email=${encodeURIComponent(result.data.emailMasked)}`,
      );
      return;
    }

    if (result.fieldErrors !== undefined) {
      let matched = false;
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        const first = messages[0];
        if (first === undefined) continue;
        if (field === '_form') {
          setFormError(message(first) ?? t('errors.serverError.body'));
          matched = true;
          continue;
        }
        setError(field as keyof RegisterFormValues, { type: 'server', message: first });
        matched = true;
      }
      if (matched) return;
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
    setFormError(message(result.message) ?? t('errors.serverError.body'));
  });

  return (
    <form noValidate onSubmit={onValid} className="flex flex-col gap-5">
      {formError === null ? null : (
        <Alert variant="error" title={t('errors.serverError.title')}>
          {formError}
        </Alert>
      )}

      <FormField
        label={t('auth.fields.fullName')}
        error={message(errors.fullName?.message)}
        required
        requiredHint={t('a11y.requiredField')}
      >
        {(field) => (
          <Input
            {...field}
            {...register('fullName')}
            autoComplete="name"
            enterKeyHint="next"
            placeholder={t('auth.register.placeholders.fullName')}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>

      <FormField
        label={t('auth.fields.email')}
        error={message(errors.email?.message)}
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
            enterKeyHint="next"
            dir="ltr"
            className="force-ltr"
            placeholder={t('auth.register.placeholders.email')}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>

      <FormField
        label={t('auth.fields.phone')}
        description={t('auth.register.hints.phone')}
        error={message(errors.phone?.message)}
        required
        requiredHint={t('a11y.requiredField')}
      >
        {(field) => (
          <Controller
            control={control}
            name="phone"
            render={({ field: phone }) => (
              <PhoneInput
                id={field.id}
                aria-describedby={field['aria-describedby']}
                ref={phone.ref}
                name={undefined}
                value={phone.value}
                onBlur={phone.onBlur}
                // E.164 once the number parses, the raw text before that — so
                // the error appears while the number is still incomplete.
                onValueChange={(next) => {
                  phone.onChange(next.e164 ?? next.raw);
                }}
                invalid={field['aria-invalid'] === true}
                enterKeyHint="next"
                placeholder={t('auth.register.placeholders.phone')}
              />
            )}
          />
        )}
      </FormField>

      <FormField
        label={t('auth.fields.password')}
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
        label={t('auth.fields.passwordConfirm')}
        error={message(errors.passwordConfirm?.message)}
        required
        requiredHint={t('a11y.requiredField')}
      >
        {(field) => (
          <PasswordInput
            {...field}
            {...register('passwordConfirm')}
            autoComplete="new-password"
            enterKeyHint="next"
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

      <FormField
        label={t('auth.fields.city')}
        description={t('auth.register.hints.city')}
        error={message(errors.city?.message)}
        optionalHint={t('common.optional')}
      >
        {(field) => (
          <Input
            {...field}
            {...register('city')}
            autoComplete="address-level2"
            enterKeyHint="next"
            placeholder={t('auth.register.placeholders.city')}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>

      <FormField
        label={t('auth.fields.professionalStatus')}
        description={t('auth.register.hints.professionalStatus')}
        error={message(errors.professionalStatus?.message)}
        optionalHint={t('common.optional')}
      >
        {(field) => (
          <Controller
            control={control}
            name="professionalStatus"
            render={({ field: status }) => (
              <Select value={status.value} onValueChange={status.onChange}>
                <SelectTrigger
                  id={field.id}
                  aria-describedby={field['aria-describedby']}
                  invalid={field['aria-invalid'] === true}
                  ref={status.ref}
                  onBlur={status.onBlur}
                >
                  <SelectValue placeholder={t('auth.professionalStatus.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {PROFESSIONAL_STATUSES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {t(`auth.professionalStatus.${PROFESSIONAL_STATUS_KEYS[code]}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </FormField>

      <FormField
        label={t('auth.fields.preferredLocale')}
        description={t('auth.register.hints.preferredLocale')}
        error={message(errors.preferredLocale?.message)}
        required
        requiredHint={t('a11y.requiredField')}
      >
        {(field) => (
          <Controller
            control={control}
            name="preferredLocale"
            render={({ field: preferred }) => (
              <Select value={preferred.value} onValueChange={preferred.onChange}>
                <SelectTrigger
                  id={field.id}
                  aria-describedby={field['aria-describedby']}
                  invalid={field['aria-invalid'] === true}
                  ref={preferred.ref}
                  onBlur={preferred.onBlur}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {locales.map((code) => (
                    // Endonyms: a language names itself the same way in every
                    // interface language, so these are not translated copy.
                    <SelectItem key={code} value={code} lang={code}>
                      {localeLabels[code]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </FormField>

      <Controller
        control={control}
        name="acceptTerms"
        render={({ field: terms }) => (
          <CheckboxField
            ref={terms.ref}
            name={terms.name}
            checked={terms.value}
            onCheckedChange={(checked) => {
              terms.onChange(checked === true);
            }}
            onBlur={terms.onBlur}
            label={t('auth.fields.acceptTerms')}
            error={message(errors.acceptTerms?.message)}
          />
        )}
      />

      {/* Honeypot. Hidden three ways over — off-screen, out of the accessibility
          tree, out of the tab order — so no real person can reach it. */}
      <div aria-hidden="true" className="sr-only">
        <label htmlFor="cfi-register-website">{t('auth.fields.honeypot')}</label>
        <input
          id="cfi-register-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...register('website')}
        />
      </div>

      <input type="hidden" {...register('formLoadedAt')} />

      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        {isSubmitting ? t('auth.register.submitting') : t('auth.register.submit')}
      </Button>
    </form>
  );
}
