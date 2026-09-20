import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Check, ChevronRight, Clock, GraduationCap, Layers, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { CourseCard } from '@/components/ui/course-card';
import { PriceTag } from '@/components/ui/price-tag';
import { Rating } from '@/components/ui/rating';
import { CourseGateArt, ZelligeBackdrop, domainIcon } from '@/components/public/catalog/gate-art';
import {
  BLANK_COVER,
  CoverFallbackStyle,
  coverTintFor,
} from '@/components/public/catalog/results-grid';
import { CourseJsonLd } from '@/components/public/course/course-jsonld';
import { Curriculum } from '@/components/public/course/curriculum';
import { Markdown } from '@/components/public/course/markdown';
import { Reviews } from '@/components/public/course/reviews';
import { PurchaseCard, PurchaseNotice } from '@/components/public/course/purchase-card';
import type { EnrollmentModalData } from '@/components/enrollment/types';
import { resolveEnrollCta } from '@/server/services/catalog/enroll-cta';
import { getBankDetails } from '@/server/services/enrollment/bank-details';
import { receiptUploadConstraints } from '@/server/actions/enrollment';
import { getPublicChrome } from '@/server/services/public-chrome';
import { getCurrentUser } from '@/server/auth';
import {
  getCourseBySlug,
  getViewerCourseState,
  listPublishedCourseSlugs,
} from '@/server/services/catalog/course-detail';
import { buildMetadata } from '@/lib/seo';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/dates';
import { Link } from '@/i18n/navigation';
import { isLocale, locales } from '@/i18n/routing';

