// P-074 — Risk register KPI strip.
import { AlertTriangle, ClipboardList, PiggyBank, Timer } from "lucide-react";

import { KpiGrid, KpiTile, type KpiStatus } from "@/components/ui/kpi-tile";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { bandForAge, formatCurrency, type AgeBand } from "@/lib/risks.rules";

interface Props {
  openCount: number;
  highCount: number;
  contingency: {
    primary: { code: string; amount: number } | null;
    otherCount: number;
    totalsByCurrency: Record<string, number>;
  };
  ageDays: number | null;
}

const AGE_BAND_STATUS: Record<AgeBand, KpiStatus> = {
  ok: "neutral",
  warning: "warning",
  destructive: "bad",
};

export function RiskKpiStrip({ openCount, highCount, contingency, ageDays }: Props) {
  const band: AgeBand = bandForAge(ageDays);
  const contingencyHint =
    contingency.primary && contingency.otherCount > 0 ? (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              + {contingency.otherCount} other currency
              {contingency.otherCount === 1 ? "" : "ies"}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <ul className="text-xs">
              {Object.entries(contingency.totalsByCurrency).map(([code, amt]) => (
                <li key={code}>{formatCurrency(amt, code)}</li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : undefined;

  return (
    <KpiGrid label="Risk register KPIs">
      <KpiTile icon={ClipboardList} label="Open risks" value={openCount} />
      <KpiTile
        icon={AlertTriangle}
        label="High risks (≥15)"
        value={highCount}
        status={highCount > 0 ? "bad" : "neutral"}
      />
      <KpiTile
        icon={PiggyBank}
        label="Contingency exposure"
        value={
          contingency.primary
            ? formatCurrency(contingency.primary.amount, contingency.primary.code)
            : "None"
        }
        hint={contingencyHint}
      />
      <KpiTile
        icon={Timer}
        label="Register age"
        value={
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">{ageDays == null ? "—" : `${ageDays}d`}</span>
              </TooltipTrigger>
              <TooltipContent>Risk register freshness — review monthly</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        }
        status={ageDays == null ? "neutral" : AGE_BAND_STATUS[band]}
      />
    </KpiGrid>
  );
}
