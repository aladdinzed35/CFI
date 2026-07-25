'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useReducedMotionSafe } from '@/hooks/use-reduced-motion-safe';

/**
 * Floating WhatsApp button (§12.1) — required on every public page.
 *
 * Behaviour, exactly as specified:
 * - fixed at the inline-end bottom corner, above the safe-area inset, 56 px;
 * - appears after 400 px of scroll **or** 4 s, whichever comes first, with a
 *   spring entrance;
 * - a subtle double pulse ring that runs three times and then stops — never a
 *   loop (§11.2 bans infinite animation);
 * - on first appearance only, a small dismissible bubble;
 * - opens `wa.me` in a new tab and calls `onOpen` so the page can log the
 *   `ContactMessage` with `source: WHATSAPP_CLICK` — the button never talks to
 *   the database itself;
 * - hides itself while a modal or bottom sheet is open, by observing the
 *   `data-overlay-open` attribute those components set on `<body>`.
 *
 * ## The one documented raw-hex exception
 * `#25D366` is WhatsApp's brand colour. Recolouring it to `--color-strait`
 * would destroy the instant recognition that makes the button work, and it is
 * not part of the CFI palette, so it cannot live in `globals.css` as a design
 * token. It is therefore declared as a component-local custom property — the
 * value is still written once, in one place, and read through `var()` from the
 * class list, so the "no raw hex inside a utility class" rule still holds.
 * The white glyph is part of the same brand lockup and follows it.
 */

export interface WhatsAppBubble {
  /** e.g. « Une question ? Écrivez-nous ». */
  text: string;
  /** Accessible name of the bubble's close button, e.g. « Fermer ». */
  dismissLabel: string;
}

export interface WhatsAppFabProps {
  /** Destination number in any format; non-digits are stripped for `wa.me`. */
  phone: string;
  /** Context-aware prefilled message, already translated and interpolated. */
  message: string;
  /** Accessible name of the button, e.g. « Nous écrire sur WhatsApp ». */
  label: string;
  /** First-appearance bubble. Omit it to ship the button alone. */
  bubble?: WhatsAppBubble;
  /** Fired on open, so the caller can log the contact and the analytics event. */
  onOpen?: () => void;
  className?: string;
}

/** Scroll distance after which the button appears, per §12.1. */
const SCROLL_REVEAL_PX = 400;
/** …or this delay, whichever comes first. */
const TIME_REVEAL_MS = 4000;
/**
 * Set by `Modal` / `Drawer` on `<body>` while an overlay owns the screen — the
 * public contract they expose as `OVERLAY_OPEN_ATTRIBUTE` in `./modal`.
 * Duplicated as a literal on purpose: importing the constant would drag the
 * whole dialog module (and Radix Dialog with it) into the bundle of every
 * public page, for one string.
 */
const OVERLAY_ATTRIBUTE = 'data-overlay-open';
const BUBBLE_SEEN_KEY = 'cfi-whatsapp-bubble-seen';

/**
 * Brand lockup. See the note above — this is the single sanctioned raw-hex
 * declaration in the component layer.
 */
const BRAND_STYLE = {
  '--cfi-whatsapp-green': '#25D366',
  '--cfi-whatsapp-glyph': '#ffffff',
} as React.CSSProperties;

function hasSeenBubble(): boolean {
  try {
    return window.sessionStorage.getItem(BUBBLE_SEEN_KEY) === '1';
  } catch {
    // Storage is unavailable in some privacy modes; show the bubble once.
    return false;
  }
}

function markBubbleSeen(): void {
  try {
    window.sessionStorage.setItem(BUBBLE_SEEN_KEY, '1');
  } catch {
    // Not persisting the dismissal is acceptable; it is a hint, not state.
  }
}

/** WhatsApp glyph. Not in lucide-react (brand marks were removed in v0.4xx). */
function WhatsAppGlyph({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413" />
    </svg>
  );
}

