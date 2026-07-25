// P-095 — Performance ratio test workspace.
import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Download, FileDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  attachPerformanceReport,
  createPerformanceRatioTest,
  getPerformanceTestDefaults,
  listPerformanceTests,
  type PrTestDefaults,
  type PrTestRow,
} from "@/lib/performance-tests.functions";
import { computePerformanceRatio, createPrTestInput } from "@/lib/performance-tests.schema";
import { buildPrTestReportPdfBytes } from "@/lib/exports/pr-test-report-pdf";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/commissioning/performance",
)({
  head: () => ({
    meta: [
      { title: "Performance Ratio Tests — GridMind EPC" },
      {
        name: "description",
        content:
          "Compare measured vs contract performance ratio and issue branded PR test reports.",
      },
      {
        property: "og:title",
        content: "Performance Ratio Tests — GridMind EPC",
      },
      {
        property: "og:description",
        content:
          "Compare measured vs contract performance ratio and issue branded PR test reports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PerformanceWorkspace,
});

const formSchema = createPrTestInput;
type FormValues = z.input<typeof formSchema>;

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}
function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function PerformanceWorkspace() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const listQ = useQuery({
    queryKey: ["pr-tests", projectId] as const,
    queryFn: () => listPerformanceTests({ data: { projectId } }),
  });
  const defaultsQ = useQuery({
    queryKey: ["pr-defaults", projectId] as const,
    queryFn: () => getPerformanceTestDefaults({ data: { projectId } }),
  });

  const rows = listQ.data?.rows ?? [];
  const canWrite = listQ.data?.canWrite ?? false;
  const defaults = defaultsQ.data ?? null;

  const chartData = useMemo(
    () =>
      rows
        .slice()
        .reverse()
        .map((r) => ({
          label: r.period_end
            ? new Date(r.period_end).toISOString().slice(0, 10)
            : r.id.slice(0, 6),
          measured: r.measured_value ?? 0,
          contract: r.contract_value ?? 0,
        })),
    [rows],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
              <Link to="/projects/$projectId/commissioning" params={{ projectId }}>
                <ArrowLeft size={12} aria-hidden />
                Back to commissioning
              </Link>
            </Button>
          </div>
          <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-foreground">
            Performance ratio tests
          </h2>
          <p className="text-sm text-muted-foreground">
            Measured vs contract PR, per test period. Branded PDF reports for the O&amp;M team.
          </p>
        </div>
        {canWrite ? (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus size={14} aria-hidden />
            New PR test
          </Button>
        ) : null}
      </header>

      {/* KPI + chart */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Latest measured PR
          </div>
          <div className="mt-2 text-3xl font-semibold text-foreground">
            {fmtPct(rows[0]?.measured_value)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Contract {fmtPct(rows[0]?.contract_value)}
          </div>
        </Card>
        <Card className="border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Latest variance
          </div>
          <div
            className={
              "mt-2 text-3xl font-semibold " +
              (rows[0]?.variance_pct == null
                ? "text-muted-foreground"
                : rows[0].variance_pct >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive")
            }
          >
            {rows[0]?.variance_pct != null
              ? `${rows[0].variance_pct >= 0 ? "+" : ""}${fmtNum(rows[0].variance_pct)}%`
              : "—"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {rows[0]?.period_start} → {rows[0]?.period_end}
          </div>
        </Card>
        <Card className="border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Tests recorded
          </div>
          <div className="mt-2 text-3xl font-semibold text-foreground">{rows.length}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Capacity {fmtNum(defaults?.capacityMwp ?? null, 3)} MWp
          </div>
        </Card>
      </div>

      <Card className="border-border bg-card p-4">
        <h3 className="mb-3 font-display text-sm font-semibold text-foreground">
          Measured vs contract PR
        </h3>
        {chartData.length === 0 ? (
          <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">
            No PR tests recorded yet.
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                <Legend />
                <ReferenceLine y={80} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                <Bar dataKey="contract" name="Contract PR" fill="hsl(var(--muted-foreground))" />
                <Bar dataKey="measured" name="Measured PR" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Table */}
      <Card className="border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Metered (MWh)</TableHead>
              <TableHead className="text-right">POA (kWh/m²)</TableHead>
              <TableHead className="text-right">Contract PR</TableHead>
              <TableHead className="text-right">Measured PR</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead className="text-right">Report</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No PR tests yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TestRow
                  key={r.id}
                  row={r}
                  defaults={defaults}
                  canWrite={canWrite}
                  onAttached={() => {
                    void qc.invalidateQueries({
                      queryKey: ["pr-tests", projectId],
                    });
                  }}
                />
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <NewPrDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
        defaults={defaults}
        onCreated={() => {
          setDialogOpen(false);
          void qc.invalidateQueries({ queryKey: ["pr-tests", projectId] });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table row with PDF export + attach report to record
// ---------------------------------------------------------------------------
function TestRow({
  row,
  defaults,
  canWrite,
  onAttached,
}: {
  row: PrTestRow;
  defaults: PrTestDefaults | null;
  canWrite: boolean;
  onAttached: () => void;
}) {
  const [busy, setBusy] = useState<"none" | "download" | "attach">("none");
  const attachMut = useMutation({ mutationFn: attachPerformanceReport });

  async function buildBytes(): Promise<Uint8Array | null> {
    if (
      !defaults ||
      row.metered_energy_mwh == null ||
      row.plane_of_array_kwh_m2 == null ||
      row.contract_value == null ||
      row.measured_value == null ||
      row.capacity_mwp == null
    ) {
      toast.error("Missing inputs on this test");
      return null;
    }
    let logoDataUrl: string | null = null;
    if (defaults.logoSignedUrl) {
      try {
        const res = await fetch(defaults.logoSignedUrl);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = "";
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          const b64 = btoa(bin);
          const ct = res.headers.get("content-type") ?? "image/png";
          logoDataUrl = `data:${ct};base64,${b64}`;
        }
      } catch {
        /* ignore */
      }
    }
    return buildPrTestReportPdfBytes({
      company: {
        name: defaults.companyName ?? "",
        legalName: defaults.companyLegalName,
      },
      project: {
        name: defaults.projectName ?? "",
        code: defaults.projectCode,
      },
      branding: {
        primaryColor: defaults.primaryColor,
        accentColor: defaults.accentColor,
        logoDataUrl,
      },
      periodStart: row.period_start ?? "",
      periodEnd: row.period_end ?? "",
      meteredEnergyMwh: row.metered_energy_mwh,
      poaKwhPerM2: row.plane_of_array_kwh_m2,
      capacityMwp: row.capacity_mwp,
      contractPrPct: row.contract_value,
      measuredPrPct: row.measured_value,
      variancePct: row.variance_pct ?? 0,
      notes: row.notes,
      generatedAt: new Date().toISOString(),
    });
  }

  async function downloadPdf() {
    setBusy("download");
    try {
      const bytes = await buildBytes();
      if (!bytes) return;
      const blob = new Blob([bytes as unknown as BlobPart], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pr-test-${row.period_end ?? row.id.slice(0, 6)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy("none");
    }
  }

  async function attachToRecord() {
    setBusy("attach");
    try {
      const bytes = await buildBytes();
      if (!bytes) return;
      const fileName = `pr-test-${row.period_end ?? row.id.slice(0, 6)}.pdf`;
      // Fetch companyId via defaults? We embed it in the storage path using
      // the row+project — server enforces the expected prefix. We derive
      // company_id from the row via the RLS-scoped project fetch: the
      // storage path must be `{companyId}/pr-report/{projectId}/{testId}/…`.
      // The client knows companyId only via defaults query context; the
      // server would return 400 if the prefix does not match.
      // Use documents bucket for uploads.
      // We need companyId; the profile query returns it via defaults query
      // — piggyback: fetch it from supabase directly.
      const { data: prof } = await supabase.from("profiles").select("company_id").maybeSingle();
      const companyId = (prof as any)?.company_id;
      if (!companyId) {
        toast.error("No company on profile");
        return;
      }
      const path = `${companyId}/pr-report/${row.project_id}/${row.id}/${fileName}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }), {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) throw upErr;
      await attachMut.mutateAsync({
        data: {
          testId: row.id,
          storagePath: path,
          fileName,
          fileSizeBytes: bytes.byteLength,
        },
      });
      toast.success("Report attached to test record");
      onAttached();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to attach report");
    } finally {
      setBusy("none");
    }
  }

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        {row.period_start} → {row.period_end}
      </TableCell>
      <TableCell className="text-right tabular-nums">{fmtNum(row.metered_energy_mwh)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtNum(row.plane_of_array_kwh_m2)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtPct(row.contract_value)}</TableCell>
      <TableCell className="text-right tabular-nums font-semibold">
        {fmtPct(row.measured_value)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.variance_pct != null ? (
          <Badge
            variant="outline"
            className={
              row.variance_pct >= 0
                ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                : "border-destructive/40 text-destructive"
            }
          >
            {row.variance_pct >= 0 ? "+" : ""}
            {fmtNum(row.variance_pct)}%
          </Badge>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={downloadPdf} disabled={busy !== "none"}>
            {busy === "download" ? (
              <Loader2 size={12} className="animate-spin" aria-hidden />
            ) : (
              <Download size={12} aria-hidden />
            )}
            PDF
          </Button>
          {canWrite ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={attachToRecord}
              disabled={busy !== "none"}
            >
              {busy === "attach" ? (
                <Loader2 size={12} className="animate-spin" aria-hidden />
              ) : (
                <FileDown size={12} aria-hidden />
              )}
              Attach
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// New PR test dialog
// ---------------------------------------------------------------------------
function NewPrDialog({
  open,
  onOpenChange,
  projectId,
  defaults,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  defaults: PrTestDefaults | null;
  onCreated: () => void;
}) {
  const seededRef = useRef(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectId,
      periodStart: "",
      periodEnd: "",
      meteredEnergyMwh: 0,
      poaKwhPerM2: 0,
      capacityMwp: 0,
      contractPr: 0,
      notes: "",
    },
  });

  // Seed from project defaults once when opened
  if (open && defaults && !seededRef.current) {
    seededRef.current = true;
    if (defaults.capacityMwp != null) form.setValue("capacityMwp", defaults.capacityMwp);
    if (defaults.contractPr != null) form.setValue("contractPr", defaults.contractPr);
  }
  if (!open && seededRef.current) seededRef.current = false;

  const values = form.watch();
  const previewPr = computePerformanceRatio(
    Number(values.meteredEnergyMwh),
    Number(values.poaKwhPerM2),
    Number(values.capacityMwp),
  );
  const previewVariance =
    previewPr != null && Number(values.contractPr) > 0
      ? ((previewPr - Number(values.contractPr)) / Number(values.contractPr)) * 100
      : null;

  const mut = useMutation({ mutationFn: createPerformanceRatioTest });

  async function onSubmit(v: FormValues) {
    try {
      await mut.mutateAsync({ data: v as any });
      toast.success("PR test recorded");
      form.reset({
        projectId,
        periodStart: "",
        periodEnd: "",
        meteredEnergyMwh: 0,
        poaKwhPerM2: 0,
        capacityMwp: defaults?.capacityMwp ?? 0,
        contractPr: defaults?.contractPr ?? 0,
        notes: "",
      });
      onCreated();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record performance ratio test</DialogTitle>
          <DialogDescription>
            Enter measured period totals; measured PR is computed server-side.
          </DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="col-span-1">
            <Label htmlFor="periodStart">Period start</Label>
            <Input id="periodStart" type="date" {...form.register("periodStart")} />
          </div>
          <div className="col-span-1">
            <Label htmlFor="periodEnd">Period end</Label>
            <Input id="periodEnd" type="date" {...form.register("periodEnd")} />
          </div>

          <div className="col-span-1">
            <Label htmlFor="meteredEnergyMwh">Metered energy (MWh)</Label>
            <Input
              id="meteredEnergyMwh"
              type="number"
              step="0.01"
              {...form.register("meteredEnergyMwh", { valueAsNumber: true })}
            />
          </div>
          <div className="col-span-1">
            <Label htmlFor="poaKwhPerM2">POA insolation (kWh/m²)</Label>
            <Input
              id="poaKwhPerM2"
              type="number"
              step="0.01"
              {...form.register("poaKwhPerM2", { valueAsNumber: true })}
            />
          </div>

          <div className="col-span-1">
            <Label htmlFor="capacityMwp">
              Nominal DC (MWp){" "}
              <span className="text-xs text-muted-foreground">(from PV config)</span>
            </Label>
            <Input
              id="capacityMwp"
              type="number"
              step="0.001"
              {...form.register("capacityMwp", { valueAsNumber: true })}
            />
          </div>
          <div className="col-span-1">
            <Label htmlFor="contractPr">
              Contract PR (%){" "}
              <span className="text-xs text-muted-foreground">(from yield config)</span>
            </Label>
            <Input
              id="contractPr"
              type="number"
              step="0.01"
              {...form.register("contractPr", { valueAsNumber: true })}
            />
          </div>

          <div className="col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              rows={2}
              {...form.register("notes")}
              placeholder="Method deviations, curtailment windows, O&M sign-off…"
            />
          </div>

          <Card className="col-span-2 flex items-center justify-between gap-3 border-border bg-muted/40 p-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Preview PR
              </div>
              <div className="text-lg font-semibold text-foreground">
                {previewPr != null ? `${previewPr.toFixed(2)}%` : "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Variance vs contract
              </div>
              <div
                className={
                  "text-lg font-semibold " +
                  (previewVariance == null
                    ? "text-muted-foreground"
                    : previewVariance >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-destructive")
                }
              >
                {previewVariance != null
                  ? `${previewVariance >= 0 ? "+" : ""}${previewVariance.toFixed(2)}%`
                  : "—"}
              </div>
            </div>
          </Card>

          <DialogFooter className="col-span-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={mut.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
              Save PR test
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
