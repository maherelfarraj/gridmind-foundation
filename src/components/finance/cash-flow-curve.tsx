// P-077 — Cumulative net cash-flow curve.
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatPeriod, type PivotResult } from "@/lib/cash-flow.rules";

export function CashFlowCurve(props: {
  pivot: PivotResult;
  baseCurrency: string;
}) {
  const data = props.pivot.netCumulative.map((r) => ({
    period: formatPeriod(r.period),
    forecastCum: Number(r.forecastCum.toFixed(2)),
    actualCum: Number(r.actualCum.toFixed(2)),
  }));

  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: props.baseCurrency || "USD",
    maximumFractionDigits: 0,
  });

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
        >
          <defs>
            <linearGradient id="cfActualFill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="hsl(var(--primary))"
                stopOpacity={0.35}
              />
              <stop
                offset="100%"
                stopColor="hsl(var(--primary))"
                stopOpacity={0}
              />
            </linearGradient>
            <linearGradient id="cfForecastFill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="hsl(var(--muted-foreground))"
                stopOpacity={0.2}
              />
              <stop
                offset="100%"
                stopColor="hsl(var(--muted-foreground))"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="period"
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickFormatter={(v) => formatter.format(Number(v))}
            width={90}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              color: "hsl(var(--popover-foreground))",
              borderRadius: 8,
            }}
            formatter={(value: number) => formatter.format(value)}
          />
          <Legend />
          <Area
            type="monotone"
            dataKey="forecastCum"
            name="Forecast (cumulative)"
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="4 4"
            fill="url(#cfForecastFill)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="actualCum"
            name="Actual (cumulative)"
            stroke="hsl(var(--primary))"
            fill="url(#cfActualFill)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
