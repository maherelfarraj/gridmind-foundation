// P-109 — SLA countdown chip.
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { classifyCountdown, formatDuration } from "@/lib/service-tickets.rules";

interface Props {
  createdAtISO: string;
  dueAtISO: string | null | undefined;
  label?: string;
}

export function SlaCountdownChip({ createdAtISO, dueAtISO, label }: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  // tick reads to avoid unused-var warnings
  void tick;

  if (!dueAtISO) return <Badge variant="outline">—</Badge>;

  const c = classifyCountdown({ createdAtISO, dueAtISO });
  const text =
    c.status === "breached"
      ? `BREACHED ${formatDuration(c.msRemaining)}`
      : formatDuration(c.msRemaining);
  const prefix = label ? `${label}: ` : "";

  if (c.status === "breached") {
    return (
      <Badge className="bg-destructive text-destructive-foreground">
        {prefix}
        {text}
      </Badge>
    );
  }
  if (c.status === "warning") {
    return (
      <Badge className="bg-warning text-warning-foreground">
        {prefix}
        {text}
      </Badge>
    );
  }
  return (
    <Badge className="bg-success text-success-foreground">
      {prefix}
      {text}
    </Badge>
  );
}
