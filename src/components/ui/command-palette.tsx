'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command, defaultFilter } from 'cmdk';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useDirection } from '@/hooks/use-direction';
import { OverlayFlag, OverlayMotion } from './modal';

/**
 * CommandPalette — ⌘K / Ctrl-K.
 *
 * This primitive knows nothing about routes, courses or admin actions: it
 * receives a flat, already-translated list of items and calls `action` when one
 * is chosen. Grouping is derived from the items' own `group` string, in the
 * order the groups first appear, so the caller controls the ordering by
 * ordering its array.
 *
 * Search matches the **label, group and hint** — never the opaque `id` — so a
 * French search finds French labels and an Arabic search finds Arabic ones.
 * Add `keywords` for synonyms and transliterations.
 *
 * Keyboard: `⌘K`/`Ctrl-K` toggles, `↑`/`↓` move and **loop**, `Enter` runs the
 * highlighted item, `Esc` closes and restores focus to whatever opened it.
 */

export type CommandPaletteIcon = ComponentType<{ className?: string }>;

export interface CommandPaletteItem {
  /** Stable, unique. Used as the cmdk value and the React key. */
  id: string;
  /** Heading this item is listed under. Already translated. */
  group: string;
  /** Already translated. */
  label: string;
  /** Secondary text at the inline end — a section, a status, a shortcut. */
  hint?: string;
  icon?: CommandPaletteIcon;
  /** Extra search terms: synonyms, transliterations, the other locale. */
  keywords?: readonly string[];
  disabled?: boolean;
  /** Runs after the palette closes. */
  action: () => void;
}

export interface CommandPaletteProps {
  items: readonly CommandPaletteItem[];
  /** Accessible name of the dialog and the list. */
  label: string;
  placeholder: string;
  /** Empty state: what happened. */
  emptyTitle: string;
  /** Empty state: what to do next. */
  emptyDescription?: string;
  closeLabel: string;
  /** Controlled open state. Omit to let the palette own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Turn off the global ⌘K listener when the host page owns the shortcut. */
  disableShortcut?: boolean;
  /** Called on every keystroke — for server-side search. */
  onSearchChange?: (search: string) => void;
  /** Shows a progress row while `items` are being fetched. */
  loading?: boolean;
  /** Accessible name of the loading row. Required when `loading` is used. */
  loadingLabel?: string;
  /** Legend row: shortcut hints, result counts. Supplied by the caller. */
  footer?: ReactNode;
}

function groupItems(
  items: readonly CommandPaletteItem[],
): readonly (readonly [string, readonly CommandPaletteItem[]])[] {
  const groups = new Map<string, CommandPaletteItem[]>();

  for (const item of items) {
    const bucket = groups.get(item.group);
    if (bucket === undefined) groups.set(item.group, [item]);
    else bucket.push(item);
  }

  return [...groups.entries()];
}

/** Score the searchable terms, never the opaque id. */
function filterItems(value: string, search: string, keywords?: string[]): number {
  const haystack = keywords !== undefined && keywords.length > 0 ? keywords.join(' ') : value;
  return defaultFilter(haystack, search);
}

export function CommandPalette({
  items,
  label,
  placeholder,
  emptyTitle,
  emptyDescription,
  closeLabel,
  open: openProp,
  onOpenChange,
  disableShortcut = false,
  onSearchChange,
  loading = false,
  loadingLabel,
  footer,
}: CommandPaletteProps): React.JSX.Element {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputId = useId();

  const controlled = openProp !== undefined;
  const open = controlled ? openProp : uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean): void => {
      if (!controlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  useEffect(() => {
    if (disableShortcut) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'k') return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setOpen(!open);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disableShortcut, open, setOpen]);

  // Held in a ref so the reset effect below depends on `open` alone — an inline
  // `onSearchChange` would otherwise re-fire it on every render.
  const searchCallbackRef = useRef(onSearchChange);
  useEffect(() => {
    searchCallbackRef.current = onSearchChange;
  }, [onSearchChange]);

  // A fresh palette every time: yesterday's query is never what you want.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    setSearch('');
    searchCallbackRef.current?.('');
  }, [open]);

  const handleSearch = useCallback(
    (next: string): void => {
      setSearch(next);
      onSearchChange?.(next);
    },
    [onSearchChange],
  );

  const groups = useMemo(() => groupItems(items), [items]);

  const run = useCallback(
    (item: CommandPaletteItem): void => {
      setOpen(false);
      item.action();
    },
    [setOpen],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <CommandPaletteShell
        label={label}
        placeholder={placeholder}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        closeLabel={closeLabel}
        inputId={inputId}
        search={search}
        onSearch={handleSearch}
        groups={groups}
        onRun={run}
        loading={loading}
        loadingLabel={loadingLabel}
        footer={footer}
      />
    </DialogPrimitive.Root>
  );
}

interface CommandPaletteShellProps {
  label: string;
  placeholder: string;
  emptyTitle: string;
  emptyDescription: string | undefined;
  closeLabel: string;
  inputId: string;
  search: string;
  onSearch: (value: string) => void;
  groups: readonly (readonly [string, readonly CommandPaletteItem[]])[];
  onRun: (item: CommandPaletteItem) => void;
  loading: boolean;
  loadingLabel: string | undefined;
  footer: ReactNode;
}

