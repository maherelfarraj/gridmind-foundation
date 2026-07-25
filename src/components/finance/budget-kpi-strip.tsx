// P-075 — Budget KPI strip: per-currency current, committed, actual, variance.
import { Banknote, Coins, Receipt, TrendingDown } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={<Banknote size={16} aria-hidden />} label="Budget">
          <span className="text-sm text-muted-foreground">No budgets yet</span>
        </Kpi>
        <Kpi icon={<Receipt size={16} aria-hidden />} label="Committed">
          <span className="text-sm text-muted-foreground">—</span>
        </Kpi>
        <Kpi icon={<Coins size={16} aria-hidden />} label="Actual">
          <span className="text-sm text-muted-foreground">—</span>
        </Kpi>
        <Kpi icon={<TrendingDown size={16} aria-hidden />} label="Variance">
          <span className="text-sm text-muted-foreground">—</span>
        </Kpi>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {totals.map((t) => (
        <CurrencyRow key={t.currency_code} t={t} />
      ))}
    </div>
  );
}

function CurrencyRow({ t }: { t: CurrencyTotals }) {
  const band = varianceBand(t.variance, t.current);
  const varianceClass =
    band === "destructive"
      ? "text-destructive"
      : band === "warning"
        ? "text-warning"
        : "text-foreground";
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Kpi
        icon={<Banknote size={16} aria-hidden />}
        label={`Budget (${t.currency_code})`}
      >
        <span className="text-2xl font-semibold text-foreground">
          {formatMoney(t.current, t.currency_code)}
        </span>
      </Kpi>
      <Kpi icon={<Receipt size={16} aria-hidden />} label="Committed">
        <span className="text-2xl font-semibold text-foreground">
          {formatMoney(t.committed, t.currency_code)}
        </span>
      </Kpi>
      <Kpi icon={<Coins size={16} aria-hidden />} label="Actual">
        <span className="text-2xl font-semibold text-foreground">
          {formatMoney(t.actual, t.currency_code)}
        </span>
      </Kpi>
      <Kpi icon={<TrendingDown size={16} aria-hidden />} label="Variance">
        <span className={cn("text-2xl font-semibold", varianceClass)}>
          {t.variance >= 0 ? "" : "-"}
          {formatMoney(Math.abs(t.variance), t.currency_code)}
        </span>
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
