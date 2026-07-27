// P-082 — LCOE scenarios tab (server-computed LCOE + Recharts compare).
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Plus } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { upsertLcoeScenario } from "@/lib/lcoe.functions";
import {
  lcoeListQueryOptions,
  projectFinanceAccessQueryOptions,
  projectFinanceErrorMessage,
} from "@/lib/project-finance.query";
import { computeLcoe, type LcoeRow } from "@/lib/project-finance.rules";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/finance/project-finance/lcoe",
)({
  head: () => ({
    meta: [
      { title: "LCOE scenarios — GridMind EPC" },
      {
        name: "description",
        content: "Levelised cost of energy scenarios with server-computed LCOE.",
      },
      { property: "og:title", content: "LCOE scenarios — GridMind EPC" },
      {
        property: "og:description",
        content: "Compare LCOE scenarios by discount rate, capex and opex.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(lcoeListQueryOptions(params.projectId)),
      context.queryClient.ensureQueryData(projectFinanceAccessQueryOptions()),
    ]);
  },
  errorComponent: ({ error, reset }) => (
    <Card className="p-4">
      <p className="text-sm text-destructive">{projectFinanceErrorMessage(error)}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={reset}>
        Try again
      </Button>
    </Card>
  ),
  pendingComponent: () => (
    <div className="space-y-3">
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  ),
  component: LcoeTab,
});

function money(n: number, code = "USD", digits = 4) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: code,
    maximumFractionDigits: digits,
  });
}

