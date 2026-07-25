// P-077 — Cash-flow KPI tile: peak funding requirement.
import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";

import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { formatPeriod } from "@/lib/cash-flow.rules";

function fmt(v: number, base: string): string {
  const abs = Math.abs(v);
  return `${v < 0 ? "-" : ""}${new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: base || "USD",
    maximumFractionDigits: 0,
  }).format(abs)}`;
}

export function CashFlowKpi(props: {
  peak: number;
  peakPeriod: string | null;
  baseCurrency: string;
  netForecast: number;
  netActual: number;
}) {
  return (
    <KpiGrid columns={3} label="Cash flow key performance indicators">
      <KpiTile
        icon={AlertTriangle}
        label="Peak funding requirement"
        value={fmt(props.peak, props.baseCurrency)}
        hint={
          props.peakPeriod
            ? `Deepest cumulative dip · ${formatPeriod(props.peakPeriod)}`
            : "No funding gap projected"
        }
      />
      <KpiTile
        icon={TrendingUp}
        label="Net forecast"
        value={fmt(props.netForecast, props.baseCurrency)}
        hint="Sum of forecast inflows − outflows"
      />
      <KpiTile
        icon={TrendingDown}
        label="Net actual"
        value={fmt(props.netActual, props.baseCurrency)}
        hint="Sum of realised inflows − outflows"
      />
    </KpiGrid>
  );
}
