// P-157 — PV simulation results dashboard: KPI tiles, loss waterfall, monthly
// chart, P-scenario compare and the per-step formula accordion.
import { Activity, BarChart3, Gauge, Percent, Sun, TrendingDown } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiTile } from "@/components/ui/kpi-tile";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export interface LossStepRow {
  index: number;
  step: string;
  label: string;
  formula: string;
  inputs: Record<string, unknown>;
  input_sources: Record<string, string>;
  loss_pct: number;
  energy_kwh: number;
  monthly_kwh: number[];
}

export interface SimulationResultRow {
  monthly: Array<{ month: number; energy_kwh: number; poa_kwh_m2: number; cell_temp_c: number }>;
  annual: Record<string, number | string>;
  loss_chain: LossStepRow[];
  p_scenarios: {
    p50_kwh: number;
    p75_kwh: number | null;
    p90_kwh: number | null;
    p99_kwh: number | null;
    sigma_pct: number | null;
    formula: string;
    note: string | null;
  };
  engine_id: string;
  calc_version: number;
  computed_at: string;
}

export interface SimulationRecord {
  id: string;
  name: string;
  status: string;
  is_baseline: boolean;
  engine_id: string;
  calc_version: number;
  computed_at: string | null;
  created_at: string;
  inputs: Record<string, unknown>;
  input_sources: Record<string, string>;
  pv_simulation_results?: SimulationResultRow[] | null;
}

