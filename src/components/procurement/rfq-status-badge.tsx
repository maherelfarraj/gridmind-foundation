// P-063 — RFQ / bid status badges.
import { Badge } from "@/components/ui/badge";
import type { RfqBidStatus, RfqStatus } from "@/lib/rfq-rules";

const RFQ_VARIANTS: Record<
  RfqStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  issued: "default",
  closed: "secondary",
  awarded: "default",
  cancelled: "destructive",
};

export function RfqStatusBadge({ status }: { status: RfqStatus }) {
  return (
    <Badge variant={RFQ_VARIANTS[status]} className="capitalize">
      {status}
    </Badge>
  );
}

const BID_VARIANTS: Record<
  RfqBidStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  invited: "outline",
  submitted: "default",
  under_review: "secondary",
  awarded: "default",
  rejected: "destructive",
  withdrawn: "secondary",
};

export function RfqBidStatusBadge({ status }: { status: RfqBidStatus }) {
  return (
    <Badge variant={BID_VARIANTS[status]} className="capitalize">
      {status.replace("_", " ")}
    </Badge>
  );
}