/** The portalled half: search field, grouped results, empty state, footer. */
function CommandPaletteShell({
  label,
  placeholder,
  emptyTitle,
  emptyDescription,
  closeLabel,
  inputId,
  search,
  onSearch,
  groups,
  onRun,
  loading,
  loadingLabel,
  footer,
}: CommandPaletteShellProps): React.JSX.Element {
  const { dir } = useDirection();

  return (
    <DialogPrimitive.Portal>
      <OverlayFlag />
      <OverlayMotion />
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-40 bg-abyss/70 backdrop-blur-[2px]',
          'data-[state=open]:animate-[cfi-overlay-in_180ms_var(--ease-out-strait)]',
          'data-[state=closed]:animate-[cfi-overlay-out_150ms_var(--ease-out-strait)]',
        )}
      />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center p-3 pt-[8vh] md:p-6 md:pt-[12vh]">
        <DialogPrimitive.Content
          aria-describedby={undefined}
          dir={dir}
          className={cn(
            'pointer-events-auto flex w-full max-w-[min(40rem,calc(100vw_-_1.5rem))] flex-col overflow-hidden outline-none',
            'rounded-lg border border-hairline bg-surface text-ink shadow-e4',
            'data-[state=open]:animate-[cfi-dialog-in_200ms_var(--ease-out-strait)]',
            'data-[state=closed]:animate-[cfi-dialog-out_160ms_var(--ease-out-strait)]',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>

          <Command
            label={label}
            loop
            filter={filterItems}
            className="flex min-h-0 flex-col"
          >
            <div className="hairline-b flex shrink-0 items-center gap-2 ps-4 pe-2">
              <Search className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <label htmlFor={inputId} className="sr-only">
                {label}
              </label>
              <Command.Input
                id={inputId}
                value={search}
                onValueChange={onSearch}
                placeholder={placeholder}
                className="h-14 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
              />
              <DialogPrimitive.Close
                aria-label={closeLabel}
                className={cn(
                  'grid size-11 shrink-0 place-items-center rounded-sm text-ink-muted',
                  'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                  'hover:bg-raised hover:text-ink active:bg-raised',
                )}
              >
                <X className="size-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>

            <Command.List
              className={cn(
                'max-h-[min(26rem,55dvh)] min-h-0 overflow-y-auto overscroll-contain p-2',
                '[scroll-padding-block:0.5rem]',
              )}
            >
              {loading ? (
                <Command.Loading label={loadingLabel}>
                  <div className="flex items-center gap-2 ps-3 pe-3 py-3 text-sm text-ink-muted">
                    <span
                      aria-hidden="true"
                      className="size-3 animate-spin rounded-pill border-2 border-hairline border-t-strait"
                    />
                    {loadingLabel}
                  </div>
                </Command.Loading>
              ) : null}

              <Command.Empty className="flex flex-col gap-1 ps-3 pe-3 py-8 text-center">
                <span className="text-sm font-medium text-ink">{emptyTitle}</span>
                {emptyDescription !== undefined ? (
                  <span className="text-sm text-ink-muted">{emptyDescription}</span>
                ) : null}
              </Command.Empty>

              {groups.map(([heading, groupItemsList]) => (
                <Command.Group
                  key={heading}
                  heading={heading}
                  className={cn(
                    'pb-1',
                    '[&_[cmdk-group-heading]]:ps-3 [&_[cmdk-group-heading]]:pe-3',
                    '[&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5',
                    '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
                    '[&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:uppercase',
                    '[&_[cmdk-group-heading]]:text-ink-muted',
                  )}
                >
                  {groupItemsList.map((item) => {
                    const Icon = item.icon;

                    return (
                      <Command.Item
                        key={item.id}
                        value={item.id}
                        disabled={item.disabled ?? false}
                        keywords={[
                          item.label,
                          item.group,
                          ...(item.hint !== undefined ? [item.hint] : []),
                          ...(item.keywords ?? []),
                        ]}
                        onSelect={() => onRun(item)}
                        className={cn(
                          'flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-sm ps-3 pe-3 py-2',
                          'text-sm text-ink outline-none',
                          'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                          'data-[selected=true]:bg-strait-wash data-[selected=true]:text-ink',
                          'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
                        )}
                      >
                        {Icon !== undefined ? (
                          <Icon className="size-4 shrink-0 text-ink-muted" />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.hint !== undefined ? (
                          <span className="shrink-0 text-xs text-ink-muted">{item.hint}</span>
                        ) : null}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>

          {footer !== undefined && footer !== null ? (
            <div className="hairline-t flex shrink-0 items-center gap-3 ps-4 pe-4 py-2.5 text-xs text-ink-muted">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

/**
 * A keyboard hint for the palette footer or a trigger button. Latin key glyphs
 * stay LTR inside Arabic (§10.3).
 */
export interface CommandPaletteKeyProps {
  children: ReactNode;
  className?: string;
}

export function CommandPaletteKey({
  children,
  className,
}: CommandPaletteKeyProps): React.JSX.Element {
  return (
    <span
      dir="ltr"
      className={cn(
        'force-ltr rounded-sm border border-hairline bg-raised px-1.5 py-0.5 text-xs text-ink-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}
