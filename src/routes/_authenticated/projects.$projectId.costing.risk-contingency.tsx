// GC-17 — Project risk & contingency drawdown cockpit.
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Activity, ShieldAlert, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { money, percent } from "@/components/cashflow/cash-format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertRegister, type AlertDecision } from "@/components/risk-contingency/alert-register";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  decideRiskAlert,
  decideRiskSimulation,
  runRiskSimulation,
} from "@/lib/risk-contingency.functions";
import {
  riskContingencyErrorMessage,
  riskContingencyWorkspaceQueryOptions,
} from "@/lib/risk-contingency.query";
import type { RiskContingencyWorkspace } from "@/lib/risk-contingency.server";
import { DEFAULT_ITERATIONS, type SimResult } from "@/lib/risk-sim.rules";

const K = "financeMod.costing.riskContingency";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/costing/risk-contingency",
)({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(riskContingencyWorkspaceQueryOptions(params.projectId)),
  head: () => ({
    meta: [
      { title: "Risk & contingency drawdown — GridMind" },
      {
        name: "description",
        content:
          "Seeded Monte Carlo risk ranges, contingency adequacy and governed drawdown control for the project.",
      },
      { property: "og:title", content: "Risk & contingency drawdown — GridMind" },
      {
        property: "og:description",
        content: "Quantitative risk ranges, contingency adequacy and governed drawdown.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RiskContingencyCockpit,
});

function tone(band: RiskContingencyWorkspace["adequacy"]["band"]) {
  return band === "healthy" ? "good" : band === "watch" ? "warning" : "bad";
}

function RiskContingencyCockpit() {
  const { projectId } = Route.useParams();
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(riskContingencyWorkspaceQueryOptions(projectId));

  const runSim = useServerFn(runRiskSimulation);
  const decideSim = useServerFn(decideRiskSimulation);
  const decideAlertFn = useServerFn(decideRiskAlert);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["risk-contingency", "workspace", projectId] });
  const onError = (e: unknown) => toast.error(riskContingencyErrorMessage(e));

  const runMutation = useMutation({
    mutationFn: (input: {
      seed: number;
      iterations: number;
      reporting_currency: string;
      budget_threshold: number | null;
      schedule_threshold_days: number | null;
      assumptions: string;
      exclusions: string;
    }) =>
      runSim({
        data: {
          project_id: projectId,
          scope: "joint",
          fx_rate_date: null,
          idempotency_key: null,
          ...input,
        },
      }),
    onSuccess: async () => {
      toast.success(t(`${K}.run.succeeded`));
      await invalidate();
    },
    onError,
  });

  const decisionMutation = useMutation({
    mutationFn: (input: { id: string; target: "approved" | "rejected"; row_version: number }) =>
      decideSim({ data: input }),
    onSuccess: async () => {
      toast.success(t(`${K}.run.decided`));
      await invalidate();
    },
    onError,
  });

  const alertMutation = useMutation({
    mutationFn: (input: AlertDecision) => decideAlertFn({ data: input }),
    onSuccess: async () => {
      toast.success(t(`${K}.alerts.updated`));
      await invalidate();
    },
    onError,
  });

  const currency = data.reporting_currency;
  const run = data.approved_run;
  const results = (run && "cost" in run.results ? (run.results as SimResult) : null) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t(`${K}.title`)} description={t(`${K}.description`)} />

      <KpiGrid>
        <KpiTile
          label={t(`${K}.kpi.p50`)}
          value={money(results?.cost.p50 ?? null, currency)}
          icon={ShieldAlert}
        />
        <KpiTile label={t(`${K}.kpi.p80`)} value={money(results?.cost.p80 ?? null, currency)} />
        <KpiTile label={t(`${K}.kpi.p90`)} value={money(results?.cost.p90 ?? null, currency)} />
        <KpiTile
          label={t(`${K}.kpi.available`)}
          value={money(data.contingency.available, currency)}
          icon={Wallet}
          hint={`${t(`${K}.kpi.reserve`)} ${money(data.contingency.management_reserve, currency)}`}
        />
        <KpiTile
          label={t(`${K}.kpi.cover`)}
          value={data.adequacy.cover_p80 === null ? "—" : data.adequacy.cover_p80.toFixed(2)}
          hint={t(`${K}.kpi.coverHelp`)}
          status={tone(data.adequacy.band)}
        />
        <KpiTile
          label={t(`${K}.kpi.burn`)}
          value={money(data.contingency.burn.per_day, currency)}
          icon={Activity}
          status={data.contingency.burn.spike ? "warning" : "neutral"}
        />
      </KpiGrid>

      <RunSection
        workspace={data}
        busy={runMutation.isPending || decisionMutation.isPending}
        onRun={(v) => runMutation.mutate(v)}
        onDecide={(v) => decisionMutation.mutate(v)}
      />

      <RangesSection
        results={results}
        currency={currency}
        precision={run?.diagnostics.relative_precision ?? null}
      />
      <TornadoSection results={results} currency={currency} />
      <ReconciliationSection workspace={data} currency={currency} />
      <RegisterSection workspace={data} />
      <AlertsSection
        workspace={data}
        busy={alertMutation.isPending}
        onDecide={(v) => alertMutation.mutate(v)}
      />
      <EventsSection workspace={data} />
    </div>
  );
}

