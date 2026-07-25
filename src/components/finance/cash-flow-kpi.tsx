// P-077 — Cash-flow KPI tile: peak funding requirement.
import { Card } from "@/components/ui/card";
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
    <div className="grid gap-3 md:grid-cols-3">
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Peak funding requirement
        </div>
        <div className="mt-1 text-2xl font-semibold text-foreground">
          {fmt(props.peak, props.baseCurrency)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {props.peakPeriod
            ? `Deepest cumulative dip · ${formatPeriod(props.peakPeriod)}`
            : "No funding gap projected"}
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Net forecast</div>
        <div className="mt-1 text-2xl font-semibold text-foreground">
          {fmt(props.netForecast, props.baseCurrency)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">Sum of forecast inflows − outflows</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Net actual</div>
        <div className="mt-1 text-2xl font-semibold text-foreground">
          {fmt(props.netActual, props.baseCurrency)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">Sum of realised inflows − outflows</div>
      </Card>
    </div>
  );
}
