import { type ComponentPropsWithRef, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Alert and Callout — inline, page-level messages.
 *
 * These are server components: nothing here needs state, so nothing here ships
 * JavaScript. Use them for messages that belong *in* the page — a payment under
 * review, a form that failed validation, a notice about the 48 h transfer delay
 * — and `toast()` for the transient confirmation of something the user just did.
 *
 *  - `Alert` is the loud one: filled wash, icon, title, body, optional action.
 *  - `Callout` is the quiet one: an accent rule and a tinted body, for context
 *    inside prose without shouting.
 *
 * Both carry an icon *and* text, so the meaning survives without colour, and
 * both take every string from props — no copy lives in this file. Errors get
 * `role="alert"` (announced immediately); the other variants get `role="status"`
 * so a screen reader finishes its current sentence first.
 */

export type AlertVariant = 'success' | 'error' | 'warning' | 'info';

interface VariantSpec {
  Icon: LucideIcon;
  tone: string;
  surface: string;
  rule: string;
}

const VARIANT: Record<AlertVariant, VariantSpec> = {
  success: {
    Icon: CheckCircle2,
    tone: 'text-success',
    surface: 'bg-success/12 border-success/30',
    rule: 'bg-success',
  },
  error: {
    Icon: AlertCircle,
    tone: 'text-danger',
    surface: 'bg-danger-wash border-danger/30',
    rule: 'bg-danger',
  },
  warning: {
    Icon: AlertTriangle,
    tone: 'text-warn',
    surface: 'bg-warn-wash border-warn/30',
    rule: 'bg-warn',
  },
  info: {
    Icon: Info,
    tone: 'text-strait',
    surface: 'bg-strait-wash border-strait/30',
    rule: 'bg-strait',
  },
};

export interface AlertProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'role'> {
  variant?: AlertVariant;
  /** Short, specific, in the interface's voice. Never "Oops!" (§11.5). */
  title: string;
  /** The explanation, and what to do next. */
  children?: ReactNode;
  /** One primary action — a button or a link, supplied by the caller. */
  action?: ReactNode;
  /** Replace the variant's default icon. It stays decorative either way. */
  icon?: LucideIcon;
}

export function Alert({
  variant = 'info',
  title,
  children,
  action,
  icon,
  className,
  ...props
}: AlertProps): React.JSX.Element {
  const spec = VARIANT[variant];
  const Icon = icon ?? spec.Icon;

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex w-full items-start gap-3 rounded-md border ps-4 pe-4 py-3.5 text-ink',
        spec.surface,
        className,
      )}
      {...props}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', spec.tone)} aria-hidden="true" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={cn('text-sm font-medium', spec.tone)}>{title}</p>
        {children !== undefined && children !== null ? (
          <div className="text-sm text-ink-muted">{children}</div>
        ) : null}
        {action !== undefined && action !== null ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">{action}</div>
        ) : null}
      </div>
    </div>
  );
}

export interface CalloutProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'role'> {
  variant?: AlertVariant;
  /** Optional — a callout can be a bare paragraph with an accent rule. */
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  /** Drop the icon for dense prose. The accent rule still marks the variant. */
  hideIcon?: boolean;
}

export function Callout({
  variant = 'info',
  title,
  children,
  action,
  icon,
  hideIcon = false,
  className,
  ...props
}: CalloutProps): React.JSX.Element {
  const spec = VARIANT[variant];
  const Icon = icon ?? spec.Icon;

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'relative flex w-full items-start gap-3 overflow-hidden rounded-md bg-raised ps-5 pe-4 py-3.5 text-ink',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 start-0 w-1', spec.rule)} />

      {!hideIcon ? (
        <Icon className={cn('mt-0.5 size-4 shrink-0', spec.tone)} aria-hidden="true" />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title !== undefined ? (
          <p className={cn('text-sm font-medium', spec.tone)}>{title}</p>
        ) : null}
        {children !== undefined && children !== null ? (
          <div className="text-sm text-ink-muted">{children}</div>
        ) : null}
        {action !== undefined && action !== null ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">{action}</div>
        ) : null}
      </div>
    </div>
  );
}
