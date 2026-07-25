'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import * as Popover from '@radix-ui/react-popover';
import {
  addDays,
  addMonths,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  type Locale as DateFnsLocale,
} from 'date-fns';
import { arMA, enGB, es, fr } from 'date-fns/locale';
import { fromZonedTime } from 'date-fns-tz';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { CASABLANCA_TZ, formatDate, toCasablanca, type DateInput } from '@/lib/dates';
import { defaultLocale, isLocale, type Locale } from '@/i18n/routing';
import { useDirection } from '@/hooks/use-direction';

/**
 * `DatePicker` (§11.3) — locale-aware and direction-correct.
 *
 * ## Two kinds of date
 * A calendar cell is a *calendar date*; a stored value is an *instant*. Mixing
 * them is how a transfer declared on the 12th shows up as the 11th on the
 * receipt. So: the grid is built from plain local `Date`s used only for
 * arithmetic, and every cell also carries the instant at which that day begins
 * in `Africa/Casablanca` — which is the value emitted and the value formatted
 * through `@/lib/dates`, exactly like every other date in the app.
 *
 * ## Week start
 * Taken from the `date-fns` locale rather than hardcoded: Monday for `fr`,
 * `es` and `en-GB`, Saturday for `ar-MA` — which is what Morocco actually uses,
 * and the reason this is not a constant.
 *
 * ## Direction
 * The grid is a CSS grid, so in Arabic its seven columns flow right-to-left on
 * their own — the calendar mirrors without a single physical property. Digits
 * stay LTR inside it (§10.3). The arrow keys are direction-aware: `ArrowRight`
 * moves to the *previous* day in Arabic, because that is where the previous day
 * is on screen.
 *
 * Fully keyboard operable: arrows by day, ↑/↓ by week, Home/End to the week
 * bounds, PageUp/PageDown by month, Enter/Space to select, Escape to close.
 */

const DATE_FNS_LOCALES: Record<Locale, DateFnsLocale> = { fr, ar: arMA, en: enGB, es };

export interface DatePickerProps {
  /** Stored instant, or `null`. */
  value: DateInput | null;
  /** Emits the instant at which the chosen Casablanca day begins. */
  onValueChange: (value: Date | null) => void;
  /** Visible field label, e.g. « Date du virement ». */
  label: string;
  /** Trigger text while empty, e.g. « Choisir une date ». */
  placeholder: string;
  /** Accessible name of the previous-month button, e.g. « Mois précédent ». */
  previousMonthLabel: string;
  /** Accessible name of the next-month button, e.g. « Mois suivant ». */
  nextMonthLabel: string;
  /** Enables the clear button, e.g. « Effacer la date ». */
  clearLabel?: string;
  /** Renders the label for screen readers only. */
  labelHidden?: boolean;
  description?: string;
  /** Error message. Sets `aria-invalid` and is announced. */
  error?: string;
  disabled?: boolean;
  /** Earliest selectable day (inclusive). */
  min?: DateInput;
  /** Latest selectable day (inclusive). */
  max?: DateInput;
  /** Renders a hidden `yyyy-MM-dd` input for plain `<form>` submission. */
  name?: string;
  className?: string;
}

interface DayCell {
  /** Local `Date`, for arithmetic and rendering only. */
  date: Date;
  /** `yyyy-MM-dd`, the stable key and the hidden input's value. */
  key: string;
  /** Instant at which this Casablanca day begins — the emitted value. */
  instant: Date;
  inMonth: boolean;
  disabled: boolean;
}

function toKey(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The Casablanca wall-clock day of a stored instant, as a local `Date`. */
function toCalendarDate(input: DateInput | null | undefined): Date | null {
  const zoned = toCasablanca(input);
  if (zoned === null) return null;
  return new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate());
}

