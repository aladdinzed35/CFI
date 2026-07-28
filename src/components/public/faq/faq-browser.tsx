'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MessageCircle, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';

/**
 * The search field that narrows an already-rendered FAQ (§12.5).
 *
 * ## What is a client component here, and what is not
 * Only this wrapper. The groups, the questions and the answers arrive as
 * `children` — server-rendered `<details>` elements — so the full text of every
 * answer is in the HTML document before a single byte of JavaScript runs. That
 * is what a crawler indexes, and it is what a visitor with scripts disabled
 * reads: a native disclosure opens and closes with no script at all, which a
 * Radix accordion cannot do. Ten items also make a round trip absurd, so
 * filtering is a substring test in the browser rather than a query.
 *
 * ## Which is why the filtering touches the DOM directly
 * A client component cannot read the text of server-rendered children, and
 * re-sending those strings as props would ship every answer twice — once as
 * markup, once as JSON. Instead the matcher walks `[data-faq-id]` under its own
 * ref, caches each element's `textContent` on first use, and toggles `hidden`.
 * The text it searches is therefore, by construction, exactly the text on
 * screen; the two cannot drift.
 *
 * ## The field appears only once it works
 * Rendered after mount, never before. A search box that silently does nothing
 * without JavaScript is a dead control, so it is absent in that case and the
 * visitor simply gets the whole list, grouped and readable. The slot keeps its
 * height so the field's arrival costs no layout shift, and the result count is
 * server-rendered with the real total — accurate before hydration, live after.
 *
 * ## Matching
 * Accent- and tashkil-insensitive on both sides, so « certificat » finds
 * « Certificat » and « شهادة » finds « شهادةً ».
 */

/**
 * Combining marks dropped before comparing: Latin accents produced by NFD
 * (U+0300–U+036F), Arabic tashkil plus the hamza and maddah marks NFD splits
 * off (U+064B–U+0655), the dagger alef (U+0670) and the tatweel (U+0640).
 */
const MARKS = /[\u0300-\u036f\u064b-\u0655\u0670\u0640]/g;

/** Fold a string down to what a visitor means when they type it. */
function fold(value: string): string {
  return value.normalize('NFD').replace(MARKS, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface FaqBrowserProps {
  /** Questions rendered in `children` — the count shown before any filtering. */
  readonly total: number;
  /** `https://wa.me/…`, or `null` when the centre has no number configured. */
  readonly whatsappHref: string | null;
  /** The server-rendered rubric nav and groups. */
  readonly children: React.ReactNode;
}

export function FaqBrowser({ total, whatsappHref, children }: FaqBrowserProps): React.JSX.Element {
  const t = useTranslations('pages.faq');
  const tCatalog = useTranslations('catalog');

  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** Folded `textContent` per item. Elements never change identity. */
  const haystacks = useRef(new Map<HTMLElement, string>());

  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(total);

  useEffect(() => {
    setMounted(true);
  }, []);

  const haystackOf = useCallback((element: HTMLElement): string => {
    const cached = haystacks.current.get(element);
    if (cached !== undefined) return cached;

    const folded = fold(element.textContent ?? '');
    haystacks.current.set(element, folded);
    return folded;
  }, []);

  useEffect(() => {
    const root = listRef.current;
    if (root === null) return;

    const term = fold(query);
    const matchedCategories = new Set<string>();
    let matches = 0;

    for (const item of Array.from(root.querySelectorAll<HTMLElement>('[data-faq-id]'))) {
      const hit = term === '' || haystackOf(item).includes(term);
      item.hidden = !hit;
      if (!hit) continue;

      matches += 1;
      const category = item.dataset.faqCategory;
      if (category !== undefined) matchedCategories.add(category);
    }

    // A group heading with nothing under it, and a rubric link pointing at a
    // group that is no longer there, are both noise. They go with their rows.
    for (const group of Array.from(root.querySelectorAll<HTMLElement>('[data-faq-group]'))) {
      const category = group.dataset.faqGroup;
      group.hidden = category === undefined || !matchedCategories.has(category);
    }
    for (const link of Array.from(root.querySelectorAll<HTMLElement>('[data-faq-nav]'))) {
      const category = link.dataset.faqNav;
      link.hidden = category === undefined || !matchedCategories.has(category);
    }

    setVisible(matches);
  }, [query, haystackOf]);

  const clear = (): void => {
    setQuery('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Height is reserved so the arrival of the field costs no layout shift. */}
      <div className="min-h-12">
        {mounted ? (
          <div role="search" aria-label={t('searchLabel')}>
            <label htmlFor={fieldId} className="sr-only">
              {t('searchLabel')}
            </label>
            <Input
              ref={inputRef}
              id={fieldId}
              type="search"
              inputMode="search"
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder={t('searchPlaceholder')}
              // The field carries its own clear control; the WebKit one would
              // sit underneath it and is not a 44 px target.
              className="[&::-webkit-search-cancel-button]:hidden"
              iconStart={<Search className="size-4" aria-hidden="true" />}
              iconEnd={
                query === '' ? (
                  // Holds the gutter open so the text never jumps sideways.
                  <span aria-hidden="true" className="size-11" />
                ) : (
                  <IconButton
                    aria-label={tCatalog('searchClear')}
                    icon={<X aria-hidden="true" />}
                    onClick={clear}
                  />
                )
              }
            />
          </div>
        ) : null}
      </div>

      {/* Correct before hydration (the real total), live after it. */}
      <p role="status" aria-live="polite" className="text-sm text-ink-muted">
        {t('resultCount', { count: visible })}
      </p>

      <div ref={listRef} className="flex flex-col gap-10">
        {children}
      </div>

      {visible === 0 ? (
        <EmptyState
          illustration={<Search aria-hidden="true" />}
          title={t('empty.title')}
          description={t('empty.body')}
          action={
            whatsappHref === null ? undefined : (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-pill border border-hairline px-5 text-sm font-medium text-ink transition-colors duration-[120ms] ease-[var(--ease-out-strait)] hover:border-strait hover:text-strait motion-reduce:transition-none"
              >
                <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
                {t('empty.action')}
              </a>
            )
          }
        />
      ) : null}
    </div>
  );
}
