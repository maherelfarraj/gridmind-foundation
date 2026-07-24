import { Badge } from "@/components/ui/badge";
import type { MatchStatus } from "@/lib/match-rules";

const LABELS: Record<MatchStatus, string> = {
  pending: "Pending",
  matched: "Matched",
  variance_blocked: "Variance blocked",
  approved_with_variance: "Approved w/ variance",
};

const VARIANTS: Record<MatchStatus, "secondary" | "default" | "destructive" | "outline"> = {
  pending: "secondary",
  matched: "default",
  variance_blocked: "destructive",
  approved_with_variance: "outline",
};

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
