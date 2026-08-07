// GC-03 — Forecast version history, lifecycle actions and side-by-side comparison.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Download, GitCompare, History, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
import { Textarea } from "@/components/ui/textarea";
import {
  actOnForecastVersion,
  createForecastVersion,
  refreshForecastVersion,
} from "@/lib/costing.close.functions";
import {
  costingCloseQueryOptions,
  forecastCompareQueryOptions,
  forecastVersionDetailQueryOptions,
} from "@/lib/costing.close.query";
import {
  buildForecastCompareCsv,
  buildForecastVersionCsv,
  forecastVersionCsvFilename,
} from "@/lib/costing.versions.csv";
import { downloadCsv } from "@/lib/csv";
import { costingErrorMessage } from "@/lib/costing.query";
import { formatCostingMoney } from "@/lib/costing.rules";
import {
  pickBaselineVersion,
  UNASSIGNED_COST_CODE_KEY,
  type ForecastVersionStatus,
} from "@/lib/costing.versions";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing/versions")({
  head: () => ({
    meta: [
      { title: "Forecast versions — GridMind EPC" },
      {
        name: "description",
        content:
          "Immutable forecast snapshots with approval workflow and baseline comparison for the project cost position.",
      },
      { property: "og:title", content: "Forecast versions — GridMind EPC" },
      {
        property: "og:description",
        content: "Snapshot, submit, approve and compare project cost forecast versions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(costingCloseQueryOptions(params.projectId)),
  pendingComponent: () => <Skeleton className="h-64 w-full" />,
  component: VersionsView,
});

const STATUS_TONE: Record<ForecastVersionStatus, "default" | "secondary" | "outline"> = {
  working: "outline",
  submitted: "secondary",
  approved: "default",
  superseded: "outline",
};

function VersionsView() {
  const { t } = useI18n();
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(costingCloseQueryOptions(projectId));

  const createFn = useServerFn(createForecastVersion);
  const refreshFn = useServerFn(refreshForecastVersion);
  const actFn = useServerFn(actOnForecastVersion);

  const versions = data.versions;
  const baseline = useMemo(() => pickBaselineVersion(versions), [versions]);
  const latest = versions[0] ?? null;

  const [fromId, setFromId] = useState<string>(baseline?.id ?? "none");
  const [toId, setToId] = useState<string>(latest?.id ?? "");
  const [explanation, setExplanation] = useState("");

  const compare = useQuery(
    forecastCompareQueryOptions(projectId, fromId === "none" ? null : fromId, toId || null),
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["costing"] });
  const money = (n: number) => formatCostingMoney(n, data.baseCurrency);
  const signed = (n: number) => `${n > 0 ? "+" : ""}${money(n)}`;

  const exportVersion = useMutation({
    mutationFn: async (v: (typeof versions)[number]) => {
      const detail = await qc.fetchQuery(forecastVersionDetailQueryOptions(v.id));
      const header = {
        version_no: v.version_no,
        status: v.status,
        reporting_period: v.reporting_period,
        base_currency_code: data.baseCurrency,
        project_name: data.projectName ?? null,
        approved_at: v.approved_at ?? null,
      };
      downloadCsv(
        forecastVersionCsvFilename(header),
        buildForecastVersionCsv(header, detail.lines, v.totals ?? null),
      );
    },
    onError: (e) => toast.error(costingErrorMessage(e)),
  });

  const exportCompare = () => {
    if (!compare.data) return;
    const label = (id: string) => {
      const v = versions.find((x) => x.id === id);
      return v ? `v${v.version_no}` : "none";
    };
    downloadCsv(
      `forecast-compare-${fromId === "none" ? "none" : label(fromId)}-${label(toId)}.csv`,
      buildForecastCompareCsv(
        fromId === "none" ? "none" : label(fromId),
        label(toId),
        compare.data,
      ),
    );
  };

  const create = useMutation({
    mutationFn: () => createFn({ data: { projectId, period: data.focusPeriod } }),
    onSuccess: async (r) => {
      toast.success(t("financeMod.costing.versions.created", { version: r.version_no }));
      await invalidate();
    },
    onError: (e) => toast.error(costingErrorMessage(e)),
  });

  const refresh = useMutation({
    mutationFn: (versionId: string) => refreshFn({ data: { toVersionId: versionId } }),
    onSuccess: async () => {
      toast.success(t("financeMod.costing.versions.refreshed"));
      await invalidate();
    },
    onError: (e) => toast.error(costingErrorMessage(e)),
  });

  const act = useMutation({
    mutationFn: (vars: {
      versionId: string;
      action: "submit" | "recall" | "approve";
      expectedRowVersion: number;
    }) =>
      actFn({
        data: {
          versionId: vars.versionId,
          action: vars.action,
          explanation: explanation.trim() || null,
          expectedRowVersion: vars.expectedRowVersion,
        },
      }),
    onSuccess: async (r) => {
      toast.success(
        t("financeMod.costing.versions.acted", {
          status: t(`financeMod.costing.versions.status.${r.status}`),
        }),
      );
      setExplanation("");
      await invalidate();
    },
    onError: (e) => toast.error(costingErrorMessage(e)),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        as="h2"
        title={t("financeMod.costing.versions.title")}
        description={t("financeMod.costing.versions.description")}
      />

      {data.canClose ? (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            <History className="size-4" /> {t("financeMod.costing.versions.create")} —{" "}
            {data.focusPeriod.slice(0, 7)}
          </Button>
          <div className="min-w-64 flex-1">
            <Label htmlFor="explanation">
              {t("financeMod.costing.versions.explanationLabel")}
            </Label>
            <Textarea
              id="explanation"
              rows={2}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder={t("financeMod.costing.versions.explanationPlaceholder")}
            />
          </div>
        </Card>
      ) : null}

      {versions.length === 0 ? (
        <EmptyState
          icon={History}
          title={t("financeMod.costing.versions.noVersions")}
          description={t("financeMod.costing.versions.noVersionsBody")}
        />
      ) : (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("financeMod.costing.versions.period")}</TableHead>
                <TableHead>{t("financeMod.costing.versions.versionNo")}</TableHead>
                <TableHead>{t("financeMod.costing.versions.status.working")}</TableHead>
                <TableHead className="text-end">{t("financeMod.costing.versions.eac")}</TableHead>
                <TableHead className="text-end">{t("financeMod.costing.versions.vac")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono">{v.reporting_period.slice(0, 7)}</TableCell>
                  <TableCell className="font-mono">v{v.version_no}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_TONE[v.status]}>
                      {t(`financeMod.costing.versions.status.${v.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end font-mono">
                    {money(Number(v.totals?.eac ?? 0))}
                  </TableCell>
                  <TableCell className="text-end font-mono">
                    {money(Number(v.totals?.vac ?? 0))}
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("financeMod.costing.versions.exportCsv")}
                        onClick={() => exportVersion.mutate(v)}
                        disabled={exportVersion.isPending}
                      >
                        <Download className="size-4" />
                      </Button>
                      {data.canClose ? (
                        <>
                        {v.status === "working" ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => refresh.mutate(v.id)}
                              disabled={refresh.isPending}
                            >
                              <RefreshCw className="size-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                act.mutate({
                                  versionId: v.id,
                                  action: "submit",
                                  expectedRowVersion: v.row_version,
                                })
                              }
                              disabled={act.isPending}
                            >
                              {t("financeMod.costing.versions.submit")}
                            </Button>
                          </>
                        ) : null}
                        {v.status === "submitted" ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                act.mutate({
                                  versionId: v.id,
                                  action: "recall",
                                  expectedRowVersion: v.row_version,
                                })
                              }
                              disabled={act.isPending}
                            >
                              {t("financeMod.costing.versions.recall")}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() =>
                                act.mutate({
                                  versionId: v.id,
                                  action: "approve",
                                  expectedRowVersion: v.row_version,
                                })
                              }
                              disabled={act.isPending}
                            >
                              {t("financeMod.costing.versions.approve")}
                            </Button>
                          </>
                        ) : null}
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card className="flex flex-col gap-4 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <GitCompare className="size-4" /> {t("financeMod.costing.versions.compare")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cmp-from">{t("financeMod.costing.versions.compareFrom")}</Label>
            <Select value={fromId} onValueChange={setFromId}>
              <SelectTrigger id="cmp-from">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("financeMod.costing.versions.none")}</SelectItem>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.reporting_period.slice(0, 7)} · v{v.version_no}
                    {baseline?.id === v.id ? ` · ${t("financeMod.costing.versions.baseline")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cmp-to">{t("financeMod.costing.versions.compareTo")}</Label>
            <Select value={toId} onValueChange={setToId}>
              <SelectTrigger id="cmp-to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.reporting_period.slice(0, 7)} · v{v.version_no}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {compare.data ? (
          <>
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={exportCompare}>
                <Download className="size-4" /> {t("financeMod.costing.versions.exportCsv")}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {(
                [
                  ["budget", compare.data.totals.delta_budget],
                  ["committed", compare.data.totals.delta_committed],
                  ["actual", compare.data.totals.delta_actual],
                  ["accruals", compare.data.totals.delta_accruals],
                  ["etc", compare.data.totals.delta_etc],
                  ["eac", compare.data.totals.delta_eac],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">
                    Δ {t(`financeMod.costing.versions.${key}`)}
                  </span>
                  <span className="font-mono text-sm font-medium text-foreground">
                    {signed(value)}
                  </span>
                </div>
              ))}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("financeMod.costing.versions.costCode")}</TableHead>
                  <TableHead>{t("financeMod.costing.versions.diffTitle")}</TableHead>
                  <TableHead className="text-end">
                    {t("financeMod.costing.versions.deltaEtc")}
                  </TableHead>
                  <TableHead className="text-end">
                    {t("financeMod.costing.versions.deltaEac")}
                  </TableHead>
                  <TableHead>{t("financeMod.costing.versions.drivers")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compare.data.rows
                  .filter((r) => r.kind !== "unchanged")
                  .map((r) => (
                    <TableRow key={r.cost_code_key}>
                      <TableCell className="font-mono">
                        {r.cost_code_key === UNASSIGNED_COST_CODE_KEY
                          ? t("financeMod.costing.versions.unassigned")
                          : (r.cost_code ?? r.cost_code_key)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {t(`financeMod.costing.versions.kind.${r.kind}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end font-mono">{signed(r.delta_etc)}</TableCell>
                      <TableCell className="text-end font-mono">{signed(r.delta_eac)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.drivers
                          .map(
                            (d) =>
                              `${t(`financeMod.costing.versions.${d.key}`)} ${signed(d.delta)}`,
                          )
                          .join(" · ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </>
        ) : null}
      </Card>
    </div>
  );
}
