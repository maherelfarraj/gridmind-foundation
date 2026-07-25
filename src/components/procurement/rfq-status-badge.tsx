// P-063 — RFQ / bid status badges. POL-3: canonical StatusBadge map.
import { StatusBadge } from "@/components/ui/status-badge";
import type { RfqBidStatus, RfqStatus } from "@/lib/rfq-rules";

export function RfqStatusBadge({ status }: { status: RfqStatus }) {
  return <StatusBadge status={status} />;
}

export function RfqBidStatusBadge({ status }: { status: RfqBidStatus }) {
  return <StatusBadge status={status} />;
}
