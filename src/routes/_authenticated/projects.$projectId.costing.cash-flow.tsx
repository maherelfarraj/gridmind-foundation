// GC-13 — Project cash-flow cockpit: basis, liquidity, funding, gates and governance.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CashAdjustmentPanel } from "@/components/cashflow/cash-adjustments";
import { CashBucketChart } from "@/components/cashflow/cash-bucket-chart";
import {
  CashExceptionTable,
  CashGateSummary,
  CashReconciliation,
} from "@/components/cashflow/cash-exceptions";
import {
  CashCovenantTable,
  CashFacilityTable,
  CashMaturityLadder,
} from "@/components/cashflow/cash-funding";
import { CashBasisCard, CashLifecycleCard } from "@/components/cashflow/cash-governance";
import { CashKpiGrid } from "@/components/cashflow/cash-kpi-grid";
import {
  CashScenarioPanel,
  toScenarioInput,
  type ScenarioDraft,
} from "@/components/cashflow/cash-scenario";
import { costingErrorMessage } from "@/lib/costing.query";
import { downloadCsv } from "@/lib/csv";
import {
  calculateCashflowSnapshot,
  decideCashflowAdjustmentFn,
  getCashflowCsv,
  runCashScenarioFn,
  saveCashflowAdjustmentFn,
  supersedeCashflowSnapshotFn,
  transitionCashflowSnapshotFn,
} from "@/lib/cashflow.functions";
import {
  cashflowAdjustmentsQueryOptions,
  cashflowWorkspaceQueryOptions,
} from "@/lib/cashflow.query";
import type { BucketGranularity, ScenarioComparison } from "@/lib/cashflow.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.cashFlow";

