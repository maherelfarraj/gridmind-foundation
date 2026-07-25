// P-068 — Expediting status badge. POL-3: canonical StatusBadge map.
import { StatusBadge } from "@/components/ui/status-badge";
import type { ExpeditingStatus } from "@/lib/expediting-rules";

const LABELS: Record<ExpeditingStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  delayed: "Delayed",
  delivered: "Delivered",
};

export function ExpeditingStatusBadge({ status }: { status: ExpeditingStatus }) {
  return <StatusBadge status={status} label={LABELS[status]} />;
}
