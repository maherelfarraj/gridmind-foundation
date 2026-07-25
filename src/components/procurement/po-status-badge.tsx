// P-064 — Purchase Order status badge.
import { Badge } from "@/components/ui/badge";
import type { PoStatus } from "@/lib/po-rules";

const PO_VARIANTS: Record<PoStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  pending_approval: "secondary",
  approved: "default",
  issued: "default",
  partially_received: "secondary",
  received: "default",
  closed: "secondary",
  cancelled: "destructive",
};

export function PoStatusBadge({ status }: { status: PoStatus }) {
  return (
    <Badge variant={PO_VARIANTS[status]} className="capitalize">
      {status.replace("_", " ")}
    </Badge>
  );
}