interface CashSearch {
  period?: string;
  granularity?: BucketGranularity;
}

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing/cash-flow")({
  validateSearch: (search: Record<string, unknown>): CashSearch => ({
    ...(typeof search["period"] === "string" ? { period: search["period"] as string } : {}),
    ...(search["granularity"] === "week" || search["granularity"] === "month"
      ? { granularity: search["granularity"] as BucketGranularity }
      : {}),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(
      cashflowWorkspaceQueryOptions(params.projectId, deps.period, deps.granularity),
    ),
  head: () => ({
    meta: [
      { title: "Cash flow & liquidity — GridMind EPC" },
      {
        name: "description",
        content:
          "Governed project cash-flow forecasting: time-phased receipts and payments, funding headroom, covenants and liquidity gates.",
      },
      { property: "og:title", content: "Cash flow & liquidity — GridMind EPC" },
      {
        property: "og:description",
        content: "Time-phased cash forecasting from authoritative costing, invoices and payments.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: ({ error }) => (
    <Card className="p-6 text-sm text-destructive">{costingErrorMessage(error)}</Card>
  ),
  notFoundComponent: CashNotFound,
  component: CashCockpit,
});

function CashNotFound() {
  const { t } = useI18n();
  return <Card className="p-6 text-sm">{t(`${K}.notFound`)}</Card>;
}

function CashCockpit() {
  const { t } = useI18n();
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [comparison, setComparison] = useState<ScenarioComparison[] | null>(null);

  const { data } = useSuspenseQuery(
    cashflowWorkspaceQueryOptions(projectId, search.period, search.granularity),
  );
  const { data: adjustments } = useSuspenseQuery(cashflowAdjustmentsQueryOptions(projectId));

  const c = data.computed;
  const currency = c.reporting_currency;
  const canWrite = data.period_state !== "closed";
  const blockers = c.exceptions.filter((e) => e.severity === "blocker").length;

  const calculate = useServerFn(calculateCashflowSnapshot);
  const transition = useServerFn(transitionCashflowSnapshotFn);
  const supersede = useServerFn(supersedeCashflowSnapshotFn);
  const saveAdjustment = useServerFn(saveCashflowAdjustmentFn);
  const decideAdjustment = useServerFn(decideCashflowAdjustmentFn);
  const runScenario = useServerFn(runCashScenarioFn);
  const csv = useServerFn(getCashflowCsv);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["cashflow"] });
  }

  const recalc = useMutation({
    mutationFn: () =>
      calculate({
        data: {
          project_id: projectId,
          period: c.period_month,
          granularity: c.granularity,
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

  async function exportCsv(
    kind: "buckets" | "lines" | "reconciliation" | "facilities" | "exceptions",
  ) {
    try {
      const res = await csv({ data: { project_id: projectId, period: c.period_month, kind } });
      downloadCsv(res.filename, res.csv);
    } catch (e) {
      toast.error(costingErrorMessage(e));
    }
  }

  async function onRunScenario(draft: ScenarioDraft) {
    setBusy(true);
    try {
      const res = await runScenario({
        data: { ...toScenarioInput(projectId, draft), period: c.period_month },
      });
      setComparison(res.comparison);
    } catch (e) {
      toast.error(costingErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const snapshotId = data.snapshot?.id ?? null;

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
              disabled={recalc.isPending || !canWrite || data.frozen}
            >
              <RefreshCw className="size-4" /> {t(`${K}.actions.recalculate`)}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportCsv("buckets")}>
              <Download className="size-4" /> {t(`${K}.actions.exportBuckets`)}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportCsv("lines")}>
              <Download className="size-4" /> {t(`${K}.actions.exportLines`)}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportCsv("exceptions")}>
              <Download className="size-4" /> {t(`${K}.actions.exportExceptions`)}
            </Button>
          </div>
        }
      />

      <CashBasisCard
        basis={{
          period_month: c.period_month,
          data_date: c.data_date,
          granularity: c.granularity,
          horizon_buckets: c.horizon_buckets,
          project_currency: c.project_currency,
          reporting_currency: c.reporting_currency,
          status: data.snapshot?.status ?? "working",
          version_no: data.snapshot?.version_no ?? null,
          frozen: data.frozen,
          period_state: data.period_state,
          forecast_version_id: c.forecast_version_id,
          fx: c.fx.map((f) => ({
            currency_code: f.currency_code,
            rate: f.rate,
            as_of: f.as_of,
            source: f.source,
          })),
          fx_missing: c.fx_missing,
          opening_cash: c.opening_cash,
          min_liquidity: data.settings.min_liquidity_amount,
        }}
      />

      <CashGateSummary exceptions={c.exceptions} ready={c.ready_to_approve} />

      <CashKpiGrid measures={c.measures} funding={c.funding} currency={currency} />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">{t(`${K}.tabs.profile`)}</TabsTrigger>
          <TabsTrigger value="funding">{t(`${K}.tabs.funding`)}</TabsTrigger>
          <TabsTrigger value="quality">{t(`${K}.tabs.quality`)}</TabsTrigger>
          <TabsTrigger value="scenario">{t(`${K}.tabs.scenario`)}</TabsTrigger>
          <TabsTrigger value="governance">{t(`${K}.tabs.governance`)}</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="pt-4">
          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-sm font-semibold text-foreground">{t(`${K}.buckets.title`)}</h2>
            <CashBucketChart
              buckets={c.buckets}
              currency={currency}
              granularity={c.granularity}
            />
          </Card>
        </TabsContent>

        <TabsContent value="funding" className="pt-4">
          <div className="flex flex-col gap-4">
            <CashFacilityTable facilities={c.facilities} currency={currency} />
            <CashCovenantTable covenants={c.covenants} />
            <CashMaturityLadder rungs={c.maturity} currency={currency} />
          </div>
        </TabsContent>

        <TabsContent value="quality" className="pt-4">
          <div className="flex flex-col gap-4">
            <CashExceptionTable
              exceptions={c.exceptions}
              title={t(`${K}.gates.dataTitle`)}
              description={t(`${K}.gates.dataDescription`)}
            />
            <CashReconciliation reconciliation={c.reconciliation} currency={currency} />
          </div>
        </TabsContent>

        <TabsContent value="scenario" className="pt-4">
          <CashScenarioPanel
            currency={currency}
            busy={busy}
            comparison={comparison}
            onRun={(draft) => void onRunScenario(draft)}
          />
        </TabsContent>

        <TabsContent value="governance" className="pt-4">
          <div className="flex flex-col gap-4">
            <CashLifecycleCard
              status={data.snapshot?.status ?? null}
              canWrite={canWrite}
              blockers={blockers}
              busy={busy}
              onSubmit={() =>
                void run(
                  () =>
                    transition({ data: { snapshot_id: snapshotId as string, to: "submitted" } }),
                  `${K}.toast.submitted`,
                )
              }
              onApprove={() =>
                void run(
                  () => transition({ data: { snapshot_id: snapshotId as string, to: "approved" } }),
                  `${K}.toast.approved`,
                )
              }
              onReturn={(reason) =>
                void run(
                  () =>
                    transition({
                      data: { snapshot_id: snapshotId as string, to: "working", reason },
                    }),
                  `${K}.toast.returned`,
                )
              }
              onSupersede={(reason) =>
                void run(
                  () => supersede({ data: { snapshot_id: snapshotId as string, reason } }),
                  `${K}.toast.superseded`,
                )
              }
            />

            <CashAdjustmentPanel
              adjustments={adjustments}
              currency={currency}
              canWrite={canWrite && !data.frozen}
              busy={busy}
              onCreate={(draft) =>
                void run(
                  () =>
                    saveAdjustment({
                      data: {
                        project_id: projectId,
                        effective_period: c.period_month,
                        bucket_date: draft.bucket_date,
                        direction: draft.direction,
                        category: draft.category.trim(),
                        counterparty: draft.counterparty.trim() || null,
                        amount: Number(draft.amount),
                        currency_code: currency,
                        reason: draft.reason.trim(),
                        evidence_reference: draft.evidence_reference.trim() || null,
                      },
                    }),
                  `${K}.toast.adjustmentSaved`,
                )
              }
              onDecide={(id, decision, reason) =>
                void run(
                  () => decideAdjustment({ data: { id, decision, reason } }),
                  `${K}.toast.adjustmentDecided`,
                )
              }
            />

            <Card className="flex flex-col gap-2 p-4">
              <h2 className="text-sm font-semibold text-foreground">{t(`${K}.history.title`)}</h2>
              <p className="text-xs text-muted-foreground">{t(`${K}.history.description`)}</p>
              <ul className="flex flex-col gap-1 text-sm">
                {data.history.length === 0 ? (
                  <li className="text-muted-foreground">{t(`${K}.history.empty`)}</li>
                ) : (
                  data.history.map((h) => (
                    <li key={h.id} className="flex flex-wrap gap-2 text-muted-foreground">
                      <span className="tabular-nums">{h.period_month.slice(0, 7)}</span>
                      <span className="text-foreground">{t(`${K}.status.${h.status}`)}</span>
                      <span className="tabular-nums">v{h.version_no}</span>
                      {h.correction_reason ? <span>{h.correction_reason}</span> : null}
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
