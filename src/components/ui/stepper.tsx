import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Stepper — the horizontal step indicator at the top of a multi-step modal
 * (§9.2: *Prix & conditions* → *Justificatif de virement* → *Confirmation*).
 *
 * Semantics: an ordered list, one `<li>` per step, `aria-current="step"` on the
 * active one. The connector between two steps is a decorative span, so screen
 * readers hear the steps and nothing else.
 *
 * The state is never colour alone: a done step swaps its number for a check,
 * the current step is outlined and labelled, and `stepStatusLabels` adds a
 * screen-reader-only word to each one when the caller supplies translations.
 */

export type StepState = 'done' | 'current' | 'upcoming';

export interface StepperStep {
  readonly id: string;
  readonly label: string;
  /** One short line under the label. Hidden below `sm` to keep the modal compact. */
  readonly description?: string;
}

export interface StepperProps extends Omit<React.ComponentPropsWithRef<'ol'>, 'children'> {
  steps: readonly StepperStep[];
  /** 1-based index of the active step. Values outside the range are clamped. */
  current: number;
  /** Accessible name of the whole indicator, translated by the caller. */
  label: string;
  /** Screen-reader-only status word appended to each step, e.g. « Terminé ». */
  stepStatusLabels?: Readonly<Record<StepState, string>>;
}

const markerClasses: Record<StepState, string> = {
  done: 'border-strait bg-strait text-on-accent',
  current: 'border-strait bg-strait-wash text-strait',
  upcoming: 'border-hairline bg-surface text-ink-muted',
};

const labelClasses: Record<StepState, string> = {
  done: 'text-ink',
  current: 'text-ink',
  upcoming: 'text-ink-muted',
};

export function Stepper({
  steps,
  current,
  label,
  stepStatusLabels,
  className,
  ...props
}: StepperProps): React.JSX.Element {
  const total = steps.length;
  const activeIndex = Math.min(Math.max(Math.round(current), 1), Math.max(total, 1));

  return (
    <ol aria-label={label} className={cn('flex w-full items-start', className)} {...props}>
      {steps.map((step, index) => {
        const position = index + 1;
        const state: StepState =
          position < activeIndex ? 'done' : position === activeIndex ? 'current' : 'upcoming';
        const connectorFilled = position <= activeIndex;

        return (
          <li
            key={step.id}
            aria-current={state === 'current' ? 'step' : undefined}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-2 text-center"
          >
            {index === 0 ? null : (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-4 end-1/2 h-px w-full transition-colors duration-300 ease-[var(--ease-out-strait)] motion-reduce:transition-none',
                  connectorFilled ? 'bg-strait' : 'bg-hairline',
                )}
              />
            )}

            <span
              aria-hidden="true"
              className={cn(
                'relative z-10 grid size-8 shrink-0 place-items-center rounded-pill border-2 text-sm font-medium transition-colors duration-[120ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none',
                markerClasses[state],
              )}
            >
              {state === 'done' ? (
                <Check className="size-4" strokeWidth={2.5} />
              ) : (
                <span data-numeric>{position}</span>
              )}
            </span>

            <span className="flex min-w-0 flex-col gap-0.5 px-1">
              <span className={cn('text-sm font-medium text-balance', labelClasses[state])}>
                {step.label}
                {stepStatusLabels === undefined ? null : (
                  <span className="sr-only">{` — ${stepStatusLabels[state]}`}</span>
                )}
              </span>
              {step.description === undefined ? null : (
                <span className="hidden text-xs text-ink-muted sm:block">{step.description}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
