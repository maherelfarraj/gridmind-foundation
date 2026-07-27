// P-076 — EVM S-curve (Recharts).
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Card } from "@/components/ui/card";
import type { EvmSnapshotRow } from "@/lib/evm.functions";

function fmt(currency: string, n: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

export function EvmSCurve({ rows }: { rows: EvmSnapshotRow[] }) {
  const currency = rows[0]?.currency_code ?? "USD";
  const data = rows.map((r) => ({
    date: r.snapshot_date,
    PV: r.planned_value,
    EV: r.earned_value,
    AC: r.actual_cost,
  }));

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">S-Curve — cumulative PV / EV / AC</h3>
        <span className="text-xs text-muted-foreground">Currency: {currency}</span>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} />
            <YAxis
              stroke="var(--muted-foreground)"
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) =>
                new Intl.NumberFormat(undefined, {
                  notation: "compact",
                  maximumFractionDigits: 1,
                }).format(v)
              }
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 12,
              }}
              formatter={(v: number, name: string) => [fmt(currency, v), name]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="PV"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="EV"
              stroke="var(--chart-2)"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="AC"
              stroke="var(--destructive)"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
