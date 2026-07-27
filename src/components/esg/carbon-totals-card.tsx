// P-217 — Totals surface with formula tooltips and the honesty note.
import { Info, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ESG_FORMULA_TOOLTIP,
  ESG_METHODOLOGY_NOTE,
  formatKgCo2e,
  type ReportTotals,
} from "@/lib/esg/carbon";

function FormulaLabel({ label, formula }: { label: string; formula: string }) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      {label}
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label={`${label} formula`}>
            <Info className="size-3" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent>{formula}</TooltipContent>
      </Tooltip>
    </span>
  );
}

export function CarbonTotalsCard({
  totals,
  rowCount,
  status,
  busy,
  canCompute,
  onCompute,
}: {
  totals: ReportTotals | null;
  rowCount: number;
  status?: string;
  busy?: boolean;
  canCompute: boolean;
  onCompute: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold">Carbon totals</CardTitle>
          <p className="text-muted-foreground text-xs">{ESG_METHODOLOGY_NOTE}</p>
        </div>
        <div className="flex items-center gap-2">
          {status ? <Badge variant="secondary">{status}</Badge> : null}
          {canCompute ? (
            <Button variant="outline" disabled={busy} onClick={onCompute}>
              <RefreshCw className="size-4" aria-hidden /> Compute
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {!totals ? (
          <p className="text-muted-foreground text-sm">
            No report computed for this period yet.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Metric
              label="Scope 1"
              formula={ESG_FORMULA_TOOLTIP.emissions}
              value={formatKgCo2e(totals.scope_1_kg)}
            />
            <Metric
              label="Scope 2"
              formula={ESG_FORMULA_TOOLTIP.emissions}
              value={formatKgCo2e(totals.scope_2_kg)}
            />
            <Metric
              label="Scope 3"
              formula={ESG_FORMULA_TOOLTIP.emissions}
              value={formatKgCo2e(totals.scope_3_kg)}
            />
            <Metric
              label="Avoided"
              formula={ESG_FORMULA_TOOLTIP.avoided}
              value={
                totals.avoided_kg === null ? "n/a" : formatKgCo2e(totals.avoided_kg)
              }
              hint={totals.note === "no_metered_data" ? "No metered data" : undefined}
            />
            <Metric
              label="Net"
              formula={ESG_FORMULA_TOOLTIP.net}
              value={formatKgCo2e(totals.net_kg)}
              hint={totals.net_negative ? "Net negative" : undefined}
            />
            <p className="text-muted-foreground col-span-full text-xs">
              {rowCount} factored rows
              {totals.unfactored_count > 0
                ? ` · ${totals.unfactored_count} unfactored (excluded, not zeroed)`
                : ""}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  formula,
  value,
  hint,
}: {
  label: string;
  formula: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <FormulaLabel label={label} formula={formula} />
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <Badge variant="outline">{hint}</Badge> : null}
    </div>
  );
}
