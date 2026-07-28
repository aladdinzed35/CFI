import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { getInstructors } from '@/server/services/public-pages';
import { getHomeData } from '@/server/services/home';
import { buildMetadata } from '@/lib/seo';
import { Link } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';

/**
 * `/[locale]/formateurs` — the teaching team (§12.2 #8, given its own page).
 *
 * ## Only real people, only real courses
 *
 * `getInstructors` returns `User` rows with `role: INSTRUCTOR`, an active
 * account, and at least one published course. An instructor account with nothing
 * published is a staff record, not a public profile: listing it would promise a
 * catalogue that does not exist. The headline and the biography are the columns
 * as typed in the admin — this page never writes a sentence about a person.
 *
 * Every figure is likewise a fact: `courseCount` is the number of published
 * courses they authored, `studentCount` the sum of the enrolments on those
 * courses. A brand-new instructor shows « Première promotion » rather than a
 * proud zero, which is what the plural form in `pages.instructors.studentCount`
 * is for.
 *
 * ## The domain
 *
 * « La spécialité » is the category of the instructor's most enrolled published
 * course, resolved by `getHomeData` — a real category name, never a guess. That
 * read model caps its list at the four longest-standing authors, so an
 * instructor outside it simply shows no domain badge: their course list below
 * already says what they teach, and an invented domain would be worse than a
 * missing one. `getInstructors` should carry the field itself; noted for the
 * agent that owns `server/services/public-pages.ts`.
 */

/** Courses listed per card before the count badge takes over. */
const COURSE_SAMPLE = 4;

type LocaleParams = { locale: string };

export function generateStaticParams(): LocaleParams[] {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'seo.instructors' });
  return buildMetadata({
    locale,
    path: '/formateurs',
    title: t('title'),
    description: t('description'),
  });
}

export default async function InstructorsPage({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [t, instructors, home] = await Promise.all([
    getTranslations({ locale, namespace: 'pages.instructors' }),
    getInstructors(locale, COURSE_SAMPLE),
    getHomeData(locale),
  ]);

  const specialtyById = new Map<string, string>();
  for (const entry of home.instructors) {
    if (entry.specialty !== null) specialtyById.set(entry.id, entry.specialty);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">{t('eyebrow')}</p>
        <h1 className="mt-4 max-w-[18ch] text-hero text-balance">{t('title')}</h1>
        <p className="mt-6 max-w-[62ch] text-lead text-pretty text-ink-muted">{t('lead')}</p>
      </header>

      {instructors.length === 0 ? (
        <div className="mt-16">
          <EmptyState
            title={t('empty.title')}
            description={t('empty.body')}
            action={
              <Link
                href="/formations"
                className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-strait px-5 text-sm font-medium text-on-accent"
              >
                {t('empty.action')}
                <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            }
          />
        </div>
      ) : (
        <ul role="list" className="mt-12 grid gap-6 lg:grid-cols-2">
          {instructors.map((instructor) => {
            const specialty = specialtyById.get(instructor.id) ?? null;

            return (
              <li
                key={instructor.id}
                className="flex flex-col rounded-lg border border-hairline bg-surface p-6 sm:p-8"
              >
                <div className="flex items-start gap-4">
                  <Avatar
                    name={instructor.fullName}
                    src={instructor.avatarUrl}
                    size="xl"
                    ring
                    className="shrink-0"
                  />
                  <div className="min-w-0">
                    <h2 className="text-heading font-medium text-ink text-balance">
                      {instructor.fullName}
                    </h2>
                    {instructor.headline === null ? null : (
                      <p className="mt-1.5 text-sm text-pretty text-ink-muted">
                        {instructor.headline}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {specialty === null ? null : (
                    <Badge tone="strait" variant="soft">
                      <span className="sr-only">{`${t('specialtyLabel')} : `}</span>
                      {specialty}
                    </Badge>
                  )}
                  <Badge tone="neutral" variant="outline">
                    {t('courseCount', { count: instructor.courseCount })}
                  </Badge>
                  <Badge tone="neutral" variant="outline">
                    {t('studentCount', { count: instructor.studentCount })}
                  </Badge>
                </div>

                {instructor.bio === null ? null : (
                  <p className="mt-5 text-body text-pretty text-ink-muted">{instructor.bio}</p>
                )}

                {instructor.courses.length === 0 ? null : (
                  <div className="mt-auto pt-6">
                    <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
                      {t('coursesTitle')}
                    </h3>
                    <ul role="list" className="mt-3 flex flex-col">
                      {instructor.courses.map((course) => (
                        <li key={course.slug} className="border-b border-hairline last:border-b-0">
                          <Link
                            href={`/formations/${course.slug}`}
                            className="flex min-h-11 items-center justify-between gap-3 py-2.5 text-sm text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:text-strait motion-reduce:transition-none"
                          >
                            <span className="min-w-0 text-pretty">{course.title}</span>
                            <ArrowRight
                              className="size-4 shrink-0 text-ink-muted rtl:-scale-x-100"
                              aria-hidden="true"
                            />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
