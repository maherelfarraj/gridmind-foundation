// P-069 — Scorecard OTD-band status badge.
import { Badge } from "@/components/ui/badge";
import { statusBand } from "@/lib/scorecard-rules";

export function ScorecardStatusBadge({ otd }: { otd: number | null | undefined }) {
  const band = statusBand(otd);
  if (band == null) return <Badge variant="outline">No data</Badge>;
  if (band === "green") return <Badge variant="default">On target</Badge>;
  if (band === "amber") return <Badge variant="secondary">Watch</Badge>;
  return <Badge variant="destructive">Underperforming</Badge>;
}
