'use client';

import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  CONTACT_ERRORS,
  CONTACT_MESSAGE_MAX,
  CONTACT_MESSAGE_MIN,
  contactSchema,
  isContactErrorToken,
} from '@/lib/validation/contact';
import type { Locale } from '@/i18n/routing';
import { sendContactMessageAction } from '@/server/actions/contact';

/**
 * The contact form (§12.5).
 *
 * ## One schema, two sides
 * `zodResolver(contactSchema)` runs the **same** object the server action passes
 * to `withAction`. There is no laxer client rule set to drift out of sync, and
 * the resolver hands `onValid` the parsed values — trimmed name, lower-cased
 * address, E.164 phone — so the payload the action receives is already the
 * payload it would have produced itself.
 *
 * ## The two bot traps
 * A honeypot a human never reaches, and the moment the form was rendered. Both
 * travel inside the shared schema, so both are enforced server-side; the markup
 * here only has to make the honeypot genuinely unreachable — visually hidden,
 * `aria-hidden`, and out of the tab order, all three, because any one alone
 * traps a real person using a screen reader or a keyboard. `formLoadedAt` is
 * written after mount rather than during render, so the server HTML and the
 * hydrated tree agree.
 *
 * Both traps report on hidden fields, so their message is hoisted into the
 * form-level alert: an error attached to a control nobody can see is an error
 * nobody can fix. The copy tells the visitor to reload rather than accusing
 * them of anything — the usual cause is a password manager filling the trap.
 *
 * ## Never a silent submit
 * Four outcomes, each one stated. The live region is mounted **empty on first
 * paint**, so what lands in it afterwards is announced: « envoi en cours »,
 * then either the confirmation or the reason it failed. Field errors go through
 * `FormField`, which pairs them with an icon and `role="alert"` (never colour
 * alone). The submit button keeps its exact width while pending — `loading`
 * hides the label in place rather than swapping it for a spinner — so nothing
 * below it moves.
 */

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

export interface ContactCourseOption {
  readonly slug: string;
  readonly title: string;
}

/**
 * What the controls hold, which is not quite the schema's input type: `phone`
 * and `courseSlug` are optional there and an empty string has to be
 * representable before it can mean "not given". Validation is still entirely
 * the schema's.
 */
interface ContactFormValues {
  fullName: string;
  email: string;
  phone: string;
  courseSlug: string;
  message: string;
  locale: Locale;
  /** Honeypot. Always empty for a human. */
  website: string;
  /** Epoch milliseconds, written after mount. */
  formLoadedAt: string;
}

/**
 * Radix refuses an item whose value is the empty string — it reserves `''` for
 * "nothing selected". « Je ne sais pas encore » is a real answer rather than an
 * absence, so it gets a sentinel that is mapped back to `''` on the way into
 * the form state and never leaves the browser.
 */
const NO_COURSE = 'aucune';

