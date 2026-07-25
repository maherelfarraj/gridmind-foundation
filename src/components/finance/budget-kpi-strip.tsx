// P-075 — Budget KPI strip: per-currency current, committed, actual, variance.
import { Banknote, Coins, Receipt, TrendingDown } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile, type KpiStatus } from "@/components/ui/kpi-tile";
import {
  formatMoney,
  totalsByCurrency,
  varianceBand,
  type CurrencyTotals,
} from "@/lib/budget.rules";
import type { BudgetRow } from "@/lib/budget.functions";

interface Props {
  budgets: BudgetRow[];
}

const BAND_STATUS: Record<ReturnType<typeof varianceBand>, KpiStatus> = {
  ok: "neutral",
  warning: "warning",
  destructive: "bad",
};

export function BudgetKpiStrip({ budgets }: Props) {
  const totals = totalsByCurrency(
    budgets.map((b) => ({
      cost_code_id: b.cost_code_id,
      original_amount: b.original_amount,
      approved_changes: b.approved_changes,
      current_amount: b.current_amount,
      committed_amount: b.committed_amount,
      actual_amount: b.actual_amount,
      currency_code: b.currency_code,
    })),
  );

  if (totals.length === 0) {
    return (
      <EmptyState icon={Banknote} title="No budgets yet" compact />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {totals.map((t) => (
        <CurrencyRow key={t.currency_code} t={t} />
      ))}
    </div>
  );
}

function CurrencyRow({ t }: { t: CurrencyTotals }) {
  const status = BAND_STATUS[varianceBand(t.variance, t.current)];
  return (
    <KpiGrid label={`Budget KPIs (${t.currency_code})`}>
      <KpiTile
        icon={Banknote}
        label={`Budget (${t.currency_code})`}
        value={formatMoney(t.current, t.currency_code)}
      />
      <KpiTile icon={Receipt} label="Committed" value={formatMoney(t.committed, t.currency_code)} />
      <KpiTile icon={Coins} label="Actual" value={formatMoney(t.actual, t.currency_code)} />
      <KpiTile
        icon={TrendingDown}
        label="Variance"
        status={status}
        value={`${t.variance >= 0 ? "" : "-"}${formatMoney(Math.abs(t.variance), t.currency_code)}`}
      />
    </KpiGrid>
  );
}
