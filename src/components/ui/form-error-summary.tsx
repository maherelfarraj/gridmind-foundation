// Shared form-level validation fallback.
//
// A resolver rejection must never be silent: even when a field has no inline
// message slot, this banner renders every issue with a human label so the
// operator can see why the submit did not fire.
import type { FieldErrors } from "react-hook-form";

const LABELS: Record<string, string> = {};

function humanize(name: string) {
  return (
    LABELS[name] ??
    name
      .replace(/_/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase())
  );
}

function flatten(errors: FieldErrors, prefix = ""): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(errors ?? {})) {
    if (!value) continue;
    const path = prefix ? `${prefix}.${name}` : name;
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      out.push(name === "root" ? message : `${humanize(name)}: ${message}`);
    } else if (typeof value === "object" && !("type" in (value as object))) {
      out.push(...flatten(value as FieldErrors, path));
    } else {
      out.push(`${humanize(name)}: invalid value`);
    }
  }
  return out;
}

export function FormErrorSummary({
  errors,
  className,
}: {
  errors: FieldErrors;
  className?: string;
}) {
  const messages = flatten(errors);
  if (messages.length === 0) return null;
  return (
    <div
      role="alert"
      className={`rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive ${className ?? ""}`}
    >
      <p className="font-medium">This form could not be saved.</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {messages.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}
