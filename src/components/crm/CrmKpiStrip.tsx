import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import type { CrmKpis } from "@/lib/crm.functions";

interface Props {
  data: CrmKpis | undefined;
  isLoading: boolean;
}

export function CrmKpiStrip({ data, isLoading }: Props) {
  const items = [
    {
      label: "Win rate",
      value: data?.winRate == null ? "—" : `${(data.winRate * 100).toFixed(0)}%`,
      hint: "Trailing 12 months",
    },
    {
      label: "Proposal cycle",
      value: data?.proposalCycleDays == null ? "—" : `${data.proposalCycleDays.toFixed(1)}d`,
      hint: "Avg create → sent",
    },
    {
      label: "Avg deal size",
      value:
        data?.avgDealSize == null
          ? "—"
          : new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: data.avgDealCurrency || "USD",
              maximumFractionDigits: 0,
            }).format(data.avgDealSize),
      hint: "Won, trailing 12 mo",
    },
    {
      label: "Pipeline coverage",
      value: data?.pipelineCoverage == null ? "—" : `${data.pipelineCoverage.toFixed(1)}×`,
      hint: "Weighted vs. 3-mo target",
    },
  ];

  return (
    <KpiGrid label="CRM key performance indicators">
      {items.map((it) => (
        <KpiTile key={it.label} label={it.label} value={it.value} hint={it.hint} isLoading={isLoading} />
      ))}
    </KpiGrid>
  );
}
