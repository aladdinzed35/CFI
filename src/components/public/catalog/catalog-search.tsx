'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Search, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { Link, getPathname, useRouter } from '@/i18n/navigation';
import { defaultLocale, isLocale } from '@/i18n/routing';
import {
  CATALOG_PARAM,
  CATALOG_PATH,
  DEFAULT_SORT,
  DEFAULT_VIEW,
  catalogHref,
  type CatalogFilters,
} from '@/server/services/catalog/filters';

/**
 * The catalogue's search field (§12.3).
 *
 * ## It is a real `<form method="get">` first, and enhanced second
 * The catalogue is a crawlable, shareable surface, so searching it cannot
 * depend on JavaScript. The element below is a plain GET form pointed at
 * `/{locale}/formations` whose text field is named `q` — exactly the parameter
 * `parseCatalogFilters` reads. With scripts disabled, pressing « Rechercher »
 * produces `/{locale}/formations?q=…` and the server answers it.
 *
 * That is also why the currently applied facets are re-emitted as hidden
 * inputs: a browser submitting a GET form *replaces* the whole query string, so
 * without them a search would silently discard the four filters the visitor had
 * already chosen. `page` is deliberately not among them — a new search belongs
 * on page 1, which is the same rule `catalogHref` applies.
 *
 * ## With JavaScript, typing narrows as you go
 * A 320 ms debounce turns a pause in typing into `router.replace`, so the grid
 * follows the query without a submit and without filling the history stack with
 * one entry per keystroke. Pressing Enter (or the button) is a `push`, because
 * that is the moment the visitor means "this is my search" and expects the back
 * button to undo it. Both paths go through `catalogHref`, so a typed search and
 * a submitted one produce byte-identical URLs.
 *
 * The field itself is never the source of truth: the URL is. `filters.query`
 * flowing back in from a navigation — the chip's «&nbsp;×&nbsp;», the toolbar's
 * « tout effacer », the back button — resets the input, so the box can never
 * disagree with the results underneath it.
 */

/** Long enough to finish a word, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 320;

/**
 * Mirrors `MAX_QUERY_LENGTH` in `@/server/services/catalog/filters`, which drops
 * a longer term instead of truncating it. Stopping the field at the same length
 * means a visitor never types a query the server will quietly ignore.
 */
const MAX_QUERY_LENGTH = 120;

/**
 * The applied facets, as `[name, value]` pairs a GET form can carry.
 *
 * Built from the same `CATALOG_PARAM` names and the same default-omission rule
 * as `serializeFilters`, so the no-JavaScript URL and the enhanced one are the
 * same URL.
 */
function hiddenFields(filters: CatalogFilters): ReadonlyArray<readonly [string, string]> {
  const fields: Array<readonly [string, string]> = [];

  for (const slug of filters.categories) fields.push([CATALOG_PARAM.category, slug]);
  for (const level of filters.levels) fields.push([CATALOG_PARAM.level, level]);
  for (const delivery of filters.deliveries) fields.push([CATALOG_PARAM.delivery, delivery]);
  for (const language of filters.languages) fields.push([CATALOG_PARAM.language, language]);
  for (const feature of filters.features) fields.push([CATALOG_PARAM.feature, feature]);
  if (filters.price !== null) fields.push([CATALOG_PARAM.price, filters.price]);
  if (filters.duration !== null) fields.push([CATALOG_PARAM.duration, filters.duration]);
  if (filters.rating !== null) fields.push([CATALOG_PARAM.rating, String(filters.rating)]);
  if (filters.sort !== DEFAULT_SORT) fields.push([CATALOG_PARAM.sort, filters.sort]);
  if (filters.view !== DEFAULT_VIEW) fields.push([CATALOG_PARAM.view, filters.view]);

  return fields;
}

export interface CatalogSearchProps {
  /** What the current URL resolves to. The field renders `filters.query`. */
  readonly filters: CatalogFilters;
  readonly className?: string;
}

