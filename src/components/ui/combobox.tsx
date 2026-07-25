'use client';

import { useCallback, useId, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useDirection } from '@/hooks/use-direction';

/**
 * `Combobox` (§11.3) — a searchable single-select built on `cmdk` inside a
 * Radix popover.
 *
 * Accessibility notes worth keeping:
 * - the visible `<label>` is a real `<label htmlFor>` bound to the trigger
 *   (`<button>` is a labelable element), so clicking the label focuses the
 *   control and screen readers announce it;
 * - the trigger is *not* given `role="combobox"`. `cmdk`'s own input already
 *   carries `role="combobox"`, `aria-autocomplete="list"`, `aria-controls` and
 *   `aria-activedescendant`, and duplicating the role on the trigger produces
 *   two combobox announcements for one control. Radix supplies
 *   `aria-haspopup="dialog"` / `aria-expanded` on the trigger, which is the
 *   honest description of what it opens;
 * - errors are wired through `aria-describedby` **and** announced: the message
 *   carries `role="alert"`;
 * - clearing is a keyboard-reachable option at the top of the list rather than
 *   a button nested inside the trigger — a button inside a button is invalid
 *   HTML and unreachable by keyboard in several browsers.
 *
 * Filtering is local by default. Pass `onSearchChange` to take it over
 * server-side; `cmdk`'s own filter is then switched off so the list shows
 * exactly what the server returned.
 */

export interface ComboboxOption {
  value: string;
  label: string;
  /** Second line in the list — a hint, not part of the accessible name. */
  description?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** Visible field label, e.g. « Catégorie ». */
  label: string;
  /** Trigger text while nothing is selected, e.g. « Toutes les catégories ». */
  placeholder: string;
  /** Search field placeholder, e.g. « Rechercher… ». */
  searchPlaceholder: string;
  /** Shown when nothing matches, e.g. « Aucun résultat. ». */
  emptyText: string;
  /** Enables the clear option, e.g. « Effacer la sélection ». */
  clearLabel?: string;
  /** Renders the label for screen readers only. */
  labelHidden?: boolean;
  /** Helper text under the field. */
  description?: string;
  /** Error message. Sets `aria-invalid` and is announced. */
  error?: string;
  disabled?: boolean;
  /** Emits the query instead of filtering locally. */
  onSearchChange?: (query: string) => void;
  loading?: boolean;
  /** Shown while `loading`, e.g. « Recherche en cours… ». */
  loadingText?: string;
  /** Renders a hidden input so the value reaches a plain `<form>` submission. */
  name?: string;
  className?: string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  label,
  placeholder,
  searchPlaceholder,
  emptyText,
  clearLabel,
  labelHidden = false,
  description,
  error,
  disabled = false,
  onSearchChange,
  loading = false,
  loadingText,
  name,
  className,
}: ComboboxProps): React.JSX.Element {
  const uid = useId();
  const triggerId = `${uid}-trigger`;
  const descriptionId = `${uid}-description`;
  const errorId = `${uid}-error`;
  const { isRtl } = useDirection();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((option) => option.value === value) ?? null;
  const invalid = error !== undefined && error.length > 0;

  const describedBy =
    [description === undefined ? null : descriptionId, invalid ? errorId : null]
      .filter((id): id is string => id !== null)
      .join(' ') || undefined;

  const handleQuery = useCallback(
    (next: string): void => {
      setQuery(next);
      onSearchChange?.(next);
    },
    [onSearchChange],
  );

  const choose = useCallback(
    (next: string | null): void => {
      onValueChange(next);
      setOpen(false);
    },
    [onValueChange],
  );

  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      <label
        htmlFor={triggerId}
        className={cn(
          'text-sm font-medium text-ink',
          labelHidden ? 'sr-only' : null,
          disabled ? 'opacity-60' : null,
        )}
      >
        {label}
      </label>

      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          id={triggerId}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            'flex h-11 w-full items-center justify-between gap-2 rounded-md border bg-surface px-3 text-start text-sm',
            'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
            invalid ? 'border-danger' : 'border-hairline hover:border-strait',
            selected === null ? 'text-ink-muted' : 'text-ink',
            'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-hairline',
            'data-[state=open]:border-strait',
          )}
        >
          <span className="truncate">{selected === null ? placeholder : selected.label}</span>
          {/* A vertical chevron pair carries no inline direction: not mirrored. */}
          <ChevronsUpDown className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            align={isRtl ? 'end' : 'start'}
            sideOffset={6}
            collisionPadding={12}
            dir={isRtl ? 'rtl' : 'ltr'}
            className={cn(
              'z-50 w-[var(--radix-popover-trigger-width)] min-w-[12rem] overflow-hidden',
              'rounded-md border border-hairline bg-raised shadow-e3',
            )}
          >
            <Command
              label={label}
              shouldFilter={onSearchChange === undefined}
              className="flex max-h-[min(20rem,var(--radix-popover-content-available-height))] flex-col"
            >
              <div className="flex items-center gap-2 px-3 hairline-b">
                <Command.Input
                  value={query}
                  onValueChange={handleQuery}
                  placeholder={searchPlaceholder}
                  className="h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
                />
                {loading ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-ink-muted" aria-hidden="true" />
                ) : null}
              </div>

              <Command.List className="overflow-y-auto overscroll-contain p-1">
                {loading && loadingText !== undefined ? (
                  <Command.Loading>
                    <p className="px-3 py-3 text-sm text-ink-muted">{loadingText}</p>
                  </Command.Loading>
                ) : null}

                <Command.Empty>
                  <p className="px-3 py-6 text-center text-sm text-ink-muted">{emptyText}</p>
                </Command.Empty>

                {clearLabel !== undefined && value !== null ? (
                  <Command.Item
                    value="__clear__"
                    keywords={[clearLabel]}
                    onSelect={() => choose(null)}
                    className={cn(
                      'flex h-11 cursor-pointer select-none items-center gap-2 rounded-sm px-3 text-sm text-ink-muted',
                      'data-[selected=true]:bg-strait-wash data-[selected=true]:text-ink',
                    )}
                  >
                    <X className="size-4 shrink-0" aria-hidden="true" />
                    <span>{clearLabel}</span>
                  </Command.Item>
                ) : null}

                {options.map((option) => {
                  const isSelected = option.value === value;
                  const keywords =
                    option.description === undefined
                      ? [option.label]
                      : [option.label, option.description];

                  return (
                    <Command.Item
                      key={option.value}
                      value={option.value}
                      keywords={keywords}
                      disabled={option.disabled}
                      // `cmdk` normalises the value it passes back, so the
                      // option is captured here rather than read from the arg.
                      onSelect={() => choose(option.value)}
                      className={cn(
                        'flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-sm px-3 py-2 text-sm',
                        'text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                        'data-[selected=true]:bg-strait-wash data-[selected=true]:text-ink',
                        'data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-40',
                        isSelected ? 'text-ink' : null,
                      )}
                    >
                      {/* A checkmark is never mirrored (§10.3). */}
                      <Check
                        className={cn(
                          'size-4 shrink-0 text-strait',
                          isSelected ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden="true"
                      />
                      <span className="flex min-w-0 flex-col text-start">
                        <span className="truncate">{option.label}</span>
                        {option.description === undefined ? null : (
                          <span className="truncate text-xs text-ink-muted">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </Command.Item>
                  );
                })}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {description === undefined ? null : (
        <p id={descriptionId} className="text-xs text-ink-muted">
          {description}
        </p>
      )}

      {invalid ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      {name === undefined ? null : <input type="hidden" name={name} value={value ?? ''} />}
    </div>
  );
}