/**
 * `/[locale]/formations/[slug]` — the conversion page (§12.4).
 *
 * A full-bleed header band (breadcrumb, title, meta, and the cover — or the
 * gate illustration when there is none), then two columns on desktop with a
 * sticky purchase card; stacked on mobile with a fixed bottom bar. Everything
 * sits on the site's shared `max-w-6xl` edge, so the title lines up with the
 * logo, and the band's second column is the card's column.
 *
 * The order of the content sections is the specification's order, because it
 * is a funnel: what you will learn, then what is inside, then who teaches it,
 * then what other people thought.
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

  const [course, user, t, tWhatsapp, chrome] = await Promise.all([
    getCourseBySlug({ slug, locale }),
    getCurrentUser(),
    getTranslations({ locale, namespace: 'course' }),
    getTranslations({ locale, namespace: 'whatsapp' }),
    getPublicChrome(locale),
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

  const whatsappNumber = chrome.contact.whatsappNumber;

  // Only the buying state pays for this: the bank coordinates and the upload
  // ceilings are read (and shipped to the browser) for a visitor who can
  // actually open the §9.2 modal, and for nobody else.
  const enrollment: EnrollmentModalData | undefined = cta.opensRequestModal
    ? await (async (): Promise<EnrollmentModalData> => {
        const [bank, constraints] = await Promise.all([
          getBankDetails(),
          receiptUploadConstraints(),
        ]);
        return {
          locale,
          course: {
            id: course.id,
            slug: course.slug,
            title: course.title,
            priceCentimes: course.priceCentimes,
            comparePriceCentimes: course.comparePriceCentimes,
            moduleCount: course.modules.length,
            durationMinutes: course.durationMinutes,
            resourceCount: course.resources.length,
            certificateEnabled: course.certificateEnabled,
          },
          bank,
          whatsappUrl: whatsappNumber === null ? null : `https://wa.me/${whatsappNumber}`,
          constraints,
        };
      })()
    : undefined;

  // The programme's empty state offers one action: ask for the plan, about
  // this course, on WhatsApp.
  const programmeWhatsappHref =
    whatsappNumber === null
      ? null
      : `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
          tWhatsapp('prefillCourse', { courseTitle: course.title }),
        )}`;

  const hasCover = course.coverUrl !== null;
  const CategoryIcon = domainIcon(course.category?.slug);

  return (
    <article>
      {/* ── Header band ────────────────────────────────────────────────────
          Full-bleed, content on the site's shared edge. Its second column is
          exactly the purchase card's column below (22rem, same gap), so on a
          desktop the cover — or, without one, the gate — sits right above the
          card and the title column is exactly the reading column. */}
      <header className="relative isolate overflow-hidden border-b border-hairline bg-surface">
        <ZelligeBackdrop id="cfi-course-backdrop" className="-z-10" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -end-24 -top-24 -z-10 size-[26rem] rounded-pill bg-strait/10 blur-3xl"
        />

        <div
          className={cn(
            'mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center lg:gap-10 lg:py-14',
            hasCover ? null : 'md:grid-cols-[minmax(0,1fr)_13rem] md:items-center',
          )}
        >
          <div className="flex min-w-0 flex-col">
            <nav aria-label={t('breadcrumbLabel')} className="text-sm text-ink-muted">
              <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <li>
                  <Link
                    href="/formations"
                    className="inline-flex min-h-6 items-center underline-offset-4 hover:text-ink hover:underline"
                  >
                    {t('breadcrumbCatalog')}
                  </Link>
                </li>
                {course.category === null ? null : (
                  <>
                    <li aria-hidden="true">
                      <ChevronRight className="size-3.5 rtl:-scale-x-100" />
                    </li>
                    <li>
                      <Link
                        href={`/formations?categorie=${course.category.slug}`}
                        className="inline-flex min-h-6 items-center underline-offset-4 hover:text-ink hover:underline"
                      >
                        {course.category.name}
                      </Link>
                    </li>
                  </>
                )}
                <li aria-hidden="true">
                  <ChevronRight className="size-3.5 rtl:-scale-x-100" />
                </li>
                {/* The h1 right below spells the title out; here it only has
                    to say where you are, on one line. */}
                <li aria-current="page" className="min-w-0 max-w-full truncate text-ink">
                  {course.title}
                </li>
              </ol>
            </nav>

            {course.category === null ? null : (
              <p className="mt-6 inline-flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-strait sm:text-xs sm:tracking-[0.18em] rtl:font-arabic rtl:text-sm rtl:tracking-normal">
                <CategoryIcon className="size-4 shrink-0" aria-hidden="true" />
                {course.category.name}
              </p>
            )}

            <h1
              className={cn(
                'text-[clamp(1.875rem,1.3rem+2.2vw,3rem)] leading-[1.1] font-medium tracking-[-0.015em] text-balance break-words rtl:tracking-normal',
                course.category === null ? 'mt-6' : 'mt-3',
              )}
            >
              {course.title}
            </h1>
            {course.subtitle === null ? null : (
              <p className="mt-4 max-w-[60ch] text-lead text-pretty text-ink-muted">{course.subtitle}</p>
            )}

            <ul
              aria-label={t('meta.label')}
              className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-ink-muted"
            >
              {course.ratingCount === 0 ? null : (
                <li className="flex items-center gap-2">
                  <span data-numeric className="font-medium text-brass">
                    {course.ratingAvg.toFixed(1)}
                  </span>
                  <Rating
                    value={course.ratingAvg}
                    size="sm"
                    label={t('meta.rating', { rating: course.ratingAvg.toFixed(1) })}
                  />
                  <span>({t('meta.ratingCount', { count: course.ratingCount })})</span>
                </li>
              )}

              {course.enrollmentCount === 0 ? null : (
                <li className="flex items-center gap-1.5">
                  <Users className="size-4 shrink-0" aria-hidden="true" />
                  {t('meta.enrolled', { count: course.enrollmentCount })}
                </li>
              )}

              <li className="flex items-center gap-1.5">
                <Clock className="size-4 shrink-0" aria-hidden="true" />
                <span className="sr-only">{t('meta.duration')} : </span>
                {formatDuration(course.durationMinutes, locale)}
              </li>

              <li className="flex items-center gap-1.5">
                <Layers className="size-4 shrink-0" aria-hidden="true" />
                {t('programme.lessonCount', { count: course.lessonCount })}
              </li>

              <li className="flex flex-wrap items-center gap-2">
                <Badge>{t(`level.${course.level}`)}</Badge>
                <Badge variant="outline">{t(`delivery.${course.deliveryMode}`)}</Badge>
              </li>
            </ul>
          </div>

          {course.coverUrl === null ? (
            <CourseGateArt
              categorySlug={course.category?.slug ?? null}
              className="hidden w-full justify-self-center md:block lg:max-w-[19rem]"
            />
          ) : (
            <div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-hairline bg-raised shadow-e3">
              <Image
                src={course.coverUrl}
                alt={course.title}
                fill
                priority
                sizes="(min-width: 1024px) 22rem, (min-width: 640px) 90vw, 100vw"
                className="object-cover"
              />
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="flex min-w-0 flex-col gap-12">
            <PurchaseNotice locale={locale} course={course} cta={cta} />

            {course.objectives.length === 0 ? null : (
              <section
                aria-labelledby="objectives"
                className="rounded-lg border border-hairline bg-surface p-5 sm:p-6"
              >
                <h2 id="objectives" className="text-heading">
                  {t('objectives.title')}
                </h2>
                <ul className="mt-5 grid gap-x-6 gap-y-3 md:grid-cols-2">
                  {course.objectives.map((objective) => (
                    <li key={objective} className="flex items-start gap-3 text-body text-ink-muted">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-pill bg-strait-wash text-strait"
                      >
                        <Check className="size-3.5" strokeWidth={2.5} />
                      </span>
                      <span className="min-w-0 text-pretty break-words">{objective}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="description">
              <h2 id="description" className="text-heading">
                {t('description.title')}
              </h2>
              <div className="mt-4 max-w-[70ch] break-words">
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
              whatsappHref={programmeWhatsappHref}
            />

            {course.requirementsText.length === 0 && course.targetAudience.length === 0 ? null : (
              <div className="grid gap-12 md:grid-cols-2 md:gap-8">
                {course.requirementsText.length === 0 ? null : (
                  <section aria-labelledby="prerequisites">
                    <h2 id="prerequisites" className="text-heading">
                      {t('prerequisites.title')}
                    </h2>
                    <ul className="mt-4 flex list-disc flex-col gap-2 ps-5 text-body text-ink-muted marker:text-strait">
                      {course.requirementsText.map((item) => (
                        <li key={item} className="text-pretty break-words">
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
                    <ul className="mt-4 flex list-disc flex-col gap-2 ps-5 text-body text-ink-muted marker:text-strait">
                      {course.targetAudience.map((item) => (
                        <li key={item} className="text-pretty break-words">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}

            {course.instructor === null ? null : (
              <section aria-labelledby="instructor">
                <h2 id="instructor" className="text-heading">
                  {t('instructor.title')}
                </h2>
                <div className="mt-4 flex items-start gap-4 rounded-lg border border-hairline bg-surface p-5">
                  <span
                    aria-hidden="true"
                    className="grid size-14 shrink-0 place-items-center rounded-pill bg-strait-wash text-strait"
                  >
                    <GraduationCap className="size-6" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-lead font-medium text-ink">
                      {course.instructor.fullName}
                    </p>
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
                <p className="mt-2 text-sm text-pretty text-ink-muted">{t('similar.subtitle')}</p>
                <CoverFallbackStyle />
                <ul className="mt-5 grid gap-3 md:grid-cols-2">
                  {course.similar.map((other) => (
                    <li key={other.slug} className="flex min-w-0">
                      <CourseCard
                        variant="compact"
                        className={cn(
                          'w-full',
                          other.coverUrl === null
                            ? ['cfi-cover-fallback', coverTintFor(course.category?.slug ?? null)]
                            : undefined,
                        )}
                        href={`/formations/${other.slug}`}
                        title={other.title}
                        image={{
                          src: other.coverUrl ?? BLANK_COVER,
                          alt:
                            other.coverUrl === null
                              ? ''
                              : t('media.coverAlt', { title: other.title }),
                        }}
                        level={{
                          value: t(`level.${other.level}`),
                          label: `${t('meta.level')} : ${t(`level.${other.level}`)}`,
                        }}
                        duration={
                          other.durationMinutes > 0
                            ? {
                                value: formatDuration(other.durationMinutes, locale),
                                label: `${t('meta.duration')} : ${formatDuration(other.durationMinutes, locale)}`,
                              }
                            : undefined
                        }
                        priceSlot={
                          <PriceTag
                            centimes={other.priceCentimes}
                            compareAtCentimes={other.comparePriceCentimes}
                            locale={locale}
                            size="sm"
                            freeLabel={t('purchase.free')}
                            compareAtSrLabel={t('purchase.comparePrefix')}
                          />
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <PurchaseCard
            locale={locale}
            course={course}
            cta={cta}
            enrollment={enrollment}
          />
        </div>
      </div>

      {/* Built from the same payload the page renders, so the markup and the
          visible content can never disagree — which is what Google penalises. */}
      <CourseJsonLd locale={locale} course={course} providerName="Centre de Formation Immersive" />
    </article>
  );
}
