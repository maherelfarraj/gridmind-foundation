// P-037 — Shared phase badge. POL-3: renders through the canonical StatusBadge map.
import { StatusBadge } from "@/components/ui/status-badge";
import { PHASE_LABELS, type ProjectPhase } from "@/lib/schemas/project-wizard";

export function PhaseBadge({ phase, className }: { phase: ProjectPhase; className?: string }) {
  return <StatusBadge status={phase} label={PHASE_LABELS[phase]} className={className} />;
}
