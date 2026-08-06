// GC-01 — Costing KPI strip: finance-grade cost position per currency.
import {
  Banknote,
  Coins,
  FileStack,
  HandCoins,
  Layers,
  PiggyBank,
  Receipt,
  Scale,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { KpiGrid, KpiTile, type KpiStatus } from "@/components/ui/kpi-tile";
import { cn } from "@/lib/utils";
import type { CbsMetricKey as CostingMetricKey } from "@/components/costing/cbs-table";
import {
  costingBand,
  formatCostingMoney,
  type CostingBand,
  type CostingRollup,
} from "@/lib/costing.rules";

const BAND_STATUS: Record<CostingBand, KpiStatus> = {
  ok: "neutral",
  warning: "warning",
  destructive: "bad",
};

export function CostingKpis({
  rollup,
  onMetric,
  activeMetric,
}: {
  rollup: CostingRollup;
  /** Drill the CBS table into this metric. */
  onMetric?: (metric: CostingMetricKey) => void;
  activeMetric?: CostingMetricKey | null;
}) {
  const c = rollup.currency_code;
  const m = (n: number) => formatCostingMoney(n, c);
  const vacStatus = BAND_STATUS[costingBand(rollup.variance_at_completion, rollup.current)];
  const availStatus = BAND_STATUS[costingBand(rollup.available, rollup.current)];

  return (
    <div className="flex flex-col gap-4">
      <KpiGrid columns={4} label={`Budget position (${c})`}>
        <MetricTile metric="original" onMetric={onMetric} active={activeMetric === "original"}>
          <KpiTile
            icon={Layers}
            label={`Original budget (${c})`}
            value={m(rollup.original)}
            hint="Baseline at award"
          />
        </MetricTile>
        <MetricTile
          metric="approved_changes"
          onMetric={onMetric}
          active={activeMetric === "approved_changes"}
        >
          <KpiTile
            icon={FileStack}
            label="Approved changes"
            value={m(rollup.approved_changes)}
            hint="Incorporated change orders"
          />
        </MetricTile>
        <MetricTile metric="current" onMetric={onMetric} active={activeMetric === "current"}>
          <KpiTile icon={Banknote} label="Current budget" value={m(rollup.current)} />
        </MetricTile>
        <MetricTile metric="available" onMetric={onMetric} active={activeMetric === "available"}>
          <KpiTile
            icon={PiggyBank}
            label="Available budget"
            status={availStatus}
            value={m(rollup.available)}
            hint="Current − max(committed, actual + accruals)"
          />
        </MetricTile>
      </KpiGrid>

      <KpiGrid columns={4} label={`Cost position (${c})`}>
        <MetricTile metric="committed" onMetric={onMetric} active={activeMetric === "committed"}>
          <KpiTile
            icon={Receipt}
            label="Committed cost"
            value={m(rollup.committed)}
            hint={`PO ${m(rollup.committed_po)} · Sub ${m(rollup.committed_subcontract)} · CO ${m(rollup.committed_change_order)}`}
          />
        </MetricTile>
        <MetricTile metric="actual" onMetric={onMetric} active={activeMetric === "actual"}>
          <KpiTile
            icon={Coins}
            label="Actual cost"
            value={m(rollup.actual)}
            hint="Booked payable invoices"
          />
        </MetricTile>
        <MetricTile metric="accruals" onMetric={onMetric} active={activeMetric === "accruals"}>
          <KpiTile
            icon={Scale}
            label="Accruals"
            value={m(rollup.accruals)}
            hint="Approved entries only"
          />
        </MetricTile>
        <MetricTile metric="etc" onMetric={onMetric} active={activeMetric === "etc"}>
          <KpiTile
            icon={TrendingUp}
            label="ETC"
            value={m(rollup.etc)}
            hint={rollup.has_forecast ? "From forecast periods" : "Residual estimate"}
          />
        </MetricTile>
      </KpiGrid>

      <KpiGrid columns={4} label={`Forecast and cash (${c})`}>
        <MetricTile metric="eac" onMetric={onMetric} active={activeMetric === "eac"}>
          <KpiTile icon={Target} label="EAC" value={m(rollup.eac)} hint="Actual + accruals + ETC" />
        </MetricTile>
        <MetricTile
          metric="variance_at_completion"
          onMetric={onMetric}
          active={activeMetric === "variance_at_completion"}
        >
          <KpiTile
            icon={Scale}
            label="Variance at completion"
            status={vacStatus}
            value={m(rollup.variance_at_completion)}
            hint="Current budget − EAC"
          />
        </MetricTile>
        <MetricTile metric="paid" onMetric={onMetric} active={activeMetric === "paid"}>
          <KpiTile
            icon={Wallet}
            label="Paid"
            value={m(rollup.paid)}
            hint="Recorded payable payments"
          />
        </MetricTile>
        <MetricTile
          metric="outstanding"
          onMetric={onMetric}
          active={activeMetric === "outstanding"}
        >
          <KpiTile
            icon={HandCoins}
            label="Outstanding"
            value={m(rollup.outstanding)}
            hint="Actual − paid"
          />
        </MetricTile>
      </KpiGrid>
    </div>
  );
}

export type { CostingMetricKey };

/** Makes a KPI tile a drill-down control into the CBS table. */
function MetricTile({
  metric,
  onMetric,
  active,
  children,
}: {
  metric: CostingMetricKey;
  onMetric?: (metric: CostingMetricKey) => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  if (!onMetric) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={() => onMetric(metric)}
      aria-pressed={active}
      className={cn(
        "rounded-lg text-start transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "ring-2 ring-primary",
      )}
    >
      {children}
    </button>
  );
}
