// P-069 — Scorecard OTD-band status badge. POL-3: canonical StatusBadge map.
import { StatusBadge } from "@/components/ui/status-badge";
import { statusBand } from "@/lib/scorecard-rules";

export function ScorecardStatusBadge({ otd }: { otd: number | null | undefined }) {
  const band = statusBand(otd);
  if (band == null) return <StatusBadge status="draft" label="No data" tone="inactive" />;
  if (band === "green") return <StatusBadge status="on_target" label="On target" />;
  if (band === "amber") return <StatusBadge status="watch" label="Watch" />;
  return <StatusBadge status="underperforming" label="Underperforming" />;
}
