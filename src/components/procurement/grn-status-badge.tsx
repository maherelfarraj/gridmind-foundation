// POL-3: canonical StatusBadge map.
import { StatusBadge } from "@/components/ui/status-badge";
import type { GrnStatus } from "@/lib/grn-rules";

const LABELS: Record<GrnStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  has_defects: "Has defects",
  closed: "Closed",
};

export function GrnStatusBadge({ status }: { status: GrnStatus }) {
  return <StatusBadge status={status} label={LABELS[status]} />;
}
