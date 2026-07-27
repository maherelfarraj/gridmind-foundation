// P-056 — Yield scenario comparison chart.
import { useMemo, useState } from "react";
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

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { YieldScenarioRow } from "@/lib/yield.functions";
import { LOSS_KEYS } from "@/lib/yield.functions";

export function YieldComparison({ scenarios }: { scenarios: YieldScenarioRow[] }) {
  const withResults = useMemo(
    () => scenarios.filter((s) => s.results?.p50_mwh != null),
    [scenarios],
  );
  const [selected, setSelected] = useState<string[]>(() =>
    withResults.slice(0, 2).map((s) => s.id),
  );

  const rows = withResults.filter((s) => selected.includes(s.id));
  const base = scenarios.find((s) => s.scenario_name === "Base");

  const p50Data = rows.map((s) => ({
    name: s.scenario_name,
    P50: Math.round(s.results.p50_mwh ?? 0),
    P90: Math.round(s.results.p90_mwh ?? 0),
  }));

  const lossData = rows.map((s) => {
    const losses = (s.params as any)?.losses_pct ?? {};
    const row: any = { name: s.scenario_name };
    for (const k of LOSS_KEYS) row[k] = Number(losses[k] ?? 0);
    return row;
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  if (withResults.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Run at least one scenario estimate to compare.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select scenarios (2–4)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {withResults.map((s) => {
            const active = selected.includes(s.id);
            return (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={active}
                  onCheckedChange={() => toggle(s.id)}
                  disabled={!active && selected.length >= 4}
                />
                <Label className="cursor-pointer">{s.scenario_name}</Label>
              </label>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">P50 / P90 (MWh)</CardTitle>
        </CardHeader>
        <CardContent style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={p50Data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--popover-foreground)",
                }}
              />
              <Legend />
              <Bar dataKey="P50" fill="var(--primary)" />
              <Bar dataKey="P90" fill="var(--muted-foreground)" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Loss breakdown (%)</CardTitle>
        </CardHeader>
        <CardContent style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={lossData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--popover-foreground)",
                }}
              />
              <Legend />
              {LOSS_KEYS.map((k, i) => (
                <Bar
                  key={k}
                  dataKey={k}
                  stackId="loss"
                  fill={`var(--chart-${(i % 5) + 1})`}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delta vs Base</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scenario</TableHead>
                <TableHead className="text-right">P50 (MWh)</TableHead>
                <TableHead className="text-right">Δ vs Base</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const p50 = s.results.p50_mwh ?? 0;
                const basep50 = base?.results?.p50_mwh ?? null;
                const delta = basep50 && basep50 > 0 ? ((p50 - basep50) / basep50) * 100 : null;
                return (
                  <TableRow key={s.id}>
                    <TableCell>{s.scenario_name}</TableCell>
                    <TableCell className="text-right">{p50.toFixed(0)}</TableCell>
                    <TableCell className="text-right">
                      {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
