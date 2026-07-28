// P-208 — GL export workspace: period picker, journal preview, CSV download.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BookOpenCheck, Download, ListTree, ScrollText, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/lib/i18n/locale-provider";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";
import { MoneyCell, Num } from "@/components/ui/num";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadCsv } from "@/lib/csv";
import {
  downloadGlExport,
  generateGlExport,
  previewGlExport,
  type GlPreview,
} from "@/lib/gl.functions";
import { glErrorInfo, glWorkspaceQueryOptions } from "@/lib/gl.query";
import { GL_EVENT_LABELS, type GlEventType, type GlLine } from "@/lib/gl.rules";

export const Route = createFileRoute("/_authenticated/finance/gl-export/")({
  head: () => ({
    meta: [
      { title: "GL export — GridMind EPC" },
      {
        name: "description",
        content:
          "Generate a balanced general-ledger journal from invoices, payments, retention, change orders and debit notes, then export it as CSV.",
      },
      { property: "og:title", content: "GL export — GridMind EPC" },
      {
        property: "og:description",
        content: "Balanced double-entry journal export straight from audited finance data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GlExportPage,
});

function GlExportPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const workspace = useQuery(glWorkspaceQueryOptions());
  const preview = useServerFn(previewGlExport);
  const generate = useServerFn(generateGlExport);
  const download = useServerFn(downloadGlExport);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [result, setResult] = useState<GlPreview | null>(null);

  useEffect(() => {
    const period = workspace.data?.default_period;
    if (period && !from && !to) {
      setFrom(period.from);
      setTo(period.to);
    }
  }, [workspace.data, from, to]);

  const base = workspace.data?.base_currency ?? "USD";
  const money = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: base,
        maximumFractionDigits: 2,
      }),
    [base],
  );

  const previewMutation = useMutation({
    mutationFn: () => preview({ data: { period_from: from, period_to: to } }),
    onSuccess: (data) => setResult(data),
    onError: (err) => toast.error(translateError(t, errorCodeOf(err), glErrorInfo(err).message)),
  });

  const generateMutation = useMutation({
    mutationFn: () => generate({ data: { period_from: from, period_to: to } }),
    onSuccess: (run) => {
      toast.success(
        run.superseded.length
          ? t("financeMod.glExport.toastRunSuperseded", {
              run: run.run_number,
              list: run.superseded.join(", "),
            })
          : t("financeMod.glExport.toastRunGenerated", {
              run: run.run_number,
              count: run.row_count,
            }),
      );
      void queryClient.invalidateQueries({ queryKey: ["gl"] });
    },
    onError: (err) => {
      const info = glErrorInfo(err);
      toast.error(translateError(t, errorCodeOf(err), info.message), {
        description: info.unbalanced.length
          ? info.unbalanced.map((u) => `${u.source_number}: ${u.reason}`).join(" ")
          : undefined,
      });
    },
  });

  const downloadMutation = useMutation({
    mutationFn: (runId: string) => download({ data: { run_id: runId } }),
    onSuccess: (res) => {
      downloadCsv(`${res.run_number}.csv`, res.csv);
      toast.success(
        t("financeMod.glExport.toastCsvSaved", {
          file: `${res.run_number}.csv`,
          path: res.file_path,
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ["gl"] });
    },
    onError: (err) => toast.error(translateError(t, errorCodeOf(err), glErrorInfo(err).message)),
  });

  const runs = workspace.data?.runs ?? [];
  const mappings = workspace.data?.mappings ?? [];
  const canWrite = workspace.data?.can_write ?? false;

  const missingForRange = useMemo(() => {
    if (!result) return [] as GlEventType[];
    return [...result.missing_mappings, ...result.disabled_mappings];
  }, [result]);

  const balanced = result ? result.balanced : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("financeMod.glExport.title")}
        description={t("financeMod.glExport.subtitle")}
        actions={
          <Button variant="outline" asChild>
            <Link to="/finance/gl-export/mappings">
              <ListTree className="me-2 size-4" /> {t("financeMod.glExport.chartOfAccounts")}
            </Link>
          </Button>
        }
      />

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="gl-from">{t("financeMod.glExport.fromLabel")}</Label>
            <Input
              id="gl-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gl-to">{t("financeMod.glExport.toLabel")}</Label>
            <Input
              id="gl-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-44"
            />
          </div>
          <Button
            onClick={() => previewMutation.mutate()}
            disabled={!from || !to || previewMutation.isPending}
          >
            <ScrollText className="me-2 size-4" />
            {previewMutation.isPending
              ? t("financeMod.glExport.previewing")
              : t("financeMod.glExport.preview")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => generateMutation.mutate()}
            disabled={!from || !to || !canWrite || generateMutation.isPending}
          >
            <BookOpenCheck className="me-2 size-4" />
            {generateMutation.isPending
              ? t("financeMod.glExport.generating")
              : t("financeMod.glExport.generateAction")}
          </Button>
          <div className="ms-auto flex items-center gap-2">
            <Switch id="gl-group" checked={grouped} onCheckedChange={setGrouped} />
            <Label htmlFor="gl-group" className="text-sm text-muted-foreground">
              {t("financeMod.glExport.groupBySource")}
            </Label>
          </div>
        </div>
        {!canWrite ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("financeMod.glExport.writeHint")}</p>
        ) : null}
      </section>

      {result ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label={t("financeMod.glExport.journalLines")}
              value={String(result.lines.length)}
            />
            <KpiTile
              label={t("financeMod.glExport.totalDebit")}
              value={<Num>{money.format(result.total_debit)}</Num>}
            />
            <KpiTile
              label={t("financeMod.glExport.totalCredit")}
              value={<Num>{money.format(result.total_credit)}</Num>}
            />
            <KpiTile
              label={t("financeMod.glExport.balance")}
              value={
                balanced ? t("financeMod.glExport.balanced") : t("financeMod.glExport.outOfBalance")
              }
              status={balanced ? "good" : "bad"}
            />
          </div>

          {missingForRange.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
              <TriangleAlert className="size-4" />
              <span>{t("financeMod.glExport.mappingsMissing")}</span>
              {missingForRange.map((ev) => (
                <StatusBadge key={ev} status={ev} tone="attention" label={GL_EVENT_LABELS[ev]} />
              ))}
              <Button variant="link" asChild className="h-auto p-0">
                <Link to="/finance/gl-export/mappings">{t("financeMod.glExport.fixMappings")}</Link>
              </Button>
            </div>
          ) : null}

          {result.fx_missing.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("financeMod.glExport.fxMissing", { base, list: result.fx_missing.join(", ") })}
            </p>
          ) : null}

          <JournalTable
            lines={result.lines}
            grouped={grouped}
            money={money}
            totalDebit={result.total_debit}
            totalCredit={result.total_credit}
            balanced={Boolean(balanced)}
          />
        </>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">{t("financeMod.glExport.exportRuns")}</h2>
        {workspace.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : runs.length === 0 ? (
          <EmptyState
            icon={BookOpenCheck}
            title={t("financeMod.glExport.noRuns")}
            description={t("financeMod.glExport.noRunsDesc")}
          />
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("financeMod.glExport.runHeader")}</TableHead>
                  <TableHead>{t("financeMod.glExport.periodHeader")}</TableHead>
                  <TableHead className="text-end">{t("financeMod.glExport.linesHeader")}</TableHead>
                  <TableHead className="text-end">{t("financeMod.glExport.debitHeader")}</TableHead>
                  <TableHead className="text-end">{t("financeMod.glExport.creditHeader")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead className="text-end">{t("financeMod.glExport.csvHeader")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">{run.run_number}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <Num>
                        {run.period_from} → {run.period_to}
                      </Num>
                    </TableCell>
                    <TableCell className="text-end">
                      <Num>{run.row_count}</Num>
                    </TableCell>
                    <TableCell className="text-end">
                      <MoneyCell>{money.format(run.total_debit)}</MoneyCell>
                    </TableCell>
                    <TableCell className="text-end">
                      <MoneyCell>{money.format(run.total_credit)}</MoneyCell>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite || downloadMutation.isPending}
                        onClick={() => downloadMutation.mutate(run.id)}
                      >
                        <Download className="me-2 size-4" /> {t("financeMod.glExport.download")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {mappings.length === 0 && !workspace.isLoading ? (
          <p className="text-sm text-muted-foreground">
            {t("financeMod.glExport.noMappings")}{" "}
            <Link to="/finance/gl-export/mappings" className="underline">
              {t("financeMod.glExport.setMappings")}
            </Link>{" "}
            {t("financeMod.glExport.beforeGenerating")}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function JournalTable({
  lines,
  grouped,
  money,
  totalDebit,
  totalCredit,
  balanced,
}: {
  lines: GlLine[];
  grouped: boolean;
  money: Intl.NumberFormat;
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}) {
  const { t } = useI18n();
  const groups = useMemo(() => {
    if (!grouped) return [{ key: "all", label: "", lines }];
    const map = new Map<string, GlLine[]>();
    for (const line of lines) {
      const list = map.get(line.event_type) ?? [];
      list.push(line);
      map.set(line.event_type, list);
    }
    return [...map.entries()].map(([key, value]) => ({
      key,
      label: GL_EVENT_LABELS[key as GlEventType] ?? key,
      lines: value,
    }));
  }, [lines, grouped]);

  if (lines.length === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        title={t("financeMod.glExport.nothingToPost")}
        description={t("financeMod.glExport.nothingToPostDesc")}
      />
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.key} className="rounded-lg border border-border">
          {group.label ? (
            <div className="border-b border-border px-4 py-2 text-sm font-medium">
              {group.label}{" "}
              <span className="text-muted-foreground">
                {group.lines.length === 1
                  ? t("financeMod.glExport.lineCount_one", { count: group.lines.length })
                  : t("financeMod.glExport.lineCount_other", { count: group.lines.length })}
              </span>
            </div>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("financeMod.glExport.accountHeader")}</TableHead>
                <TableHead>{t("financeMod.glExport.nameHeader")}</TableHead>
                <TableHead className="text-end">{t("financeMod.glExport.dr")}</TableHead>
                <TableHead className="text-end">{t("financeMod.glExport.cr")}</TableHead>
                <TableHead>{t("financeMod.glExport.memoHeader")}</TableHead>
                <TableHead>{t("financeMod.glExport.sourceHeader")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.lines.map((line) => (
                <TableRow key={line.line_no}>
                  <TableCell>
                    <Num>{line.entry_date}</Num>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{line.account_code}</TableCell>
                  <TableCell>{line.account_name}</TableCell>
                  <TableCell className="text-end">
                    <MoneyCell>{line.debit ? money.format(line.debit) : "—"}</MoneyCell>
                  </TableCell>
                  <TableCell className="text-end">
                    <MoneyCell>{line.credit ? money.format(line.credit) : "—"}</MoneyCell>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{line.memo}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {line.source_type} · {line.source_number}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
      <div
        className={`flex items-center justify-end gap-8 rounded-lg border p-3 text-sm font-medium ${
          balanced
            ? "border-success/40 bg-success/10 text-success"
            : "border-destructive/40 bg-destructive/10 text-destructive"
        }`}
      >
        <Num>{t("financeMod.glExport.footerDr", { amount: money.format(totalDebit) })}</Num>
        <Num>{t("financeMod.glExport.footerCr", { amount: money.format(totalCredit) })}</Num>
        <span>{balanced ? t("financeMod.glExport.balanced") : t("financeMod.glExport.outOfBalance")}</span>
      </div>
    </div>
  );
}
