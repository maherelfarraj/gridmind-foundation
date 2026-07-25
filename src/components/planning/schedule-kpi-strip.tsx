// P-073 — Schedule KPI strip: total, weighted %, overdue, schedule variance.
import { AlertOctagon, CheckCircle2, ClipboardList, Gauge } from "lucide-react";

import { KpiGrid, KpiTile, type KpiStatus } from "@/components/ui/kpi-tile";
import { bandForFinishVariance, type VarianceBand } from "@/lib/schedule.rules";

interface Props {
  total: number;
  weightedPct: number;
  overdue: number;
  finishVariance: number | null;
  baselineName: string | null;
}

const BAND_STATUS: Record<VarianceBand, KpiStatus> = {
  ok: "neutral",
  warning: "warning",
  destructive: "bad",
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
    <KpiGrid label="Schedule KPIs">
      <KpiTile icon={ClipboardList} label="Tasks" value={total} />
      <KpiTile
        icon={Gauge}
        label="% complete (weighted)"
        value={`${weightedPct.toFixed(1)}%`}
      />
      <KpiTile
        icon={AlertOctagon}
        label="Overdue"
        value={overdue}
        status={overdue > 0 ? "bad" : "neutral"}
      />
      <KpiTile
        icon={CheckCircle2}
        label={baselineName ? `Finish variance vs ${baselineName}` : "Finish variance"}
        value={
          finishVariance == null
            ? "—"
            : `${finishVariance > 0 ? "+" : ""}${finishVariance.toFixed(1)}d`
        }
        hint={finishVariance == null ? "No baseline selected" : undefined}
        status={finishVariance == null ? "neutral" : BAND_STATUS[band]}
      />
    </KpiGrid>
  );
}
