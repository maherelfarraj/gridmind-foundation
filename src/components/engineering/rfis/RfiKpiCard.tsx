// P-059 — RFI KPI card with 4 tiles + monthly Recharts bar.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui/card";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import type { RfiKpiResult } from "@/lib/rfi.functions";

export function RfiKpiCard({ kpis }: { kpis: RfiKpiResult }) {
  const avg = kpis.turnaround_days_avg == null ? "—" : `${kpis.turnaround_days_avg} d`;
  const pct = kpis.pct_on_time == null ? "—" : `${kpis.pct_on_time}%`;
  return (
    <Card className="p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">RFI performance</h2>
        <span className="text-xs text-muted-foreground">Last 90 days</span>
      </div>
      <KpiGrid label="RFI KPIs">
        <KpiTile label="Turnaround" value={avg} hint={`${kpis.answered_count} answered`} />
        <KpiTile label="Open" value={kpis.open_count} hint={`${kpis.total_count} total`} />
        <KpiTile
          label="Overdue"
          value={kpis.overdue_count}
          status={kpis.overdue_count > 0 ? "bad" : "neutral"}
        />
        <KpiTile
          label="On-time"
          value={pct}
          status={kpis.pct_on_time != null && kpis.pct_on_time >= 80 ? "good" : "neutral"}
        />
      </KpiGrid>
      <div className="mt-4 h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={kpis.by_month}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--popover-foreground))",
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="raised" fill="hsl(var(--primary))" name="Raised" />
            <Bar dataKey="answered" fill="hsl(var(--muted-foreground))" name="Answered" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
