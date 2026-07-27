import { BarChart3, Info, Zap } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, parseISO } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { useRunYieldStub } from "@/lib/proposal-query";
import type { ProposalDetail } from "@/lib/proposal.functions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatNumber(v: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(v);
}

export function YieldSimulationCard({
  proposal,
  readOnly,
}: {
  proposal: ProposalDetail;
  readOnly: boolean;
}) {
  const run = useRunYieldStub(proposal.id);
  const yr = proposal.yield_result;
  const canRun = !!proposal.array_config;

  const monthlyData = yr?.monthly?.map((v, i) => ({ month: MONTHS[i], kwh: v })) ?? [];

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Yield simulation</h3>
          <p className="text-xs text-muted-foreground">
            8760-hour deterministic stub — engine{" "}
            <code className="text-[10px]">gridmind-stub-v1</code>
          </p>
        </div>
        {!readOnly && (
          <Button
            size="sm"
            onClick={() => run.mutate()}
            disabled={!canRun || run.isPending}
            title={canRun ? "" : "Save array config first"}
          >
            <Zap size={14} aria-hidden />
            {run.isPending ? "Running…" : yr ? "Re-run simulation" : "Run simulation"}
          </Button>
        )}
      </div>

      {!yr ? (
        <EmptyState
          icon={BarChart3}
          title="No simulation yet"
          description='Configure the array and click "Run simulation".'
          compact
        />
      ) : (
        <>
          <KpiGrid label="Yield simulation results">
            <KpiTile label="P50 (annual)" value={`${formatNumber(yr.p50_kwh)} kWh`} status="good" />
            <KpiTile label="P90 (annual)" value={`${formatNumber(yr.p90_kwh)} kWh`} />
            <KpiTile
              label="Specific yield"
              value={`${formatNumber(yr.specific_yield_kwh_kwp)} kWh/kWp`}
            />
            <KpiTile label="Performance ratio" value={yr.performance_ratio.toFixed(3)} />
          </KpiGrid>

          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickFormatter={(v) =>
                    v >= 1_000_000
                      ? `${(v / 1_000_000).toFixed(1)}M`
                      : v >= 1_000
                        ? `${(v / 1_000).toFixed(0)}k`
                        : String(v)
                  }
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [`${formatNumber(v)} kWh`, "Output"]}
                />
                <Bar dataKey="kwh" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            Engine: <code>{yr.engine}</code> · computed{" "}
            {yr.computed_at ? format(parseISO(yr.computed_at), "PPp") : "—"}
          </div>
        </>
      )}

      <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
        <span>Placeholder engine — replaced by PVsyst import in Stage 2 (Engineering).</span>
      </div>
    </Card>
  );
}
