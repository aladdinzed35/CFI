import { Check, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Timeline — the request-status widget of §9.2.
 *
 * Four nodes (*Demande envoyée* → *Justificatif reçu* → *Vérification en cours*
 * → *Accès activé*) with a timestamp under each, a connector that fills as the
 * request advances, and a slot for inline content under any node — that slot is
 * where the re-upload box lives when the admin moves the request to
 * `INFO_REQUESTED`, and where the WhatsApp CTA lives on `REJECTED`.
 *
 * Node states carry an icon and a shape as well as a colour, so the amber
 * "information demandée" node and the red "refusée" node are distinguishable
 * without colour vision (§21).
 *
 * Copy — labels, timestamps, state words — is formatted and translated by the
 * caller. The component holds none.
 */

export type TimelineNodeState = 'done' | 'current' | 'pending' | 'warning' | 'error';

export interface TimelineNode {
  readonly id: string;
  /** Node title, translated. */
  readonly label: string;
  readonly state: TimelineNodeState;
  /** Already-formatted date/time — the caller owns the locale and the timezone. */
  readonly timestamp?: string;
  /** One or two lines of detail: the admin's message, the rejection reason. */
  readonly description?: string;
  /** Inline slot rendered under the node — the re-upload box, a CTA row. */
  readonly content?: React.ReactNode;
}

export interface TimelineProps extends Omit<React.ComponentPropsWithRef<'ol'>, 'children'> {
  nodes: readonly TimelineNode[];
  /** Accessible name of the list, translated by the caller. */
  label: string;
  /** Screen-reader-only state word per node, e.g. { current: « En cours » }. */
  stateLabels?: Readonly<Record<TimelineNodeState, string>>;
}

const markerClasses: Record<TimelineNodeState, string> = {
  done: 'border-strait bg-strait text-on-accent',
  current: 'border-strait bg-strait-wash text-strait',
  pending: 'border-hairline bg-surface text-ink-muted',
  warning: 'border-warn bg-warn-wash text-warn',
  error: 'border-danger bg-danger-wash text-danger',
};

const labelClasses: Record<TimelineNodeState, string> = {
  done: 'text-ink',
  current: 'text-ink',
  pending: 'text-ink-muted',
  warning: 'text-warn',
  error: 'text-danger',
};

const connectorClasses: Record<TimelineNodeState, string> = {
  done: 'bg-strait',
  current: 'bg-strait',
  pending: 'bg-hairline',
  warning: 'bg-warn',
  error: 'bg-danger',
};

/**
 * The pulse on the current node. Three runs then stop — the app never ships an
 * animation that loops forever (§11.2), and `prefers-reduced-motion` removes it
 * altogether. Hoisted and de-duplicated by React 19 via `href` + `precedence`,
 * so it is emitted once no matter how many timelines are on the page.
 */
const pulseKeyframes = `
@keyframes cfi-timeline-pulse {
  0%   { transform: scale(1);   opacity: 0.45; }
  100% { transform: scale(2.1); opacity: 0;    }
}
@media (prefers-reduced-motion: reduce) {
  .cfi-timeline-pulse { display: none; }
}
`;

function MarkerGlyph({ state }: { state: TimelineNodeState }): React.JSX.Element {
  switch (state) {
    case 'done':
      return <Check className="size-4" strokeWidth={2.5} aria-hidden="true" />;
    case 'warning':
      return <TriangleAlert className="size-4" aria-hidden="true" />;
    case 'error':
      return <X className="size-4" strokeWidth={2.5} aria-hidden="true" />;
    case 'current':
      return <span className="size-2.5 rounded-pill bg-strait" aria-hidden="true" />;
    case 'pending':
      return <span className="size-2 rounded-pill bg-ink-muted/60" aria-hidden="true" />;
  }
}

export function Timeline({
  nodes,
  label,
  stateLabels,
  className,
  ...props
}: TimelineProps): React.JSX.Element {
  return (
    <>
      <style href="cfi-timeline-pulse" precedence="medium">
        {pulseKeyframes}
      </style>

      <ol aria-label={label} className={cn('flex w-full flex-col', className)} {...props}>
        {nodes.map((node, index) => {
          const isLast = index === nodes.length - 1;
          const filled = node.state === 'done';

          return (
            <li
              key={node.id}
              aria-current={node.state === 'current' ? 'step' : undefined}
              data-state={node.state}
              className={cn('relative grid grid-cols-[2rem_1fr] gap-x-3', isLast ? 'pb-0' : 'pb-6')}
            >
              {isLast ? null : (
                <>
                  <span
                    aria-hidden="true"
                    className="absolute top-9 bottom-1 start-[calc(1rem-0.5px)] w-px bg-hairline"
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute top-9 bottom-1 start-[calc(1rem-0.5px)] w-px origin-top transition-transform duration-300 ease-[var(--ease-out-strait)] motion-reduce:transition-none',
                      connectorClasses[node.state],
                      filled ? 'scale-y-100' : 'scale-y-0',
                    )}
                  />
                </>
              )}

              <span className="relative grid size-8 shrink-0 place-items-center">
                {node.state === 'current' ? (
                  <span
                    aria-hidden="true"
                    className="cfi-timeline-pulse absolute inset-0 rounded-pill bg-strait [animation:cfi-timeline-pulse_1.4s_var(--ease-out-strait)_3_both]"
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className={cn(
                    'relative z-10 grid size-8 place-items-center rounded-pill border-2 transition-colors duration-[120ms] ease-[var(--ease-out-strait)] motion-reduce:transition-none',
                    markerClasses[node.state],
                  )}
                >
                  <MarkerGlyph state={node.state} />
                </span>
              </span>

              <div className="flex min-w-0 flex-col gap-1 pt-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className={cn('text-body font-medium', labelClasses[node.state])}>
                    {node.label}
                  </span>
                  {stateLabels === undefined ? null : (
                    <span className="sr-only">{` — ${stateLabels[node.state]}`}</span>
                  )}
                  {node.timestamp === undefined ? null : (
                    <span data-numeric className="force-ltr text-xs text-ink-muted" dir="ltr">
                      {node.timestamp}
                    </span>
                  )}
                </div>

                {node.description === undefined ? null : (
                  <p className="text-sm text-ink-muted">{node.description}</p>
                )}

                {node.content === undefined ? null : <div className="mt-2">{node.content}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
