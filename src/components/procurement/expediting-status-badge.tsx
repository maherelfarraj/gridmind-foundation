// P-068 — Expediting status badge.
import { Badge } from "@/components/ui/badge";
import type { ExpeditingStatus } from "@/lib/expediting-rules";

const VARIANTS: Record<ExpeditingStatus, "default" | "secondary" | "outline" | "destructive"> = {
  on_track: "outline",
  at_risk: "secondary",
  delayed: "destructive",
  delivered: "default",
};

const LABELS: Record<ExpeditingStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  delayed: "Delayed",
  delivered: "Delivered",
};

export function ExpeditingStatusBadge({ status }: { status: ExpeditingStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