export function DatePicker({
  value,
  onValueChange,
  label,
  placeholder,
  previousMonthLabel,
  nextMonthLabel,
  clearLabel,
  labelHidden = false,
  description,
  error,
  disabled = false,
  min,
  max,
  name,
  className,
}: DatePickerProps): React.JSX.Element {
  const uid = useId();
  const triggerId = `${uid}-trigger`;
  const captionId = `${uid}-caption`;
  const descriptionId = `${uid}-description`;
  const errorId = `${uid}-error`;

  const rawLocale = useLocale();
  const locale: Locale = isLocale(rawLocale) ? rawLocale : defaultLocale;
  const dateFnsLocale = DATE_FNS_LOCALES[locale];
  const { sign, isRtl } = useDirection();

  const selected = useMemo(() => toCalendarDate(value), [value]);
  const minDate = useMemo(() => toCalendarDate(min ?? null), [min]);
  const maxDate = useMemo(() => toCalendarDate(max ?? null), [max]);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(() => startOfMonth(selected ?? new Date()));
  const [focusKey, setFocusKey] = useState<string>(() => toKey(selected ?? new Date()));

  const gridRef = useRef<HTMLTableElement>(null);
  const moveFocusToDay = useRef(false);

  // Re-open on the month that holds the current value.
  useEffect(() => {
    if (!open) return;
    const anchor = selected ?? new Date();
    setView(startOfMonth(anchor));
    setFocusKey(toKey(anchor));
  }, [open, selected]);

  const weeks = useMemo<DayCell[][]>(() => {
    const first = startOfWeek(startOfMonth(view), { locale: dateFnsLocale });
    const built: DayCell[][] = [];

    for (let week = 0; week < 6; week += 1) {
      const row: DayCell[] = [];
      for (let day = 0; day < 7; day += 1) {
        const date = addDays(first, week * 7 + day);
        const key = toKey(date);
        row.push({
          date,
          key,
          instant: fromZonedTime(`${key}T00:00:00`, CASABLANCA_TZ),
          inMonth: date.getMonth() === view.getMonth() && date.getFullYear() === view.getFullYear(),
          disabled:
            (minDate !== null && date.getTime() < minDate.getTime()) ||
            (maxDate !== null && date.getTime() > maxDate.getTime()),
        });
      }
      built.push(row);
    }

    return built;
  }, [dateFnsLocale, maxDate, minDate, view]);

  const weekdays = useMemo(() => {
    const first = startOfWeek(startOfMonth(view), { locale: dateFnsLocale });
    return Array.from({ length: 7 }, (_unused, index) => {
      const day = addDays(first, index);
      return {
        short: format(day, 'EEEEEE', { locale: dateFnsLocale }),
        long: format(day, 'EEEE', { locale: dateFnsLocale }),
      };
    });
  }, [dateFnsLocale, view]);

  // Keep the roving tabstop inside the rendered grid.
  useEffect(() => {
    const inGrid = weeks.some((row) => row.some((cell) => cell.key === focusKey));
    if (inGrid) return;
    const firstOfMonth = startOfMonth(view);
    setFocusKey(toKey(firstOfMonth));
  }, [focusKey, view, weeks]);

  useEffect(() => {
    if (!open || !moveFocusToDay.current) return;
    moveFocusToDay.current = false;
    const target = gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusKey}"]`);
    target?.focus();
  }, [focusKey, open, weeks]);

  const focusDate = useCallback(
    (next: Date): void => {
      moveFocusToDay.current = true;
      setFocusKey(toKey(next));
      if (next.getMonth() !== view.getMonth() || next.getFullYear() !== view.getFullYear()) {
        setView(startOfMonth(next));
      }
    },
    [view],
  );

  const currentFocusDate = useCallback((): Date => {
    for (const row of weeks) {
      for (const cell of row) {
        if (cell.key === focusKey) return cell.date;
      }
    }
    return startOfMonth(view);
  }, [focusKey, view, weeks]);

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTableElement>): void => {
      const from = currentFocusDate();
      let next: Date | null = null;

      switch (event.key) {
        case 'ArrowRight':
          // On screen, "right" is the next day in LTR and the previous in RTL.
          next = addDays(from, sign);
          break;
        case 'ArrowLeft':
          next = addDays(from, -sign);
          break;
        case 'ArrowDown':
          next = addDays(from, 7);
          break;
        case 'ArrowUp':
          next = addDays(from, -7);
          break;
        case 'Home':
          next = startOfWeek(from, { locale: dateFnsLocale });
          break;
        case 'End':
          next = endOfWeek(from, { locale: dateFnsLocale });
          break;
        case 'PageUp':
          next = addMonths(from, -1);
          break;
        case 'PageDown':
          next = addMonths(from, 1);
          break;
        default:
          return;
      }

      event.preventDefault();
      focusDate(next);
    },
    [currentFocusDate, dateFnsLocale, focusDate, sign],
  );

  const select = useCallback(
    (cell: DayCell): void => {
      onValueChange(cell.instant);
      setOpen(false);
    },
    [onValueChange],
  );

  const invalid = error !== undefined && error.length > 0;
  const describedBy =
    [description === undefined ? null : descriptionId, invalid ? errorId : null]
      .filter((id): id is string => id !== null)
      .join(' ') || undefined;

  const monthLabel = format(view, 'LLLL yyyy', { locale: dateFnsLocale });
  const selectedKey = selected === null ? null : toKey(selected);
  const todayKey = toKey(new Date());

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
        <div className="flex items-center gap-2">
          <Popover.Trigger
            id={triggerId}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(
              'flex h-11 w-full items-center gap-2 rounded-md border bg-surface px-3 text-start text-sm',
              'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
              invalid ? 'border-danger' : 'border-hairline hover:border-strait',
              value === null ? 'text-ink-muted' : 'text-ink',
              'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-hairline',
              'data-[state=open]:border-strait',
            )}
          >
            {/* A calendar glyph carries no direction: never mirrored. */}
            <CalendarDays className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span className="truncate">
              {value === null ? placeholder : formatDate(value, locale)}
            </span>
          </Popover.Trigger>

          {clearLabel !== undefined && value !== null && !disabled ? (
            <button
              type="button"
              onClick={() => onValueChange(null)}
              aria-label={clearLabel}
              className={cn(
                'inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface',
                'text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                'hover:bg-raised hover:text-ink',
              )}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <Popover.Portal>
          <Popover.Content
            align={isRtl ? 'end' : 'start'}
            sideOffset={6}
            collisionPadding={12}
            dir={isRtl ? 'rtl' : 'ltr'}
            className="z-50 rounded-md border border-hairline bg-raised p-3 shadow-e3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setView((current) => addMonths(current, -1))}
                aria-label={previousMonthLabel}
                className={cn(
                  'inline-flex size-11 items-center justify-center rounded-md',
                  'text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                  'hover:bg-surface hover:text-ink',
                )}
              >
                {/* Chevrons carry direction: mirrored in RTL (§10.3). */}
                <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
              </button>

              <p
                id={captionId}
                aria-live="polite"
                className="text-sm font-medium capitalize text-ink"
              >
                {monthLabel}
              </p>

              <button
                type="button"
                onClick={() => setView((current) => addMonths(current, 1))}
                aria-label={nextMonthLabel}
                className={cn(
                  'inline-flex size-11 items-center justify-center rounded-md',
                  'text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                  'hover:bg-surface hover:text-ink',
                )}
              >
                <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
              </button>
            </div>

            {/* A real table, not a CSS grid with `display: contents`: rows and
                cells then carry `row` / `gridcell` natively, and the seven
                columns already flow right-to-left in Arabic — which is the
                whole mirroring requirement, geometry untouched. */}
            <table
              ref={gridRef}
              role="grid"
              aria-labelledby={captionId}
              onKeyDown={handleGridKeyDown}
              className="border-collapse"
            >
              <thead>
                <tr>
                  {weekdays.map((weekday) => (
                    <th key={weekday.long} scope="col" abbr={weekday.long} className="pb-1">
                      <span aria-hidden="true" className="text-xs font-medium text-ink-muted">
                        {weekday.short}
                      </span>
                      <span className="sr-only">{weekday.long}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((row) => {
                  const firstCell = row[0];
                  return (
                    <tr key={firstCell === undefined ? 'row' : firstCell.key}>
                      {row.map((cell) => {
                        const isSelected = cell.key === selectedKey;
                        const isToday = cell.key === todayKey;

                        return (
                          <td key={cell.key} aria-selected={isSelected} className="p-0">
                            <button
                              type="button"
                              data-day={cell.key}
                              tabIndex={cell.key === focusKey ? 0 : -1}
                              disabled={cell.disabled}
                              aria-label={formatDate(cell.instant, locale)}
                              aria-current={isToday ? 'date' : undefined}
                              onClick={() => select(cell)}
                              className={cn(
                                'flex size-11 items-center justify-center rounded-sm text-sm',
                                'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                                cell.inMonth ? 'text-ink' : 'text-ink-muted opacity-50',
                                isSelected
                                  ? 'bg-strait font-semibold text-on-accent'
                                  : 'hover:bg-surface',
                                // Today is marked by an outline as well as a
                                // colour — never colour alone (§21).
                                isToday && !isSelected ? 'ring-1 ring-strait ring-inset' : null,
                                'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent',
                              )}
                            >
                              <span aria-hidden="true" data-numeric>
                                <span className="force-ltr" dir="ltr">
                                  {cell.date.getDate()}
                                </span>
                              </span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

      {name === undefined ? null : (
        <input type="hidden" name={name} value={selectedKey ?? ''} />
      )}
    </div>
  );
}
