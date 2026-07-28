import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Check, Clock, GraduationCap, Layers, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Rating } from '@/components/ui/rating';
import { CourseJsonLd } from '@/components/public/course/course-jsonld';
import { Curriculum } from '@/components/public/course/curriculum';
import { Markdown } from '@/components/public/course/markdown';
import { Reviews } from '@/components/public/course/reviews';
import { PurchaseCard } from '@/components/public/course/purchase-card';
import { resolveEnrollCta } from '@/server/services/catalog/enroll-cta';
import { getCurrentUser } from '@/server/auth';
import {
  getCourseBySlug,
  getViewerCourseState,
  listPublishedCourseSlugs,
} from '@/server/services/catalog/course-detail';
import { buildMetadata } from '@/lib/seo';
import { formatDuration } from '@/lib/dates';
import { Link } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';

/**
 * `/[locale]/formations/[slug]` — the conversion page (§12.4).
 *
 * Two columns on desktop with a sticky purchase card; stacked on mobile with a
 * sticky bottom bar. The order of the content sections is the specification's
 * order, because it is a funnel: what you will learn, then what is inside, then
 * who teaches it, then what other people thought.
 *
 * ## The CTA is decided on the server, in one place
 *
 * §12.4 lists seven visitor states. `resolveEnrollCta` maps them exhaustively
 * in a pure function, so the button can never disagree with the account it is
 * being shown to — and the mapping is unit-testable without rendering.
 *
 * ## Preview lessons
 *
 * A preview opens without an account, which §12.4 calls the single most
 * effective conversion tool. Video hosting arrives in M4, so a preview whose
 * lesson has real text renders that text; one that would need a player it does
 * not have is shown as a locked row instead of a dead play button.
 */

type RouteParams = { locale: string; slug: string };

