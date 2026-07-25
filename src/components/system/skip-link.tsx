import { cn } from '@/lib/cn';

/**
 * Skip-to-content link (§21, WCAG 2.2 AA "Bypass Blocks").
 *
 * Invisible until it receives keyboard focus, then it becomes a real, visible
 * control pinned to the inline-start corner — so it lands correctly in Arabic
 * without any mirroring logic. It must be the first focusable element in
 * <body>, and `href` must match the id on the page's <main>.
 */

export interface SkipLinkProps {
  /** Translated label, e.g. « Aller au contenu principal ». */
  label: string;
  /** Fragment target. Defaults to the shell's <main id="contenu">. */
  href?: string;
  className?: string;
}

export function SkipLink({ label, href = '#contenu', className }: SkipLinkProps): React.JSX.Element {
  return (
    <a
      href={href}
      className={cn(
        'sr-only-focusable absolute top-3 start-3 z-50 inline-flex h-11 items-center rounded-md border border-hairline bg-raised px-4 text-sm font-medium text-ink shadow-e3',
        className,
      )}
    >
      {label}
    </a>
  );
}
