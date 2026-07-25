// P-074 — Risk register KPI strip.
import { AlertTriangle, ClipboardList, PiggyBank, Timer } from "lucide-react";

import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  AGE_BAND_TEXT,
  bandForAge,
  formatCurrency,
  type AgeBand,
} from "@/lib/risks.rules";

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

export function RiskKpiStrip({
  openCount,
  highCount,
  contingency,
  ageDays,
}: Props) {
  const band: AgeBand = bandForAge(ageDays);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Kpi icon={<ClipboardList size={16} aria-hidden />} label="Open risks">
        <span className="text-2xl font-semibold text-foreground">
          {openCount}
        </span>
      </Kpi>
      <Kpi icon={<AlertTriangle size={16} aria-hidden />} label="High risks (≥15)">
        <span
          className={cn(
            "text-2xl font-semibold",
            highCount > 0 ? "text-destructive" : "text-foreground",
          )}
        >
          {highCount}
        </span>
      </Kpi>
      <Kpi
        icon={<PiggyBank size={16} aria-hidden />}
        label="Contingency exposure"
      >
        {contingency.primary ? (
          <div className="flex flex-col">
            <span className="text-2xl font-semibold text-foreground">
              {formatCurrency(
                contingency.primary.amount,
                contingency.primary.code,
              )}
            </span>
            {contingency.otherCount > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help text-xs text-muted-foreground">
                      + {contingency.otherCount} other currency
                      {contingency.otherCount === 1 ? "" : "ies"}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <ul className="text-xs">
                      {Object.entries(contingency.totalsByCurrency).map(
                        ([code, amt]) => (
                          <li key={code}>{formatCurrency(amt, code)}</li>
                        ),
                      )}
                    </ul>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">None</span>
        )}
      </Kpi>
      <Kpi icon={<Timer size={16} aria-hidden />} label="Register age">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "cursor-help text-2xl font-semibold",
                  AGE_BAND_TEXT[band],
                )}
              >
                {ageDays == null ? "—" : `${ageDays}d`}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Risk register freshness — review monthly
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
