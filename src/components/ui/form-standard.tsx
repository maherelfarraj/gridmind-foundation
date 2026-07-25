// POL-3 — Shared form standard: uniform field rows, section titles, dialog footers
// and inline-edit inputs. Use these instead of hand-rolled label/error markup.
import { Loader2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** A titled group of fields. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      {title ? (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Uniform label + control + helper/error row. */
export function FormRow({
  label,
  htmlFor,
  required,
  helper,
  error,
  hint,
  children,
  className,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  /** Right-aligned secondary text next to the label (e.g. char count). */
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
            {required ? (
              <span className="ml-0.5 text-destructive" aria-hidden>
                *
              </span>
            ) : null}
          </Label>
          {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        </div>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : helper ? (
        <p className="text-xs text-muted-foreground">{helper}</p>
      ) : null}
    </div>
  );
}

/** Two-column grid on desktop, single column with 44px targets on mobile. */
export function FormGrid({
  children,
  columns = 2,
  className,
}: {
  children: React.ReactNode;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 1 ? "grid-cols-1" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Sticky Cancel (ghost) + Submit (primary, spinner while pending) dialog footer. */
export function DialogFormFooter({
  onCancel,
  cancelLabel = "Cancel",
  submitLabel = "Save",
  pending,
  disabled,
  form,
  extra,
  className,
}: {
  onCancel?: () => void;
  cancelLabel?: string;
  submitLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  form?: string;
  extra?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 -mx-6 -mb-6 mt-2 flex flex-col-reverse gap-2 border-t border-border bg-background/95 px-6 py-4 backdrop-blur sm:flex-row sm:justify-end",
        className,
      )}
    >
      {extra ? <div className="sm:mr-auto">{extra}</div> : null}
      {onCancel ? (
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
      ) : null}
      <Button type="submit" form={form} disabled={pending || disabled}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {submitLabel}
      </Button>
    </div>
  );
}

/** Inline table-cell editor — same styling at h-8. */
export const InlineEditInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<typeof Input>
>(({ className, ...props }, ref) => (
  <Input ref={ref} className={cn("h-8 px-2 text-sm tabular-nums", className)} {...props} />
));
InlineEditInput.displayName = "InlineEditInput";
