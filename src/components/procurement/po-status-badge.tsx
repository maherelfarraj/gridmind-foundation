// P-064 — Purchase Order status badge. POL-3: canonical StatusBadge map.
import { StatusBadge } from "@/components/ui/status-badge";
import type { PoStatus } from "@/lib/po-rules";

export function PoStatusBadge({ status }: { status: PoStatus }) {
  return <StatusBadge status={status} />;
}
