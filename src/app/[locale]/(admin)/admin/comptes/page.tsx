import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';

import {
  endOfCasablancaDay,
  formatDateTime,
  formatRelative,
  startOfCasablancaDay,
  toDateTimeAttribute,
} from '@/lib/dates';
import { formatPhoneDisplay, formatPhoneNational, toWhatsAppNumber } from '@/lib/phone';
import { domainOfEmail } from '@/lib/validation/disposable-domains';
import { isLocale, localeLabels, type Locale } from '@/i18n/routing';
import { requirePageAdmin } from '@/server/auth/guards';
import { moderationSources } from '@/server/services/accounts/moderation';
import {
  accountCounts,
  getAccountForReview,
  listAccounts,
  PAGE_SIZE_DEFAULT,
  type AccountRow,
} from '@/server/services/accounts/queries';

import { AccountsTable } from './accounts-table';
import {
  PARAM,
  QUEUES,
  REJECTION_REASONS,
  ROLE_FROM_PARAM,
  SORT_KEYS,
  type AccountReviewView,
  type AccountRowView,
  type AccountsFilterState,
  type DuplicateView,
  type QueueKey,
  type SortParam,
} from './account-view';

/**
 * `/admin/comptes` — the account queues (§17.2).
 *
 * This file is the boundary: it validates the URL, asks the read model for one
 * page of rows, and turns database values into strings the browser can render
 * without a timezone database or a message catalogue. Nothing below it queries,
 * nothing above it formats.
 *
 * ## The URL is attacker-controlled input
 * §20 requires Zod on every boundary, "including URL params and search params".
 * Each parameter is validated against a closed set; anything unusable falls back
 * to its default with `.catch()` rather than throwing, because a tracking
 * parameter appended to a shared link must not turn the queue into an error
 * page. Unknown keys are dropped: the object handed to `listAccounts` is built
 * field by field, and that service's own schema is `.strict()`.
 *
 * ## Which queue opens by default
 * §17.2: « À valider » is the default landing *when there is pending work*.
 * With an empty queue the administrator is sent to « Actifs », because landing
 * on an empty screen tells them nothing.
 */

type LocaleParams = { locale: string };
type RawSearchParams = Record<string, string | string[] | undefined>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;

const QUEUE_KEYS = QUEUES.map((entry) => entry.key) as [QueueKey, ...QueueKey[]];

const searchParamsSchema = z.object({
  [PARAM.queue]: z.enum(QUEUE_KEYS).optional().catch(undefined),
  [PARAM.search]: z.string().trim().min(1).max(120).optional().catch(undefined),
  [PARAM.page]: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  [PARAM.pageSize]: z.coerce.number().int().min(5).max(100).optional().catch(undefined),
  [PARAM.sortBy]: z.enum(['nom', 'date', 'statut', 'connexion']).optional().catch(undefined),
  [PARAM.sortDir]: z.enum(['asc', 'desc']).optional().catch(undefined),
  [PARAM.role]: z.enum(['etudiant', 'formateur', 'admin', 'super-admin']).optional().catch(undefined),
  [PARAM.locale]: z.enum(['fr', 'ar', 'en', 'es']).optional().catch(undefined),
  [PARAM.city]: z.string().trim().min(1).max(60).optional().catch(undefined),
  [PARAM.from]: z.string().regex(ISO_DAY).optional().catch(undefined),
  [PARAM.to]: z.string().regex(ISO_DAY).optional().catch(undefined),
  [PARAM.emailStatus]: z.enum(['confirme', 'non-confirme']).optional().catch(undefined),
  [PARAM.review]: z.string().trim().min(1).max(64).optional().catch(undefined),
});

/** Only the first value of a repeated parameter is considered. */
function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Registrable domains a Moroccan student actually uses, for the « vouliez-vous
 * écrire… ? » hint of §17.2. One or two wrong characters is a typo worth
 * flagging; anything further apart is a different provider.
 */
const COMMON_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.fr',
  'outlook.com',
  'outlook.fr',
  'yahoo.com',
  'yahoo.fr',
  'live.com',
  'live.fr',
  'icloud.com',
  'protonmail.com',
  'menara.ma',
  'iam.ma',
  'orange.fr',
  'wanadoo.fr',
];

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const columns = b.length + 1;
  let previous = Array.from({ length: columns }, (_unused, index) => index);

  for (let i = 1; i < rows; i += 1) {
    const current = [i, ...Array.from({ length: columns - 1 }, () => 0)];
    for (let j = 1; j < columns; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }

  return previous[columns - 1] ?? Number.MAX_SAFE_INTEGER;
}

