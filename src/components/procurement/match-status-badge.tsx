// POL-3: canonical StatusBadge map.
import { StatusBadge } from "@/components/ui/status-badge";
import type { MatchStatus } from "@/lib/match-rules";

const LABELS: Record<MatchStatus, string> = {
  pending: "Pending",
  matched: "Matched",
  variance_blocked: "Variance blocked",
  approved_with_variance: "Approved w/ variance",
};

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  return <StatusBadge status={status} label={LABELS[status]} />;
}