export function WhatsAppFab({
  phone,
  message,
  label,
  bubble,
  onOpen,
  className,
}: WhatsAppFabProps): React.JSX.Element {
  const { reduced } = useReducedMotionSafe();
  const [revealed, setRevealed] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [bubbleOpen, setBubbleOpen] = useState(false);

  // ── Reveal: 400 px of scroll, or 4 s, whichever lands first ───────────────
  useEffect(() => {
    if (window.scrollY >= SCROLL_REVEAL_PX) {
      setRevealed(true);
      return;
    }

    const onScroll = (): void => {
      if (window.scrollY >= SCROLL_REVEAL_PX) setRevealed(true);
    };

    const timer = window.setTimeout(() => setRevealed(true), TIME_REVEAL_MS);
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  // ── Bubble: first appearance only, per session ────────────────────────────
  useEffect(() => {
    if (!revealed || bubble === undefined) return;
    if (hasSeenBubble()) return;
    setBubbleOpen(true);
  }, [bubble, revealed]);

  // ── Stand down while a modal or bottom sheet owns the screen ──────────────
  useEffect(() => {
    const body = document.body;
    const read = (): void => setOverlayOpen(body.hasAttribute(OVERLAY_ATTRIBUTE));

    read();
    const observer = new MutationObserver(read);
    observer.observe(body, { attributes: true, attributeFilter: [OVERLAY_ATTRIBUTE] });

    return () => observer.disconnect();
  }, []);

  const dismissBubble = useCallback((): void => {
    setBubbleOpen(false);
    markBubbleSeen();
  }, []);

  const handleOpen = useCallback((): void => {
    if (bubbleOpen) dismissBubble();
    markBubbleSeen();
    onOpen?.();
  }, [bubbleOpen, dismissBubble, onOpen]);

  const digits = phone.replace(/\D/g, '');
  const href = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  const visible = revealed && !overlayOpen;

  const entrance = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, scale: 0.5, y: 28 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.7, y: 12, transition: { duration: 0.16 } },
        transition: { type: 'spring' as const, stiffness: 420, damping: 24, mass: 0.7 },
      };

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="whatsapp-fab"
          style={BRAND_STYLE}
          initial={entrance.initial}
          animate={entrance.animate}
          exit={entrance.exit}
          transition={entrance.transition}
          className={cn(
            'safe-b fixed bottom-0 end-0 z-40 flex flex-col items-end gap-2 p-4 print:hidden',
            className,
          )}
        >
          {bubble !== undefined && bubbleOpen ? (
            <div
              className={cn(
                'flex max-w-[16rem] items-start gap-2 rounded-md border border-hairline bg-raised',
                'px-3 py-2 text-sm text-ink shadow-e3',
              )}
            >
              <p className="text-start">{bubble.text}</p>
              <button
                type="button"
                onClick={dismissBubble}
                aria-label={bubble.dismissLabel}
                className={cn(
                  '-me-1 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-sm',
                  'text-ink-muted transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                  'hover:bg-surface hover:text-ink',
                )}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}

          <div className="relative size-14">
            {/* Double pulse ring — three runs, then silence. Not rendered at
                all under reduced motion. */}
            {!reduced
              ? [0, 1].map((ring) => (
                  <motion.span
                    key={ring}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-pill border-2 border-[var(--cfi-whatsapp-green)]"
                    initial={{ scale: 1, opacity: 0.55 }}
                    animate={{ scale: 1.9, opacity: 0 }}
                    transition={{
                      duration: 1.5,
                      // 1 run + 2 repeats = exactly three pulses.
                      repeat: 2,
                      repeatDelay: 0.8,
                      delay: ring * 0.45,
                      ease: 'easeOut',
                    }}
                  />
                ))
              : null}

            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              onClick={handleOpen}
              className={cn(
                'relative inline-flex size-14 items-center justify-center rounded-pill shadow-e3',
                'bg-[var(--cfi-whatsapp-green)] text-[var(--cfi-whatsapp-glyph)]',
                'transition-transform duration-[120ms] ease-[var(--ease-out-strait)]',
                'hover:scale-105 active:scale-95',
              )}
            >
              {/* A brand mark is never mirrored in RTL (§10.3). */}
              <WhatsAppGlyph className="size-7" />
            </a>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
