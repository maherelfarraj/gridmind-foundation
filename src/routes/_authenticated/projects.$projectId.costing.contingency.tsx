// GC-14 — Project contingency cockpit: pools, governed drawdown ledger and risk exposure.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ShieldAlert, Wallet } from "lucide-react";
import { toast } from "sonner";

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
import { money, percent } from "@/components/cashflow/cash-format";
import {
  createContingencyPool,
  decideContingencyMovement,
  requestContingencyMovement,
} from "@/lib/contingency.functions";
import { contingencyWorkspaceQueryOptions } from "@/lib/contingency.query";
import { MOVEMENT_KINDS, type MovementKind, type PoolState } from "@/lib/contingency.rules";
import type { ContingencyWorkspace } from "@/lib/contingency.server";
import { costingErrorMessage } from "@/lib/costing.query";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.contingency";

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing/contingency")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(contingencyWorkspaceQueryOptions(params.projectId)),
  head: () => ({
    meta: [
      { title: "Contingency & risk exposure — GridMind" },
      {
        name: "description",
        content:
          "Governed contingency pools, drawdown approvals and probability-weighted risk exposure for the project.",
      },
      { property: "og:title", content: "Contingency & risk exposure — GridMind" },
      {
        property: "og:description",
        content: "Contingency pools, drawdown governance and P50/P80 risk exposure.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContingencyCockpit,
});

function ContingencyCockpit() {
  const { projectId } = Route.useParams();
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(contingencyWorkspaceQueryOptions(projectId));

  const createPool = useServerFn(createContingencyPool);
  const requestMovement = useServerFn(requestContingencyMovement);
  const decideMovement = useServerFn(decideContingencyMovement);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["contingency", "workspace", projectId] });
  const onError = (e: unknown) => toast.error(costingErrorMessage(e));

  const poolMutation = useMutation({
    mutationFn: (input: { name: string; original_amount: number; basis: string | null }) =>
      createPool({
        data: {
          project_id: projectId,
          name: input.name,
          basis: input.basis,
          currency_code: data.currency_code,
          original_amount: input.original_amount,
          status: "active",
        },
      }),
    onSuccess: async () => {
      toast.success(t(`${K}.pools.created`));
      await invalidate();
    },
    onError,
  });

  const movementMutation = useMutation({
    mutationFn: (input: {
      pool_id: string;
      kind: MovementKind;
      amount: number;
      effective_date: string;
      reason: string;
    }) =>
      requestMovement({
        data: {
          project_id: projectId,
          currency_code: data.currency_code,
          ...input,
        },
      }),
    onSuccess: async () => {
      toast.success(t(`${K}.movements.requested`));
      await invalidate();
    },
    onError,
  });

  const decisionMutation = useMutation({
    mutationFn: (input: { id: string; status: "approved" | "rejected"; decision_note?: string }) =>
      decideMovement({ data: input }),
    onSuccess: async (_r, vars) => {
      toast.success(
        t(vars.status === "approved" ? `${K}.movements.approved` : `${K}.movements.rejected`),
      );
      await invalidate();
    },
    onError,
  });

  const currency = data.currency_code;
  const canWrite = data.access.canWrite;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t(`${K}.title`)} description={t(`${K}.description`)} />

      {!canWrite ? <p className="text-xs text-muted-foreground">{t(`${K}.readOnly`)}</p> : null}

      <KpiGrid>
        <KpiTile
          label={t(`${K}.kpi.original`)}
          value={money(data.totals.original_amount, currency)}
          icon={Wallet}
        />
        <KpiTile
          label={t(`${K}.kpi.balance`)}
          value={money(data.totals.balance, currency)}
          status={data.totals.balance < 0 ? "bad" : "good"}
          hint={percent(data.totals.utilization_pct)}
        />
        <KpiTile label={t(`${K}.kpi.drawn`)} value={money(data.totals.drawn, currency)} />
        <KpiTile
          label={t(`${K}.kpi.pending`)}
          value={String(data.pending_count)}
          hint={money(data.totals.pending_draw, currency)}
          status={data.pending_count > 0 ? "warning" : "neutral"}
        />
        <KpiTile
          label={t(`${K}.kpi.exposure`)}
          value={money(data.exposure.p80, currency)}
          hint={`${t(`${K}.exposure.p50`)} ${money(data.exposure.p50, currency)}`}
          icon={ShieldAlert}
        />
        <KpiTile
          label={t(`${K}.kpi.cover`)}
          value={data.adequacy.cover_ratio === null ? "—" : data.adequacy.cover_ratio.toFixed(2)}
          hint={t(`${K}.kpi.coverHelp`)}
          status={data.adequacy.tone}
        />
      </KpiGrid>

      <PoolSection
        pools={data.pools}
        currency={currency}
        canWrite={canWrite}
        onCreate={(v) => poolMutation.mutate(v)}
        busy={poolMutation.isPending}
      />

      <MovementSection
        workspace={data}
        currency={currency}
        onRequest={(v) => movementMutation.mutate(v)}
        onDecide={(v) => decisionMutation.mutate(v)}
        busy={movementMutation.isPending || decisionMutation.isPending}
      />

      <ExposureSection workspace={data} currency={currency} />
    </div>
  );
}