export function resultOf(sim: SimulationRecord | null | undefined): SimulationResultRow | null {
  const rows = sim?.pv_simulation_results ?? [];
  return rows.length > 0 ? rows[0] : null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function fmt(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

/** Gross → each loss step → net, in the persisted loss_chain order. */
export function waterfallData(chain: LossStepRow[]) {
  if (chain.length === 0) return [];
  const gross = chain[0].energy_kwh;
  const rows: Array<{ name: string; base: number; delta: number; kind: string; loss: number }> = [
    { name: "Gross", base: 0, delta: gross, kind: "gross", loss: 0 },
  ];
  let running = gross;
  for (const step of chain.slice(1)) {
    const after = step.energy_kwh;
    const drop = running - after;
    rows.push({
      name: step.label,
      base: after,
      delta: Math.max(0, drop),
      kind: "loss",
      loss: drop,
    });
    running = after;
  }
  rows.push({ name: "Net", base: 0, delta: running, kind: "net", loss: 0 });
  return rows;
}

const KIND_FILL: Record<string, string> = {
  gross: "var(--color-chart-1)",
  loss: "var(--color-chart-3)",
  net: "var(--color-chart-2)",
};

export function PvSimulationResults({ simulation }: { simulation: SimulationRecord }) {
  const result = resultOf(simulation);
  if (!result) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No results stored for this run"
        description="Re-run the simulation to regenerate the transparent loss chain."
      />
    );
  }

  const annual = result.annual;
  const chain = result.loss_chain ?? [];
  const gross = chain.length > 0 ? chain[0].energy_kwh : 0;
  const grossMonthly = chain.length > 0 ? chain[0].monthly_kwh : [];
  const waterfall = waterfallData(chain);
  const p = result.p_scenarios;

  const monthly = (result.monthly ?? []).map((m, i) => ({
    month: MONTH_LABELS[i] ?? String(m.month),
    gross: Math.round((grossMonthly[i] ?? 0) / 1000),
    net: Math.round(m.energy_kwh / 1000),
  }));

  const scenarioData =
    p.sigma_pct === null
      ? []
      : [
          { name: "P50", mwh: num(p.p50_kwh) / 1000 },
          { name: "P75", mwh: num(p.p75_kwh) / 1000 },
          { name: "P90", mwh: num(p.p90_kwh) / 1000 },
          { name: "P99", mwh: num(p.p99_kwh) / 1000 },
        ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiTile
          label="Annual net energy"
          value={`${fmt(num(annual.energy_kwh) / 1000, 0)} MWh`}
          hint={`Gross ${fmt(gross / 1000, 0)} MWh before losses`}
          icon={Sun}
        />
        <KpiTile
          label="Specific yield"
          value={`${fmt(num(annual.specific_yield_kwh_per_kwp), 0)} kWh/kWp`}
          hint={`${fmt(num(annual.array_dc_kwp) / 1000, 1)} MWp DC`}
          icon={Activity}
        />
        <KpiTile
          label="Performance ratio"
          value={`${fmt(num(annual.performance_ratio_pct), 1)} %`}
          icon={Percent}
          status={num(annual.performance_ratio_pct) >= 78 ? "good" : "warning"}
        />
        <KpiTile
          label="Capacity factor"
          value={`${fmt(num(annual.capacity_factor_pct), 1)} %`}
          icon={Gauge}
        />
        <KpiTile label="P50" value={`${fmt(num(p.p50_kwh) / 1000, 0)} MWh`} icon={TrendingDown} />
        <KpiTile
          label="P90"
          value={p.p90_kwh === null ? "—" : `${fmt(num(p.p90_kwh) / 1000, 0)} MWh`}
          hint={p.note ?? `σ = ${p.sigma_pct}%`}
          status={p.p90_kwh === null ? "warning" : "neutral"}
          icon={TrendingDown}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Loss waterfall — gross to net</CardTitle>
        </CardHeader>
        <CardContent className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={waterfall} margin={{ top: 8, right: 8, left: 8, bottom: 72 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="name"
                angle={-40}
                textAnchor="end"
                interval={0}
                height={80}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              />
              <YAxis
                tickFormatter={(v: number) => fmt(v / 1000, 0)}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                label={{
                  value: "MWh",
                  angle: -90,
                  position: "insideLeft",
                  fill: "var(--color-muted-foreground)",
                  fontSize: 11,
                }}
              />
              <Tooltip
                formatter={(value: number, key: string) =>
                  key === "delta" ? `${fmt(value / 1000, 1)} MWh` : ""
                }
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.5rem",
                  color: "var(--color-popover-foreground)",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
              <Bar dataKey="delta" stackId="w" isAnimationActive={false}>
                {waterfall.map((row) => (
                  <Cell key={row.name} fill={KIND_FILL[row.kind]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly energy — gross vs net</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                />
                <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                <Tooltip
                  formatter={(v: number) => `${fmt(v, 0)} MWh`}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "0.5rem",
                    color: "var(--color-popover-foreground)",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="gross" name="Gross" fill="var(--color-chart-4)" />
                <Bar dataKey="net" name="Net" fill="var(--color-chart-2)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">P-scenarios</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {scenarioData.length === 0 ? (
              <EmptyState
                compact
                icon={TrendingDown}
                title="insufficient_data"
                description={
                  p.note ??
                  "Provide the interannual variability σ to compute P75, P90 and P99 exceedance scenarios."
                }
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={scenarioData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                  <Tooltip
                    formatter={(v: number) => `${fmt(v, 0)} MWh`}
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "0.5rem",
                      color: "var(--color-popover-foreground)",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="mwh" name="Energy" fill="var(--color-chart-1)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Loss chain — formulas, inputs and sources
            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
              {result.engine_id} · v{result.calc_version}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {chain.map((step) => (
              <AccordionItem key={step.step} value={step.step}>
                <AccordionTrigger className="text-sm">
                  <span className="flex w-full items-center justify-between gap-3 pr-2">
                    <span className="truncate">
                      <span className="mr-2 font-mono text-xs text-muted-foreground">
                        {String(step.index).padStart(2, "0")}
                      </span>
                      {step.label}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      −{fmt(step.loss_pct, 2)} % · {fmt(step.energy_kwh / 1000, 0)} MWh
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3">
                  <p className="rounded-md bg-muted p-3 font-mono text-xs text-foreground">
                    {step.formula}
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Inputs</p>
                      <ul className="space-y-1 text-xs">
                        {Object.entries(step.inputs).map(([k, v]) => (
                          <li key={k} className="flex justify-between gap-3">
                            <span className="text-muted-foreground">{k}</span>
                            <span className="font-mono">{v === null ? "—" : String(v)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        Input sources
                      </p>
                      <ul className="space-y-1 text-xs">
                        {Object.entries(step.input_sources).map(([k, v]) => (
                          <li key={k} className="flex justify-between gap-3">
                            <span className="text-muted-foreground">{k}</span>
                            <span className="font-mono">{v}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}

/** Delta table between two simulations: headline metrics + each loss step. */
export function PvSimulationCompare({ a, b }: { a: SimulationRecord; b: SimulationRecord }) {
  const ra = resultOf(a);
  const rb = resultOf(b);
  if (!ra || !rb) {
    return (
      <EmptyState
        compact
        icon={BarChart3}
        title="Both simulations need stored results"
        description="Re-run any simulation that has no persisted result before comparing."
      />
    );
  }

  const headline = [
    ["Annual net (MWh)", num(ra.annual.energy_kwh) / 1000, num(rb.annual.energy_kwh) / 1000, 0],
    [
      "Specific yield (kWh/kWp)",
      num(ra.annual.specific_yield_kwh_per_kwp),
      num(rb.annual.specific_yield_kwh_per_kwp),
      0,
    ],
    [
      "Performance ratio (%)",
      num(ra.annual.performance_ratio_pct),
      num(rb.annual.performance_ratio_pct),
      2,
    ],
    [
      "Capacity factor (%)",
      num(ra.annual.capacity_factor_pct),
      num(rb.annual.capacity_factor_pct),
      2,
    ],
  ] as const;

  const stepsB = new Map(rb.loss_chain.map((s) => [s.step, s]));

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead className="text-right">{a.name}</TableHead>
            <TableHead className="text-right">{b.name}</TableHead>
            <TableHead className="text-right">Δ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {headline.map(([label, va, vb, digits]) => (
            <TableRow key={label}>
              <TableCell>{label}</TableCell>
              <TableCell className="text-right font-mono">{fmt(va, digits)}</TableCell>
              <TableCell className="text-right font-mono">{fmt(vb, digits)}</TableCell>
              <TableCell
                className={`text-right font-mono ${vb - va >= 0 ? "text-accent" : "text-destructive"}`}
              >
                {vb - va >= 0 ? "+" : ""}
                {fmt(vb - va, digits)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Loss step</TableHead>
            <TableHead className="text-right">{a.name} (%)</TableHead>
            <TableHead className="text-right">{b.name} (%)</TableHead>
            <TableHead className="text-right">Δ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ra.loss_chain.map((step) => {
            const other = stepsB.get(step.step);
            const delta = (other?.loss_pct ?? 0) - step.loss_pct;
            return (
              <TableRow key={step.step}>
                <TableCell>{step.label}</TableCell>
                <TableCell className="text-right font-mono">{fmt(step.loss_pct, 2)}</TableCell>
                <TableCell className="text-right font-mono">
                  {other ? fmt(other.loss_pct, 2) : "—"}
                </TableCell>
                <TableCell
                  className={`text-right font-mono ${delta <= 0 ? "text-accent" : "text-destructive"}`}
                >
                  {delta >= 0 ? "+" : ""}
                  {fmt(delta, 2)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
