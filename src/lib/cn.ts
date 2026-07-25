import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type { ClassValue };

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
