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
import type { RfiKpiResult } from "@/lib/rfi.functions";

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "success"
        ? "text-primary"
        : "text-foreground";
  return (
    <div className="rounded border border-border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function RfiKpiCard({ kpis }: { kpis: RfiKpiResult }) {
  const avg =
    kpis.turnaround_days_avg == null
      ? "—"
      : `${kpis.turnaround_days_avg} d`;
  const pct = kpis.pct_on_time == null ? "—" : `${kpis.pct_on_time}%`;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">RFI performance</h2>
        <span className="text-xs text-muted-foreground">Last 90 days</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Turnaround"
          value={avg}
          hint={`${kpis.answered_count} answered`}
        />
        <Tile
          label="Open"
          value={String(kpis.open_count)}
          hint={`${kpis.total_count} total`}
        />
        <Tile
          label="Overdue"
          value={String(kpis.overdue_count)}
          tone={kpis.overdue_count > 0 ? "danger" : "default"}
        />
        <Tile
          label="On-time"
          value={pct}
          tone={
            kpis.pct_on_time != null && kpis.pct_on_time >= 80
              ? "success"
              : "default"
          }
        />
      </div>
      <div className="mt-4 h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={kpis.by_month}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
            />
            <XAxis
              dataKey="month"
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--popover-foreground))",
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              dataKey="raised"
              fill="hsl(var(--primary))"
              name="Raised"
            />
            <Bar
              dataKey="answered"
              fill="hsl(var(--muted-foreground))"
              name="Answered"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
