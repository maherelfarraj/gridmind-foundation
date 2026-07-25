// P-076 — EVM KPI strip.
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { indexHealth, type IndexHealth } from "@/lib/evm.rules";
import type { EvmSnapshotRow } from "@/lib/evm.functions";

function fmt(currency: string, n: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

function healthClass(h: IndexHealth): string {
  if (h === "good") return "text-emerald-500";
  if (h === "warn") return "text-amber-500";
  if (h === "bad") return "text-destructive";
  return "text-muted-foreground";
}

export function EvmKpiStrip({ latest }: { latest: EvmSnapshotRow | null }) {
  if (!latest) return null;
  const spiHealth = indexHealth(latest.spi);
  const cpiHealth = indexHealth(latest.cpi);
  const eacVar =
    latest.estimate_at_completion == null
      ? null
      : latest.estimate_at_completion - latest.budget_at_completion;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      <Tile label="BAC" value={fmt(latest.currency_code, latest.budget_at_completion)} />
      <Tile label="PV (Planned)" value={fmt(latest.currency_code, latest.planned_value)} />
      <Tile label="EV (Earned)" value={fmt(latest.currency_code, latest.earned_value)} />
      <Tile label="AC (Actual)" value={fmt(latest.currency_code, latest.actual_cost)} />
      <Tile
        label="SPI"
        value={latest.spi == null ? "—" : latest.spi.toFixed(2)}
        valueClass={healthClass(spiHealth)}
        sub="Schedule perf."
      />
      <Tile
        label="CPI"
        value={latest.cpi == null ? "—" : latest.cpi.toFixed(2)}
        valueClass={healthClass(cpiHealth)}
        sub="Cost perf."
      />
      <Tile
        label="EAC"
        value={
          latest.estimate_at_completion == null
            ? "—"
            : fmt(latest.currency_code, latest.estimate_at_completion)
        }
        sub={
          eacVar == null
            ? undefined
            : `${eacVar >= 0 ? "+" : ""}${fmt(latest.currency_code, eacVar)} vs BAC`
        }
        subClass={
          eacVar == null
            ? undefined
            : eacVar > 0
              ? "text-destructive"
              : "text-emerald-500"
        }
      />
      <Tile
        label="Snapshot date"
        value={latest.snapshot_date}
        sub={`source: ${latest.source}`}
      />
    </div>
  );
}

function Tile(props: {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
  subClass?: string;
}) {
  return (
    <Card className="flex flex-col gap-1 p-3">
      <div className="text-xs uppercase text-muted-foreground">{props.label}</div>
      <div className={cn("text-lg font-semibold", props.valueClass)}>
        {props.value}
      </div>
      {props.sub ? (
        <div className={cn("text-xs text-muted-foreground", props.subClass)}>
          {props.sub}
        </div>
      ) : null}
    </Card>
  );
}
