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

export function CostingKpis({ rollup }: { rollup: CostingRollup }) {
  const c = rollup.currency_code;
  const m = (n: number) => formatCostingMoney(n, c);
  const vacStatus = BAND_STATUS[costingBand(rollup.variance_at_completion, rollup.current)];
  const availStatus = BAND_STATUS[costingBand(rollup.available, rollup.current)];

  return (
    <div className="flex flex-col gap-4">
      <KpiGrid columns={4} label={`Budget position (${c})`}>
        <KpiTile
          icon={Layers}
          label={`Original budget (${c})`}
          value={m(rollup.original)}
          hint="Baseline at award"
        />
        <KpiTile
          icon={FileStack}
          label="Approved changes"
          value={m(rollup.approved_changes)}
          hint="Incorporated change orders"
        />
        <KpiTile icon={Banknote} label="Current budget" value={m(rollup.current)} />
        <KpiTile
          icon={PiggyBank}
          label="Available budget"
          status={availStatus}
          value={m(rollup.available)}
          hint="Current − max(committed, actual + accruals)"
        />
      </KpiGrid>

      <KpiGrid columns={4} label={`Cost position (${c})`}>
        <KpiTile
          icon={Receipt}
          label="Committed cost"
          value={m(rollup.committed)}
          hint={`PO ${m(rollup.committed_po)} · Sub ${m(rollup.committed_subcontract)} · CO ${m(rollup.committed_change_order)}`}
        />
        <KpiTile
          icon={Coins}
          label="Actual cost"
          value={m(rollup.actual)}
          hint="Booked payable invoices"
        />
        <KpiTile
          icon={Scale}
          label="Accruals"
          value={m(rollup.accruals)}
          hint="Approved entries only"
        />
        <KpiTile
          icon={TrendingUp}
          label="ETC"
          value={m(rollup.etc)}
          hint={rollup.has_forecast ? "From forecast periods" : "Residual estimate"}
        />
      </KpiGrid>

      <KpiGrid columns={4} label={`Forecast and cash (${c})`}>
        <KpiTile icon={Target} label="EAC" value={m(rollup.eac)} hint="Actual + accruals + ETC" />
        <KpiTile
          icon={Scale}
          label="Variance at completion"
          status={vacStatus}
          value={m(rollup.variance_at_completion)}
          hint="Current budget − EAC"
        />
        <KpiTile
          icon={Wallet}
          label="Paid"
          value={m(rollup.paid)}
          hint="Recorded payable payments"
        />
        <KpiTile
          icon={HandCoins}
          label="Outstanding"
          value={m(rollup.outstanding)}
          hint="Actual − paid"
        />
      </KpiGrid>
    </div>
  );
}
