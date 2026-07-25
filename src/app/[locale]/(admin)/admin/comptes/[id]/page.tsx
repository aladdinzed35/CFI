import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';
import { AtSign, Ban, MessageCircle, Phone, ShieldOff } from 'lucide-react';

import { cn } from '@/lib/cn';
import { formatDateTime, toDateTimeAttribute } from '@/lib/dates';
import { formatPhoneDisplay, formatPhoneNational, toWhatsAppNumber } from '@/lib/phone';
import { Link, redirect } from '@/i18n/navigation';
import { isLocale, localeLabels, type Locale } from '@/i18n/routing';
import { requirePageAdmin } from '@/server/auth/guards';
import { can } from '@/server/auth/permissions';
import { listSessions, type SessionSummary } from '@/server/auth/session';
import { parseRejectionReason } from '@/server/services/accounts/moderation';
import {
  getAccountDetail,
  listAccountAuditTrail,
  revokeAllUserSessionsAction,
  revokeUserSessionAction,
  updateInternalNoteAction,
  type AdminAuditEntry,
} from '@/server/actions/admin-accounts';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { Textarea } from '@/components/ui/textarea';

import { AdminBackLink } from '../../admin-nav';
import { REJECTION_REASONS, STATUS_LABEL_KEY } from '../account-view';

/**
 * `/admin/comptes/[id]` — one account, Milestone 1 scope (§17.2).
 *
 * §17.2 lists twelve tabs. Eleven of them read enrolments, payments, progress,
 * assignments, certificates, discussions or AI conversations — none of which
 * exist yet. They are not rendered as empty shells: a tab that opens on nothing
 * teaches an administrator to distrust the panel. The four that have real data
 * in this milestone are here, and the rest arrive with their milestone.
 *
 * ## No client component
 * Every mutation on this page is a `<form>` posting to a Server Action:
 * saving the internal note, signing one device out, signing them all out. They
 * work with JavaScript disabled, they cannot double-submit into an inconsistent
 * state, and the result is reported by re-rendering the page with a message —
 * never by a toast that vanishes before it is read.
 *
 * ## Direct reads, deliberately
 * The failed-login counters and this account's audit trail have no read model
 * yet. They are queried here rather than invented, with the same `WHERE` a
 * service would use; the moment `§17.13` lands its journal service, these two
 * queries move into it.
 */

type RouteParams = { locale: string; id: string };
type RawSearchParams = Record<string, string | string[] | undefined>;

