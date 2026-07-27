// P-218 — ESG dashboard charts. Token colors only.
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  ComposedChart,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { ESG_CATEGORY_LABEL } from "@/lib/esg/activity.rules";
import {
  ESG_TOOLTIP,
  fmtKg,
  type CategoryPoint,
  type MonthPoint,
  type ScopeSharePoint,
} from "@/lib/esg/dashboard.rules";

const SCOPE_COLOR: Record<string, string> = {
  scope_1: "var(--chart-1)",
  scope_2: "var(--chart-2)",
  scope_3: "var(--chart-3)",
};
const SCOPE_LABEL: Record<string, string> = {
  scope_1: "Scope 1",
  scope_2: "Scope 2",
  scope_3: "Scope 3",
};

function ChartCard({
  title,
  formula,
  empty,
  children,
}: {
  title: string;
  formula: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          {title}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label={`${title} formula`}>
                <Info className="text-muted-foreground size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{formula}</TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="h-64">
        {empty ? (
          <EmptyState title="No data in period" description="Nothing to chart yet." />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export function ScopeDonut({ data }: { data: ScopeSharePoint[] }) {
  const empty = data.every((d) => d.kg <= 0);
  return (
    <ChartCard title="Scope breakdown" formula={ESG_TOOLTIP.donut} empty={empty}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="kg"
            nameKey="scope"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
          >
            {data.map((d) => (
              <Cell key={d.scope} fill={SCOPE_COLOR[d.scope]} />
            ))}
          </Pie>
          <ChartTooltip
            formatter={(value: number, name: string) => [fmtKg(value), SCOPE_LABEL[name] ?? name]}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function MonthlyTrend({ data }: { data: MonthPoint[] }) {
  const empty = data.every((d) => d.scope_1_kg + d.scope_2_kg + d.scope_3_kg <= 0 && !d.avoided_kg);
  return (
    <ChartCard title="Monthly trend" formula={ESG_TOOLTIP.trend} empty={empty}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={11} />
          <YAxis stroke="var(--muted-foreground)" fontSize={11} />
          <ChartTooltip formatter={(v: number) => fmtKg(v)} />
          {(["scope_1", "scope_2", "scope_3"] as const).map((s) => (
            <Area
              key={s}
              type="monotone"
              dataKey={`${s}_kg`}
              name={SCOPE_LABEL[s]}
              stackId="scopes"
              stroke={SCOPE_COLOR[s]}
              fill={SCOPE_COLOR[s]}
              fillOpacity={0.35}
            />
          ))}
          <Line
            type="monotone"
            dataKey="avoided_kg"
            name="Avoided"
            stroke="var(--chart-4)"
            strokeDasharray="5 4"
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function CategoryBar({ data }: { data: CategoryPoint[] }) {
  const rows = data.map((d) => ({
    ...d,
    label: ESG_CATEGORY_LABEL[d.category as keyof typeof ESG_CATEGORY_LABEL] ?? d.category,
  }));
  return (
    <ChartCard
      title="Emissions by category"
      formula={ESG_TOOLTIP.category}
      empty={rows.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" stroke="var(--muted-foreground)" fontSize={11} />
          <YAxis
            type="category"
            dataKey="label"
            width={130}
            stroke="var(--muted-foreground)"
            fontSize={11}
          />
          <ChartTooltip formatter={(v: number) => fmtKg(v)} />
          <Bar dataKey="kg" name="CO2e" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export { AreaChart };
