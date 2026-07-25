'use client';

import * as ToastPrimitive from '@radix-ui/react-toast';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { dismissToast, useToasts, type ToastRecord, type ToastVariant } from './use-toast';

/**
 * Toaster — the rendered half of the toast system.
 *
 * `components/system/providers` already mounts the Radix `ToastProvider` (with
 * the translated region label and the direction-aware swipe axis) and the
 * `ToastViewport`, pinned to the inline-end bottom corner above the safe-area
 * inset. This component therefore renders **only the toasts themselves** and
 * must be mounted anywhere inside `Providers`; Radix portals each one into the
 * existing viewport.
 *
 *   <Providers toastLabel={t('notifications')}>
 *     {children}
 *     <Toaster />
 *   </Providers>
 *
 * Each toast carries an icon *and* text — colour never carries the meaning on
 * its own. Errors are announced assertively, everything else politely. Touch
 * users can swipe them away along the writing direction; keyboard users reach
 * the action and the dismiss button with `F6` (Radix's toast hotkey) and `Tab`.
 */

const TOAST_KEYFRAMES = `
@keyframes cfi-toast-in { from { opacity: 0; transform: translate3d(0, 14px, 0) } to { opacity: 1; transform: translate3d(0, 0, 0) } }
@keyframes cfi-toast-out { from { opacity: 1 } to { opacity: 0 } }
`;

interface VariantSpec {
  Icon: LucideIcon;
  /** Icon + accent bar colour. */
  tone: string;
  accent: string;
  chip: string;
}

const VARIANT: Record<ToastVariant, VariantSpec> = {
  success: { Icon: CheckCircle2, tone: 'text-success', accent: 'bg-success', chip: 'bg-success/12' },
  error: { Icon: AlertCircle, tone: 'text-danger', accent: 'bg-danger', chip: 'bg-danger-wash' },
  warning: { Icon: AlertTriangle, tone: 'text-warn', accent: 'bg-warn', chip: 'bg-warn-wash' },
  info: { Icon: Info, tone: 'text-strait', accent: 'bg-strait', chip: 'bg-strait-wash' },
};

interface ToastItemProps {
  record: ToastRecord;
}

function ToastItem({ record }: ToastItemProps): React.JSX.Element {
  const spec = VARIANT[record.variant];
  const { Icon } = spec;

  return (
    <ToastPrimitive.Root
      open={record.open}
      duration={record.duration}
      type={record.variant === 'error' ? 'foreground' : 'background'}
      onOpenChange={(open) => {
        if (!open) dismissToast(record.id);
      }}
      className={cn(
        'pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-md',
        'border border-hairline bg-raised text-ink shadow-e3',
        'ps-4 pe-1 py-3',
        'data-[state=open]:animate-[cfi-toast-in_220ms_var(--ease-out-strait)]',
        'data-[state=closed]:animate-[cfi-toast-out_180ms_var(--ease-out-strait)]',
        // Swipe feedback. These set `transform` only, so they never fight the
        // opacity-only exit animation above.
        'data-[swipe=move]:[transform:translate3d(var(--radix-toast-swipe-move-x),0,0)]',
        'data-[swipe=end]:[transform:translate3d(var(--radix-toast-swipe-end-x),0,0)]',
        'data-[swipe=cancel]:[transform:translate3d(0,0,0)]',
        'data-[swipe=cancel]:transition-transform data-[swipe=cancel]:duration-200 data-[swipe=cancel]:ease-[var(--ease-out-strait)]',
      )}
    >
      {/* Accent bar: a second, non-colour-dependent signal alongside the icon. */}
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 start-0 w-1', spec.accent)}
      />

      <span
        aria-hidden="true"
        className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm', spec.chip)}
      >
        <Icon className={cn('size-4', spec.tone)} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
        <ToastPrimitive.Title className="text-sm font-medium text-ink">
          {record.title}
        </ToastPrimitive.Title>

        {record.description !== undefined ? (
          <ToastPrimitive.Description className="text-sm text-ink-muted">
            {record.description}
          </ToastPrimitive.Description>
        ) : null}

        {record.action !== undefined ? (
          <ToastPrimitive.Action asChild altText={record.action.altText}>
            <button
              type="button"
              onClick={record.action.onSelect}
              className={cn(
                'mt-2 inline-flex min-h-11 w-fit items-center rounded-sm border border-hairline bg-surface',
                'ps-3 pe-3 text-sm font-medium text-ink',
                'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
                'hover:border-strait hover:text-strait active:bg-raised',
              )}
            >
              {record.action.label}
            </button>
          </ToastPrimitive.Action>
        ) : null}
      </div>

      <ToastPrimitive.Close
        aria-label={record.dismissLabel}
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-sm text-ink-muted',
          'transition-colors duration-[120ms] ease-[var(--ease-out-strait)]',
          'hover:bg-surface hover:text-ink active:bg-surface',
        )}
      >
        <X className="size-4" aria-hidden="true" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

export function Toaster(): React.JSX.Element {
  const records = useToasts();

  return (
    <>
      <style href="cfi-toast-motion" precedence="high">
        {TOAST_KEYFRAMES}
      </style>
      {records.map((record) => (
        <ToastItem key={record.id} record={record} />
      ))}
    </>
  );
}
