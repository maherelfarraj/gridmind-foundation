// GC-03 — Costing period close: readiness, state transitions and reporting settings.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Lock, LockOpen, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { CloseCockpit } from "@/components/costing/close-cockpit";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
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
import { setCostingSettings, transitionCostingPeriod } from "@/lib/costing.close.functions";
import { costingCloseQueryOptions } from "@/lib/costing.close.query";
import type { CostingPeriodState } from "@/lib/costing.periods";
import { costingErrorMessage } from "@/lib/costing.query";
import { formatCostingMoney } from "@/lib/costing.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing/close")({
  head: () => ({
    meta: [
      { title: "Costing period close — GridMind EPC" },
      {
        name: "description",
        content:
          "Soft lock and hard close costing periods, review close readiness and set reporting materiality.",
      },
      { property: "og:title", content: "Costing period close — GridMind EPC" },
      {
        property: "og:description",
        content: "Period locks, close readiness checks and reporting materiality for the project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(costingCloseQueryOptions(params.projectId)),
  pendingComponent: () => <Skeleton className="h-64 w-full" />,
  component: CloseView,
});

const STATE_TONE: Record<CostingPeriodState, "default" | "secondary" | "destructive"> = {
  open: "secondary",
  soft_locked: "default",
  hard_closed: "destructive",
};

function CloseView() {
  const { t } = useI18n();
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const { data } = useSuspenseQuery(costingCloseQueryOptions(projectId, period));

  const transitionFn = useServerFn(transitionCostingPeriod);
  const settingsFn = useServerFn(setCostingSettings);

  const [reason, setReason] = useState("");
  const [tz, setTz] = useState(data.settings.reporting_timezone);
  const [abs, setAbs] = useState(String(data.settings.materiality_abs));
  const [pct, setPct] = useState(String(data.settings.materiality_pct));

  const invalidate = () => qc.invalidateQueries({ queryKey: ["costing"] });

  const focusRow = data.periods.find(
    (p) => p.period_month === data.focusPeriod && p.project_id === projectId,
  );

  const transition = useMutation({
    mutationFn: (target: CostingPeriodState) =>
      transitionFn({
        data: {
          companyId: data.project.company_id,
          projectId,
          period: data.focusPeriod,
          target,
          reason: reason.trim() || null,
          expectedVersion: focusRow?.row_version ?? null,
        },
      }),
    onSuccess: async (r) => {
      toast.success(
        t("financeMod.costing.close.transitioned", {
          state: t(`financeMod.costing.close.state.${r.state}`),
        }),
      );
      setReason("");
      await invalidate();
    },
    onError: (e) => toast.error(costingErrorMessage(e)),
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      settingsFn({
        data: {
          companyId: data.project.company_id,
          reporting_timezone: tz.trim(),
          materiality_abs: Number(abs) || 0,
          materiality_pct: Number(pct) || 0,
        },
      }),
    onSuccess: async () => {
      toast.success(t("financeMod.costing.close.saved"));
      await invalidate();
    },
    onError: (e) => toast.error(costingErrorMessage(e)),
  });

  const blockers = data.readiness.items.filter((i) => i.severity === "blocker");
  const warnings = data.readiness.items.filter((i) => i.severity === "warning");
  const money = (n: number) => formatCostingMoney(n, data.baseCurrency);
  const busy = transition.isPending;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        as="h2"
        title={t("financeMod.costing.close.title")}
        description={t("financeMod.costing.close.description")}
      />

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex w-48 flex-col gap-1.5">
            <Label htmlFor="focus-period">{t("financeMod.costing.close.focusPeriod")}</Label>
            <Input
              id="focus-period"
              type="month"
              value={data.focusPeriod.slice(0, 7)}
              onChange={(e) => setPeriod(e.target.value ? `${e.target.value}-01` : undefined)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {t("financeMod.costing.close.currentPeriod")}: {data.currentPeriod.slice(0, 7)} (
              {data.settings.reporting_timezone})
            </span>
            <Badge variant={STATE_TONE[data.state]} className="w-fit">
              {t(`financeMod.costing.close.state.${data.state}`)}
            </Badge>
          </div>
        </div>

        <Alert>
          {data.state === "hard_closed" ? (
            <ShieldAlert className="size-4" />
          ) : data.state === "soft_locked" ? (
            <Lock className="size-4" />
          ) : (
            <LockOpen className="size-4" />
          )}
          <AlertTitle>{t(`financeMod.costing.close.state.${data.state}`)}</AlertTitle>
          <AlertDescription>
            {t(`financeMod.costing.close.stateHint.${data.state}`, {
              next: data.nextPeriod.slice(0, 7),
            })}
          </AlertDescription>
        </Alert>

        {data.canClose ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="close-reason">{t("financeMod.costing.close.reasonLabel")}</Label>
              <Textarea
                id="close-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("financeMod.costing.close.reasonPlaceholder")}
                rows={2}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || data.state !== "open"}
                onClick={() => transition.mutate("soft_locked")}
              >
                <Lock className="size-4" /> {t("financeMod.costing.close.actions.softLock")}
              </Button>
              <Button
                variant="destructive"
                disabled={busy || data.state !== "soft_locked" || blockers.length > 0}
                onClick={() => transition.mutate("hard_closed")}
              >
                <ShieldAlert className="size-4" /> {t("financeMod.costing.close.actions.hardClose")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy || data.state === "open" || !reason.trim()}
                onClick={() => transition.mutate("open")}
              >
                <LockOpen className="size-4" /> {t("financeMod.costing.close.actions.reopen")}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {t("financeMod.costing.close.readinessTitle")}
          </h3>
          {blockers.length > 0 ? (
            <Badge variant="destructive">
              {t("financeMod.costing.close.blockers", { count: blockers.length })}
            </Badge>
          ) : null}
          {warnings.length > 0 ? (
            <Badge variant="outline">
              {t("financeMod.costing.close.warnings", { count: warnings.length })}
            </Badge>
          ) : null}
        </div>
        {data.readiness.items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" /> {t("financeMod.costing.close.ready")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.readiness.items.map((item) => (
              <li key={item.key} className="flex items-start gap-2 text-sm">
                {item.severity === "blocker" ? (
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                )}
                <span className="text-foreground">
                  {t(`financeMod.costing.close.checks.${item.key}`, {
                    count: item.count,
                    currencies: (item.currencies ?? []).join(", "),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t("financeMod.costing.close.previewTitle")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ["budget", data.preview.totals.budget_current],
              ["committed", data.preview.totals.committed],
              ["actual", data.preview.totals.actual],
              ["accruals", data.preview.totals.accruals],
              ["etc", data.preview.totals.etc],
              ["eac", data.preview.totals.eac],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                {t(`financeMod.costing.versions.${key}`)}
              </span>
              <span className="font-mono text-sm font-medium text-foreground">{money(value)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t("financeMod.costing.close.history")}
        </h3>
        {data.periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("financeMod.costing.close.noPeriods")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("financeMod.costing.close.focusPeriod")}</TableHead>
                <TableHead>{t("financeMod.costing.versions.status.working")}</TableHead>
                <TableHead>{t("financeMod.costing.close.reasonLabel")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.periods.map((p) => (
                <TableRow key={`${p.period_month}-${p.project_id ?? "company"}`}>
                  <TableCell className="font-mono">
                    {p.period_month.slice(0, 7)}
                    {p.project_id ? "" : " · company"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATE_TONE[p.state]}>
                      {t(`financeMod.costing.close.state.${p.state}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {data.canClose ? (
        <Card className="flex flex-col gap-3 p-4">
          <h3 className="text-sm font-semibold text-foreground">
            {t("financeMod.costing.close.settingsTitle")}
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tz">{t("financeMod.costing.close.timezone")}</Label>
              <Input id="tz" value={tz} onChange={(e) => setTz(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mat-abs">
                {t("financeMod.costing.close.materialityAbs", { currency: data.baseCurrency })}
              </Label>
              <Input
                id="mat-abs"
                inputMode="decimal"
                value={abs}
                onChange={(e) => setAbs(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mat-pct">{t("financeMod.costing.close.materialityPct")}</Label>
              <Input
                id="mat-pct"
                inputMode="decimal"
                value={pct}
                onChange={(e) => setPct(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("financeMod.costing.close.materialityHint")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("financeMod.costing.close.timezoneHint")}
          </p>
          <div>
            <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
              {t("financeMod.costing.close.save")}
            </Button>
          </div>
        </Card>
      ) : null}
      <CloseCockpit projectId={projectId} {...(period ? { period } : {})} />
    </div>
  );
}
