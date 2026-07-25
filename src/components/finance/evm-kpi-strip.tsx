// P-076 — EVM KPI strip.
import { CalendarClock, Coins, Gauge, PiggyBank, Target, TrendingUp, Wallet } from "lucide-react";

import { KpiGrid, KpiTile, type KpiStatus } from "@/components/ui/kpi-tile";
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

function healthStatus(h: IndexHealth): KpiStatus {
  if (h === "good") return "good";
  if (h === "warn") return "warning";
  if (h === "bad") return "bad";
  return "neutral";
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
    <KpiGrid columns={6} label="EVM key performance indicators">
      <KpiTile icon={Wallet} label="BAC" value={fmt(latest.currency_code, latest.budget_at_completion)} />
      <KpiTile
        icon={Target}
        label="PV (Planned)"
        value={fmt(latest.currency_code, latest.planned_value)}
      />
      <KpiTile
        icon={TrendingUp}
        label="EV (Earned)"
        value={fmt(latest.currency_code, latest.earned_value)}
      />
      <KpiTile icon={Coins} label="AC (Actual)" value={fmt(latest.currency_code, latest.actual_cost)} />
      <KpiTile
        icon={Gauge}
        label="SPI"
        status={healthStatus(spiHealth)}
        value={latest.spi == null ? "—" : latest.spi.toFixed(2)}
        hint="Schedule perf."
      />
      <KpiTile
        icon={PiggyBank}
        label="CPI"
        status={healthStatus(cpiHealth)}
        value={latest.cpi == null ? "—" : latest.cpi.toFixed(2)}
        hint="Cost perf."
      />
      <KpiTile
        icon={CalendarClock}
        label="EAC"
        status={eacVar == null ? "neutral" : eacVar > 0 ? "bad" : "good"}
        value={
          latest.estimate_at_completion == null
            ? "—"
            : fmt(latest.currency_code, latest.estimate_at_completion)
        }
        hint={
          eacVar == null
            ? undefined
            : `${eacVar >= 0 ? "+" : ""}${fmt(latest.currency_code, eacVar)} vs BAC`
        }
      />
      <KpiTile
        icon={CalendarClock}
        label="Snapshot date"
        value={latest.snapshot_date}
        hint={`source: ${latest.source}`}
      />
    </KpiGrid>
  );
}
