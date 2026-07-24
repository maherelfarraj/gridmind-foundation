// P-065 — PO status stepper showing full lifecycle.
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PoStatus } from "@/lib/po-rules";

const STEPS: Array<{ status: PoStatus; label: string }> = [
  { status: "draft", label: "Draft" },
  { status: "pending_approval", label: "Pending approval" },
  { status: "approved", label: "Approved" },
  { status: "issued", label: "Issued" },
  { status: "partially_received", label: "Partial receipt" },
  { status: "received", label: "Received" },
  { status: "closed", label: "Closed" },
];

export function PoStatusStepper({ status }: { status: PoStatus }) {
  if ((status as string) === "cancelled" || (status as string) === "rejected") {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
        Purchase order is <span className="font-semibold">{status}</span> — no
        further actions available.
      </div>
    );
  }

  const activeIdx = Math.max(
    0,
    STEPS.findIndex((s) => s.status === status),
  );

  return (
    <ol className="flex w-full flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
      {STEPS.map((step, i) => {
        const done = i < activeIdx;
        const current = i === activeIdx;
        return (
          <li key={step.status} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold",
                done
                  ? "border-primary bg-primary text-primary-foreground"
                  : current
                    ? "border-primary bg-background text-primary"
                    : "border-border bg-background text-muted-foreground",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "whitespace-nowrap",
                current ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <span
                className={cn(
                  "mx-1 h-px w-6 sm:w-10",
                  done ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
