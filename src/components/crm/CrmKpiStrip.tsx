import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label} className="border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">{it.label}</p>
          {isLoading ? (
            <Skeleton className="mt-2 h-7 w-20" />
          ) : (
            <p className="mt-1 text-2xl font-semibold text-foreground">{it.value}</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">{it.hint}</p>
        </Card>
      ))}
    </div>
  );
}
