// P-037 — Shared phase badge. Semantic tokens only.
import { cn } from "@/lib/utils";
import { PHASE_LABELS, type ProjectPhase } from "@/lib/schemas/project-wizard";

const VARIANTS: Record<ProjectPhase, string> = {
  development: "bg-secondary text-secondary-foreground",
  ntp: "bg-accent text-accent-foreground",
  cod: "bg-primary text-primary-foreground",
  handover: "bg-muted text-muted-foreground",
};

export function PhaseBadge({
  phase,
  className,
}: {
  phase: ProjectPhase;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        VARIANTS[phase],
        className,
      )}
    >
      {PHASE_LABELS[phase]}
    </span>
  );
}
