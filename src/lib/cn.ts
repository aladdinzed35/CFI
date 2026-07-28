import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

export type { ClassValue };

/**
 * The design system's own type scale (§11.1).
 *
 * These are FONT-SIZE utilities, not colours. tailwind-merge cannot know that:
 * out of the box it reads any unknown `text-*` as a text colour, so
 * `cn('text-on-accent', 'text-lead')` decided the two conflicted and dropped
 * `text-on-accent`.
 *
 * That shipped. Every `size="lg"` button carries `text-lead`, which silently
 * removed the `text-on-accent` from its own variant, leaving light ink on the
 * bright teal fill — 1.42:1 measured on the contact page's WhatsApp button,
 * against a 4.5:1 requirement. Nothing failed: the class was simply absent, so
 * the text inherited `--color-ink` and looked plausible in a screenshot.
 *
 * Registering them as font-size tells tailwind-merge they conflict with each
 * other and with `text-sm`/`text-xs`, and never with a colour.
 */
const TYPE_SCALE = ['hero', 'display', 'title', 'heading', 'lead', 'body'] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': TYPE_SCALE.map((step) => `text-${step}`),
    },
  },
});

/**
 * Merge Tailwind class names.
 *
 * `clsx` resolves the conditional syntax (strings, arrays, objects, falsy values)
 * and `tailwind-merge` then removes conflicting utilities so that the LAST class
 * wins — `cn('p-2', 'p-4')` returns `'p-4'`, not `'p-2 p-4'`.
 *
 * This is the only sanctioned way to compose class names in the codebase: it lets
 * a caller override a component's default utilities through a `className` prop
 * without fighting CSS specificity.
 *
 * @example
 * cn('inline-flex items-center', isActive && 'bg-strait text-on-accent', className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