const TABS = [
  { key: 'profil', labelKey: 'tabs.profile' },
  { key: 'securite', labelKey: 'tabs.security' },
  { key: 'notes', labelKey: 'tabs.notes' },
  { key: 'journal', labelKey: 'tabs.journal' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const searchSchema = z.object({
  onglet: z.enum(['profil', 'securite', 'notes', 'journal']).optional().catch(undefined),
  /** What just succeeded, so the page can say so on the way back in. */
  fait: z.enum(['note', 'session', 'sessions']).optional().catch(undefined),
  /** An `ActionErrorCode`, translated through the `admin.actionError` namespace. */
  erreur: z
    .enum(['validation', 'unauthenticated', 'forbidden', 'csrf', 'rateLimited', 'notFound', 'conflict', 'server'])
    .optional()
    .catch(undefined),
  /** How many sessions the last « tout déconnecter » closed. */
  n: z.coerce.number().int().min(0).max(1_000).optional().catch(undefined),
});

/** `ActionErrorCode` → key of the `admin.actionError` namespace. */
const ERROR_PARAM: Record<string, string> = {
  validation: 'validation',
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  csrf: 'csrf',
  rate_limited: 'rateLimited',
  not_found: 'notFound',
  conflict: 'conflict',
  server_error: 'server',
};

/* -------------------------------------------------------------------------- */

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<RawSearchParams>;
}): Promise<React.JSX.Element> {
  const [{ locale, id }, rawSearch] = await Promise.all([params, searchParams]);
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  const user = await requirePageAdmin(locale);

  const [t, tAccounts, tCommon, tError] = await Promise.all([
    getTranslations('admin.detail'),
    getTranslations('admin.accounts'),
    getTranslations('common'),
    getTranslations('admin.actionError'),
  ]);

  const query = searchSchema.parse(
    Object.fromEntries(
      Object.entries(rawSearch).map(([key, value]) => [
        key,
        Array.isArray(value) ? value[0] : value,
      ]),
    ),
  );

  const account = await getAccountDetail(id);

  if (account === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          illustration={<Ban aria-hidden="true" />}
          title={t('notFoundTitle')}
          description={t('notFoundBody')}
          action={
            <Link
              href="/admin/comptes"
              className="inline-flex min-h-11 items-center rounded-pill bg-strait px-5 text-sm font-medium text-on-accent"
            >
              {t('back')}
            </Link>
          }
        />
      </div>
    );
  }

  const tab: TabKey = query.onglet ?? 'profil';
  const canReadJournal = can(user, 'auditLog.view');
  const visibleTabs = TABS.filter((entry) => entry.key !== 'journal' || canReadJournal);
  const activeTab: TabKey = visibleTabs.some((entry) => entry.key === tab) ? tab : 'profil';

  const sessions: readonly SessionSummary[] =
    activeTab === 'securite' ? await listSessions(account.id) : [];

  const auditLog: readonly AdminAuditEntry[] =
    activeTab === 'journal' && canReadJournal ? await listAccountAuditTrail(account.id) : [];

  const detailPath = `/admin/comptes/${account.id}`;
  const whatsappDigits = toWhatsAppNumber(account.phone);
  const rejection = parseRejectionReason(account.rejectionReason);
  const rejectionEntry =
    rejection === null ? undefined : REJECTION_REASONS.find((entry) => entry.code === rejection.code);

  /* ── Server actions, inline: they close over `locale` and `id` ────────── */

  async function saveNote(formData: FormData): Promise<void> {
    'use server';
    const result = await updateInternalNoteAction(formData);
    redirect({
      href: {
        pathname: detailPath,
        query: result.ok
          ? { onglet: 'notes', fait: 'note' }
          : { onglet: 'notes', erreur: ERROR_PARAM[result.error] ?? 'server' },
      },
      locale: locale as Locale,
    });
  }

  async function revokeOneSession(formData: FormData): Promise<void> {
    'use server';
    const result = await revokeUserSessionAction(formData);
    redirect({
      href: {
        pathname: detailPath,
        query: result.ok
          ? { onglet: 'securite', fait: 'session' }
          : { onglet: 'securite', erreur: ERROR_PARAM[result.error] ?? 'server' },
      },
      locale: locale as Locale,
    });
  }

  async function revokeEverySession(formData: FormData): Promise<void> {
    'use server';
    const security = await getTranslations({
      locale: locale as Locale,
      namespace: 'admin.detail.security',
    });
    const typed = formData.get('confirmation');

    // Typed confirmation, checked on the server (§17): the word shown in the
    // interface is the word the action requires, in the administrator's locale.
    if (typeof typed !== 'string' || typed.trim() !== security('confirmWord')) {
      redirect({
        href: { pathname: detailPath, query: { onglet: 'securite', erreur: 'validation' } },
        locale: locale as Locale,
      });
    }

    const result = await revokeAllUserSessionsAction({ userId: id });
    redirect({
      href: {
        pathname: detailPath,
        query: result.ok
          ? { onglet: 'securite', fait: 'sessions', n: String(result.data.revoked) }
          : { onglet: 'securite', erreur: ERROR_PARAM[result.error] ?? 'server' },
      },
      locale: locale as Locale,
    });
  }

  /* ── Render ──────────────────────────────────────────────────────────── */

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <AdminBackLink href="/admin/comptes" label={t('back')} />

      <header className="mt-3 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={account.fullName} size="lg" />
          <div className="min-w-0">
            <h1 className="font-display text-title text-ink">{account.fullName}</h1>
            <p className="force-ltr text-sm text-ink-muted" dir="ltr">
              {account.email}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              domain="account"
              status={account.status}
              label={tAccounts(STATUS_LABEL_KEY[account.status])}
              srPrefix={tAccounts('drawer.status')}
            />
            {account.role === 'STUDENT' ? null : (
              <Badge tone="deep" variant="soft">
                {tAccounts(
                  account.role === 'INSTRUCTOR'
                    ? 'roles.instructor'
                    : account.role === 'ADMIN'
                      ? 'roles.admin'
                      : 'roles.superAdmin',
                )}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ContactLink href={`mailto:${account.email}`} label={t('actions.email')} icon="mail" />
          <ContactLink href={`tel:${account.phone}`} label={t('actions.call')} icon="phone" />
          {whatsappDigits === '' ? null : (
            <ContactLink
              href={`https://wa.me/${whatsappDigits}?text=${encodeURIComponent(
                tAccounts('whatsappMessage', { name: account.fullName }),
              )}`}
              label={t('actions.whatsapp')}
              icon="whatsapp"
              external
            />
          )}
        </div>
      </header>

      <nav
        aria-label={t('tabsLabel')}
        className="hairline-b mt-6 -mx-1 flex items-stretch gap-1 overflow-x-auto px-1"
      >
        {visibleTabs.map((entry) => {
          const active = entry.key === activeTab;
          return (
            <Link
              key={entry.key}
              href={{ pathname: detailPath, query: { onglet: entry.key } }}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative -mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                active ? 'border-strait text-ink' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {t(entry.labelKey)}
            </Link>
          );
        })}
      </nav>

      {query.erreur === undefined ? null : (
        <Alert variant="error" title={tError(query.erreur)} className="mt-4" />
      )}

      <div className="mt-6">
        {activeTab === 'profil' ? (
          <section className="flex flex-col gap-8">
            <div>
              <h2 className="font-display text-heading text-ink">{t('profile.identity')}</h2>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field label={tAccounts('drawer.fullName')} value={account.fullName} />
                <Field label={tAccounts('drawer.email')} value={account.email} ltr />
                <Field
                  label={tAccounts('drawer.phoneE164')}
                  value={formatPhoneDisplay(account.phone)}
                  ltr
                />
                <Field
                  label={tAccounts('drawer.phoneNational')}
                  value={formatPhoneNational(account.phone)}
                  ltr
                />
                <Field label={tAccounts('drawer.city')} value={account.city} />
                <Field
                  label={tAccounts('drawer.professionalStatus')}
                  value={account.professionalStatus}
                />
                <Field label={tAccounts('drawer.locale')} value={localeLabels[account.locale]} />
                <Field
                  label={tAccounts('drawer.registeredAt')}
                  value={formatDateTime(account.createdAt, locale)}
                />
                <Field
                  label={tAccounts('drawer.verifiedAt')}
                  value={
                    account.emailVerifiedAt === null
                      ? null
                      : formatDateTime(account.emailVerifiedAt, locale)
                  }
                />
                <Field label={t('profile.tags')} value={account.tags} />
              </dl>
            </div>

            <div>
              <h2 className="font-display text-heading text-ink">{t('profile.moderation')}</h2>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field
                  label={t('profile.approvedAt')}
                  value={
                    account.approvedAt === null ? null : formatDateTime(account.approvedAt, locale)
                  }
                />
                <Field label={t('profile.approvedBy')} value={account.approvedByName} />
                <Field
                  label={t('profile.rejectionReason')}
                  value={
                    rejection === null
                      ? null
                      : rejectionEntry === undefined
                        ? tAccounts('rejectReasons.other')
                        : tAccounts(rejectionEntry.labelKey)
                  }
                />
                {rejection?.details === null || rejection === null ? null : (
                  <Field label={tAccounts('reject.detailsLabel')} value={rejection.details} />
                )}
              </dl>
            </div>
          </section>
        ) : null}

        {activeTab === 'securite' ? (
          <section className="flex flex-col gap-8">
            {query.fait === 'session' ? (
              <Alert variant="success" title={t('security.revoked')} />
            ) : null}
            {query.fait === 'sessions' ? (
              <Alert
                variant="success"
                title={t('security.revokedAll', { count: query.n ?? 0 })}
              />
            ) : null}

            <div>
              <h2 className="font-display text-heading text-ink">{t('security.title')}</h2>
              <p className="mt-1 max-w-prose text-sm text-ink-muted">{t('security.body')}</p>

              {sessions.length === 0 ? (
                <p className="mt-4 text-sm text-ink-muted">{t('security.noSessions')}</p>
              ) : (
                <ul role="list" className="mt-4 flex flex-col gap-2">
                  {sessions.map((session) => (
                    <li
                      key={session.id}
                      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-hairline bg-surface p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">
                          {session.device ?? t('security.unknownDevice')}
                        </p>
                        <p className="force-ltr text-xs text-ink-muted" dir="ltr">
                          {session.ip ?? '—'}
                        </p>
                        <p className="mt-1 text-xs text-ink-muted">
                          {t('security.startedAt')} :{' '}
                          <time dateTime={toDateTimeAttribute(session.createdAt)}>
                            {formatDateTime(session.createdAt, locale)}
                          </time>
                          {' · '}
                          {t('security.expiresAt')} :{' '}
                          <time dateTime={toDateTimeAttribute(session.expiresAt)}>
                            {formatDateTime(session.expiresAt, locale)}
                          </time>
                        </p>
                      </div>

                      <form action={revokeOneSession}>
                        <input type="hidden" name="userId" value={account.id} />
                        <input type="hidden" name="sessionId" value={session.id} />
                        <Button type="submit" variant="secondary" size="sm">
                          {t('security.revoke')}
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {sessions.length === 0 ? null : (
              <form
                action={revokeEverySession}
                className="flex flex-col gap-3 rounded-md border border-danger/40 bg-danger-wash p-4"
              >
                <div>
                  <h2 className="flex items-center gap-2 font-display text-heading text-ink">
                    <ShieldOff className="size-5 shrink-0 text-danger" aria-hidden="true" />
                    {t('security.revokeAllTitle')}
                  </h2>
                  <p className="mt-1 max-w-prose text-sm text-ink-muted">
                    {t('security.revokeAllBody')}
                  </p>
                </div>

                <div className="max-w-sm">
                  <FormField
                    label={tAccounts('bulk.typeToConfirm', { word: t('security.confirmWord') })}
                    required
                    requiredHint={tCommon('required')}
                  >
                    {(field) => (
                      <Input
                        id={field.id}
                        name="confirmation"
                        autoComplete="off"
                        inputSize="sm"
                        required
                      />
                    )}
                  </FormField>
                </div>

                <div>
                  <Button type="submit" variant="danger">
                    {t('security.revokeAll')}
                  </Button>
                </div>
              </form>
            )}

            <div>
              <h2 className="font-display text-heading text-ink">{t('security.attemptsTitle')}</h2>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field
                  label={t('security.lastLogin')}
                  value={
                    account.lastLoginAt === null ? null : formatDateTime(account.lastLoginAt, locale)
                  }
                />
                <Field label={t('security.lastLoginIp')} value={account.lastLoginIp} ltr />
                <Field
                  label={t('security.attemptsTitle')}
                  value={t('security.failedAttempts', { count: account.failedLoginCount })}
                />
                <Field
                  label={t('security.lockLabel')}
                  value={
                    account.lockedUntil === null || account.lockedUntil.getTime() < Date.now()
                      ? t('security.notLocked')
                      : t('security.lockedUntil', {
                          date: formatDateTime(account.lockedUntil, locale),
                        })
                  }
                />
              </dl>
            </div>
          </section>
        ) : null}

        {activeTab === 'notes' ? (
          <section className="flex flex-col gap-4">
            {query.fait === 'note' ? <Alert variant="success" title={t('notes.saved')} /> : null}

            <div>
              <h2 className="font-display text-heading text-ink">{t('notes.title')}</h2>
              <p className="mt-1 max-w-prose text-sm text-ink-muted">{t('notes.body')}</p>
            </div>

            <form action={saveNote} className="flex max-w-2xl flex-col gap-3">
              <input type="hidden" name="userId" value={account.id} />
              <FormField label={t('notes.label')} optionalHint={tCommon('optional')}>
                {(field) => (
                  <Textarea
                    id={field.id}
                    name="note"
                    defaultValue={account.internalNote ?? ''}
                    placeholder={t('notes.placeholder')}
                    maxLength={4000}
                  />
                )}
              </FormField>
              <div>
                <Button type="submit" variant="primary">
                  {tCommon('save')}
                </Button>
              </div>
            </form>
          </section>
        ) : null}

        {activeTab === 'journal' ? (
          <section className="flex flex-col gap-4">
            <div>
              <h2 className="font-display text-heading text-ink">{t('journal.title')}</h2>
              <p className="mt-1 max-w-prose text-sm text-ink-muted">{t('journal.body')}</p>
            </div>

            {auditLog.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('journal.empty')}</p>
            ) : (
              <ol role="list" className="flex flex-col gap-2">
                {auditLog.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-1 rounded-md border border-hairline bg-surface p-4"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Badge tone="neutral" variant="outline" size="sm">
                        <span className="font-mono text-xs">{entry.action}</span>
                      </Badge>
                      <time
                        dateTime={toDateTimeAttribute(entry.createdAt)}
                        className="text-xs text-ink-muted"
                      >
                        {formatDateTime(entry.createdAt, locale)}
                      </time>
                      <span className="text-xs text-ink-muted">
                        {t('journal.by', { actor: entry.actorName ?? t('journal.system') })}
                      </span>
                    </div>
                    {entry.summary === null ? null : (
                      <p className="text-sm text-ink">{entry.summary}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  value,
  ltr = false,
}: {
  label: string;
  value: string | null;
  ltr?: boolean;
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd
        className={cn('mt-0.5 break-words text-sm text-ink', ltr ? 'force-ltr' : null)}
        dir={ltr ? 'ltr' : undefined}
      >
        {value ?? '—'}
      </dd>
    </div>
  );
}

function ContactLink({
  href,
  label,
  icon,
  external = false,
}: {
  href: string;
  label: string;
  icon: 'mail' | 'phone' | 'whatsapp';
  external?: boolean;
}): React.JSX.Element {
  const Icon = icon === 'mail' ? AtSign : icon === 'phone' ? Phone : MessageCircle;

  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-pill border border-hairline bg-surface px-4 text-sm text-ink-muted',
        'transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:bg-raised hover:text-ink',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {label}
    </a>
  );
}
