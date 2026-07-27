// P-223 — Compact PO lifecycle stepper for the vendor portal.
import { PO_STATUS_LABELS, PO_STATUS_STEPS } from "@/lib/vendor-portal.rules";

export function PoStatusStepper({ status }: { status: string }) {
  const activeIndex = PO_STATUS_STEPS.indexOf(status as (typeof PO_STATUS_STEPS)[number]);

  if (activeIndex === -1) {
    return <p className="text-sm capitalize text-muted-foreground">{status.replace(/_/g, " ")}</p>;
  }

  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Purchase order status">
      {PO_STATUS_STEPS.map((step, index) => {
        const done = index < activeIndex;
        const current = index === activeIndex;
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              aria-current={current ? "step" : undefined}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                current
                  ? "bg-primary text-primary-foreground"
                  : done
                    ? "bg-muted text-foreground"
                    : "bg-muted/50 text-muted-foreground"
              }`}
            >
              {PO_STATUS_LABELS[step]}
            </span>
            {index < PO_STATUS_STEPS.length - 1 ? (
              <span
                aria-hidden
                className={`h-px w-4 ${done ? "bg-foreground/40" : "bg-border"}`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