function SectionHead({ titleKey, descKey }: { titleKey: string; descKey: string }) {
  const { t } = useI18n();
  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground">{t(titleKey)}</h2>
      <p className="text-xs text-muted-foreground">{t(descKey)}</p>
    </div>
  );
}

function RunSection({
  workspace,
  busy,
  onRun,
  onDecide,
}: {
  workspace: RiskContingencyWorkspace;
  busy: boolean;
  onRun: (v: {
    seed: number;
    iterations: number;
    reporting_currency: string;
    budget_threshold: number | null;
    schedule_threshold_days: number | null;
    assumptions: string;
    exclusions: string;
  }) => void;
  onDecide: (v: { id: string; target: "approved" | "rejected"; row_version: number }) => void;
}) {
  const { t } = useI18n();
  const [seed, setSeed] = useState("12345");
  const [iterations, setIterations] = useState(String(DEFAULT_ITERATIONS));
  const [budget, setBudget] = useState("");
  const [assumptions, setAssumptions] = useState("");
  const canWrite = workspace.access.canWrite;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <SectionHead titleKey={`${K}.run.title`} descKey={`${K}.run.description`} />

      {workspace.missing_fx.length > 0 ? (
        <p className="text-xs text-destructive">{t(`${K}.problems.fx`)}</p>
      ) : null}
      {workspace.input_problems.map((p) => (
        <p key={p} className="text-xs text-warning">
          {p}
        </p>
      ))}

      {canWrite ? (
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            onRun({
              seed: Number(seed) || 0,
              iterations: Number(iterations) || DEFAULT_ITERATIONS,
              reporting_currency: workspace.reporting_currency,
              budget_threshold: budget === "" ? null : Number(budget),
              schedule_threshold_days: null,
              assumptions,
              exclusions: "",
            });
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="gc17-seed">{t(`${K}.run.seed`)}</Label>
            <Input
              id="gc17-seed"
              inputMode="numeric"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="gc17-iter">{t(`${K}.run.iterations`)}</Label>
            <Input
              id="gc17-iter"
              inputMode="numeric"
              value={iterations}
              onChange={(e) => setIterations(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="gc17-budget">{t(`${K}.run.budget`)}</Label>
            <Input
              id="gc17-budget"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="gc17-assumptions">{t(`${K}.run.assumptions`)}</Label>
            <Input
              id="gc17-assumptions"
              value={assumptions}
              onChange={(e) => setAssumptions(e.target.value)}
            />
          </div>
          <div className="sm:col-span-4">
            <Button type="submit" disabled={busy}>
              {t(`${K}.run.new`)}
            </Button>
          </div>
        </form>
      ) : null}

      {workspace.runs.length === 0 ? (
        <EmptyState title={t(`${K}.run.title`)} description={t(`${K}.run.empty`)} />
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.run.title`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.run.created`)}</TableHead>
              <TableHead scope="col">{t(`${K}.run.status`)}</TableHead>
              <TableHead scope="col">{t(`${K}.run.seed`)}</TableHead>
              <TableHead scope="col">{t(`${K}.run.iterations`)}</TableHead>
              <TableHead scope="col">{t(`${K}.run.checksum`)}</TableHead>
              <TableHead scope="col">{t(`${K}.run.engine`)}</TableHead>
              <TableHead scope="col" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {workspace.runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.created_at.slice(0, 10)}</TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell>{r.seed}</TableCell>
                <TableCell>{r.iterations}</TableCell>
                <TableCell className="font-mono text-xs">{r.input_checksum}</TableCell>
                <TableCell className="text-xs">
                  {r.engine} {r.engine_version}
                </TableCell>
                <TableCell className="text-right">
                  {workspace.access.canApprove && r.status === "draft" ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          onDecide({ id: r.id, target: "approved", row_version: r.row_version })
                        }
                      >
                        {t(`${K}.run.approve`)}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          onDecide({ id: r.id, target: "rejected", row_version: r.row_version })
                        }
                      >
                        {t(`${K}.run.reject`)}
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function RangesSection({
  results,
  currency,
  precision,
}: {
  results: SimResult | null;
  currency: string;
  precision: number | null;
}) {
  const { t } = useI18n();
  return (
    <Card className="flex flex-col gap-4 p-4">
      <SectionHead titleKey={`${K}.ranges.title`} descKey={`${K}.ranges.description`} />
      {!results ? (
        <EmptyState title={t(`${K}.ranges.title`)} description={t(`${K}.ranges.empty`)} />
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.ranges.title`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" />
              <TableHead scope="col" className="text-right">
                {t(`${K}.kpi.p50`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.kpi.p80`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.kpi.p90`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.ranges.mean`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.ranges.sd`)}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>{t(`${K}.ranges.cost`)}</TableCell>
              <TableCell className="text-right">{money(results.cost.p50, currency)}</TableCell>
              <TableCell className="text-right">{money(results.cost.p80, currency)}</TableCell>
              <TableCell className="text-right">{money(results.cost.p90, currency)}</TableCell>
              <TableCell className="text-right">{money(results.cost.mean, currency)}</TableCell>
              <TableCell className="text-right">{money(results.cost.sd, currency)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>{t(`${K}.ranges.schedule`)}</TableCell>
              <TableCell className="text-right">{results.schedule.p50.toFixed(1)}</TableCell>
              <TableCell className="text-right">{results.schedule.p80.toFixed(1)}</TableCell>
              <TableCell className="text-right">{results.schedule.p90.toFixed(1)}</TableCell>
              <TableCell className="text-right">{results.schedule.mean.toFixed(1)}</TableCell>
              <TableCell className="text-right">{results.schedule.sd.toFixed(1)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
      {results ? (
        <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <div>
            <dt>{t(`${K}.ranges.probBudget`)}</dt>
            <dd>{percent((results.prob_exceeds_budget ?? 0) * 100)}</dd>
          </div>
          <div>
            <dt>{t(`${K}.ranges.probFinish`)}</dt>
            <dd>{percent((results.prob_exceeds_finish ?? 0) * 100)}</dd>
          </div>
          <div>
            <dt>{t(`${K}.run.precision`)}</dt>
            <dd>{percent(precision === null ? null : precision * 100)}</dd>
          </div>
        </dl>
      ) : null}
    </Card>
  );
}

function TornadoSection({ results, currency }: { results: SimResult | null; currency: string }) {
  const { t } = useI18n();
  const rows = (results?.tornado ?? []).slice(0, 12);
  return (
    <Card className="flex flex-col gap-4 p-4">
      <SectionHead titleKey={`${K}.tornado.title`} descKey={`${K}.tornado.description`} />
      {rows.length === 0 ? (
        <EmptyState title={t(`${K}.tornado.title`)} description={t(`${K}.ranges.empty`)} />
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.tornado.title`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.tornado.risk`)}</TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.tornado.correlation`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.tornado.contribution`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.tornado.share`)}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.risk_id}>
                <TableCell>{row.title}</TableCell>
                <TableCell className="text-right">{row.correlation.toFixed(3)}</TableCell>
                <TableCell className="text-right">
                  {money(row.mean_contribution, currency)}
                </TableCell>
                <TableCell className="text-right">{percent(row.share_pct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function ReconciliationSection({
  workspace,
  currency,
}: {
  workspace: RiskContingencyWorkspace;
  currency: string;
}) {
  const { t } = useI18n();
  const r = workspace.contingency.reconciliation;
  const lines: [string, number][] = [
    [`${K}.reconciliation.opening`, r.opening],
    [`${K}.reconciliation.transfersIn`, r.transfers_in + r.additions],
    [`${K}.reconciliation.transfersOut`, -r.transfers_out],
    [`${K}.reconciliation.drawdowns`, -r.drawdowns],
    [`${K}.reconciliation.releases`, -r.releases],
    [`${K}.reconciliation.closing`, r.closing],
  ];
  return (
    <Card className="flex flex-col gap-4 p-4">
      <SectionHead
        titleKey={`${K}.reconciliation.title`}
        descKey={`${K}.reconciliation.description`}
      />
      <Table>
        <caption className="sr-only">{t(`${K}.reconciliation.title`)}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t(`${K}.reconciliation.title`)}</TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.available`)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map(([key, value]) => (
            <TableRow key={key}>
              <TableCell>{t(key)}</TableCell>
              <TableCell className="text-right">{money(value, currency)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        {t(r.balanced ? `${K}.reconciliation.balanced` : `${K}.reconciliation.unbalanced`)}
      </p>
    </Card>
  );
}

function RegisterSection({ workspace }: { workspace: RiskContingencyWorkspace }) {
  const { t } = useI18n();
  return (
    <Card className="flex flex-col gap-4 p-4">
      <SectionHead titleKey={`${K}.register.title`} descKey={`${K}.register.description`} />
      {workspace.register.length === 0 ? (
        <EmptyState title={t(`${K}.register.title`)} description={t(`${K}.register.empty`)} />
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.register.title`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.register.risk`)}</TableHead>
              <TableHead scope="col">{t(`${K}.register.category`)}</TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.register.score`)}
              </TableHead>
              <TableHead scope="col">{t(`${K}.register.owner`)}</TableHead>
              <TableHead scope="col">{t(`${K}.register.review`)}</TableHead>
              <TableHead scope="col">{t(`${K}.register.quantified`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workspace.register.map((row) => (
              <TableRow key={row.risk_id}>
                <TableCell>{row.title}</TableCell>
                <TableCell>{row.category}</TableCell>
                <TableCell className="text-right">{row.score}</TableCell>
                <TableCell>{row.owner_name ?? "—"}</TableCell>
                <TableCell>{row.next_review_date ?? "—"}</TableCell>
                <TableCell>
                  <StatusBadge status={row.quantified ? "approved" : "draft"} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function AlertsSection({
  workspace,
  busy,
  onDecide,
}: {
  workspace: RiskContingencyWorkspace;
  busy: boolean;
  onDecide: (v: AlertDecision) => void;
}) {
  return (
    <Card className="flex flex-col gap-4 p-4">
      <SectionHead titleKey={`${K}.alerts.title`} descKey={`${K}.alerts.description`} />
      <AlertRegister
        alerts={workspace.alerts}
        canWrite={workspace.access.canWrite}
        busy={busy}
        onDecide={onDecide}
      />
    </Card>
  );
}

function EventsSection({ workspace }: { workspace: RiskContingencyWorkspace }) {
  const { t } = useI18n();
  return (
    <Card className="flex flex-col gap-4 p-4">
      <SectionHead titleKey={`${K}.events.title`} descKey={`${K}.events.description`} />
      {workspace.events.length === 0 ? (
        <EmptyState title={t(`${K}.events.title`)} description={t(`${K}.events.empty`)} />
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.events.title`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.events.when`)}</TableHead>
              <TableHead scope="col">{t(`${K}.events.entity`)}</TableHead>
              <TableHead scope="col">{t(`${K}.events.action`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workspace.events.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.created_at.slice(0, 19).replace("T", " ")}</TableCell>
                <TableCell>{e.entity_type}</TableCell>
                <TableCell>{e.action}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