export function CatalogSearch({ filters, className }: CatalogSearchProps): React.JSX.Element {
  const t = useTranslations('catalog');
  const rawLocale = useLocale();
  const locale = isLocale(rawLocale) ? rawLocale : defaultLocale;
  const router = useRouter();
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();

  /** The term the URL currently carries — what the results on screen reflect. */
  const applied = filters.query ?? '';
  const [value, setValue] = useState(applied);

  /**
   * The last term we either sent to the router or received from it. It is what
   * keeps the debounce from re-firing its own result and the sync below from
   * overwriting a term the visitor is still typing.
   */
  const settled = useRef(applied);

  // The URL changed under us (chip removed, « tout effacer », back button).
  useEffect(() => {
    if (settled.current === applied) return;
    settled.current = applied;
    setValue(applied);
  }, [applied]);

  // Typing settles → narrow the results, replacing rather than stacking history.
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === settled.current) return undefined;

    const timer = window.setTimeout(() => {
      settled.current = trimmed;
      startTransition(() => {
        router.replace(catalogHref(filters, { query: trimmed === '' ? null : trimmed }), {
          scroll: false,
        });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [value, filters, router]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = value.trim();
    settled.current = trimmed;
    startTransition(() => {
      router.push(catalogHref(filters, { query: trimmed === '' ? null : trimmed }), {
        scroll: false,
      });
    });
  };

  /** `/{locale}/formations` — where the form posts when scripts are disabled. */
  const action = getPathname({ href: CATALOG_PATH, locale });
  const withoutQuery = catalogHref(filters, { query: null });

  /**
   * A link, not a button, so it clears the search without JavaScript too. When
   * nothing is applied yet the visitor is only clearing what they have typed,
   * and navigating to a URL we are already on would be a pointless round trip.
   */
  const clear = (event: ReactMouseEvent<HTMLAnchorElement>): void => {
    const nothingApplied = applied === '';
    settled.current = '';
    setValue('');
    if (nothingApplied) event.preventDefault();
    inputRef.current?.focus();
  };

  return (
    <form
      role="search"
      method="get"
      action={action}
      onSubmit={submit}
      aria-label={t('searchLabel')}
      className={cn('flex flex-col gap-3', className)}
    >
      <div
        className={cn(
          'flex items-center gap-2',
          pending && 'opacity-70 transition-opacity duration-[120ms]',
        )}
      >
        <label htmlFor={fieldId} className="sr-only">
          {t('searchLabel')}
        </label>

        <Input
          ref={inputRef}
          id={fieldId}
          name={CATALOG_PARAM.query}
          type="search"
          inputMode="search"
          autoComplete="off"
          maxLength={MAX_QUERY_LENGTH}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          placeholder={t('searchPlaceholder')}
          containerClassName="min-w-0 flex-1"
          // The field carries its own clear control; the WebKit one would sit
          // underneath it and is not a 44 px target.
          className="[&::-webkit-search-cancel-button]:hidden"
          iconStart={<Search className="size-4" aria-hidden="true" />}
          iconEnd={
            // Always occupies the gutter, so the text does not jump sideways the
            // moment the clear control appears.
            value === '' ? (
              <span aria-hidden="true" className="size-11" />
            ) : (
              <Link
                href={withoutQuery}
                onClick={clear}
                aria-label={t('searchClear')}
                className="grid size-11 place-items-center rounded-sm text-ink-muted transition-colors duration-[120ms] hover:bg-raised hover:text-ink"
              >
                <X className="size-4" aria-hidden="true" />
              </Link>
            )
          }
        />

        <Button type="submit" variant="secondary" className="shrink-0">
          {t('searchSubmit')}
        </Button>
      </div>

      {/* Everything the visitor already narrowed by, so a no-JavaScript submit
          keeps it instead of resetting the catalogue. */}
      {hiddenFields(filters).map(([name, fieldValue]) => (
        <input key={`${name}:${fieldValue}`} type="hidden" name={name} value={fieldValue} />
      ))}

      {filters.query === null ? null : (
        <p className="flex flex-wrap items-center gap-2">
          <Link
            href={withoutQuery}
            onClick={clear}
            className="inline-flex h-11 items-center gap-1.5 rounded-pill border border-hairline bg-raised ps-4 pe-3 text-sm text-ink transition-colors duration-[120ms] hover:border-strait"
          >
            <span className="max-w-[16rem] truncate">
              {t('activeQuery', { query: filters.query })}
            </span>
            <span className="sr-only">{t('searchClear')}</span>
            <X className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          </Link>
        </p>
      )}
    </form>
  );
}
