'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The wiring layer between a label, a control, its help text and its error.
 *
 * Getting `htmlFor` / `id` / `aria-describedby` / `aria-invalid` right by hand
 * on every screen is how accessibility rots, so `FormField` generates the ids
 * with `useId` and hands them to the control through a render function:
 *
 *   <FormField label={t('email')} description={t('emailHint')} error={errors.email?.message}>
 *     {(field) => <Input type="email" {...field} {...register('email')} />}
 *   </FormField>
 *
 * A render function rather than `cloneElement`: it is explicit, it type-checks,
 * and it composes with `react-hook-form`'s `register()` spread without the
 * component having to guess which child is the control.
 *
 * The error is announced (`role="alert"`) and carries an icon, so the failure
 * is never signalled by colour alone.
 */

export interface FormFieldRenderProps {
  /** Put this on the control — the label's `htmlFor` already points at it. */
  readonly id: string;
  /** Space-separated ids of the description and error, or `undefined`. */
  readonly 'aria-describedby': string | undefined;
  /** `true` while an error is present, `undefined` otherwise. */
  readonly 'aria-invalid': true | undefined;
  /** Mirrors `required`, for controls that style it themselves. */
  readonly required: boolean;
}

export interface FormFieldProps {
  /** Visible label text. Required — a placeholder is not a label. */
  label: React.ReactNode;
  /** Help text rendered under the label and linked with `aria-describedby`. */
  description?: React.ReactNode;
  /** Error message. Its presence is what puts the field in the invalid state. */
  error?: React.ReactNode;
  required?: boolean;
  /** Screen-reader-only suffix on the label, e.g. « obligatoire ». */
  requiredHint?: string;
  /** Visible suffix on the label when the field is optional, e.g. « facultatif ». */
  optionalHint?: string;
  /** Use a caller-supplied id instead of the generated one. */
  id?: string;
  className?: string;
  labelClassName?: string;
  children: (field: FormFieldRenderProps) => React.ReactNode;
}

export function FormField({
  label,
  description,
  error,
  required = false,
  requiredHint,
  optionalHint,
  id,
  className,
  labelClassName,
  children,
}: FormFieldProps): React.JSX.Element {
  const generatedId = React.useId();
  const fieldId = id ?? `field-${generatedId}`;
  const descriptionId = `${fieldId}-description`;
  const errorId = `${fieldId}-error`;

  const hasDescription = description !== undefined && description !== null && description !== false;
  const hasError = error !== undefined && error !== null && error !== false;

  const describedBy =
    [hasDescription ? descriptionId : null, hasError ? errorId : null]
      .filter((value): value is string => value !== null)
      .join(' ') || undefined;

  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      <FormLabel
        htmlFor={fieldId}
        required={required}
        requiredHint={requiredHint}
        optionalHint={optionalHint}
        className={labelClassName}
      >
        {label}
      </FormLabel>

      {hasDescription ? <FormDescription id={descriptionId}>{description}</FormDescription> : null}

      {children({
        id: fieldId,
        'aria-describedby': describedBy,
        'aria-invalid': hasError ? true : undefined,
        required,
      })}

      {hasError ? <FormError id={errorId}>{error}</FormError> : null}
    </div>
  );
}

export interface FormLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  /** Screen-reader-only suffix announced after the label text. */
  requiredHint?: string;
  /** Visible suffix shown when the field is optional. */
  optionalHint?: string;
}

export const FormLabel = React.forwardRef<HTMLLabelElement, FormLabelProps>(function FormLabel(
  { className, children, required = false, requiredHint, optionalHint, ...props },
  ref,
) {
  return (
    <label
      ref={ref}
      className={cn('flex items-center gap-1.5 text-sm font-medium text-ink', className)}
      {...props}
    >
      <span>{children}</span>
      {required ? (
        <>
          <span aria-hidden="true" className="text-danger">
            *
          </span>
          {requiredHint !== undefined ? <span className="sr-only">{requiredHint}</span> : null}
        </>
      ) : optionalHint !== undefined ? (
        <span className="text-xs font-normal text-ink-muted">{optionalHint}</span>
      ) : null}
    </label>
  );
});

export type FormDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;

export const FormDescription = React.forwardRef<HTMLParagraphElement, FormDescriptionProps>(
  function FormDescription({ className, ...props }, ref) {
    return <p ref={ref} className={cn('text-sm text-ink-muted', className)} {...props} />;
  },
);

export type FormErrorProps = React.HTMLAttributes<HTMLParagraphElement>;

export const FormError = React.forwardRef<HTMLParagraphElement, FormErrorProps>(function FormError(
  { className, children, ...props },
  ref,
) {
  return (
    <p
      ref={ref}
      role="alert"
      className={cn('flex items-start gap-1.5 text-sm text-danger', className)}
      {...props}
    >
      {/* Icon + text: the error never depends on colour alone (§21). */}
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
});
