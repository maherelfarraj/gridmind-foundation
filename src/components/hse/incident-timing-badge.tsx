// P-088 — Incident 24h timing badge.
import { AlertTriangle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { incidentTimingBadge } from "@/lib/hse.rules";

interface Props {
  occurredAt: string;
  reportedAt?: string | null;
  now?: Date;
}

export function IncidentTimingBadge({ occurredAt, reportedAt, now }: Props) {
  const badge = incidentTimingBadge(occurredAt, reportedAt ?? null, now);
  if (badge.kind === "countdown") {
    const hours = Math.ceil(badge.hoursRemaining);
    return (
      <Badge
        variant="outline"
        className="gap-1 border-warning/40 bg-warning/10 text-warning-foreground"
      >
        <Clock size={12} aria-hidden />
        Log within 24h — {hours}h remaining
      </Badge>
    );
  }
  if (badge.kind === "late") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-destructive/40 bg-destructive/10 text-destructive"
      >
        <AlertTriangle size={12} aria-hidden />
        Logged late
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      On time
    </Badge>
  );
}
