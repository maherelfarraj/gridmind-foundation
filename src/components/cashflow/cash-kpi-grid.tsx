// GC-13 — Liquidity headline measures for a project or the portfolio.
import { Banknote, Gauge, Landmark, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import { KpiTile } from "@/components/ui/kpi-tile";
import { cashTone, count, fundingTone, money, percent } from "@/components/cashflow/cash-format";
import type { FundingPosition, LiquidityMeasures } from "@/lib/cashflow.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.cashFlow";

export function CashKpiGrid({
  measures,
  funding,
  currency,
}: {
  measures: LiquidityMeasures;
  funding: FundingPosition;
  currency: string;
}) {
  const { t } = useI18n();
  const m = measures;

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      role="group"
      aria-label={t(`${K}.kpi.groupLabel`)}
    >
      <KpiTile
        label={t(`${K}.kpi.openingCash`)}
        value={money(m.opening_cash, currency)}
        icon={Wallet}
        hint={t(`${K}.kpi.openingCashHint`)}
      />
      <KpiTile
        label={t(`${K}.kpi.inflow`)}
        value={money(m.total_inflow, currency)}
        icon={TrendingUp}
        hint={t(`${K}.kpi.inflowHint`)}
      />
      <KpiTile
        label={t(`${K}.kpi.outflow`)}
        value={money(m.total_outflow, currency)}
        icon={TrendingDown}
        hint={t(`${K}.kpi.outflowHint`)}
      />
      <KpiTile
        label={t(`${K}.kpi.closingCash`)}
        value={money(m.closing_cash, currency)}
        icon={Banknote}
        status={cashTone(m.closing_cash)}
        hint={t(`${K}.kpi.closingCashHint`)}
      />
      <KpiTile
        label={t(`${K}.kpi.peakFunding`)}
        value={money(m.peak_funding_need, currency)}
        icon={Landmark}
        status={m.peak_funding_need > 0 ? "warning" : "good"}
        hint={t(`${K}.kpi.peakFundingHint`)}
      />
      <KpiTile
        label={t(`${K}.kpi.minLiquidity`)}
        value={money(m.minimum_liquidity, currency)}
        icon={Gauge}
        status={cashTone(m.minimum_liquidity)}
        hint={t(`${K}.kpi.minLiquidityHint`)}
      />
      <KpiTile
        label={t(`${K}.kpi.unfunded`)}
        value={money(funding.unfunded_requirement, currency)}
        icon={Landmark}
        status={fundingTone(funding.unfunded_requirement, funding.utilization_pct)}
        hint={t(`${K}.kpi.unfundedHint`)}
      />
      <KpiTile
        label={t(`${K}.kpi.runway`)}
        value={m.runway_buckets === null ? "—" : count(m.runway_buckets)}
        icon={Gauge}
        hint={t(`${K}.kpi.runwayHint`, { utilization: percent(funding.utilization_pct) })}
      />
    </div>
  );
}
