import { getTranslations } from 'next-intl/server';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import type { HomeInstructor } from '@/server/services/home';

/**
 * §12.2 §8 — « Nos formateurs ».
 *
 * Photo, name, headline, specialty, number of courses. Every field is a real
 * column on `User`, and the specialty is the category of the instructor's most
 * enrolled published course — a fact, not an editorial guess.
 *
 * ## Why the cards do not link anywhere
 *
 * §12.5 does not define an instructor profile route, and the `home.instructors`
 * namespace ships a « Voir le profil » string ahead of the page it belongs to.
 * A card that navigates nowhere is a dead button, which §9 of the working rules
 * forbids outright, so the cards are presentational until that route exists. The
 * moment it does, the name becomes the link and nothing else here changes.
 *
 * The section removes itself when the catalogue has no published course with an
 * instructor attached: an « Équipe pédagogique » heading over an empty row is a
 * worse signal than no section at all.
 */

/*
  Plain sections that follow one another would stack their paddings into a
  190 px hole. When the next section is also plain, this one keeps less below
  it; when the previous one is plain, a hairline at the content edge replaces
  the top padding. Same classes in proofs, centre and faq.
*/
const PLAIN_BAND =
  '[&:has(+[data-home-band=plain])]:pb-12 sm:[&:has(+[data-home-band=plain])]:pb-16 [[data-home-band=plain]+&]:pt-0 [[data-home-band=plain]+&]:before:mb-12 [[data-home-band=plain]+&]:before:block [[data-home-band=plain]+&]:before:h-px [[data-home-band=plain]+&]:before:bg-hairline sm:[[data-home-band=plain]+&]:before:mb-16';

/**
 * Only the columns the team fills — three people never sit in a four-column
 * row with a hole at the end. An odd last card on the two-column tablet row
 * spans it rather than standing alone at the inline start.
 */
const GRID_COLUMNS: Record<number, string> = {
  1: 'sm:max-w-md',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3 sm:[&>li:last-child]:col-span-2 lg:[&>li:last-child]:col-span-1',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
};

export interface HomeInstructorsProps {
  instructors: readonly HomeInstructor[];
}

export async function HomeInstructors({
  instructors,
}: HomeInstructorsProps): Promise<React.JSX.Element | null> {
  if (instructors.length === 0) return null;

  const t = await getTranslations('home.instructors');
  const tInstructor = await getTranslations('course.instructor');

  return (
    <section
      aria-labelledby="home-instructors-title"
      data-home-band="plain"
      className={cn('mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24', PLAIN_BAND)}
    >
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait rtl:font-arabic rtl:text-sm rtl:tracking-normal">
        {t('sectionLabel')}
      </p>
      <h2 id="home-instructors-title" className="mt-4 max-w-[18ch] text-display text-balance">
        {t('title')}
      </h2>
      <p className="mt-5 max-w-[62ch] text-lead text-pretty text-ink-muted">{t('subtitle')}</p>

      <ul
        role="list"
        className={cn(
          'mt-10 grid gap-4 sm:mt-12 sm:gap-6',
          GRID_COLUMNS[Math.min(instructors.length, 4)] ?? GRID_COLUMNS[4],
        )}
      >
        {instructors.map((instructor) => (
          /*
            A container, so each card picks its layout from its OWN width: a
            phone-wide or tablet-wide card puts the portrait beside the name
            (four stacked portrait cards were two full screens on a phone),
            the narrow quarter-row card on a desktop stacks it on top.
          */
          <li key={instructor.id} className="@container">
            <div className="flex h-full flex-col items-start gap-5 rounded-lg border border-hairline bg-surface p-5 sm:p-6 @xs:flex-row">
              <Avatar
                name={instructor.fullName}
                src={instructor.avatarUrl}
                size="xl"
                // The alt text lives inside Avatar; this is the phrasing §12.4
                // already uses for an instructor portrait.
                className="shrink-0 @xs:size-16"
              />

              <div className="flex min-w-0 flex-1 flex-col self-stretch">
                <h3 className="text-heading font-medium text-balance text-ink">{instructor.fullName}</h3>

                {instructor.headline === null ? null : (
                  <p className="mt-2 text-sm text-pretty text-ink-muted">{instructor.headline}</p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                  {instructor.specialty === null ? null : (
                    <Badge tone="strait" variant="soft">
                      {instructor.specialty}
                    </Badge>
                  )}
                  <Badge tone="neutral" variant="outline">
                    {tInstructor('courseCount', { count: instructor.courseCount })}
                  </Badge>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
