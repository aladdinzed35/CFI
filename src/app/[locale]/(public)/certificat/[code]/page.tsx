import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Info } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CertificateVerdict } from '@/components/public/certificate/verdict';
import { Link } from '@/i18n/navigation';
import { clientIpFrom } from '@/server/auth';
import { getPublicChrome } from '@/server/services/public-chrome';
import { verifyCertificate, type CertificateVerification } from '@/server/services/certificates';
import {
  CERTIFICATE_CODE_PATTERN,
  CERTIFICATE_VERIFY_POLICY,
  MAX_CERTIFICATE_CODE_LENGTH,
  normalizeCertificateCode,
} from '@/lib/certificate-code';
import { consumePolicy } from '@/lib/rate-limit';
import { isLocale } from '@/i18n/routing';

/**
 * `/[locale]/certificat/[code]` — the QR target (§12.5).
 *
 * §22 puts a QR code on every issued certificate pointing at
 * `https://cfi.ma/fr/certificat/<verifyCode>`, so this page is what an employer
 * sees after scanning a printed document: the verdict already rendered, with
 * nothing to type. `/certificat` remains the page for someone who was *given* a
 * code and is typing it — that one deliberately keeps the code out of the URL.
 *
 * ## It spends a rate-limit token, exactly like the form does
 * A verification code is short, printed on paper, and guessable. The action's
 * whole defence is that asking COSTS something, so a script cannot walk the code
 * space for free. A deep link that rendered a verdict without charging would
 * hand back that free oracle — and being a plain GET it is the *easier* surface
 * to script. It therefore draws from the same bucket
 * (`certificate:verify:ip`), so ten scans and ten form submissions are ten
 * checks, not twenty.
 *
 * A refusal is its own state rather than a 429: the person holding the
 * certificate did nothing wrong, and « réessayez dans un instant » is a more
 * honest answer than a status code they cannot act on.
 *
 * ## Never indexed
 * A valid verdict names the holder. `noindex, nofollow` keeps a person's name
 * and the course they took out of search results — this page is for whoever is
 * holding the document, not for the open web. Next's default
 * `strict-origin-when-cross-origin` referrer policy already stops the code
 * leaking to third parties in a Referer header.
 *
 * ## Malformed codes are answered, not 404'd
 * A `notFound()` here would tell an attacker « that code is not even the right
 * shape » in a way an unknown-but-well-formed code does not — the exact oracle
 * §20 rules out. Anything that is not a real, current certificate gets the same
 * « aucun certificat ne correspond » panel.
 */

type RouteParams = { locale: string; code: string };

/**
 * Per request, always. There is one page per certificate in existence and the
 * verdict changes the moment one is revoked; a cached « authentique » for an
 * annulled certificate is the one failure this page must never have.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'pages.certificate' });

  // No `buildMetadata`: that helper emits canonical and hreflang links, and
  // there is nothing here worth pointing a crawler at. The title deliberately
  // carries no code and no name.
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default async function CertificateDeepLinkPage({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<React.JSX.Element> {
  const { locale, code: rawCode } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [t, tRoot, chrome, headerList] = await Promise.all([
    getTranslations({ locale, namespace: 'pages.certificate' }),
    getTranslations({ locale }),
    getPublicChrome(locale),
    headers(),
  ]);

  // `clientIpFrom`, not a hand-rolled header read: it applies the same
  // normalisation (an IPv6-mapped IPv4 collapses to its dotted form), and the
  // bucket is only shared with the action if the KEY matches exactly. A second
  // implementation that skipped that step would give the same visitor two
  // buckets and twenty checks — precisely the doubling this page exists to
  // avoid. Every IP-less caller shares one bucket rather than escaping the
  // limit: the failure mode of an unknown origin should be stricter, not laxer.
  const limit = consumePolicy(
    CERTIFICATE_VERIFY_POLICY,
    clientIpFrom(headerList) ?? 'unknown',
  );

  // `decodeURIComponent` can throw on a malformed escape; a bad URL is just an
  // unknown code, not a crash.
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawCode);
  } catch {
    decoded = rawCode;
  }

  const normalized =
    decoded.length > MAX_CERTIFICATE_CODE_LENGTH ? '' : normalizeCertificateCode(decoded);

  const result: CertificateVerification | null = !limit.allowed
    ? null
    : CERTIFICATE_CODE_PATTERN.test(normalized)
      ? await verifyCertificate(normalized, locale)
      : // Same answer a well-formed unknown code gets, on purpose.
        { found: false };

  const whatsappHref =
    chrome.contact.whatsappNumber === null
      ? null
      : `https://wa.me/${chrome.contact.whatsappNumber}?text=${encodeURIComponent(
          tRoot('whatsapp.prefillCertificate'),
        )}`;

  const whatsappAction = (label: string): React.JSX.Element | null =>
    whatsappHref === null ? null : (
      <Button asChild size="sm" variant="secondary">
        <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      </Button>
    );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-3 pb-8">
        <h1 className="text-title text-balance">{t('title')}</h1>
        <p className="text-lead text-pretty text-ink-muted">{t('scannedLead')}</p>
        <p className="text-sm text-ink-muted">
          {t('valid.referenceLabel')}{' '}
          <span data-numeric dir="ltr" className="force-ltr font-mono tracking-[0.08em] text-ink">
            {normalized === '' ? decoded.slice(0, 64) : normalized}
          </span>
        </p>
      </header>

      {result === null ? (
        <Alert variant="warning" title={t('throttled.title')}>
          {tRoot('errors.rateLimited', {
            minutes: Math.max(1, Math.ceil((limit.retryAfterSec || 600) / 60)),
          })}
        </Alert>
      ) : (
        <CertificateVerdict result={result} action={whatsappAction} headingLevel="h2" />
      )}

      <p className="mt-6 flex items-start gap-3 text-sm text-pretty text-ink-muted">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{t('scope')}</span>
      </p>

      {/* The way back to the typed-code page, for an employer holding a second
          document — or one whose scanner mangled this code. */}
      <p className="mt-8 border-t border-hairline pt-6">
        <Link
          href="/certificat"
          className="text-sm text-strait underline-offset-4 hover:underline"
        >
          {t('checkAnother')}
        </Link>
      </p>
    </div>
  );
}