function PoolSection({
  pools,
  currency,
  canWrite,
  onCreate,
  busy,
}: {
  pools: PoolState[];
  currency: string;
  canWrite: boolean;
  onCreate: (v: { name: string; original_amount: number; basis: string | null }) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [basis, setBasis] = useState("");
  const [amount, setAmount] = useState("");

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.pools.title`)}</h2>
        <p className="text-xs text-muted-foreground">{t(`${K}.pools.description`)}</p>
      </div>

      {pools.length === 0 ? (
        <EmptyState title={t(`${K}.pools.emptyTitle`)} description={t(`${K}.pools.emptyBody`)} />
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.pools.caption`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.pools.name`)}</TableHead>
              <TableHead scope="col">{t(`${K}.pools.status`)}</TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.pools.original`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.pools.drawn`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.pools.released`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.pools.balance`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.pools.utilization`)}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pools.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>
                  <StatusBadge status={p.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(p.original_amount, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(p.drawn, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(p.released, currency)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${p.over_drawn ? "text-destructive" : ""}`}
                >
                  {money(p.balance, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {percent(p.utilization_pct)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canWrite ? (
        <form
          className="grid gap-3 border-t border-border pt-4 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            onCreate({
              name: name.trim(),
              basis: basis.trim() ? basis.trim() : null,
              original_amount: Number(amount || 0),
            });
            setName("");
            setBasis("");
            setAmount("");
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="pool-name">{t(`${K}.form.poolName`)}</Label>
            <Input
              id="pool-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={160}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pool-basis">{t(`${K}.form.poolBasis`)}</Label>
            <Input id="pool-basis" value={basis} onChange={(e) => setBasis(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pool-amount">{t(`${K}.form.amount`)}</Label>
            <Input
              id="pool-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={busy}>
              {t(`${K}.pools.create`)}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function MovementSection({
  workspace,
  currency,
  onRequest,
  onDecide,
  busy,
}: {
  workspace: ContingencyWorkspace;
  currency: string;
  onRequest: (v: {
    pool_id: string;
    kind: MovementKind;
    amount: number;
    effective_date: string;
    reason: string;
  }) => void;
  onDecide: (v: { id: string; status: "approved" | "rejected"; decision_note?: string }) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [poolId, setPoolId] = useState("");
  const [kind, setKind] = useState<MovementKind>("draw");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");

  const poolName = (id: string) => workspace.pools.find((p) => p.id === id)?.name ?? "—";

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.movements.title`)}</h2>
        <p className="text-xs text-muted-foreground">{t(`${K}.movements.description`)}</p>
      </div>

      {workspace.movements.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${K}.movements.empty`)}</p>
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.movements.caption`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.movements.date`)}</TableHead>
              <TableHead scope="col">{t(`${K}.movements.pool`)}</TableHead>
              <TableHead scope="col">{t(`${K}.movements.kind`)}</TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.movements.amount`)}
              </TableHead>
              <TableHead scope="col">{t(`${K}.movements.reason`)}</TableHead>
              <TableHead scope="col">{t(`${K}.movements.status`)}</TableHead>
              <TableHead scope="col">{t(`${K}.movements.actions`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workspace.movements.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="tabular-nums">{m.effective_date}</TableCell>
                <TableCell>{poolName(m.pool_id)}</TableCell>
                <TableCell>{t(`${K}.movements.kinds.${m.kind}`)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(m.amount, currency)}
                </TableCell>
                <TableCell className="max-w-[24ch] truncate text-muted-foreground">
                  {m.reason}
                </TableCell>
                <TableCell>
                  <StatusBadge status={m.status} />
                </TableCell>
                <TableCell>
                  {m.status === "pending" && workspace.access.canApprove ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onDecide({ id: m.id, status: "approved" })}
                      >
                        {t(`${K}.movements.approve`)}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          const note = window.prompt(t(`${K}.movements.rejectPrompt`));
                          if (note && note.trim()) {
                            onDecide({ id: m.id, status: "rejected", decision_note: note.trim() });
                          }
                        }}
                      >
                        {t(`${K}.movements.reject`)}
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {workspace.access.canWrite && workspace.pools.length > 0 ? (
        <form
          className="grid gap-3 border-t border-border pt-4 sm:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            onRequest({
              pool_id: poolId || workspace.pools[0]!.id,
              kind,
              amount: Number(amount || 0),
              effective_date: date,
              reason: reason.trim(),
            });
            setAmount("");
            setReason("");
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="mv-pool">{t(`${K}.form.pool`)}</Label>
            <select
              id="mv-pool"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={poolId || workspace.pools[0]!.id}
              onChange={(e) => setPoolId(e.target.value)}
            >
              {workspace.pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="mv-kind">{t(`${K}.form.kind`)}</Label>
            <select
              id="mv-kind"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as MovementKind)}
            >
              {MOVEMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`${K}.movements.kinds.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="mv-amount">{t(`${K}.form.amount`)}</Label>
            <Input
              id="mv-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="mv-date">{t(`${K}.form.effectiveDate`)}</Label>
            <Input
              id="mv-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="mv-reason">{t(`${K}.form.reason`)}</Label>
            <Input
              id="mv-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              maxLength={2000}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={busy}>
              {t(`${K}.movements.request`)}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function ExposureSection({
  workspace,
  currency,
}: {
  workspace: ContingencyWorkspace;
  currency: string;
}) {
  const { t } = useI18n();

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.exposure.title`)}</h2>
        <p className="text-xs text-muted-foreground">{t(`${K}.exposure.description`)}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            [`${K}.exposure.expectedTotal`, money(workspace.exposure.expected_value, currency)],
            [`${K}.exposure.p50`, money(workspace.exposure.p50, currency)],
            [`${K}.exposure.p80`, money(workspace.exposure.p80, currency)],
            [`${K}.exposure.sigma`, money(workspace.exposure.sigma, currency)],
            [`${K}.exposure.daysExpected`, String(workspace.exposure.schedule_days_expected)],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-md border border-border p-3">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t(key)}</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      {workspace.quantifications.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${K}.exposure.empty`)}</p>
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.exposure.caption`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.exposure.risk`)}</TableHead>
              <TableHead scope="col">{t(`${K}.exposure.range`)}</TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.exposure.probability`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.exposure.expected`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.exposure.days`)}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workspace.quantifications.map((q) => (
              <TableRow key={q.risk_id}>
                <TableCell className="font-medium">{q.risk_title}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {money(q.cost_low, currency)} / {money(q.cost_most_likely, currency)} /{" "}
                  {money(q.cost_high, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {percent(q.probability_pct)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(q.expected_value, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{q.schedule_days_impact}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
