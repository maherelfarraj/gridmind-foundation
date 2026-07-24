// P-039 — Small label+input scaffold used by all config forms.
import type { ReactNode } from "react";
import type { FieldError } from "react-hook-form";

import { cn } from "@/lib/utils";

export function FieldShell({
  label,
  hint,
  suffix,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  suffix?: string;
  error?: FieldError;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-sm", className)}>
      <span className="font-medium text-foreground">{label}</span>
      <div className="relative flex items-center">
        <div className="flex-1">{children}</div>
        {suffix && (
          <span className="pointer-events-none absolute right-3 text-xs uppercase tracking-wide text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {hint && !error && (
        <span className="text-xs text-muted-foreground">{hint}</span>
      )}
      {error && (
        <span className="text-xs text-destructive">{error.message}</span>
      )}
    </label>
  );
}
