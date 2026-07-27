// P-205 — Insurance coverage summary cards + coverage-by-type breakdown chart.
import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INSURANCE_EMPTY_STATE,
  coverageByType,
  countdownLabel,
  countdownTone,
  insuranceSummaries,
  instrumentTypeLabel,
  type BondRow,
  type CountdownTone,
} from "@/lib/bonds.rules";

const CHIP_TONE: Record<CountdownTone, string> = {
  good: "bg-accent/10 text-accent",
  warning: "bg-warning/15 text-warning",
  bad: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

const BAR_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function InsuranceSummaryCards({ rows }: { rows: BondRow[] }) {
  const summaries = useMemo(() => insuranceSummaries(rows), [rows]);
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {summaries.map((s) => (
        <Card key={s.instrument_type} className="space-y-2 p-4">
          <h3 className="text-sm font-semibold">{instrumentTypeLabel(s.instrument_type)}</h3>
          {s.active_count === 0 ? (
            <p className="text-xs text-muted-foreground">
              {INSURANCE_EMPTY_STATE[s.instrument_type]}
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {s.active_count} active {s.active_count === 1 ? "policy" : "policies"}
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {s.coverage.map((c) => money(c.amount, c.currency_code)).join(" · ")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {s.nearest_expiry ?? "No expiry"}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHIP_TONE[countdownTone(s.nearest_days)]}`}
                >
                  {countdownLabel(s.nearest_days)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{s.issuers.join(", ")}</p>
              <ul className="text-xs text-muted-foreground">
                {s.policies.map((p) => (
                  <li key={p.id}>
                    {p.instrument_number}
                    {p.document_path ? " · policy on file" : " · no policy document"}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      ))}
    </div>
  );
}

export function CoverageByTypeChart({ rows }: { rows: BondRow[] }) {
  const currencies = useMemo(
    () => [...new Set(rows.map((r) => r.currency_code))].sort(),
    [rows],
  );
  const [currency, setCurrency] = useState<string | null>(null);
  const active = currency && currencies.includes(currency) ? currency : (currencies[0] ?? "");
  const bars = useMemo(() => coverageByType(rows, active), [rows, active]);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeader
          title="Coverage by instrument type"
          description="Active coverage only — Σ amount per type, never converted across currencies."
        />
        {currencies.length > 1 ? (
          <Select value={active} onValueChange={setCurrency}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencies.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {bars.length === 0 ? (
        <EmptyState title="No active coverage to chart" compact />
      ) : (
        <div className="w-full" style={{ height: Math.max(160, bars.length * 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis
                type="number"
                className="fill-muted-foreground"
                tick={{ fontSize: 11 }}
                hide
              />
              <YAxis
                type="category"
                dataKey="label"
                width={160}
                className="fill-muted-foreground"
                tick={{ fontSize: 11 }}
              />
              <ChartTooltip
                cursor={{ className: "fill-muted/40" }}
                formatter={(v: number) => money(v, active)}
              />
              <Bar dataKey="amount" name="Coverage" radius={[0, 4, 4, 0]}>
                {bars.map((b, i) => (
                  <Cell key={b.instrument_type} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
