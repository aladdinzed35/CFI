import { getTranslations } from 'next-intl/server';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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
      className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24"
    >
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-strait">
        {t('sectionLabel')}
      </p>
      <h2 id="home-instructors-title" className="mt-4 max-w-[18ch] text-display">
        {t('title')}
      </h2>
      <p className="mt-5 max-w-[62ch] text-lead text-ink-muted">{t('subtitle')}</p>

      <ul role="list" className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {instructors.map((instructor) => (
          <li
            key={instructor.id}
            className="flex flex-col items-start rounded-lg border border-hairline bg-surface p-6"
          >
            <Avatar
              name={instructor.fullName}
              src={instructor.avatarUrl}
              size="xl"
              // The alt text lives inside Avatar; this is the phrasing §12.4
              // already uses for an instructor portrait.
              className="shrink-0"
            />

            <h3 className="mt-5 text-heading font-medium text-ink">{instructor.fullName}</h3>

            {instructor.headline === null ? null : (
              <p className="mt-2 text-sm text-ink-muted">{instructor.headline}</p>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
              {instructor.specialty === null ? null : (
                <Badge tone="strait" variant="soft">
                  {instructor.specialty}
                </Badge>
              )}
              <Badge tone="neutral" variant="outline">
                {tInstructor('courseCount', { count: instructor.courseCount })}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
