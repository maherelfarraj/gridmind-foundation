// P-069 — Trend chip vs prior period.
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { trend } from "@/lib/scorecard-rules";

export function TrendChip({
  current,
  prior,
  positiveIsGood = true,
}: {
  current: number | null | undefined;
  prior: number | null | undefined;
  positiveIsGood?: boolean;
}) {
  const t = trend(current, prior);
  if (!t) return <span className="text-xs text-muted-foreground">—</span>;
  const isPositive = t.direction === "up";
  const good = t.direction === "flat" ? null : positiveIsGood ? isPositive : !isPositive;
  const color = good == null ? "text-muted-foreground" : good ? "text-success" : "text-destructive";
  const Icon =
    t.direction === "up" ? ArrowUpRight : t.direction === "down" ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${color}`}>
      <Icon className="h-3 w-3" />
      {t.delta > 0 ? "+" : ""}
      {t.delta.toFixed(1)}
    </span>
  );
}