export interface ContactFormProps {
  locale: Locale;
  /** Published courses, for the « formation qui vous intéresse » select. */
  courses: readonly ContactCourseOption[];
  /** `wa.me` link with the generic prefill, or `null` when no number is set. */
  whatsappHref: string | null;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function ContactForm({
  locale,
  courses,
  whatsappHref,
}: ContactFormProps): React.JSX.Element {
  const t = useTranslations('pages.contact');
  const tRoot = useTranslations();

  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
    setError,
    setValue,
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      courseSlug: '',
      message: '',
      locale,
      website: '',
      formLoadedAt: '',
    },
  });

  // After mount, never during render: a value produced by `Date.now()` on the
  // server would not match the one produced in the browser.
  React.useEffect(() => {
    setValue('formLoadedAt', String(Date.now()));
  }, [setValue]);

  /**
   * The schema reports short discriminants — `'fullName'`, `'messageTooShort'`
   * — never sentences (§20, rule 5). The exhaustive switch is what turns them
   * into copy, and what keeps every `t()` call a literal the i18n guard can
   * resolve.
   */
  const fieldMessage = React.useCallback(
    (raw: string | undefined): string | undefined => {
      if (raw === undefined || raw === '') return undefined;
      if (!isContactErrorToken(raw)) return t('errors.server');

      switch (raw) {
        case CONTACT_ERRORS.fullName:
          return t('errors.fullName');
        case CONTACT_ERRORS.email:
          return t('errors.email');
        case CONTACT_ERRORS.phone:
          return t('errors.phone');
        case CONTACT_ERRORS.messageRequired:
          return t('errors.messageRequired');
        case CONTACT_ERRORS.messageTooShort:
          return t('errors.messageTooShort', { min: CONTACT_MESSAGE_MIN });
        case CONTACT_ERRORS.messageTooLong:
          return t('errors.messageTooLong', { max: CONTACT_MESSAGE_MAX });
        case CONTACT_ERRORS.bot:
        case CONTACT_ERRORS.invalid:
          return tRoot('errors.botDetected');
      }
    },
    [t, tRoot],
  );

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setAnnouncement(t('submitting'));

    const result = await sendContactMessageAction(values);

    if (result.ok) {
      setSentTo(values.email);
      setAnnouncement(t('success.title'));
      return;
    }

    if (result.error === 'validation' && result.fieldErrors !== undefined) {
      let matched = false;

      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        const first = messages[0];
        if (first === undefined) continue;

        // The traps and the locale are not fields a visitor can correct, so
        // their refusal is reported above the form rather than under a control
        // that is not on screen.
        if (
          field === '_form' ||
          field === 'website' ||
          field === 'formLoadedAt' ||
          field === 'locale'
        ) {
          setFormError(fieldMessage(first) ?? t('errors.server'));
          matched = true;
          continue;
        }

        setError(field as keyof ContactFormValues, { type: 'server', message: first });
        matched = true;
      }

      if (matched) {
        setAnnouncement(t('errors.server'));
        return;
      }
    }

    const failure =
      result.error === 'rate_limited'
        ? t('errors.rateLimited', {
            minutes: Math.max(1, Math.ceil((result.retryAfterSec ?? 3_600) / 60)),
          })
        : result.error === 'csrf'
          ? tRoot('errors.botDetected')
          : t('errors.server');

    setFormError(failure);
    setAnnouncement(failure);
  });

  const startOver = React.useCallback(() => {
    reset();
    setSentTo(null);
    setFormError(null);
    setAnnouncement('');
    setValue('formLoadedAt', String(Date.now()));
  }, [reset, setValue]);

  // A trap that fires client-side lands on a hidden field; hoist it so the
  // person sees something they can act on.
  const trapError = fieldMessage(errors.website?.message ?? errors.formLoadedAt?.message);
  const visibleFormError = formError ?? trapError ?? null;

  return (
    <div className="w-full">
      {/* Mounted empty on first paint, so what arrives later is announced
          rather than silently swapped in. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {sentTo === null ? (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
          {visibleFormError === null ? null : (
            <Alert variant="error" title={tRoot('errors.serverError.title')}>
              {visibleFormError}
            </Alert>
          )}

          <FormField
            label={t('fields.fullName')}
            error={fieldMessage(errors.fullName?.message)}
            required
            requiredHint={tRoot('a11y.requiredField')}
          >
            {(field) => (
              <Input
                {...field}
                {...register('fullName')}
                autoComplete="name"
                enterKeyHint="next"
                placeholder={t('placeholders.fullName')}
                invalid={field['aria-invalid'] === true}
              />
            )}
          </FormField>

          <FormField
            label={t('fields.email')}
            error={fieldMessage(errors.email?.message)}
            required
            requiredHint={tRoot('a11y.requiredField')}
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
                // An address is Latin script and stays LTR inside Arabic (§10.3).
                dir="ltr"
                className="force-ltr"
                placeholder={t('placeholders.email')}
                invalid={field['aria-invalid'] === true}
              />
            )}
          </FormField>

          <FormField
            label={t('fields.phone')}
            description={t('hints.phone')}
            error={fieldMessage(errors.phone?.message)}
            optionalHint={tRoot('common.optional')}
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
                    // E.164 once the number parses, the raw text before that —
                    // so the error only appears once it can be true.
                    onValueChange={(next) => {
                      phone.onChange(next.e164 ?? next.raw);
                    }}
                    invalid={field['aria-invalid'] === true}
                    enterKeyHint="next"
                    placeholder={t('placeholders.phone')}
                  />
                )}
              />
            )}
          </FormField>

          <FormField
            label={t('fields.courseInterest')}
            description={t('hints.courseInterest')}
            error={fieldMessage(errors.courseSlug?.message)}
            optionalHint={tRoot('common.optional')}
          >
            {(field) => (
              <Controller
                control={control}
                name="courseSlug"
                render={({ field: course }) => (
                  <Select
                    value={course.value}
                    onValueChange={(next) => {
                      course.onChange(next === NO_COURSE ? '' : next);
                    }}
                  >
                    <SelectTrigger
                      id={field.id}
                      aria-describedby={field['aria-describedby']}
                      invalid={field['aria-invalid'] === true}
                      ref={course.ref}
                      onBlur={course.onBlur}
                    >
                      {/* « Je ne sais pas encore » IS the unset state, so it is
                          the placeholder rather than a separate default. Radix
                          renders a placeholder during SSR; a selected item's
                          label only appears after hydration, so an empty
                          control would flash on a slow connection. */}
                      <SelectValue placeholder={t('courseInterestNone')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_COURSE}>{t('courseInterestNone')}</SelectItem>
                      {courses.map((course_) => (
                        <SelectItem key={course_.slug} value={course_.slug}>
                          {course_.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </FormField>

          <FormField
            label={t('fields.message')}
            description={t('hints.message')}
            error={fieldMessage(errors.message?.message)}
            required
            requiredHint={tRoot('a11y.requiredField')}
          >
            {(field) => (
              <Textarea
                {...field}
                {...register('message')}
                rows={7}
                maxLength={CONTACT_MESSAGE_MAX}
                counterAnnouncement={(remaining) => t('charactersRemaining', { count: remaining })}
                enterKeyHint="enter"
                placeholder={t('placeholders.message')}
                invalid={field['aria-invalid'] === true}
              />
            )}
          </FormField>

          {/* Honeypot — off-screen, out of the accessibility tree and out of the
              tab order. A human never reaches it; a form-filling bot fills it. */}
          <div aria-hidden="true" className="sr-only">
            <label htmlFor="cfi-contact-website">{t('fields.honeypot')}</label>
            <input
              id="cfi-contact-website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              {...register('website')}
            />
          </div>

          <input type="hidden" {...register('formLoadedAt')} />
          {/* The interface language the visitor is reading in — not a choice
              they make, but the language the reply must come back in. */}
          <input type="hidden" defaultValue={locale} {...register('locale')} />

          <Button type="submit" size="lg" loading={isSubmitting} className="self-start">
            {t('submit')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <Alert variant="success" title={t('success.title')}>
            {t('success.body', { email: sentTo })}
          </Alert>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={startOver}>
              {t('success.action')}
            </Button>

            {whatsappHref === null ? null : (
              <Button asChild>
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                  {t('success.whatsappCta')}
                </a>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