function suggestDomain(email: string): string | null {
  const domain = domainOfEmail(email);
  if (domain === null) return null;
  if (COMMON_EMAIL_DOMAINS.includes(domain)) return null;

  for (const candidate of COMMON_EMAIL_DOMAINS) {
    const tolerance = candidate.length > 9 ? 2 : 1;
    if (editDistance(domain, candidate) <= tolerance) return candidate;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default async function AccountsPage({
  params,
  searchParams,
}: {
  params: Promise<LocaleParams>;
  searchParams: Promise<RawSearchParams>;
}): Promise<React.JSX.Element> {
  const [{ locale }, rawSearch] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  const user = await requirePageAdmin(locale);

  const t = await getTranslations('admin.accounts');

  const query = searchParamsSchema.parse(
    Object.fromEntries(Object.entries(rawSearch).map(([key, value]) => [key, firstValue(value)])),
  );

  const countsResult = await accountCounts(user);
  const counts = countsResult.ok
    ? countsResult.data
    : {
        pendingApproval: 0,
        pendingEmail: 0,
        active: 0,
        rejected: 0,
        suspended: 0,
        oldestPendingHours: null,
      };

  const queue: QueueKey =
    query[PARAM.queue] ?? (counts.pendingApproval > 0 ? 'a-valider' : 'actifs');
  const status: AccountRow['status'] =
    QUEUES.find((entry) => entry.key === queue)?.status ?? 'PENDING_APPROVAL';

  const page = query[PARAM.page] ?? 1;
  const pageSize = query[PARAM.pageSize] ?? PAGE_SIZE_DEFAULT;
  const sortBy: SortParam = query[PARAM.sortBy] ?? 'date';
  const sortDir = query[PARAM.sortDir] ?? 'desc';
  const roleParam = query[PARAM.role];
  const role = roleParam === undefined ? undefined : ROLE_FROM_PARAM[roleParam];
  const from = startOfCasablancaDay(query[PARAM.from] ?? null);
  const rawTo = endOfCasablancaDay(query[PARAM.to] ?? null);
  // `endOfCasablancaDay` is exclusive; the read model compares with `lte`.
  const to = rawTo === null ? null : new Date(rawTo.getTime() - 1);
  const emailStatus = query[PARAM.emailStatus];

  const listResult = await listAccounts(
    {
      status: [status],
      ...(role === undefined ? {} : { role: [role] }),
      ...(query[PARAM.locale] === undefined ? {} : { locale: [query[PARAM.locale]] }),
      ...(query[PARAM.city] === undefined ? {} : { city: query[PARAM.city] }),
      ...(query[PARAM.search] === undefined ? {} : { search: query[PARAM.search] }),
      ...(from === null ? {} : { registeredFrom: from }),
      ...(to === null ? {} : { registeredTo: to }),
      ...(emailStatus === undefined ? {} : { emailVerified: emailStatus === 'confirme' }),
      page,
      pageSize,
      sortBy: SORT_KEYS[sortBy],
      sortDir,
    },
    user,
  );

  const listing = listResult.ok
    ? listResult.data
    : { rows: [] as readonly AccountRow[], total: 0, page: 1, pageSize, pageCount: 1 };

  const now = new Date();
  const rows = listing.rows.map((row) => toRowView(row, locale, now, t));

  const reviewId = query[PARAM.review];
  const review =
    reviewId === undefined ? null : await loadReview(reviewId, user, locale, t);

  /** Re-serialised from the validated values: a junk parameter never survives. */
  const currentParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) currentParams[key] = String(value);
  }
  currentParams[PARAM.queue] = queue;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1 pb-4">
        <h1 className="font-display text-title text-ink">{t('title')}</h1>
        <p className="max-w-prose text-sm text-ink-muted">{t('subtitle')}</p>
      </header>

      <AccountsTable
        rows={rows}
        total={listing.total}
        page={listing.page}
        pageSize={listing.pageSize}
        pageCount={listing.pageCount}
        sortBy={sortBy}
        sortDir={sortDir}
        queue={queue}
        counts={{
          'a-valider': counts.pendingApproval,
          actifs: counts.active,
          'attente-email': counts.pendingEmail,
          refuses: counts.rejected,
          suspendus: counts.suspended,
        }}
        search={query[PARAM.search] ?? ''}
        filters={filterState(query)}
        currentParams={currentParams}
        review={review}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* View-model builders                                                         */
/* -------------------------------------------------------------------------- */

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function filterState(query: z.output<typeof searchParamsSchema>): AccountsFilterState {
  return {
    role: query[PARAM.role] ?? null,
    locale: query[PARAM.locale] ?? null,
    city: query[PARAM.city] ?? null,
    from: query[PARAM.from] ?? null,
    to: query[PARAM.to] ?? null,
    emailStatus: query[PARAM.emailStatus] ?? null,
  };
}

/** `https://wa.me/…` with a greeting already typed — §17.2's fastest check. */
function whatsappHref(row: { phone: string; fullName: string }, t: Translator): string | null {
  const digits = toWhatsAppNumber(row.phone);
  if (digits === '') return null;
  const message = t('whatsappMessage', { name: row.fullName });
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function toRowView(
  row: AccountRow,
  locale: Locale,
  now: Date,
  t: Translator,
): AccountRowView {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    emailDisposable: row.emailDomainDisposable,
    phoneDisplay: row.phoneDisplay,
    whatsappHref: whatsappHref(row, t),
    phoneIsMoroccan: row.phoneIsMoroccan,
    city: row.city,
    status: row.status,
    role: row.role,
    registeredAtRelative: formatRelative(row.createdAt, locale, now),
    registeredAtAbsolute: formatDateTime(row.createdAt, locale),
    registeredAtIso: toDateTimeAttribute(row.createdAt),
    lastLoginRelative:
      row.lastLoginAt === null ? null : formatRelative(row.lastLoginAt, locale, now),
  };
}

function toDuplicateView(
  row: {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    city: string | null;
    status: AccountRow['status'];
    createdAt: Date;
  },
  locale: Locale,
): DuplicateView {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phoneDisplay: formatPhoneDisplay(row.phone),
    city: row.city,
    status: row.status,
    registeredAt: formatDateTime(row.createdAt, locale),
  };
}