function LcoeTab() {
  const { projectId } = Route.useParams();
  const list = useSuspenseQuery(lcoeListQueryOptions(projectId));
  const access = useSuspenseQuery(projectFinanceAccessQueryOptions());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LcoeRow | null>(null);

  const rows = list.data.rows;

  const lowest = useMemo(() => {
    const withLcoe = rows.filter((r) => r.lcoe != null) as Array<LcoeRow & { lcoe: number }>;
    if (withLcoe.length === 0) return null;
    return withLcoe.reduce((a, b) => (a.lcoe <= b.lcoe ? a : b));
  }, [rows]);

  const chartData = rows
    .filter((r) => r.lcoe != null)
    .map((r) => ({ name: r.name, LCOE: Number((r.lcoe ?? 0).toFixed(2)) }));

  const exportCsv = () => {
    const header = [
      "name",
      "capex",
      "opex_annual",
      "discount_rate_pct",
      "annual_energy_mwh",
      "degradation_pct",
      "project_life_years",
      "currency",
      "lcoe",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          JSON.stringify(r.name),
          r.capex,
          r.opex_annual,
          r.discount_rate_pct,
          r.annual_energy_mwh,
          r.degradation_pct,
          r.project_life_years,
          r.currency_code,
          r.lcoe ?? "",
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    a.href = url;
    a.download = `lcoe-${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {rows.length === 0 ? "No scenarios yet." : `${rows.length} scenario(s)`}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-2 size-4" /> CSV
          </Button>
          {access.data.canWrite ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="mr-2 size-4" /> New scenario
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Create the first LCOE scenario to compare cost of energy assumptions.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Capex</TableHead>
                <TableHead className="text-right">Opex / yr</TableHead>
                <TableHead className="text-right">r%</TableHead>
                <TableHead className="text-right">MWh / yr</TableHead>
                <TableHead className="text-right">Life</TableHead>
                <TableHead className="text-right">LCOE / MWh</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => {
                    if (!access.data.canWrite) return;
                    setEditing(r);
                    setOpen(true);
                  }}
                >
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.capex, r.currency_code, 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.opex_annual, r.currency_code, 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.discount_rate_pct}%</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.annual_energy_mwh.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.project_life_years}y</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {r.lcoe == null ? "—" : money(r.lcoe, r.currency_code, 4)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {chartData.length > 0 ? (
        <Card className="p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Scenario comparison</h2>
            {lowest ? (
              <div className="text-xs text-muted-foreground">
                Lowest LCOE: <span className="font-medium text-foreground">{lowest.name}</span> at r
                = {lowest.discount_rate_pct}% ({money(lowest.lcoe, lowest.currency_code, 4)}/MWh)
              </div>
            ) : null}
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    color: "var(--popover-foreground)",
                    borderRadius: 6,
                  }}
                />
                <Bar dataKey="LCOE" fill="var(--primary)" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}

      {open ? (
        <LcoeDrawer projectId={projectId} initial={editing} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}

interface LcoeDrawerProps {
  projectId: string;
  initial: LcoeRow | null;
  onClose: () => void;
}

function LcoeDrawer({ projectId, initial, onClose }: LcoeDrawerProps) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertLcoeScenario);
  const [name, setName] = useState(initial?.name ?? "");
  const [capex, setCapex] = useState(String(initial?.capex ?? 120_000_000));
  const [opex, setOpex] = useState(String(initial?.opex_annual ?? 1_800_000));
  const [rate, setRate] = useState(String(initial?.discount_rate_pct ?? 7));
  const [energy, setEnergy] = useState(String(initial?.annual_energy_mwh ?? 260_000));
  const [degradation, setDegradation] = useState(String(initial?.degradation_pct ?? 0.5));
  const [life, setLife] = useState(String(initial?.project_life_years ?? 25));
  const [currency, setCurrency] = useState(initial?.currency_code ?? "USD");

  const preview = useMemo(() => {
    try {
      return computeLcoe({
        capex: Number(capex || 0),
        opex_annual: Number(opex || 0),
        discount_rate_pct: Number(rate || 0),
        annual_energy_mwh: Number(energy || 0),
        degradation_pct: Number(degradation || 0),
        project_life_years: parseInt(life || "0", 10),
      });
    } catch {
      return null;
    }
  }, [capex, opex, rate, energy, degradation, life]);

  const mut = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          id: initial?.id,
          project_id: projectId,
          name,
          capex: Number(capex),
          opex_annual: Number(opex),
          discount_rate_pct: Number(rate),
          annual_energy_mwh: Number(energy),
          degradation_pct: Number(degradation),
          project_life_years: parseInt(life, 10),
          currency_code: currency,
          assumptions: {},
        },
      }),
    onSuccess: async () => {
      toast.success(initial ? "Scenario updated" : "Scenario created");
      await qc.invalidateQueries({ queryKey: ["pf", "lcoe", projectId] });
      onClose();
    },
    onError: (err) => toast.error(projectFinanceErrorMessage(err)),
  });

  const canSave =
    name.trim().length > 0 &&
    Number(energy) > 0 &&
    Number(capex) >= 0 &&
    parseInt(life, 10) >= 1 &&
    currency.length === 3;

  return (
    <Sheet open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{initial ? "Edit scenario" : "New LCOE scenario"}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 grid gap-3">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Capex</Label>
              <Input
                type="number"
                step="0.01"
                value={capex}
                onChange={(e) => setCapex(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Opex / yr</Label>
              <Input
                type="number"
                step="0.01"
                value={opex}
                onChange={(e) => setOpex(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>Discount rate %</Label>
              <Input
                type="number"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Degradation % / yr</Label>
              <Input
                type="number"
                step="0.01"
                value={degradation}
                onChange={(e) => setDegradation(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Life (years)</Label>
              <Input type="number" min="1" value={life} onChange={(e) => setLife(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Annual energy MWh</Label>
              <Input
                type="number"
                step="0.01"
                value={energy}
                onChange={(e) => setEnergy(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Currency</Label>
              <Input
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </div>
          </div>
          <Card className="bg-primary/5 border-primary/20 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Preview LCOE (server recomputes on save)
            </div>
            <div className="text-xl font-semibold tabular-nums">
              {preview == null ? "—" : money(preview, currency || "USD", 4)}/MWh
            </div>
          </Card>
        </div>
        <SheetFooter className="mt-6 gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Saving…" : initial ? "Update" : "Create"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
