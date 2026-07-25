import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { ArrowRight, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import { isLocale, type Locale } from '@/i18n/routing';
import { requirePageActiveUser } from '@/server/auth/guards';

/**
 * `/espace` — the student dashboard, **Milestone 1 scope only**.
 *
 * The dashboard §13.1 describes is nine sections deep: *Reprendre*, the weekly
 * goal ring, the Lattice progress map, enrolments, the to-do list, requests,
 * announcements, recommendations, achievements. Every one of them reads data
 * that Milestone 4 creates. Rendering them now would mean inventing it, so this
 * page ships the *other* state §13.1 specifies and which is the only true one
 * for a freshly approved account:
 *
 * > Empty-state version for a brand-new active student: a warm 3-step
 * > onboarding checklist (`Complétez votre profil` → `Choisissez une formation`
 * > → `Demandez l'accès`) with progress.
 *
 * The progress is real: step one is ticked from the account's own data, and the
 * two that follow belong to flows that do not exist yet — so they are shown as
 * what they are, upcoming, with no button that would lead nowhere. Nothing on
 * this page is a placeholder, and nothing promises a screen that is not built.
 */

type LocaleParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const active: Locale = isLocale(locale) ? locale : 'fr';
  const t = await getTranslations({ locale: active, namespace: 'nav' });

  return {
    title: t('dashboard'),
    // The student space is private: never indexed, never followed.
    robots: { index: false, follow: false },
  };
}

interface OnboardingStep {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly done: boolean;
  /**
   * The button that advances this step — added by the milestone that builds
   * its destination. A step with none is shown, and shown as what it is; it is
   * never given a button that leads to a page that does not exist.
   */
  readonly action?: { readonly href: string; readonly label: string };
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  setRequestLocale(locale);

  // The middleware already refused anyone who is not approved; this is the
  // check that consults the `Session` table, so a suspension that happened
  // thirty seconds ago is honoured here even though the cookie still looks fine.
  const user = await requirePageActiveUser(locale);
  const t = await getTranslations({ locale, namespace: 'student.dashboard' });

  const steps: readonly OnboardingStep[] = [
    {
      id: 'profil',
      title: t('onboarding.profile.title'),
      body: t('onboarding.profile.body'),
      // Name, e-mail and phone were mandatory at registration; the photo is
      // what is genuinely still missing, and it is what the formateur sees.
      // The signal comes from the account itself, so the tick is earned rather
      // than assumed — `/espace/profil` is where it gets earned, and that page
      // arrives with the milestone that builds it (§13.4).
      done: user.avatarKey !== null,
    },
    {
      id: 'formation',
      title: t('onboarding.course.title'),
      body: t('onboarding.course.body'),
      done: false,
    },
    {
      id: 'acces',
      title: t('onboarding.request.title'),
      body: t('onboarding.request.body'),
      done: false,
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;
  const currentIndex = steps.findIndex((step) => !step.done);
  const progress = Math.round((doneCount / steps.length) * 100);
  const firstName = firstNameOf(user.fullName);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title">{t('welcome', { firstName })}</h1>
          <StatusPill
            domain="account"
            status="ACTIVE"
            label={t('status.active')}
            srPrefix={t('status.label')}
          />
        </div>
        <p className="max-w-2xl text-lead text-ink-muted">{t('lead')}</p>
      </header>

      <Card elevation={1}>
        <CardHeader>
          <CardTitle as="h2">{t('onboarding.title')}</CardTitle>
          <ProgressBar
            className="mt-3"
            value={progress}
            label={t('onboarding.progressLabel')}
            valueText={t('onboarding.progress', { done: doneCount, total: steps.length })}
            showLabel
          />
        </CardHeader>

        <CardContent>
          <ol className="flex flex-col">
            {steps.map((step, index) => {
              const state = step.done ? 'done' : index === currentIndex ? 'current' : 'upcoming';

              return (
                <li
                  key={step.id}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={cn(
                    'flex gap-4 py-5 last:pb-0',
                    index === 0 ? 'pt-0' : 'hairline-t',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-pill border-2 text-sm font-medium',
                      state === 'done' && 'border-strait bg-strait text-on-accent',
                      state === 'current' && 'border-strait bg-strait-wash text-strait',
                      state === 'upcoming' && 'border-hairline bg-surface text-ink-muted',
                    )}
                  >
                    {step.done ? (
                      <Check className="size-4" strokeWidth={2.5} />
                    ) : (
                      <span data-numeric>{index + 1}</span>
                    )}
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <p
                      className={cn(
                        'text-body font-medium',
                        state === 'upcoming' ? 'text-ink-muted' : 'text-ink',
                      )}
                    >
                      {step.title}
                      {/* The state is spelled out, never carried by colour alone. */}
                      <span className="sr-only">{` — ${t(`onboarding.state.${state}`)}`}</span>
                    </p>
                    <p className="text-sm text-ink-muted">{step.body}</p>

                    {step.action !== undefined && !step.done ? (
                      <div className="mt-2">
                        <Button
                          asChild
                          size="sm"
                          variant={state === 'current' ? 'primary' : 'secondary'}
                          iconEnd={<ArrowRight className="size-4 rtl:-scale-x-100" />}
                        >
                          <Link href={step.action.href}>{step.action.label}</Link>
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * « Salma El Amrani » → « Salma ». Falls back to the whole name rather than to
 * an empty greeting, and never assumes the first token is a given name for a
 * single-word entry.
 */
function firstNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/u)[0];
  return first === undefined || first.length === 0 ? fullName.trim() : first;
}
