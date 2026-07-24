// P-038 — Read-only phase gate stepper. Semantic tokens only.
import { CheckCircle2, Circle, Clock, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectDetailGate } from "@/lib/projects.functions";

const PHASE_ORDER = ["development", "ntp", "cod", "handover"] as const;
type Phase = (typeof PHASE_ORDER)[number];

const PHASE_LABELS: Record<Phase, string> = {
  development: "Development",
  ntp: "NTP",
  cod: "COD",
  handover: "Handover",
};

type GateStatus = "approved" | "in_review" | "open" | "locked";

function normStatus(s: string | undefined): GateStatus {
  if (s === "approved" || s === "in_review" || s === "open" || s === "locked") {
    return s;
  }
  return "locked";
}

const CIRCLE: Record<GateStatus, string> = {
  approved: "bg-primary text-primary-foreground border-primary",
  in_review: "bg-accent text-accent-foreground border-accent",
  open: "border-primary text-primary ring-1 ring-primary/40 bg-background",
  locked: "bg-muted text-muted-foreground border-border",
};

const LABEL_TONE: Record<GateStatus, string> = {
  approved: "text-foreground",
  in_review: "text-foreground",
  open: "text-foreground",
  locked: "text-muted-foreground",
};

function StatusIcon({ status }: { status: GateStatus }) {
  switch (status) {
    case "approved":
      return <CheckCircle2 size={18} aria-hidden />;
    case "in_review":
      return <Clock size={18} aria-hidden />;
    case "open":
      return <Circle size={18} aria-hidden />;
    case "locked":
      return <Lock size={14} aria-hidden />;
  }
}

export function PhaseGateStepper({
  gates,
  className,
}: {
  gates: ProjectDetailGate[];
  className?: string;
}) {
  const byPhase = new Map<Phase, ProjectDetailGate>();
  for (const g of gates) {
    if ((PHASE_ORDER as readonly string[]).includes(g.phase)) {
      byPhase.set(g.phase as Phase, g);
    }
  }

  return (
    <ol
      className={cn("flex w-full items-start gap-0", className)}
      aria-label="Project phase gates"
    >
      {PHASE_ORDER.map((phase, idx) => {
        const gate = byPhase.get(phase);
        const status = normStatus(gate?.status);
        const isLast = idx === PHASE_ORDER.length - 1;

        // Connector color reflects progress: primary if this step is approved.
        const connectorTone =
          status === "approved" ? "bg-primary" : "bg-border";

        return (
          <li
            key={phase}
            className="flex flex-1 items-start gap-0"
            aria-current={status === "open" ? "step" : undefined}
          >
            <div className="flex min-w-0 flex-col items-center gap-2">
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors",
                  CIRCLE[status],
                )}
                aria-label={`${PHASE_LABELS[phase]} — ${status.replace("_", " ")}`}
              >
                <StatusIcon status={status} />
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <span
                  className={cn(
                    "text-xs font-medium",
                    LABEL_TONE[status],
                  )}
                >
                  {PHASE_LABELS[phase]}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {status.replace("_", " ")}
                </span>
              </div>
            </div>
            {!isLast && (
              <div
                aria-hidden
                className={cn("mt-4 h-0.5 flex-1", connectorTone)}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
