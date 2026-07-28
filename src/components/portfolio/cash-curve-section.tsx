// P-253 — Consolidated cash curve: forecast vs actual, monthly ↔ cumulative,
// total ↔ per-project contribution, with a month drill panel.
// Presentational only — all math lives in cash-curve.rules.ts.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LineChart as LineChartIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  consolidateCurve,
  curvePoints,
  monthLabel,
  movementTotals,
  projectContributionSeries,
  type ProjectCurveRow,
} from "@/lib/portfolio/cash-curve.rules";
import {
  portfolioCashCurveQueryOptions,
  portfolioCashMonthQueryOptions,
} from "@/lib/portfolio/portfolio-query";

const RANGES = [
  { back: 12, forward: 6 },
  { back: 24, forward: 12 },
  { back: 6, forward: 3 },
] as const;

const SERIES_STROKES = [
  "var(--primary)",
  "var(--accent)",
  "var(--warning)",
  "var(--chart-4, var(--muted-foreground))",
  "var(--chart-5, var(--secondary))",
];

export function CashCurveSection({ baseCurrency }: { baseCurrency: string }) {
  const { t, locale } = useI18n();
  const [range, setRange] = useState<{ back: number; forward: number }>(RANGES[0]);
  const [cumulative, setCumulative] = useState(false);
  const [byProject, setByProject] = useState(false);
  const [month, setMonth] = useState<string | null>(null);

  const curveQuery = useQuery(portfolioCashCurveQueryOptions(range));
  const monthQuery = useQuery(portfolioCashMonthQueryOptions(month));

  const rows = useMemo<ProjectCurveRow[]>(() => curveQuery.data ?? [], [curveQuery.data]);
  const months = useMemo(() => consolidateCurve(rows), [rows]);
  const points = useMemo(
    () => curvePoints(months, cumulative).map((p) => ({ ...p, label: monthLabel(p.month) })),
    [months, cumulative],
  );
  const series = useMemo(() => projectContributionSeries(rows, { cumulative }), [rows, cumulative]);
  const stacked = series.data.map((row) => ({
    ...row,
    label: monthLabel(String(row.month)),
  }));

  const money = (v: number) => formatCurrency(v, locale, baseCurrency);
  const axisMoney = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: baseCurrency || "USD",
      maximumFractionDigits: 0,
      notation: "compact",
    }).format(Number(v));

  const movements = monthQuery.data ?? [];
  const totals = movementTotals(movements);

  const onMonthClick = (label: unknown) => {
    const found = months.find((m) => monthLabel(m.month) === String(label));
    setMonth(found ? found.month : null);
  };

  const tooltipStyle = {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    color: "var(--popover-foreground)",
    borderRadius: 8,
  } as const;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("portfolioMod.cash.heading")}
        description={t("portfolioMod.cash.description", { currency: baseCurrency })}
      />

      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <Button
            key={`${r.back}-${r.forward}`}
            type="button"
            size="sm"
            variant={r.back === range.back && r.forward === range.forward ? "default" : "outline"}
            onClick={() => setRange(r)}
          >
            {t("portfolioMod.cash.rangeOption", { back: r.back, forward: r.forward })}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button
          type="button"
          size="sm"
          variant={cumulative ? "default" : "outline"}
          aria-pressed={cumulative}
          onClick={() => setCumulative((v) => !v)}
        >
          {cumulative ? t("portfolioMod.cash.cumulative") : t("portfolioMod.cash.monthly")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={byProject ? "default" : "outline"}
          aria-pressed={byProject}
          onClick={() => setByProject((v) => !v)}
        >
          {byProject ? t("portfolioMod.cash.byProject") : t("portfolioMod.cash.total")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("portfolioMod.cash.baseCurrency", { currency: baseCurrency })}
        </span>
      </div>

      {curveQuery.isLoading ? (
        <Card className="p-4">
          <Skeleton className="h-72 w-full" />
        </Card>
      ) : months.length === 0 ? (
        <EmptyState
          icon={LineChartIcon}
          title={t("portfolioMod.cash.empty.title")}
          description={t("portfolioMod.cash.empty.description")}
        />
      ) : (
        <Card className="p-4">
          {/* Numbers stay Western/LTR even in RTL layouts. */}
          <div className="h-72 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              {byProject ? (
                <BarChart data={stacked} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={12}
                    width={80}
                    tickFormatter={(v) => axisMoney(Number(v))}
                  />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => money(v)} />
                  <Legend />
                  {series.projects.map((p, i) => (
                    <Bar
                      key={p.project_id}
                      dataKey={p.project_id}
                      name={p.project_code}
                      stackId="cash"
                      fill={SERIES_STROKES[i % SERIES_STROKES.length]}
                      onClick={(d: { label?: string }) => onMonthClick(d?.label)}
                    />
                  ))}
                </BarChart>
              ) : (
                <AreaChart
                  data={points}
                  margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                  onClick={(e: { activeLabel?: string }) => onMonthClick(e?.activeLabel)}
                >
                  <defs>
                    <linearGradient id="pfActualFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="pfForecastFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--muted-foreground)" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="var(--muted-foreground)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={12}
                    width={80}
                    tickFormatter={(v) => axisMoney(Number(v))}
                  />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => money(v)} />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="forecast"
                    name={t("portfolioMod.cash.forecast")}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                    fill="url(#pfForecastFill)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="actual"
                    name={t("portfolioMod.cash.actual")}
                    stroke="var(--primary)"
                    fill="url(#pfActualFill)"
                    strokeWidth={2}
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
          {series.projects.length === 1 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("portfolioMod.cash.singleProject")}
            </p>
          ) : null}
        </Card>
      )}

      {month ? (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("portfolioMod.cash.drill.heading", { month: monthLabel(month) })}
            </h3>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMonth(null)}>
              {t("portfolioMod.cash.drill.close")}
            </Button>
          </div>
          {monthQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("portfolioMod.cash.drill.none")}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-start text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 text-start">{t("portfolioMod.cash.drill.project")}</th>
                      <th className="py-2 text-start">{t("portfolioMod.cash.drill.kind")}</th>
                      <th className="py-2 text-start">{t("portfolioMod.cash.drill.direction")}</th>
                      <th className="py-2 text-start">{t("portfolioMod.cash.drill.category")}</th>
                      <th className="py-2 text-end">{t("portfolioMod.cash.drill.amount")}</th>
                      <th className="py-2 text-end">{t("portfolioMod.cash.drill.reference")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id} className="border-t border-border">
                        <td className="py-2 text-foreground">{m.project_code}</td>
                        <td className="py-2 text-muted-foreground">
                          {t(`portfolioMod.cash.kind.${m.kind}`, { defaultValue: m.kind })}
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {t(`portfolioMod.cash.direction.${m.direction}`, {
                            defaultValue: m.direction,
                          })}
                        </td>
                        <td className="py-2 text-muted-foreground">{m.category ?? "—"}</td>
                        <td className="py-2 text-end font-medium tabular-nums text-foreground">
                          {formatCurrency(Number(m.amount_base ?? 0), locale, m.base_currency)}
                        </td>
                        <td className="py-2 text-end">
                          <Link
                            to="/projects/$projectId/finance/cash-flow"
                            params={{ projectId: m.project_id }}
                            className="text-xs underline underline-offset-2"
                          >
                            {m.reference_type ?? t("portfolioMod.cash.drill.open")}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("portfolioMod.cash.drill.totals", {
                  in: money(totals.inflow),
                  out: money(totals.outflow),
                  net: money(totals.net),
                })}
              </p>
            </>
          )}
        </Card>
      ) : (
        <p className="text-xs text-muted-foreground">{t("portfolioMod.cash.drill.hint")}</p>
      )}
    </section>
  );
}
