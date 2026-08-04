import { useTranslations } from 'next-intl';
import { BadgeCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import type { CertificateVerification } from '@/server/services/certificates';

/**
 * The three answers a certificate check can give (§12.5), rendered once.
 *
 * There are two ways into this verdict and they must never disagree: an
 * employer typing a code into `/certificat`, and someone scanning the QR on a
 * printed document, which lands on `/certificat/[code]`. Two copies of these
 * panels would drift — one would gain the revocation date, or lose the
 * « what this proves » caveat — and the page that disagrees is the one telling
 * somebody a genuine certificate is fake.
 *
 * It takes no `'use client'` directive on purpose. `useTranslations` works in
 * both environments, so the form renders it inside its client island and the
 * deep link renders it on the server, from one definition.
 *
 * ## Colour never carries the verdict
 * Each panel leads with an icon and a sentence. The valid one is the only place
 * on either page allowed to use brass — the achievement token (§11.2) — which
 * is precisely why it must not be spent on the other two.
 */

export interface CertificateVerdictProps {
  readonly result: CertificateVerification;
  /**
   * The « write to us » control, built by the caller because the two
   * unsuccessful states word it differently and because a centre with no
   * WhatsApp number configured must get no button rather than a dead one.
   */
  readonly action?: (label: string) => React.JSX.Element | null;
  /**
   * `h2` under the form, which already has an `h1`; the deep link passes `h1`
   * because the verdict IS that page's subject.
   */
  readonly headingLevel?: 'h1' | 'h2';
}

export function CertificateVerdict({
  result,
  action,
  headingLevel = 'h2',
}: CertificateVerdictProps): React.JSX.Element {
  const t = useTranslations('pages.certificate');
  const Heading = headingLevel;

  if (!result.found) {
    return (
      <Alert
        variant="warning"
        icon={ShieldQuestion}
        title={t('invalid.title')}
        action={action?.(t('invalid.action'))}
      >
        {t('invalid.body')}
      </Alert>
    );
  }

  if (result.revoked) {
    return (
      <Alert
        variant="error"
        icon={ShieldAlert}
        title={t('revoked.title')}
        action={action?.(t('revoked.action'))}
      >
        <p>{t('revoked.body')}</p>
        {/* §12.5: an annulled certificate shows WHEN it was annulled, so a
            holder can tell whether it was valid on the day it was issued to
            them. The reason stays internal and never reaches this component. */}
        <p className="mt-2">
          {t('revoked.dateLabel')}{' '}
          <time dateTime={result.revokedAt} className="font-medium">
            {result.revokedAtLabel}
          </time>
        </p>
      </Alert>
    );
  }

  return (
    <section
      role="status"
      aria-labelledby="certificate-result"
      className="rounded-lg border border-brass/30 bg-brass-wash p-6 sm:p-8"
    >
      <div className="flex items-start gap-3">
        <BadgeCheck className="mt-0.5 size-6 shrink-0 text-brass" aria-hidden="true" />
        <div className="min-w-0">
          <Heading id="certificate-result" className="text-heading font-medium text-ink text-balance">
            {t('valid.title')}
          </Heading>
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
            {/* `CFI-2026-4KX9TB` is a Latin-script identifier: in Arabic it keeps
                its own direction so the hyphens do not migrate (§10.3). */}
            <span className="force-ltr font-mono tracking-[0.08em]" dir="ltr">
              {result.code}
            </span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
