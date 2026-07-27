// P-197 — Revenue recognition (WIP): lender-ready work-in-progress schedule.
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileDown, Info, Loader2, Scale } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildWipReportPdfBytes, wipReportFilename } from "@/lib/exports/wip-pdf";
import { UNDER_BILLED_THRESHOLD_PCT } from "@/lib/finance/wip-thresholds";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { prepareWipExport } from "@/lib/wip.functions";
import {
  wipAccessQueryOptions,
  wipProjectsQueryOptions,
  wipReportQueryOptions,
} from "@/lib/wip.query";
import { BILLING_FLAG_LABEL, WIP_FORMULAS, todayIso, type WipContractRow } from "@/lib/wip.rules";

export const Route = createFileRoute("/_authenticated/finance/revenue-recognition")({
  head: () => ({
    meta: [
      { title: "Revenue recognition (WIP) — GridMind EPC" },
      {
        name: "description",
        content:
          "Lender-ready work-in-progress schedule: certified percentage-of-completion revenue, billings, collections, retention and under/over-billing position.",
      },
      { property: "og:title", content: "Revenue recognition (WIP) — GridMind EPC" },
      {
        property: "og:description",
        content: "Certified earned revenue versus billings and collections, per contract.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RevenueRecognitionPage,
});

function FormulaHead({ label, formula }: { label: string; formula: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1">
          {label}
          <Info className="size-3 text-muted-foreground" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">{formula}</TooltipContent>
    </Tooltip>
  );
}

function FlagBadge({ row }: { row: WipContractRow }) {
  if (row.flag === "balanced") return <Badge variant="outline">Balanced</Badge>;
  return (
    <Badge variant={row.flag === "under_billed" ? "secondary" : "destructive"}>
      {BILLING_FLAG_LABEL[row.flag]}
    </Badge>
  );
}

function RevenueRecognitionPage() {
  const navigate = useNavigate();
  const access = useQuery(wipAccessQueryOptions());
  const level = access.data?.level;

  useEffect(() => {
    if (level === "none") {
      toast.error("The WIP schedule is restricted to finance and project administrators.");
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [level, navigate]);

  const projects = useQuery(wipProjectsQueryOptions());
  const [projectId, setProjectId] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string>(todayIso());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!projectId && projects.data && projects.data.length > 0) setProjectId(projects.data[0].id);
  }, [projects.data, projectId]);

  const enabled = level === "full" || level === "read";
  const report = useQuery({
    ...wipReportQueryOptions(projectId, asOf),
    enabled: enabled && Boolean(projectId),
  });
  const prepare = useServerFn(prepareWipExport);

  const data = report.data;
  const currency = data?.base_currency ?? "USD";
  const money = (v: number) => formatMoney(v, currency);
  const rows = data?.rows ?? [];
  const rollup = data?.rollup;

  async function handleExport() {
    if (!projectId || !data) return;
    setBusy(true);
    try {
      const { branding, company } = await prepare({
        data: { project_id: projectId, as_of_date: data.as_of_date },
      });
      const bytes = await buildWipReportPdfBytes({
        project: data.project ? { name: data.project.name, code: data.project.code } : null,
        asOfDate: data.as_of_date,
        preparedBy: data.prepared_by,
        currency,
        rows: data.rows,
        rollup: data.rollup,
        branding,
        company,
      });
      const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = wipReportFilename({
        project: data.project ? { name: data.project.name, code: data.project.code } : null,
        asOfDate: data.as_of_date,
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4_000);
      toast.success("WIP schedule exported");
    } catch (error) {
      const err = error as { statusCode?: number; message?: string };
      toast.error(
        err.statusCode === 423
          ? "Export blocked — an approval is pending on this project."
          : (err.message ?? "Export failed"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (level === "none") return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work-in-Progress Schedule — percentage-of-completion (certified)"
        description={`As of ${formatDate(asOf)} · Prepared by ${data?.prepared_by ?? "—"}`}
        actions={
          <div className="flex items-center gap-2">
            {level === "read" ? <Badge variant="outline">Read-only</Badge> : null}
            <Button size="sm" onClick={() => void handleExport()} disabled={busy || !data}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <FileDown className="size-4" aria-hidden />
              )}
              Export PDF
            </Button>
          </div>
        }
      />

      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="wip-project">Project</Label>
          <Select value={projectId ?? undefined} onValueChange={(v) => setProjectId(v)}>
            <SelectTrigger id="wip-project" className="w-72">
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {(projects.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.code ? `${p.code} — ${p.name}` : p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wip-as-of">As-of date</Label>
          <Input
            id="wip-as-of"
            type="date"
            className="w-44"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value || todayIso())}
          />
        </div>
      </Card>

      {report.error ? (
        <Card className="flex flex-col items-start gap-3 border-destructive/40 p-5">
          <p className="text-sm font-medium text-destructive">Could not load the WIP schedule</p>
          <p className="text-sm text-muted-foreground">
            {(report.error as Error).message || "Unexpected error."}
          </p>
          <Button size="sm" variant="outline" onClick={() => void report.refetch()}>
            Retry
          </Button>
        </Card>
      ) : null}

      {report.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : null}

      {rollup && !report.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiTile label="Earned revenue" value={money(rollup.earned)} hint={WIP_FORMULAS.earned} />
          <KpiTile label="Billed" value={money(rollup.billed)} hint={WIP_FORMULAS.billed} />
          <KpiTile
            label="Collected"
            value={money(rollup.collected)}
            hint={WIP_FORMULAS.collected}
          />
          <KpiTile
            label="Net WIP"
            value={money(rollup.wip)}
            hint={WIP_FORMULAS.wip}
            status={rollup.wip >= 0 ? "good" : "warning"}
          />
          <KpiTile
            label="Under / over-billed"
            value={`${money(rollup.under_billed)} / ${money(rollup.over_billed)}`}
            hint="Σ positive WIP (under-billed asset) and Σ |negative WIP| (over-billed liability) across contracts."
          />
        </div>
      ) : null}

      {!report.isLoading && rows.length === 0 && !report.error ? (
        <EmptyState
          icon={Scale}
          title="No signed contracts with certified progress"
          description="Sign a contract and certify a pay application to recognise revenue on this project."
        />
      ) : null}

      {rows.length > 0 ? (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contract</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">
                  <FormulaHead label="% complete" formula={WIP_FORMULAS.percentComplete} />
                </TableHead>
                <TableHead className="text-right">
                  <FormulaHead label="Earned" formula={WIP_FORMULAS.earned} />
                </TableHead>
                <TableHead className="text-right">
                  <FormulaHead label="Billed" formula={WIP_FORMULAS.billed} />
                </TableHead>
                <TableHead className="text-right">
                  <FormulaHead label="Collected" formula={WIP_FORMULAS.collected} />
                </TableHead>
                <TableHead className="text-right">
                  <FormulaHead label="WIP" formula={WIP_FORMULAS.wip} />
                </TableHead>
                <TableHead>Position</TableHead>
                <TableHead className="text-right">
                  <FormulaHead label="Retention withheld" formula={WIP_FORMULAS.retention} />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.contract_id}
                  className={
                    r.over_threshold && r.flag === "under_billed" ? "bg-warning/10" : undefined
                  }
                >
                  <TableCell className="font-medium">{r.contract_number}</TableCell>
                  <TableCell>{r.counterparty}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.value)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPercent(r.percent_complete, { fromRatio: true })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.earned)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.billed)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.collected)}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${r.wip < 0 ? "text-destructive" : ""}`}
                  >
                    {money(r.wip)}
                  </TableCell>
                  <TableCell>
                    <FlagBadge row={r} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.retention_withheld)}
                  </TableCell>
                </TableRow>
              ))}
              {rollup ? (
                <TableRow className="border-t-2 font-medium">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-muted-foreground">
                    {rollup.contracts} contract{rollup.contracts === 1 ? "" : "s"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(rollup.contract_value)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPercent(
                      rollup.contract_value > 0 ? rollup.earned / rollup.contract_value : 0,
                      { fromRatio: true },
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(rollup.earned)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(rollup.billed)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(rollup.collected)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(rollup.wip)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">
                    {money(rollup.retention_withheld)}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      <Card className="space-y-2 p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Basis of preparation</p>
        <p>{WIP_FORMULAS.earned}</p>
        <p>{WIP_FORMULAS.billed}</p>
        <p>{WIP_FORMULAS.wip}</p>
        <p>
          Rows are highlighted when under-billing exceeds{" "}
          {formatPercent(UNDER_BILLED_THRESHOLD_PCT, { fromRatio: true, digits: 0 })} of contract
          value.
        </p>
      </Card>
    </div>
  );
}
