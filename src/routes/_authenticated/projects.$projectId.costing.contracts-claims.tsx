// GC-16 — Project contract & claims control cockpit.
//
// Read-and-govern surface: every calculation, authorisation and state
// transition is enforced server-side. This page renders the governed
// exposure, registers, deadline calendar, alert queue and audit timeline,
// and offers only the lifecycle actions the caller's role permits.
// NON-POSTING.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlarmClock, FileWarning, Gavel, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ContractsClaimsAppendixCard } from "@/components/contracts-claims/contracts-claims-appendix";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { costingErrorMessage } from "@/lib/costing.query";
import {
  actOnClaimAlert,
  buildContractClaimSnapshot,
  refreshClaimAlerts,
  saveContractClaim,
  transitionContractClaim,
  transitionContractClaimSnapshot,
} from "@/lib/contracts-claims.functions";
import {
  claimsAppendixQueryOptions,
  claimsWorkspaceQueryOptions,
} from "@/lib/contracts-claims.query";
import {
  CLAIM_KINDS,
  CLAIM_STATUSES,
  CLAIM_TRANSITIONS,
  CONTRACTS_CLAIMS_DISCLAIMER,
  type ClaimStatus,
} from "@/lib/contracts-claims.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.contractsClaims";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/costing/contracts-claims",
)({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(claimsWorkspaceQueryOptions(params.projectId)),
  head: () => ({
    meta: [
      { title: "Contract & claims control — GridMind" },
      {
        name: "description",
        content:
          "Governed contract, variation and claim control with deadlines, exposure and certification for the project.",
      },
      { property: "og:title", content: "Contract & claims control — GridMind" },
      {
        property: "og:description",
        content:
          "Non-posting governed claims exposure, contractual deadlines, securities and approvals with a full audit trail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContractsClaimsCockpit,
});

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const monthStart = (iso: string): string => `${iso.slice(0, 7)}-01`;

function money(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

interface ClaimDraft {
  claim_ref: string;
  title: string;
  kind: string;
  clause_ref: string;
  entitlement_basis: string;
  currency_code: string;
  asserted_amount: string;
  eot_days_claimed: string;
}

const EMPTY_DRAFT: ClaimDraft = {
  claim_ref: "",
  title: "",
  kind: "variation",
  clause_ref: "",
  entitlement_basis: "",
  currency_code: "USD",
  asserted_amount: "0",
  eot_days_claimed: "0",
};

function ContractsClaimsCockpit() {
  const { projectId } = Route.useParams();
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(claimsWorkspaceQueryOptions(projectId));
  const { data: appendix } = useSuspenseQuery(claimsAppendixQueryOptions(projectId));

  const save = useServerFn(saveContractClaim);
  const transition = useServerFn(transitionContractClaim);
  const build = useServerFn(buildContractClaimSnapshot);
  const transitionSnapshot = useServerFn(transitionContractClaimSnapshot);
  const alertAction = useServerFn(actOnClaimAlert);
  const refresh = useServerFn(refreshClaimAlerts);

  const currency = data.project.currency;
  const snapshot = data.snapshot as {
    id: string;
    status: string;
    row_version: number;
    period_month: string;
  } | null;
  const frozen = snapshot?.status === "approved";

  const [period, setPeriod] = useState(snapshot?.period_month ?? monthStart(todayIso()));
  const [dataDate, setDataDate] = useState(todayIso());
  const [draft, setDraft] = useState<ClaimDraft>(EMPTY_DRAFT);
  const [open, setOpen] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["contracts-claims"] });
  const onError = (e: unknown) => toast.error(costingErrorMessage(e));

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          project_id: projectId,
          claim_ref: draft.claim_ref,
          title: draft.title,
          kind: draft.kind as (typeof CLAIM_KINDS)[number],
          clause_ref: draft.clause_ref || null,
          entitlement_basis: draft.entitlement_basis || null,
          currency_code: draft.currency_code.toUpperCase(),
          asserted_amount: Number(draft.asserted_amount) || 0,
          eot_days_claimed: Number(draft.eot_days_claimed) || 0,
        },
      }),
    onSuccess: () => {
      toast.success(t(`${K}.toast.saved`));
      setOpen(false);
      setDraft(EMPTY_DRAFT);
      void invalidate();
    },
    onError,
  });

  const transitionMutation = useMutation({
    mutationFn: (vars: { claim_id: string; to: ClaimStatus; row_version: number }) =>
      transition({ data: { ...vars, reason: "Transitioned from the claims cockpit." } }),
    onSuccess: () => {
      toast.success(t(`${K}.toast.transitioned`));
      void invalidate();
    },
    onError,
  });

  const buildMutation = useMutation({
    mutationFn: () =>
      build({
        data: { project_id: projectId, period_month: period, data_date: dataDate },
      }),
    onSuccess: () => {
      toast.success(t(`${K}.toast.built`));
      void invalidate();
    },
    onError,
  });

  const snapshotMutation = useMutation({
    mutationFn: (to: "submitted" | "approved" | "working") =>
      transitionSnapshot({
        data: {
          snapshot_id: snapshot!.id,
          to,
          row_version: snapshot!.row_version,
          reason: "Snapshot lifecycle action from the claims cockpit.",
        },
      }),
    onSuccess: () => {
      toast.success(t(`${K}.toast.snapshot`));
      void invalidate();
    },
    onError,
  });

  const alertMutation = useMutation({
    mutationFn: (vars: { alert_id: string; action: "acknowledge" | "escalate" | "resolve" }) =>
      alertAction({ data: vars }),
    onSuccess: () => {
      toast.success(t(`${K}.toast.alert`));
      void invalidate();
    },
    onError,
  });

  const refreshMutation = useMutation({
    mutationFn: () => refresh({ data: { project_id: projectId } }),
    onSuccess: () => {
      toast.success(t(`${K}.toast.alertsRefreshed`));
      void invalidate();
    },
    onError,
  });

  const totals = data.totals;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title={t(`${K}.title`)}
        description={t(`${K}.subtitle`)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data.access.canWrite ? (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" disabled={frozen}>
                    {t(`${K}.actions.newClaim`)}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t(`${K}.actions.newClaim`)}</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-3">
                    <div className="grid gap-1">
                      <Label htmlFor="cc-ref">{t(`${K}.table.ref`)}</Label>
                      <Input
                        id="cc-ref"
                        value={draft.claim_ref}
                        onChange={(e) => setDraft({ ...draft, claim_ref: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="cc-title">{t(`${K}.table.title`)}</Label>
                      <Input
                        id="cc-title"
                        value={draft.title}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1">
                        <Label htmlFor="cc-kind">{t(`${K}.table.kind`)}</Label>
                        <select
                          id="cc-kind"
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          value={draft.kind}
                          onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                        >
                          {CLAIM_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {t(`${K}.claimKind.${k}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor="cc-clause">{t(`${K}.table.clause`)}</Label>
                        <Input
                          id="cc-clause"
                          value={draft.clause_ref}
                          onChange={(e) => setDraft({ ...draft, clause_ref: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="grid gap-1">
                        <Label htmlFor="cc-ccy">{t(`${K}.table.currency`)}</Label>
                        <Input
                          id="cc-ccy"
                          maxLength={3}
                          value={draft.currency_code}
                          onChange={(e) => setDraft({ ...draft, currency_code: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor="cc-amount">{t(`${K}.totals.asserted`)}</Label>
                        <Input
                          id="cc-amount"
                          inputMode="decimal"
                          value={draft.asserted_amount}
                          onChange={(e) => setDraft({ ...draft, asserted_amount: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor="cc-eot">{t(`${K}.totals.eot`)}</Label>
                        <Input
                          id="cc-eot"
                          inputMode="numeric"
                          value={draft.eot_days_claimed}
                          onChange={(e) => setDraft({ ...draft, eot_days_claimed: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="cc-basis">{t(`${K}.table.entitlement`)}</Label>
                      <Textarea
                        id="cc-basis"
                        rows={3}
                        value={draft.entitlement_basis}
                        onChange={(e) => setDraft({ ...draft, entitlement_basis: e.target.value })}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={() => saveMutation.mutate()}
                      disabled={
                        saveMutation.isPending || !draft.claim_ref || draft.title.length < 3
                      }
                    >
                      {t(`${K}.actions.save`)}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
            >
              {t(`${K}.actions.refreshAlerts`)}
            </Button>
          </div>
        }
      />

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>{t(`${K}.disclaimerTitle`)}</AlertTitle>
        <AlertDescription>{CONTRACTS_CLAIMS_DISCLAIMER}</AlertDescription>
      </Alert>

      <KpiGrid>
        <KpiTile
          label={t(`${K}.totals.liveExposure`)}
          value={money(totals.live_exposure, currency)}
          icon={Gavel}
        />
        <KpiTile
          label={t(`${K}.totals.unapproved`)}
          value={money(totals.unapproved_exposure, currency)}
          icon={FileWarning}
        />
        <KpiTile label={t(`${K}.totals.ld`)} value={money(totals.ld_exposure, currency)} />
        <KpiTile
          label={t(`${K}.totals.eot`)}
          value={`${totals.eot_days_approved} / ${totals.eot_days_claimed}`}
          icon={AlarmClock}
        />
      </KpiGrid>

      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="grid gap-1">
          <Label htmlFor="cc-period">{t(`${K}.filters.period`)}</Label>
          <Input
            id="cc-period"
            type="month"
            value={period.slice(0, 7)}
            onChange={(e) => setPeriod(`${e.target.value}-01`)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="cc-datadate">{t(`${K}.filters.dataDate`)}</Label>
          <Input
            id="cc-datadate"
            type="date"
            value={dataDate}
            onChange={(e) => setDataDate(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.access.canWrite ? (
            <Button
              size="sm"
              onClick={() => buildMutation.mutate()}
              disabled={buildMutation.isPending}
            >
              {t(`${K}.actions.build`)}
            </Button>
          ) : null}
          {snapshot && data.access.canWrite && snapshot.status === "working" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => snapshotMutation.mutate("submitted")}
            >
              {t(`${K}.actions.submit`)}
            </Button>
          ) : null}
          {snapshot && data.access.canApprove && snapshot.status === "submitted" ? (
            <Button size="sm" variant="outline" onClick={() => snapshotMutation.mutate("approved")}>
              {t(`${K}.actions.approve`)}
            </Button>
          ) : null}
          {snapshot ? (
            <StatusBadge status={snapshot.status} label={t(`${K}.status.${snapshot.status}`)} />
          ) : null}
        </div>
      </Card>

      <section>
        <SectionHeader title={t(`${K}.sections.register`)} />
        {data.claims.length === 0 ? (
          <EmptyState title={t(`${K}.empty.claims`)} description={t(`${K}.empty.claimsHint`)} />
        ) : (
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t(`${K}.table.ref`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.table.kind`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.table.status`)}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t(`${K}.totals.asserted`)}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t(`${K}.totals.approved`)}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t(`${K}.totals.liveExposure`)}
                  </TableHead>
                  <TableHead scope="col">{t(`${K}.table.actions`)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.claims.map((c) => {
                  const next = CLAIM_TRANSITIONS[c.status as ClaimStatus] ?? [];
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <span className="font-medium">{c.claim_ref}</span>
                        <span className="block text-xs text-muted-foreground">{c.title}</span>
                      </TableCell>
                      <TableCell>{t(`${K}.claimKind.${c.kind}`)}</TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} label={t(`${K}.claimStatus.${c.status}`)} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(c.asserted_amount, c.currency_code)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(c.approved_amount, c.currency_code)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(c.exposure.exposure, c.currency_code)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {data.access.canWrite && !frozen
                            ? next
                                .filter((to) => CLAIM_STATUSES.includes(to))
                                .map((to) => (
                                  <Button
                                    key={to}
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      transitionMutation.mutate({
                                        claim_id: c.id,
                                        to,
                                        row_version: (c as unknown as { row_version: number })
                                          .row_version,
                                      })
                                    }
                                  >
                                    {t(`${K}.claimStatus.${to}`)}
                                  </Button>
                                ))
                            : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      <section>
        <SectionHeader title={t(`${K}.sections.deadlines`)} />
        {data.deadlines.length === 0 ? (
          <EmptyState title={t(`${K}.empty.deadlines`)} />
        ) : (
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t(`${K}.table.deadline`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.table.kind`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.table.due`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.table.status`)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.deadlines.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.label}</TableCell>
                    <TableCell>{t(`${K}.deadlineKind.${d.kind}`)}</TableCell>
                    <TableCell className="tabular-nums">
                      {d.due_date} · {d.state.days_remaining}d
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={d.state.overdue ? "rejected" : d.state.status}
                        label={t(`${K}.deadlineStatus.${d.state.status}`)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      <section>
        <SectionHeader title={t(`${K}.sections.alerts`)} />
        {data.alerts.length === 0 ? (
          <EmptyState title={t(`${K}.empty.alerts`)} />
        ) : (
          <Card className="flex flex-col divide-y divide-border">
            {data.alerts.map((a) => {
              const row = a as unknown as {
                id: string;
                kind: string;
                severity: string;
                title: string;
                state: string;
                due_at: string | null;
              };
              return (
                <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="flex flex-col">
                    <span className="text-sm text-foreground">{row.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.kind} · {row.severity}
                      {row.due_at ? ` · ${row.due_at}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={row.state} label={t(`${K}.alertState.${row.state}`)} />
                    {data.access.canWrite ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            alertMutation.mutate({ alert_id: row.id, action: "acknowledge" })
                          }
                        >
                          {t(`${K}.actions.acknowledge`)}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            alertMutation.mutate({ alert_id: row.id, action: "resolve" })
                          }
                        >
                          {t(`${K}.actions.resolve`)}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </section>

      <section>
        <SectionHeader title={t(`${K}.sections.appendix`)} />
        <ContractsClaimsAppendixCard appendix={appendix} currency={currency} />
      </section>

      <section>
        <SectionHeader title={t(`${K}.sections.timeline`)} />
        {data.timeline.length === 0 ? (
          <EmptyState title={t(`${K}.empty.timeline`)} />
        ) : (
          <Card className="flex flex-col divide-y divide-border text-xs">
            {data.timeline.map((e, i) => {
              const row = e as unknown as {
                event_type: string;
                occurred_at: string;
                summary?: string;
              };
              return (
                <div key={`${row.occurred_at}-${i}`} className="flex justify-between gap-3 p-2">
                  <span className="text-foreground">{row.summary ?? row.event_type}</span>
                  <span className="tabular-nums text-muted-foreground">{row.occurred_at}</span>
                </div>
              );
            })}
          </Card>
        )}
      </section>
    </div>
  );
}
