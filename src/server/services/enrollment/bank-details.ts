/**
 * The centre's bank coordinates, as the §9.2 modal and the §13.3 status page
 * need them.
 *
 * §12.1 and §17.12 forbid hardcoding them: the RIB, the IBAN and the
 * beneficiary live in `SiteSetting` and are edited from the administration.
 * `src/app/**` and `src/components/**` may not touch Prisma (§5, enforced by
 * ESLint), so the screens that print the transfer instructions read them here.
 *
 * ## Every field is nullable, on purpose
 * A fresh install has not filled them in yet, and a *wrong* RIB is far worse
 * than an absent one: a student would send real money to a placeholder. A
 * missing value is returned as `null`, the UI omits that row, and
 * {@link BankDetails.usable} tells the modal whether a transfer can be
 * instructed at all — when it is `false` the modal offers WhatsApp instead of
 * inventing coordinates.
 *
 * ## Caching
 * The same trade-off as `services/public-chrome` and `mail/send`: one minute,
 * so an edit in the admin lands quickly and a burst of course pages does not
 * re-read the settings table on every request. Nothing here throws — an
 * unreadable settings table degrades to "no coordinates configured".
 */

import { db } from '@/server/db';

export interface BankDetails {
  readonly holder: string | null;
  readonly bankName: string | null;
  readonly rib: string | null;
  readonly iban: string | null;
  readonly swift: string | null;
  /** `true` when at least one account number is configured (RIB or IBAN). */
  readonly usable: boolean;
}

/** The §17.12 `bank.*` group, verbatim. */
const BANK_KEYS = ['bank.holder', 'bank.name', 'bank.rib', 'bank.iban', 'bank.swift'] as const;

const CACHE_TTL_MS = 60_000;

const EMPTY: BankDetails = {
  holder: null,
  bankName: null,
  rib: null,
  iban: null,
  swift: null,
  usable: false,
};

let cache: { readonly value: BankDetails; readonly expiresAt: number } | null = null;

/** `SiteSetting.value` is JSON; only a non-empty string is usable as a label. */
function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getBankDetails(): Promise<BankDetails> {
  const now = Date.now();
  if (cache !== null && cache.expiresAt > now) return cache.value;

  const settings = new Map<string, string | null>();
  try {
    const rows = await db.siteSetting.findMany({
      where: { key: { in: [...BANK_KEYS] } },
      select: { key: true, value: true },
    });
    for (const row of rows) settings.set(row.key, asString(row.value));
  } catch (cause) {
    // A course page must still render if the settings table hiccups; it simply
    // stops offering the transfer instructions.
    console.warn('[bank] SiteSetting illisible :', cause instanceof Error ? cause.message : cause);
    return EMPTY;
  }

  const rib = settings.get('bank.rib') ?? null;
  const iban = settings.get('bank.iban') ?? null;

  const value: BankDetails = {
    holder: settings.get('bank.holder') ?? null,
    bankName: settings.get('bank.name') ?? null,
    rib,
    iban,
    swift: settings.get('bank.swift') ?? null,
    usable: rib !== null || iban !== null,
  };

  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/** Drops the cached coordinates — call after the admin saves the bank block. */
export function invalidateBankDetails(): void {
  cache = null;
}
