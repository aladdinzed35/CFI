'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { BadgeCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import type { CertificateVerification } from '@/server/services/certificates';
import type { Locale } from '@/i18n/routing';
import { verifyCertificateAction } from '@/server/actions/verify-certificate';

/**
 * The verification form and its three answers (§12.5).
 *
 * ## Three states, each of which says what it means
 * Valid, annulled, unknown — and none of them is a shrug. The unknown state is
 * the one that must be got right today, because it is the only one the register
 * can currently produce: it says that no certificate carries this code and tells
 * the enquirer to check it character by character, which is a complete answer,
 * not a feature waiting to be finished.
 *
 * Colour never carries the verdict on its own: each panel leads with an icon and
 * a sentence, and the valid one is the only place on this page allowed to use
 * brass — the achievement token (§11).
 *
 * ## The client's format check is a courtesy, never a verdict
 * `normalizeCode` and `CODE_PATTERN` are the same two rules the server action
 * applies, duplicated here so a mistyped code fails in place instead of costing
 * a round trip and a rate-limit token. They are duplicated rather than shared
 * because the authoritative copy lives in a `'use server'` module, which may
 * export nothing but async functions. Nothing the browser decides ever reaches
 * the verdict: the server re-normalises and re-checks everything it is sent.
 *
 * ## The code stays LTR
 * `CFI-2026-4KX9TB` is a Latin-script identifier. In Arabic it keeps `dir="ltr"`
 * and `.force-ltr` in the field, in the result panel and in the placeholder, so
 * the hyphens do not migrate across the string (§10.3).
 */

/* -------------------------------------------------------------------------- */
/* The two rules, mirrored from the server action                              */
/* -------------------------------------------------------------------------- */

const CODE_PATTERN = /^[A-Z0-9]{2,12}(?:-[A-Z0-9]{2,12}){0,4}$/;

