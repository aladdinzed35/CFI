import { getTranslations } from 'next-intl/server';
import { Info, PlayCircle, ReceiptText, ShieldCheck, UserPlus } from 'lucide-react';

/**
 * §12.2 §5 — « Comment ça marche ».
 *
 * This one *is* a sequence, so it is numbered 01 → 04, and the numerals are set
 * in the mono face at display size because they are the navigation of the
 * section: a visitor scanning the page should be able to count the steps
 * between "I have no account" and "I am learning" without reading a word.
 *
 * ## Honesty is the feature
 *
 * The spec is blunt about why this section exists: setting expectations here
 * kills support tickets. So step 2 says a human validates the account and how
 * long that takes, step 3 says the payment is a bank transfer or cash at the
 * centre and that a receipt must be uploaded, and the closing note repeats that
 * **there is no online payment** — because the single most expensive
 * misunderstanding this business can have is a visitor who reaches the transfer
 * screen expecting a card form.
 *
 * ## Ordered list, ordered semantics
 *
 * `<ol>` with a `<h3>` per step: the order is in the markup, not only in the
 * numerals, so it survives a screen reader and a stylesheet failure alike. The
 * numerals themselves are `aria-hidden` — "01" read aloud before every heading
 * is noise, and the list already announces its position.
 */

const STEPS = [
  { key: 'step1', Icon: UserPlus },
  { key: 'step2', Icon: ShieldCheck },
  { key: 'step3', Icon: ReceiptText },
  { key: 'step4', Icon: PlayCircle },
] as const;

export async function HomeHowItWorks(): Promise<React.JSX.Element> {
  const t = await getTranslations('home.howItWorks');

  return (
    <section
      aria-labelledby="home-how-title"
      className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24"
    >
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
        {t('sectionLabel')}
      </p>
      <h2 id="home-how-title" className="mt-4 max-w-[18ch] text-display">
        {t('title')}
      </h2>
      <p className="mt-5 max-w-[62ch] text-lead text-ink-muted">{t('subtitle')}</p>

      <ol role="list" className="mt-12 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(({ key, Icon }, index) => (
          <li key={key} className="flex flex-col border-t border-hairline pt-6">
            <div className="flex items-center justify-between gap-4">
              <span
                aria-hidden="true"
                className="font-display text-title font-medium text-strait"
                data-numeric
              >
                <span className="force-ltr" dir="ltr">
                  {`0${index + 1}`}
                </span>
              </span>
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-strait-wash">
                <Icon className="size-5 text-strait" aria-hidden="true" />
              </span>
            </div>

            <h3 className="mt-5 text-heading font-medium text-ink">
              <span className="sr-only">{`${t('stepLabel', { number: index + 1 })} : `}</span>
              {t(`${key}.title`)}
            </h3>
            <p className="mt-3 text-sm text-ink-muted">{t(`${key}.body`)}</p>
          </li>
        ))}
      </ol>

      {/* The line that prevents the most common support ticket. Paired with an
          icon, never carried by colour alone (§11.2). */}
      <p className="mt-10 flex max-w-[70ch] items-start gap-3 rounded-md border border-hairline bg-surface p-4 text-sm text-ink-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-strait" aria-hidden="true" />
        <span>{t('note')}</span>
      </p>
    </section>
  );
}
