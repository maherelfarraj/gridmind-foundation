// GC-15 — Project revenue / WIP / percentage-of-completion cockpit.
//
// Read-and-govern surface: every calculation and authorisation lives
// server-side. This page renders the governed snapshot and offers only the
// lifecycle actions the caller's role permits. NON-POSTING.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, FileSpreadsheet, TrendingUp, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { money, percent } from "@/components/cashflow/cash-format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { costingErrorMessage } from "@/lib/costing.query";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  buildRecognitionSnapshot,
  correctRecognitionSnapshot,
  runRecognitionSensitivity,
  transitionRecognitionSnapshot,
} from "@/lib/recognition.functions";
import { recognitionWorkspaceQueryOptions } from "@/lib/recognition.query";
import { RECOGNITION_DISCLAIMER } from "@/lib/recognition.rules";

const K = "financeMod.costing.recognition";

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing/revenue")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(recognitionWorkspaceQueryOptions(params.projectId)),
  head: () => ({
    meta: [
      { title: "Revenue & WIP recognition — GridMind" },
      {
        name: "description",
        content:
          "Governed percentage-of-completion revenue, contract asset and contract liability recognition for the project.",
      },
      { property: "og:title", content: "Revenue & WIP recognition — GridMind" },
      {
        property: "og:description",
        content:
          "Non-posting governed revenue recognition with obligation drill-down, reconciliation and approvals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RecognitionCockpit,
});

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const monthStart = (iso: string): string => `${iso.slice(0, 7)}-01`;

function RecognitionCockpit() {
  const { projectId } = Route.useParams();
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(recognitionWorkspaceQueryOptions(projectId));

  const build = useServerFn(buildRecognitionSnapshot);
  const transition = useServerFn(transitionRecognitionSnapshot);
  const correct = useServerFn(correctRecognitionSnapshot);
  const sensitivity = useServerFn(runRecognitionSensitivity);

  const [period, setPeriod] = useState(data.snapshot?.period_month ?? monthStart(todayIso()));
  const [dataDate, setDataDate] = useState(data.snapshot?.data_date ?? todayIso());
  const [eacUplift, setEacUplift] = useState(10);
  const [stress, setStress] = useState<Awaited<ReturnType<typeof runRecognitionSensitivity>> | null>(
    null,
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["recognition"] });
  const onError = (e: unknown) => toast.error(costingErrorMessage(e));

  const buildMutation = useMutation({
    mutationFn: () =>
      build({
        data: {
          project_id: projectId,
          period_month: period,
          data_date: dataDate,
          billing_cutoff: dataDate,
        },
      }),
    onSuccess: () => {
      toast.success(t(`${K}.toast.built`));
      void invalidate();
    },
    onError,
  });

  const transitionMutation = useMutation({
    mutationFn: (to: "submitted" | "approved" | "working") =>
      transition({
        data: {
          snapshot_id: data.snapshot!.id,
          to_status: to,
          row_version: data.snapshot!.row_version,
        },
      }),
    onSuccess: () => {
      toast.success(t(`${K}.toast.transitioned`));
      void invalidate();
    },
    onError,
  });

  const correctMutation = useMutation({
    mutationFn: (reason: string) =>
      correct({ data: { snapshot_id: data.snapshot!.id, reason } }),
    onSuccess: () => {
      toast.success(t(`${K}.toast.corrected`));
      void invalidate();
    },
    onError,
  });

  const stressMutation = useMutation({
    mutationFn: () =>
      sensitivity({
        data: {
          project_id: projectId,
          period_month: period,
          eac_uplift_pct: eacUplift,
          progress_delta_pp: 0,
          billing_delay_pct: 0,
          fx_shock_pct: 0,
        },
      }),
    onSuccess: (r) => setStress(r),
    onError,
  });

  const snapshot = data.snapshot;
  const totals = data.totals;
  const currency = data.reporting_currency;
  const canWrite = data.access.canWrite;
  const canApprove = data.access.canApprove;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t(`${K}.title`)}
        description={t(`${K}.subtitle`)}
        actions={
          snapshot ? (
            <StatusBadge
              status={snapshot.status}
              label={t(`${K}.status.${snapshot.status}`)}
            />
          ) : null
        }
      />

      <Alert>
        <AlertTitle>{t(`${K}.disclaimerTitle`)}</AlertTitle>
        <AlertDescription>{RECOGNITION_DISCLAIMER}</AlertDescription>
      </Alert>

      {/* ---------------- Build / lifecycle ---------------- */}
      <Card className="p-4">
        <SectionHeader title={t(`${K}.basis.title`)} description={t(`${K}.basis.hint`)} />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="rec-period">{t(`${K}.basis.period`)}</Label>
            <Input
              id="rec-period"
              type="month"
              value={period.slice(0, 7)}
              onChange={(e) => setPeriod(`${e.target.value}-01`)}
              className="w-40"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="rec-data-date">{t(`${K}.basis.dataDate`)}</Label>
            <Input
              id="rec-data-date"
              type="date"
              value={dataDate}
              onChange={(e) => setDataDate(e.target.value)}
              className="w-44"
            />
          </div>
          <Button
            onClick={() => buildMutation.mutate()}
            disabled={!canWrite || buildMutation.isPending}
          >
            {t(`${K}.actions.build`)}
          </Button>
          {snapshot?.status === "working" ? (
            <Button
              variant="secondary"
              onClick={() => transitionMutation.mutate("submitted")}
              disabled={!canWrite || transitionMutation.isPending}
            >
              {t(`${K}.actions.submit`)}
            </Button>
          ) : null}
          {snapshot?.status === "submitted" ? (
            <>
              <Button
                onClick={() => transitionMutation.mutate("approved")}
                disabled={!canApprove || data.blockers.length > 0 || transitionMutation.isPending}
              >
                {t(`${K}.actions.approve`)}
              </Button>
              <Button
                variant="ghost"
                onClick={() => transitionMutation.mutate("working")}
                disabled={!canWrite || transitionMutation.isPending}
              >
                {t(`${K}.actions.reopen`)}
              </Button>
            </>
          ) : null}
          {snapshot?.status === "approved" ? (
            <Button
              variant="outline"
              onClick={() => correctMutation.mutate(t(`${K}.actions.correctionReason`))}
              disabled={!canApprove || correctMutation.isPending}
            >
              {t(`${K}.actions.correct`)}
            </Button>
          ) : null}
        </div>
        {snapshot ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t(`${K}.basis.provenance`, {
              version: snapshot.version_no,
              policy: snapshot.policy_version,
              method: snapshot.method,
              currency,
              cutoff: snapshot.billing_cutoff,
            })}
          </p>
        ) : null}
      </Card>

      {!snapshot || !totals ? (
        <EmptyState
          icon={FileSpreadsheet}
          title={t(`${K}.empty.title`)}
          description={t(`${K}.empty.description`)}
        />
      ) : (
        <>
          {/* ---------------- KPI strip ---------------- */}
          <KpiGrid>
            <KpiTile
              icon={TrendingUp}
              label={t(`${K}.kpi.cumulativeRevenue`)}
              value={money(totals.cumulative_revenue, currency)}
              hint={t(`${K}.kpi.periodRevenue`, {
                value: money(totals.period_revenue, currency),
              })}
            />
            <KpiTile
              icon={Activity}
              label={t(`${K}.kpi.margin`)}
              value={percent(totals.margin_pct)}
              status={
                totals.margin_pct === null ? "neutral" : totals.margin_pct < 0 ? "bad" : "good"
              }
              hint={t(`${K}.kpi.grossProfit`, {
                value: money(totals.gross_profit, currency),
              })}
            />
            <KpiTile
              icon={Wallet}
              label={t(`${K}.kpi.contractAsset`)}
              value={money(totals.contract_asset, currency)}
              status={totals.contract_asset > 0 ? "warning" : "neutral"}
              hint={t(`${K}.kpi.underbilling`)}
            />
            <KpiTile
              icon={Wallet}
              label={t(`${K}.kpi.contractLiability`)}
              value={money(totals.contract_liability, currency)}
              status={totals.contract_liability > 0 ? "warning" : "neutral"}
              hint={t(`${K}.kpi.overbilling`)}
            />
            <KpiTile
              label={t(`${K}.kpi.billed`)}
              value={money(totals.billed_to_date, currency)}
              hint={t(`${K}.kpi.cash`, { value: money(totals.cash_received, currency) })}
            />
            <KpiTile
              label={t(`${K}.kpi.lossProvision`)}
              value={money(totals.loss_provision, currency)}
              status={totals.loss_provision > 0 ? "bad" : "good"}
            />
          </KpiGrid>

          {/* ---------------- Obligations ---------------- */}
          <Card className="p-4">
            <SectionHeader
              title={t(`${K}.obligations.title`)}
              description={t(`${K}.obligations.hint`)}
            />
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t(`${K}.obligations.code`)}</TableHead>
                    <TableHead scope="col">{t(`${K}.obligations.method`)}</TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.obligations.price`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.obligations.progress`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.obligations.revenue`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.obligations.billed`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.obligations.wip`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.obligations.deferred`)}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lines.map((l) => (
                    <TableRow key={l.obligation_id}>
                      <TableCell className="font-medium">
                        {l.code}
                        <span className="block text-xs text-muted-foreground">{l.label}</span>
                      </TableCell>
                      <TableCell>{t(`${K}.method.${l.method}`)}</TableCell>
                      <TableCell className="text-end tabular-nums">
                        {money(l.transaction_price, l.currency_code)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {percent(l.progress_pct * 100)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {money(l.cumulative_revenue, l.currency_code)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {money(l.billed_to_date, l.currency_code)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {money(l.contract_asset, l.currency_code)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {money(l.contract_liability, l.currency_code)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* ---------------- Retention / advance ---------------- */}
          <Card className="p-4">
            <SectionHeader
              title={t(`${K}.retention.title`)}
              description={t(`${K}.retention.hint`)}
            />
            <dl className="mt-3 grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-muted-foreground">{t(`${K}.retention.withheld`)}</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {money(totals.retention_receivable, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{t(`${K}.retention.advance`)}</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {money(totals.advance_balance, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{t(`${K}.retention.remaining`)}</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {money(totals.remaining_revenue, currency)}
                </dd>
              </div>
            </dl>
          </Card>

          {/* ---------------- Reconciliation ---------------- */}
          <Card className="p-4">
            <SectionHeader
              title={t(`${K}.reconciliation.title`)}
              description={t(`${K}.reconciliation.hint`)}
            />
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {data.reconciliation.map((c) => (
                <li key={c.code} className="flex items-center justify-between gap-3 text-sm">
                  <span>{t(`${K}.reconciliation.${c.code}`)}</span>
                  <StatusBadge
                    status={c.ok ? "passed" : "failed"}
                    tone={c.ok ? "success" : "critical"}
                    label={c.ok ? t(`${K}.reconciliation.ok`) : `Δ ${c.delta}`}
                  />
                </li>
              ))}
            </ul>
          </Card>

          {/* ---------------- Exceptions ---------------- */}
          <Card className="p-4">
            <SectionHeader
              title={t(`${K}.exceptions.title`)}
              description={t(`${K}.exceptions.hint`)}
            />
            {data.exceptions.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t(`${K}.exceptions.none`)}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.exceptions.map((e, i) => (
                  <li key={`${e.code}-${i}`} className="flex items-start gap-2 text-sm">
                    <StatusBadge
                      status={e.severity}
                      tone={
                        e.severity === "critical"
                          ? "critical"
                          : e.severity === "warning"
                            ? "warning"
                            : "neutral"
                      }
                      label={t(`${K}.severity.${e.severity}`)}
                    />
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ---------------- Non-posting sensitivity ---------------- */}
          <Card className="p-4">
            <SectionHeader
              title={t(`${K}.sensitivity.title`)}
              description={t(`${K}.sensitivity.hint`)}
            />
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="grid gap-1">
                <Label htmlFor="rec-eac">{t(`${K}.sensitivity.eacUplift`)}</Label>
                <Input
                  id="rec-eac"
                  type="number"
                  value={eacUplift}
                  onChange={(e) => setEacUplift(Number(e.target.value))}
                  className="w-28"
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => stressMutation.mutate()}
                disabled={stressMutation.isPending}
              >
                {t(`${K}.sensitivity.run`)}
              </Button>
            </div>
            {stress ? (
              <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t(`${K}.sensitivity.revenueDelta`)}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {money(stress.delta.cumulative_revenue, currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t(`${K}.sensitivity.marginDelta`)}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {money(stress.delta.gross_profit, currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t(`${K}.sensitivity.lossDelta`)}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {money(stress.delta.loss_provision, currency)}
                  </dd>
                </div>
              </dl>
            ) : null}
          </Card>

          {/* ---------------- Audit history ---------------- */}
          <Card className="p-4">
            <SectionHeader title={t(`${K}.history.title`)} description={t(`${K}.history.hint`)} />
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t(`${K}.history.when`)}</TableHead>
                    <TableHead scope="col">{t(`${K}.history.event`)}</TableHead>
                    <TableHead scope="col">{t(`${K}.history.from`)}</TableHead>
                    <TableHead scope="col">{t(`${K}.history.to`)}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.events.slice(0, 15).map((e) => (
                    <TableRow key={String(e.id)}>
                      <TableCell>{String(e.created_at).slice(0, 19).replace("T", " ")}</TableCell>
                      <TableCell>{String(e.event_type)}</TableCell>
                      <TableCell>{String(e.from_status ?? "—")}</TableCell>
                      <TableCell>{String(e.to_status ?? "—")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
