// GC-12 — Project EVM cockpit: basis, measures, gates, detail, trend and governance.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Download, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EvmDetailTable } from "@/components/evm/evm-detail-table";
import { EvmExceptionTable, EvmGateSummary } from "@/components/evm/evm-exceptions";
import { EvmBasisCard, EvmFormulaCard, EvmLifecycleCard } from "@/components/evm/evm-governance";
import { EvmKpiGrid } from "@/components/evm/evm-kpi-grid";
import { EvmTrend } from "@/components/evm/evm-trend";
import { money } from "@/components/evm/evm-format";
import { costingErrorMessage } from "@/lib/costing.query";
import { downloadCsv } from "@/lib/csv";
import {
  calculateEvmReport,
  getEvmCsv,
  saveEvmSettingsFn,
  supersedeEvmReportFn,
  transitionEvmReportFn,
} from "@/lib/evm.report.functions";
import { evmWorkspaceQueryOptions } from "@/lib/evm.report.query";
import type { EacMethod } from "@/lib/evm.report.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.evm";

interface EvmSearch {
  period?: string;
  currency?: string;
}

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing/evm")({
  validateSearch: (search: Record<string, unknown>): EvmSearch => ({
    ...(typeof search["period"] === "string" ? { period: search["period"] as string } : {}),
    ...(typeof search["currency"] === "string" ? { currency: search["currency"] as string } : {}),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(
      evmWorkspaceQueryOptions(params.projectId, deps.period, deps.currency),
    ),
  head: () => ({
    meta: [
      { title: "Earned value management — GridMind EPC" },
      {
        name: "description",
        content:
          "Governed earned value snapshots: PV, EV, AC, CPI, SPI, EAC variants and quality gates for the project.",
      },
      { property: "og:title", content: "Earned value management — GridMind EPC" },
      {
        property: "og:description",
        content: "Cost and schedule performance from approved baselines and posted actuals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: ({ error }) => (
    <Card className="p-6 text-sm text-destructive">{costingErrorMessage(error)}</Card>
  ),
  notFoundComponent: EvmNotFound,
  component: EvmCockpit,
});

function EvmNotFound() {
  const { t } = useI18n();
  return <Card className="p-6 text-sm">{t(`${K}.notFound`)}</Card>;
}

function EvmCockpit() {
  const { t } = useI18n();
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data } = useSuspenseQuery(
    evmWorkspaceQueryOptions(projectId, search.period, search.currency),
  );
  const c = data.computed;
  const currency = c.reporting_currency;
  const measures = c.total_reporting ?? c.total;

  const calculate = useServerFn(calculateEvmReport);
  const transition = useServerFn(transitionEvmReportFn);
  const supersede = useServerFn(supersedeEvmReportFn);
  const saveSettings = useServerFn(saveEvmSettingsFn);
  const csv = useServerFn(getEvmCsv);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["evm"] });
  }

  const recalc = useMutation({
    mutationFn: () =>
      calculate({
        data: {
          project_id: projectId,
          period: c.period_month,
          ...(search.currency ? { currency: search.currency } : {}),
        },
      }),
    onSuccess: async () => {
      toast.success(t(`${K}.toast.recalculated`));
      await refresh();
    },
    onError: (e) => toast.error(costingErrorMessage(e)),
  });

  async function run(fn: () => Promise<unknown>, successKey: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(t(successKey));
      await refresh();
    } catch (e) {
      toast.error(costingErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv(kind: "detail" | "trend" | "mappings" | "exceptions" | "formulas") {
    try {
      const res = await csv({
        data: { project_id: projectId, period: c.period_month, kind },
      });
      downloadCsv(res.filename, res.csv);
    } catch (e) {
      toast.error(costingErrorMessage(e));
    }
  }

  const reportId = data.report?.id ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t(`${K}.title`)}
        description={t(`${K}.description`)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => recalc.mutate()}
              disabled={recalc.isPending || !data.can_write || data.frozen}
            >
              <RefreshCw className="size-4" /> {t(`${K}.actions.recalculate`)}
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link
                to="/projects/$projectId/costing/evm-mappings"
                params={{ projectId }}
                search={{ period: data.computed.period_month }}
              >
                <Settings2 className="size-4" /> {t(`${K}.mapping.title`)}
              </Link>
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportCsv("detail")}>
              <Download className="size-4" /> {t(`${K}.actions.exportDetail`)}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportCsv("trend")}>
              <Download className="size-4" /> {t(`${K}.actions.exportTrend`)}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportCsv("exceptions")}>
              <Download className="size-4" /> {t(`${K}.actions.exportExceptions`)}
            </Button>
          </div>
        }
      />

      <EvmBasisCard
        basis={{
          period_month: c.period_month,
          data_date: c.data_date,
          cost_basis: c.cost_basis,
          ac_basis: c.ac_basis,
          eac_method: c.eac_method,
          schedule_baseline_id: c.schedule_baseline_id,
          project_currency: c.project_currency,
          reporting_currency: c.reporting_currency,
          fx: c.fx,
          status: data.report?.status ?? "working",
          version_no: data.report?.version_no ?? null,
          frozen: data.frozen,
          period_state: data.period_state,
        }}
      />

      <EvmGateSummary
        blockers={c.quality.blockers}
        warnings={c.quality.warnings}
        unmappedPct={c.quality.unmapped_pct}
        ready={c.quality.ready_to_approve}
      />

      <EvmKpiGrid
        measures={measures}
        currency={currency}
        delayDays={c.delay_days}
        cpiThreshold={c.settings.cpi_threshold}
        spiThreshold={c.settings.spi_threshold}
      />

      <Tabs defaultValue="detail">
        <TabsList>
          <TabsTrigger value="detail">{t(`${K}.tabs.detail`)}</TabsTrigger>
          <TabsTrigger value="quality">{t(`${K}.tabs.quality`)}</TabsTrigger>
          <TabsTrigger value="trend">{t(`${K}.tabs.trend`)}</TabsTrigger>
          <TabsTrigger value="governance">{t(`${K}.tabs.governance`)}</TabsTrigger>
        </TabsList>

        <TabsContent value="detail" className="pt-4">
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">{t(`${K}.detail.title`)}</h2>
              <p className="text-xs text-muted-foreground">
                {t(`${K}.detail.reconciliation`, {
                  status: c.reconciliation.ok
                    ? t(`${K}.detail.tiesOut`)
                    : t(`${K}.detail.mismatch`),
                  difference: money(c.reconciliation.difference, currency),
                })}
              </p>
            </div>
            <EvmDetailTable nodes={c.nodes} currency={currency} />
          </Card>
        </TabsContent>

        <TabsContent value="quality" className="pt-4">
          <div className="flex flex-col gap-4">
            <EvmExceptionTable
              exceptions={c.quality.exceptions}
              currency={currency}
              title={t(`${K}.gates.dataTitle`)}
              description={t(`${K}.gates.dataDescription`)}
            />
            <EvmExceptionTable
              exceptions={c.performance}
              currency={currency}
              title={t(`${K}.gates.performanceTitle`)}
              description={t(`${K}.gates.performanceDescription`)}
            />
          </div>
        </TabsContent>

        <TabsContent value="trend" className="pt-4">
          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-sm font-semibold text-foreground">{t(`${K}.trend.title`)}</h2>
            <EvmTrend analysis={data.trend_analysis} currency={currency} />
          </Card>
        </TabsContent>

        <TabsContent value="governance" className="pt-4">
          <div className="flex flex-col gap-4">
            <EvmLifecycleCard
              status={data.report?.status ?? null}
              canWrite={data.can_write}
              blockers={c.quality.blockers}
              busy={busy}
              onSubmit={() =>
                void run(
                  () => transition({ data: { report_id: reportId as string, to: "submitted" } }),
                  `${K}.toast.submitted`,
                )
              }
              onApprove={() =>
                void run(
                  () => transition({ data: { report_id: reportId as string, to: "approved" } }),
                  `${K}.toast.approved`,
                )
              }
              onReturn={(reason) =>
                void run(
                  () =>
                    transition({ data: { report_id: reportId as string, to: "working", reason } }),
                  `${K}.toast.returned`,
                )
              }
              onSupersede={(reason) =>
                void run(
                  () => supersede({ data: { report_id: reportId as string, reason } }),
                  `${K}.toast.superseded`,
                )
              }
            />

            <EvmFormulaCard
              measures={measures}
              currency={currency}
              official={c.settings.official_eac_method as EacMethod}
              canWrite={data.can_write && !data.frozen}
              busy={busy}
              onChangeOfficial={(method) =>
                void run(
                  () =>
                    saveSettings({
                      data: {
                        project_id: projectId,
                        official_eac_method: method,
                        reason: "Official EAC method changed from the EVM cockpit.",
                      },
                    }),
                  `${K}.toast.settingsSaved`,
                )
              }
            />

            <Card className="flex flex-col gap-2 p-4">
              <h2 className="text-sm font-semibold text-foreground">{t(`${K}.history.title`)}</h2>
              <Label className="text-xs text-muted-foreground">
                {t(`${K}.history.description`)}
              </Label>
              <ul className="flex flex-col gap-1 text-sm">
                {data.events.length === 0 ? (
                  <li className="text-muted-foreground">{t(`${K}.history.empty`)}</li>
                ) : (
                  data.events.map((e) => (
                    <li key={e.id} className="flex flex-wrap gap-2 text-muted-foreground">
                      <span className="tabular-nums">
                        {e.created_at.slice(0, 16).replace("T", " ")}
                      </span>
                      <span className="text-foreground">
                        {t(`${K}.event.${e.event_type}`, { defaultValue: e.event_type })}
                      </span>
                      {e.from_status && e.to_status ? (
                        <span>
                          {t(`${K}.status.${e.from_status}`)} → {t(`${K}.status.${e.to_status}`)}
                        </span>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