/**
 * Everything the review drawer shows, in one server round trip.
 *
 * `canApprove` / `canReject` come from the account state machine rather than
 * from a hand-written status test, so the drawer and the service can never
 * disagree about what is possible.
 */
async function loadReview(
  userId: string,
  user: Parameters<typeof getAccountForReview>[1],
  locale: Locale,
  t: Translator,
): Promise<AccountReviewView | null> {
  const result = await getAccountForReview(userId, user);
  if (!result.ok) return null;

  const { account, duplicates, registration } = result.data;
  const approvable = moderationSources('ADMIN_APPROVED');
  const rejectable = moderationSources('ADMIN_REJECTED');

  const reason = result.data.rejectionReason;
  const reasonEntry =
    reason === null ? undefined : REJECTION_REASONS.find((entry) => entry.code === reason.code);

  return {
    id: account.id,
    fullName: account.fullName,
    email: account.email,
    phone: account.phone,
    phoneDisplay: account.phoneDisplay,
    phoneNational: formatPhoneNational(account.phone),
    whatsappHref: whatsappHref(account, t),
    phoneIsMoroccan: account.phoneIsMoroccan,
    city: account.city,
    professionalStatus: result.data.professionalStatus,
    localeLabel: localeLabels[account.locale],
    status: account.status,
    registeredAt: formatDateTime(account.createdAt, locale),
    verifiedAt:
      result.data.emailVerifiedAt === null ? null : formatDateTime(result.data.emailVerifiedAt, locale),
    approvedAt: result.data.approvedAt === null ? null : formatDateTime(result.data.approvedAt, locale),
    lastLoginAt: account.lastLoginAt === null ? null : formatDateTime(account.lastLoginAt, locale),
    emailDisposable: account.emailDomainDisposable,
    emailTypoSuggestion: suggestDomain(account.email),
    rejection:
      reason === null
        ? null
        : {
            reasonLabel: reasonEntry === undefined ? t('rejectReasons.other') : t(reasonEntry.labelKey),
            details: reason.details,
          },
    registrationIp: registration.ip,
    registrationUserAgent: registration.userAgent,
    duplicatesByPhone: duplicates.samePhone.map((row) => toDuplicateView(row, locale)),
    duplicatesByNameAndCity: duplicates.sameNameAndCity.map((row) => toDuplicateView(row, locale)),
    canApprove: approvable.includes(account.status),
    canReject: rejectable.includes(account.status),
  };
}