export async function generateStaticParams(): Promise<RouteParams[]> {
  const slugs = await listPublishedCourseSlugs();
  return locales.flatMap((locale) => slugs.map((slug) => ({ locale, slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};

  const course = await getCourseBySlug({ slug, locale });
  if (course === null) return {};

  return buildMetadata({
    locale,
    path: `/formations/${course.slug}`,
    title: course.seoTitle ?? course.title,
    description: course.seoDescription ?? course.subtitle ?? course.description.slice(0, 160),
    image: course.coverUrl === null ? undefined : { url: course.coverUrl, alt: course.title },
    modifiedTime: course.updatedAt.toISOString(),
  });
}

export default async function CoursePage({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<React.JSX.Element> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const [course, user, t] = await Promise.all([
    getCourseBySlug({ slug, locale }),
    getCurrentUser(),
    getTranslations({ locale, namespace: 'course' }),
  ]);

  if (course === null) notFound();

  // Only asked for when there is someone to ask about.
  const viewer =
    user === null ? null : await getViewerCourseState({ userId: user.id, courseId: course.id });

  const cta = resolveEnrollCta({
    accountStatus: user?.status ?? null,
    courseSlug: course.slug,
    viewer,
  });

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <nav aria-label={t('breadcrumbLabel')} className="pb-6 text-sm text-ink-muted">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/formations" className="underline-offset-4 hover:text-ink hover:underline">
              {t('breadcrumbCatalog')}
            </Link>
          </li>
          {course.category === null ? null : (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <Link
                  href={`/formations?categorie=${course.category.slug}`}
                  className="underline-offset-4 hover:text-ink hover:underline"
                >
                  {course.category.name}
                </Link>
              </li>
            </>
          )}
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink">
            {course.title}
          </li>
        </ol>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:items-start">
        <article className="flex min-w-0 flex-col gap-10">
          <header className="flex flex-col gap-4">
            <h1 className="text-title text-balance">{course.title}</h1>
            {course.subtitle === null ? null : (
              <p className="text-lead text-pretty text-ink-muted">{course.subtitle}</p>
            )}

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-muted">
              {course.ratingCount === 0 ? null : (
                <span className="flex items-center gap-2">
                  <Rating value={course.ratingAvg} size="sm" label={t('meta.rating', { rating: course.ratingAvg.toFixed(1) })} />
                  <span data-numeric>{course.ratingAvg.toFixed(1)}</span>
                  <span>({t('meta.ratingCount', { count: course.ratingCount })})</span>
                </span>
              )}

              {course.enrollmentCount === 0 ? null : (
                <span className="flex items-center gap-1.5">
                  <Users className="size-4" aria-hidden="true" />
                  {t('meta.enrolled', { count: course.enrollmentCount })}
                </span>
              )}

              <span className="flex items-center gap-1.5">
                <Clock className="size-4" aria-hidden="true" />
                {formatDuration(course.durationMinutes, locale)}
              </span>

              <span className="flex items-center gap-1.5">
                <Layers className="size-4" aria-hidden="true" />
                {t('programme.lessonCount', { count: course.lessonCount })}
              </span>

              <Badge>{t(`level.${course.level}`)}</Badge>
              <Badge variant="outline">{t(`delivery.${course.deliveryMode}`)}</Badge>
            </div>
          </header>

          {course.coverUrl === null ? null : (
            <div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-hairline bg-raised">
              <Image
                src={course.coverUrl}
                alt={course.title}
                fill
                priority
                sizes="(min-width: 1024px) 760px, 100vw"
                className="object-cover"
              />
            </div>
          )}

          {course.objectives.length === 0 ? null : (
            <section aria-labelledby="objectives">
              <h2 id="objectives" className="text-heading">
                {t('objectives.title')}
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {course.objectives.map((objective) => (
                  <li key={objective} className="flex items-start gap-2.5 text-body text-ink-muted">
                    <Check className="mt-1 size-4 shrink-0 text-strait" aria-hidden="true" />
                    <span className="text-pretty">{objective}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="description">
            <h2 id="description" className="text-heading">
              {t('description.title')}
            </h2>
            <div className="mt-4">
              <Markdown source={course.description} />
            </div>
          </section>

          {/* The programme is a client island: it opens the preview modal, which
              §12.4 calls the single most effective conversion tool. Everything
              around it stays a Server Component. */}
          <Curriculum
            locale={locale}
            modules={course.modules}
            lessonCount={course.lessonCount}
            registerHref={cta.kind === 'guest' ? cta.href : null}
          />

          {course.requirementsText.length === 0 ? null : (
            <section aria-labelledby="prerequisites">
              <h2 id="prerequisites" className="text-heading">
                {t('prerequisites.title')}
              </h2>
              <ul className="mt-4 flex list-disc flex-col gap-2 ps-5 text-body text-ink-muted">
                {course.requirementsText.map((item) => (
                  <li key={item} className="text-pretty">
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {course.targetAudience.length === 0 ? null : (
            <section aria-labelledby="audience">
              <h2 id="audience" className="text-heading">
                {t('audience.title')}
              </h2>
              <ul className="mt-4 flex list-disc flex-col gap-2 ps-5 text-body text-ink-muted">
                {course.targetAudience.map((item) => (
                  <li key={item} className="text-pretty">
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {course.instructor === null ? null : (
            <section aria-labelledby="instructor">
              <h2 id="instructor" className="text-heading">
                {t('instructor.title')}
              </h2>
              <div className="mt-4 flex items-start gap-4 rounded-md border border-hairline bg-surface p-4">
                <span
                  aria-hidden="true"
                  className="grid size-12 shrink-0 place-items-center rounded-pill bg-raised text-ink-muted"
                >
                  <GraduationCap className="size-6" />
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-ink">{course.instructor.fullName}</p>
                  {course.instructor.headline === null ? null : (
                    <p className="mt-1 text-sm text-pretty text-ink-muted">
                      {course.instructor.headline}
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          <Reviews locale={locale} reviews={course.reviews} />

          {course.similar.length === 0 ? null : (
            <section aria-labelledby="similar">
              <h2 id="similar" className="text-heading">
                {t('similar.title')}
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {course.similar.map((other) => (
                  <li key={other.slug}>
                    <Link
                      href={`/formations/${other.slug}`}
                      className="block rounded-md border border-hairline bg-surface p-4 transition-colors hover:border-strait"
                    >
                      <span className="block truncate font-medium text-ink">{other.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>

        <PurchaseCard locale={locale} course={course} cta={cta} />
      </div>

      {/* Built from the same payload the page renders, so the markup and the
          visible content can never disagree — which is what Google penalises. */}
      <CourseJsonLd locale={locale} course={course} providerName="Centre de Formation Immersive" />
    </div>
  );
}