function normalizeCode(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[‐-―−_]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export interface VerifyCertificateFormProps {
  locale: Locale;
  /** `wa.me` link for the « écrivez-nous » action, or `null` when no number is set. */
  whatsappHref: string | null;
}

export function VerifyCertificateForm({
  locale,
  whatsappHref,
}: VerifyCertificateFormProps): React.JSX.Element {
  const t = useTranslations('pages.certificate');
  const tRoot = useTranslations();

  const inputRef = React.useRef<HTMLInputElement>(null);

  const [code, setCode] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CertificateVerification | null>(null);
  const [announcement, setAnnouncement] = React.useState('');

  /**
   * A verdict belongs to the code that produced it. The moment the field
   * changes, the panel below it would be answering a question nobody asked any
   * more — so it goes.
   */
  const onCodeChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setCode(event.target.value);
    setFieldError(null);
    setFormError(null);
    setResult(null);
    setAnnouncement('');
  }, []);

  const onSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (pending) return;

      const normalized = normalizeCode(code);

      if (normalized === '') {
        setFieldError(t('errorRequired'));
        setResult(null);
        inputRef.current?.focus();
        return;
      }
      if (!CODE_PATTERN.test(normalized)) {
        setFieldError(t('errorFormat'));
        setResult(null);
        inputRef.current?.focus();
        return;
      }

      setFieldError(null);
      setFormError(null);
      setResult(null);
      setAnnouncement(t('submitting'));
      setPending(true);

      const response = await verifyCertificateAction({ code: normalized, locale });

      setPending(false);
      // The panels below announce themselves through their own live roles;
      // leaving the sentence here as well would say everything twice.
      setAnnouncement('');

      if (response.ok) {
        setResult(response.data);
        return;
      }

      const failure =
        response.error === 'rate_limited'
          ? tRoot('errors.rateLimited', {
              minutes: Math.max(1, Math.ceil((response.retryAfterSec ?? 600) / 60)),
            })
          : response.error === 'csrf'
            ? tRoot('errors.botDetected')
            : tRoot('errors.serverError.body');

      setFormError(failure);
    },
    [code, locale, pending, t, tRoot],
  );

  /**
   * The two unsuccessful states each own their wording — « écrivez-nous » means
   * something different when a code is unknown than when a certificate was
   * annulled — so the label is passed in rather than shared. No number
   * configured means no button, never a dead one.
   */
  const whatsappAction = (label: string): React.JSX.Element | null =>
    whatsappHref === null ? null : (
      <Button asChild size="sm" variant="secondary">
        <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      </Button>
    );

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Mounted empty on first paint, so « vérification en cours » is announced
          when it arrives rather than being read as part of the page. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        <FormField
          label={t('codeLabel')}
          description={t('codeHint')}
          error={fieldError}
          required
          requiredHint={tRoot('a11y.requiredField')}
        >
          {(field) => (
            <Input
              {...field}
              ref={inputRef}
              name="code"
              value={code}
              onChange={onCodeChange}
              inputSize="lg"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              maxLength={64}
              // A Latin-script identifier keeps its own direction inside Arabic.
              dir="ltr"
              className="force-ltr font-mono tracking-[0.08em]"
              placeholder={t('codePlaceholder')}
              invalid={field['aria-invalid'] === true}
            />
          )}
        </FormField>

        <Button type="submit" size="lg" loading={pending} className="self-start">
          {t('submit')}
        </Button>
      </form>

      {formError === null ? null : (
        <Alert variant="error" title={tRoot('errors.serverError.title')}>
          {formError}
        </Alert>
      )}

      {result === null ? null : result.found === false ? (
        <Alert
          variant="warning"
          icon={ShieldQuestion}
          title={t('invalid.title')}
          action={whatsappAction(t('invalid.action'))}
        >
          {t('invalid.body')}
        </Alert>
      ) : result.revoked ? (
        <Alert
          variant="error"
          icon={ShieldAlert}
          title={t('revoked.title')}
          action={whatsappAction(t('revoked.action'))}
        >
          {t('revoked.body')}
        </Alert>
      ) : (
        <section
          role="status"
          aria-labelledby="certificate-result"
          className="rounded-lg border border-brass/30 bg-brass-wash p-6 sm:p-8"
        >
          <div className="flex items-start gap-3">
            <BadgeCheck className="mt-0.5 size-6 shrink-0 text-brass" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="certificate-result" className="text-heading font-medium text-ink text-balance">
                {t('valid.title')}
              </h2>
              <p className="mt-2 text-body text-pretty text-ink-muted">{t('valid.body')}</p>
            </div>
          </div>

          <dl className="mt-6 grid gap-5 border-t border-hairline pt-6 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-sm text-ink-muted">{t('valid.holderLabel')}</dt>
              <dd className="mt-1 text-body font-medium text-ink">{result.holderName}</dd>
            </div>

            {result.courseTitle === null ? null : (
              <div className="min-w-0">
                <dt className="text-sm text-ink-muted">{t('valid.courseLabel')}</dt>
                <dd className="mt-1 text-body font-medium text-ink">{result.courseTitle}</dd>
              </div>
            )}

            <div className="min-w-0">
              <dt className="text-sm text-ink-muted">{t('valid.issuedLabel')}</dt>
              <dd className="mt-1 text-body text-ink">
                <time dateTime={result.issuedAt}>{result.issuedAtLabel}</time>
              </dd>
            </div>

            {result.durationLabel === null ? null : (
              <div className="min-w-0">
                <dt className="text-sm text-ink-muted">{t('valid.hoursLabel')}</dt>
                <dd className="mt-1 text-body text-ink" data-numeric>
                  <span className="force-ltr" dir="ltr">
                    {result.durationLabel}
                  </span>
                </dd>
              </div>
            )}

            {result.instructorName === null ? null : (
              <div className="min-w-0">
                <dt className="text-sm text-ink-muted">{t('valid.instructorLabel')}</dt>
                <dd className="mt-1 text-body text-ink">{result.instructorName}</dd>
              </div>
            )}

            <div className="min-w-0">
              <dt className="text-sm text-ink-muted">{t('valid.referenceLabel')}</dt>
              <dd className="mt-1 text-body text-ink">
                <span className="force-ltr font-mono tracking-[0.08em]" dir="ltr">
                  {result.code}
                </span>
              </dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
