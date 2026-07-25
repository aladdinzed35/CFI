'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { User } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Avatar — student, instructor and admin identity.
 *
 * Radix handles the one thing that is genuinely hard here: rendering the
 * fallback only after the image has actually failed, instead of flashing
 * initials on every mount.
 *
 * `name` is the accessible name (it becomes the image `alt` and the
 * screen-reader text of the fallback). Initials are derived from it unless the
 * caller passes better ones — `initialsFrom` is Unicode-aware, so Arabic and
 * accented Latin names produce the right glyphs.
 */

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizeClasses: Record<AvatarSize, string> = {
  xs: 'size-6 text-[0.625rem]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-body',
  xl: 'size-20 text-lead',
};

const iconSizeClasses: Record<AvatarSize, string> = {
  xs: 'size-3.5',
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
  xl: 'size-8',
};

/** First letter of the first word + first letter of the last word, upper-cased. */
export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (first === undefined) return '';

  const firstChar = Array.from(first)[0] ?? '';
  if (parts.length === 1) return firstChar.toLocaleUpperCase();

  const last = parts[parts.length - 1] ?? '';
  const lastChar = Array.from(last)[0] ?? '';
  return `${firstChar}${lastChar}`.toLocaleUpperCase();
}

export interface AvatarProps {
  /** Accessible name — image alt text and fallback screen-reader text. */
  name: string;
  src?: string | null;
  /** Overrides the initials derived from `name`. */
  initials?: string;
  size?: AvatarSize;
  shape?: 'circle' | 'square';
  /** Hairline ring — used to lift an avatar off a photo or a coloured band. */
  ring?: boolean;
  className?: string;
}

export function Avatar({
  name,
  src,
  initials,
  size = 'md',
  shape = 'circle',
  ring = false,
  className,
}: AvatarProps): React.JSX.Element {
  const text = initials ?? initialsFrom(name);

  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden bg-raised align-middle select-none',
        shape === 'circle' ? 'rounded-pill' : 'rounded-sm',
        ring && 'ring-1 ring-hairline',
        sizeClasses[size],
        className,
      )}
    >
      {src ? (
        <AvatarPrimitive.Image
          src={src}
          alt={name}
          className="size-full object-cover"
          draggable={false}
        />
      ) : null}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className="grid size-full place-items-center bg-raised font-medium text-ink-muted"
      >
        <span className="sr-only">{name}</span>
        {text === '' ? (
          <User className={iconSizeClasses[size]} aria-hidden="true" />
        ) : (
          <span aria-hidden="true">{text}</span>
        )}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
