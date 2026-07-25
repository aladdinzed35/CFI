'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { resendVerificationAction } from '@/server/actions/auth';

/**
 * « Renvoyer le lien », with the 60-second cooldown of §9.1.
 *
 * ## The cooldown survives a refresh
 * The deadline is a timestamp in `localStorage`, not a counter in React state.
 * Reloading the page, or coming back to it from the mailbox, therefore does not
 * hand out a fresh allowance — which is the whole point of a cooldown, and the
 * server's durable `RateLimitEvent` budget would refuse the request anyway. The
 * difference is that the visitor now sees *why* the button is disabled and for
 * how long, instead of pressing it and being told off.
 *
 * ## Where the address comes from
 * The page only ever knows the **masked** address, so this panel needs another
 * source. In order: the session (a `PENDING_EMAIL` account can sign in), then
 * the address the registration form left in per-tab storage, then — if neither
 * is available, because the link was opened in a different tab or storage is
 * refused — a field, because asking is better than a disabled button with no
 * explanation. Whichever path is taken, the server's answer is identical for a
 * known and an unknown address (§20).
 *
 * ## No timing trap here
 * The honeypot travels, the render timestamp does not. A student who lands on
 * this page and presses the button within two and a half seconds is doing
 * exactly what the page invites them to do; refusing them as a bot would be
 * wrong. The one-per-minute durable budget is the defence at this endpoint.
 */

/** Written by the registration form; per tab, cleared when the tab closes. */
const PENDING_EMAIL_STORAGE_KEY = 'cfi.verify-email';
/** Epoch milliseconds before which the button stays disabled. */
const COOLDOWN_STORAGE_KEY = 'cfi.verify-resend-until';

/** §9.1 — 60 s, and `RESEND_VERIFICATION` in `@/lib/rate-limit` says the same. */
const DEFAULT_COOLDOWN_SEC = 60;

function readStoredDeadline(): number {
  try {
    const raw = window.localStorage.getItem(COOLDOWN_STORAGE_KEY);
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeStoredDeadline(deadline: number): void {
  try {
    window.localStorage.setItem(COOLDOWN_STORAGE_KEY, String(deadline));
  } catch {
    // Storage refused: the countdown then lives for this page view only, and
    // the server budget still refuses an early second send.
  }
}

function readStoredEmail(): string {
  try {
    return window.sessionStorage.getItem(PENDING_EMAIL_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export interface ResendPanelProps {
  /** The signed-in account's real address, or `''` when there is no session. */
  initialEmail: string;
}

export function ResendPanel({ initialEmail }: ResendPanelProps): React.JSX.Element {
  const t = useTranslations();

  const [email, setEmail] = React.useState(initialEmail);
  const [pending, setPending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [remaining, setRemaining] = React.useState(0);

  // Storage is read after mount only: it does not exist while the page is being
  // rendered on the server, and reading it during render would desynchronise
  // the two trees.
  React.useEffect(() => {
    if (initialEmail === '') {
      const stored = readStoredEmail();
      if (stored !== '') setEmail(stored);
    }
    const deadline = readStoredDeadline();
    if (deadline > Date.now()) {
      setRemaining(Math.ceil((deadline - Date.now()) / 1_000));
    }
  }, [initialEmail]);

  const counting = remaining > 0;

  // One interval, created when the countdown starts and torn down when it ends
  // — not re-created on every tick. The deadline is re-read from storage each
  // time, so two tabs counting down agree with each other.
  React.useEffect(() => {
    if (!counting) return;
    const timer = window.setInterval(() => {
      const left = Math.ceil((readStoredDeadline() - Date.now()) / 1_000);
      setRemaining(left > 0 ? left : 0);
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [counting]);

  const startCooldown = React.useCallback((seconds: number): void => {
    const deadline = Date.now() + seconds * 1_000;
    writeStoredDeadline(deadline);
    setRemaining(seconds);
  }, []);

  const onSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (pending || remaining > 0) return;

      setPending(true);
      setError(null);
      setSent(false);

      const form = new FormData(event.currentTarget);
      const submitted = String(form.get('email') ?? '').trim();

      const result = await resendVerificationAction({
        email: submitted,
        website: String(form.get('website') ?? ''),
      });

      setPending(false);

      if (result.ok) {
        setEmail(submitted);
        try {
          window.sessionStorage.setItem(PENDING_EMAIL_STORAGE_KEY, submitted);
        } catch {
          // Not persisting it only means the field is shown again next time.
        }
        setSent(true);
        startCooldown(result.data.cooldownSec > 0 ? result.data.cooldownSec : DEFAULT_COOLDOWN_SEC);
        return;
      }

      if (result.error === 'rate_limited') {
        startCooldown(result.retryAfterSec ?? DEFAULT_COOLDOWN_SEC);
        return;
      }

      const fieldMessage = result.fieldErrors?.email?.[0];
      if (fieldMessage !== undefined) {
        setError(t.has(fieldMessage) ? t(fieldMessage) : t('errors.invalidEmail'));
        return;
      }
      if (result.error === 'csrf') {
        setError(t('errors.botDetected'));
        return;
      }
      setError(t('errors.serverError.body'));
    },
    [pending, remaining, startCooldown, t],
  );

  const cooling = counting;
  const knowsAddress = email !== '';

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {sent ? <Alert variant="success" title={t('auth.verifyEmail.resent')} /> : null}
      {error === null ? null : (
        <Alert variant="error" title={t('errors.serverError.title')}>
          {error}
        </Alert>
      )}

      {knowsAddress ? (
        <input type="hidden" name="email" value={email} />
      ) : (
        <FormField label={t('auth.fields.email')} required requiredHint={t('a11y.requiredField')}>
          {(field) => (
            <Input
              {...field}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              dir="ltr"
              className="force-ltr"
              placeholder={t('auth.login.emailPlaceholder')}
            />
          )}
        </FormField>
      )}

      {/* Honeypot — off-screen, out of the accessibility tree, out of the tab order. */}
      <div aria-hidden="true" className="sr-only">
        <label htmlFor="cfi-resend-website">{t('auth.fields.honeypot')}</label>
        <input id="cfi-resend-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <Button type="submit" variant="secondary" size="lg" fullWidth loading={pending} disabled={cooling}>
        {pending ? t('auth.verifyEmail.resending') : t('auth.verifyEmail.resend')}
      </Button>

      {cooling ? (
        // Deliberately not a live region: a number that changes every second
        // would be announced every second. The outcome is announced by the
        // Alert above; this line is the visual explanation of the disabled
        // button, and screen-reader users reach it right after the button.
        <p className="text-sm text-ink-muted">
          {t('auth.verifyEmail.cooldown', { seconds: remaining })}
        </p>
      ) : null}
    </form>
  );
}
