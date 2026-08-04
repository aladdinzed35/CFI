'use client';

import { useTranslations } from 'next-intl';
import { Landmark } from 'lucide-react';

import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/cn';

import type { BankDetailsView } from './types';

/**
 * The centre's coordinates, with a copy button on every line a student has to
 * retype into a banking app (§9.2 step 1).
 *
 * ## Why each row is `dir="ltr"`
 * A RIB is 24 digits and an IBAN starts with `MA64`. Rendered inside an Arabic
 * page, bidirectional reordering would move the country prefix to the wrong end
 * and the student would copy a number that looks right and is not. §10.3
 * requires `.force-ltr` on references, RIB/IBAN and amounts inside Arabic, and
 * the copied *value* is the raw string either way — the isolation is visual
 * only, so what lands in the clipboard is always what the bank expects.
 *
 * Rows whose setting is empty are not rendered: §17.12 lets the owner fill the
 * bank block in over time, and an empty « IBAN : — » is an invitation to send
 * money nowhere.
 */

export interface BankBlockProps {
  readonly bank: BankDetailsView;
  /** Drops the heading and tightens the rows, for the re-upload panel. */
  readonly compact?: boolean;
  readonly className?: string;
}

export function BankBlock({ bank, compact = false, className }: BankBlockProps): React.JSX.Element {
  const t = useTranslations('enrollment.modal.bank');

  const rows: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly copyLabel: string | null;
  }> = [
    bank.holder === null
      ? null
      : { id: 'holder', label: t('holder'), value: bank.holder, copyLabel: t('copyHolder') },
    bank.bankName === null
      ? null
      : { id: 'bankName', label: t('bankName'), value: bank.bankName, copyLabel: null },
    bank.rib === null
      ? null
      : { id: 'rib', label: t('rib'), value: bank.rib, copyLabel: t('copyRib') },
    bank.iban === null
      ? null
      : { id: 'iban', label: t('iban'), value: bank.iban, copyLabel: t('copyIban') },
    bank.swift === null
      ? null
      : { id: 'swift', label: t('swift'), value: bank.swift, copyLabel: null },
  ].filter((row): row is { id: string; label: string; value: string; copyLabel: string | null } => row !== null);

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border border-hairline bg-raised p-3 sm:p-4',
        className,
      )}
    >
      {compact ? null : (
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <Landmark className="size-4 shrink-0 text-strait" aria-hidden="true" />
          {t('title')}
        </p>
      )}

      <dl className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-hairline pb-1.5 last:border-0 last:pb-0"
          >
            <dt className="text-xs text-ink-muted">{row.label}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <span
                dir="ltr"
                data-numeric
                className="force-ltr min-w-0 truncate text-sm text-ink"
                title={row.value}
              >
                {row.value}
              </span>
              {row.copyLabel === null ? null : (
                <CopyButton
                  value={row.value}
                  label={row.copyLabel}
                  copiedLabel={t('copied')}
                  size="sm"
                />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
