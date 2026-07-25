// P-073 — Schedule KPI strip: total, weighted %, overdue, schedule variance.
import { AlertOctagon, CheckCircle2, ClipboardList, Gauge } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { bandForFinishVariance, type VarianceBand } from "@/lib/schedule.rules";

interface Props {
  total: number;
  weightedPct: number;
  overdue: number;
  finishVariance: number | null;
  baselineName: string | null;
}

const BAND_TEXT: Record<VarianceBand, string> = {
  ok: "text-foreground",
  warning: "text-warning",
  destructive: "text-destructive",
};

export function ScheduleKpiStrip({
  total,
  weightedPct,
  overdue,
  finishVariance,
  baselineName,
}: Props) {
  const band = bandForFinishVariance(finishVariance);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Kpi icon={<ClipboardList size={16} aria-hidden />} label="Tasks">
        <span className="text-2xl font-semibold text-foreground">{total}</span>
      </Kpi>
      <Kpi icon={<Gauge size={16} aria-hidden />} label="% complete (weighted)">
        <span className="text-2xl font-semibold text-foreground">{weightedPct.toFixed(1)}%</span>
      </Kpi>
      <Kpi icon={<AlertOctagon size={16} aria-hidden />} label="Overdue">
        <span
          className={cn(
            "text-2xl font-semibold",
            overdue > 0 ? "text-destructive" : "text-foreground",
          )}
        >
          {overdue}
        </span>
      </Kpi>
      <Kpi
        icon={<CheckCircle2 size={16} aria-hidden />}
        label={baselineName ? `Finish variance vs ${baselineName}` : "Finish variance"}
      >
        {finishVariance == null ? (
          <span className="text-sm text-muted-foreground">No baseline selected</span>
        ) : (
          <span className={cn("text-2xl font-semibold", BAND_TEXT[band])}>
            {finishVariance > 0 ? "+" : ""}
            {finishVariance.toFixed(1)}d
          </span>
        )}
      </Kpi>
    </div>
  );
}

function Kpi({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-1 border-border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      {children}
    </Card>
  );
}
