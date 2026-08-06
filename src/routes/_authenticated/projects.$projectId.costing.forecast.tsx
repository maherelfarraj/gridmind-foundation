// GC-01 — Forecast periods (ETC by cost code/month) and accrual lifecycle.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
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
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createCostAccrual,
  transitionCostAccrual,
  upsertCostForecast,
} from "@/lib/costing.functions";
import {
  costingAccessQueryOptions,
  costingErrorMessage,
  costingWorkspaceQueryOptions,
} from "@/lib/costing.query";
import { canTransitionAccrual, formatCostingMoney, monthKey } from "@/lib/costing.rules";

export const Route = createFileRoute("/_authenticated/projects/$projectId/costing/forecast")({
  head: () => ({
    meta: [
      { title: "Cost forecast — GridMind EPC" },
      {
        name: "description",
        content: "Monthly ETC forecast periods and approved accruals for the project.",
      },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(costingWorkspaceQueryOptions(params.projectId)),
  pendingComponent: () => <Skeleton className="h-64 w-full" />,
  component: ForecastView,
});

function ForecastView() {
  const { t } = useI18n();
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(costingWorkspaceQueryOptions(projectId));
  const { data: access } = useSuspenseQuery(costingAccessQueryOptions());
  const canWrite = access.canWrite;

  const upsertFn = useServerFn(upsertCostForecast);
  const createAccrualFn = useServerFn(createCostAccrual);
  const transitionFn = useServerFn(transitionCostAccrual);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: costingWorkspaceQueryOptions(projectId).queryKey });

  const defaultCurrency = data.rollups[0]?.currency_code ?? "USD";
  const thisMonth = monthKey(new Date().toISOString().slice(0, 10));

  const [fCode, setFCode] = useState("");
  const [fPeriod, setFPeriod] = useState(thisMonth.slice(0, 7));
  const [fAmount, setFAmount] = useState("");
  const [aCode, setACode] = useState("");
  const [aPeriod, setAPeriod] = useState(thisMonth.slice(0, 7));
  const [aAmount, setAAmount] = useState("");
  const [aDesc, setADesc] = useState("");

  const saveForecast = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          projectId,
          cost_code_id: fCode,
          period: `${fPeriod}-01`,
          etc_amount: Number(fAmount),
          currency_code: defaultCurrency,
        },
      }),
    onSuccess: async () => {
      toast.success(t("financeMod.costing.forecast.savedForecast"));
      setFAmount("");
      await invalidate();
    },
    onError: (e) => toast.error(costingErrorMessage(e)),
  });

  const addAccrual = useMutation({
    mutationFn: () =>
      createAccrualFn({
        data: {
          projectId,
          cost_code_id: aCode,
          period: `${aPeriod}-01`,
          amount: Number(aAmount),
          currency_code: defaultCurrency,
          description: aDesc || undefined,
        },
      }),
    onSuccess: async () => {
      toast.success(t("financeMod.costing.forecast.createdAccrual"));
      setAAmount("");
      setADesc("");
      await invalidate();
    },
    onError: (e) => toast.error(costingErrorMessage(e)),
  });

  const transition = useMutation({
    mutationFn: (vars: { id: string; action: "approve" | "reverse" }) =>
      transitionFn({ data: vars }),
    onSuccess: async (r) => {
      toast.success(t("financeMod.costing.forecast.transitioned", { status: r.status }));
      await invalidate();
    },
    onError: (e) => toast.error(costingErrorMessage(e)),
  });

  const codeOptions = data.costCodes;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        as="h2"
        title={t("financeMod.costing.forecast.title")}
        description={t("financeMod.costing.forecast.description")}
      />

      {canWrite ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-sm font-semibold text-foreground">{t("financeMod.costing.forecast.addForecast")}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-code">{t("financeMod.costing.forecast.costCode")}</Label>
                <Select value={fCode} onValueChange={setFCode}>
                  <SelectTrigger id="f-code">
                    <SelectValue placeholder={t("financeMod.costing.forecast.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    {codeOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-period">{t("financeMod.costing.forecast.period")}</Label>
                <Input
                  id="f-period"
                  type="month"
                  value={fPeriod}
                  onChange={(e) => setFPeriod(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f-amount">{t("financeMod.costing.forecast.etcLabel", { currency: defaultCurrency })}</Label>
                <Input
                  id="f-amount"
                  inputMode="decimal"
                  value={fAmount}
                  onChange={(e) => setFAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <Button
              className="self-start"
              disabled={!fCode || !fAmount || saveForecast.isPending}
              onClick={() => saveForecast.mutate()}
            >
              {t("financeMod.costing.forecast.saveForecast")}
            </Button>
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-sm font-semibold text-foreground">{t("financeMod.costing.forecast.newAccrual")}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="a-code">{t("financeMod.costing.forecast.costCode")}</Label>
                <Select value={aCode} onValueChange={setACode}>
                  <SelectTrigger id="a-code">
                    <SelectValue placeholder={t("financeMod.costing.forecast.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    {codeOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="a-period">{t("financeMod.costing.forecast.period")}</Label>
                <Input
                  id="a-period"
                  type="month"
                  value={aPeriod}
                  onChange={(e) => setAPeriod(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="a-amount">{t("financeMod.costing.forecast.amountLabel", { currency: defaultCurrency })}</Label>
                <Input
                  id="a-amount"
                  inputMode="decimal"
                  value={aAmount}
                  onChange={(e) => setAAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-desc">{t("financeMod.costing.forecast.descriptionLabel")}</Label>
              <Input
                id="a-desc"
                value={aDesc}
                onChange={(e) => setADesc(e.target.value)}
                placeholder={t("financeMod.costing.forecast.descriptionPlaceholder")}
              />
            </div>
            <Button
              className="self-start"
              disabled={!aCode || !aAmount || addAccrual.isPending}
              onClick={() => addAccrual.mutate()}
            >
              {t("financeMod.costing.forecast.createAccrual")}
            </Button>
          </Card>
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t("financeMod.costing.forecast.periodsTitle")}</h3>
        {data.forecasts.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title={t("financeMod.costing.forecast.emptyForecastTitle")}
            description={t("financeMod.costing.forecast.emptyForecastBody")}
          />
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("financeMod.costing.forecast.costCode")}</TableHead>
                  <TableHead>{t("financeMod.costing.forecast.period")}</TableHead>
                  <TableHead className="text-right">{t("financeMod.costing.forecast.etc")}</TableHead>
                  <TableHead>{t("financeMod.costing.forecast.notes")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.forecasts.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.cost_code ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{f.period.slice(0, 7)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCostingMoney(f.etc_amount, f.currency_code)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{f.notes ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t("financeMod.costing.forecast.accrualsTitle")}</h3>
        {data.accruals.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title={t("financeMod.costing.forecast.emptyAccrualsTitle")}
            description={t("financeMod.costing.forecast.emptyAccrualsBody")}
          />
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("financeMod.costing.forecast.costCode")}</TableHead>
                  <TableHead>{t("financeMod.costing.forecast.period")}</TableHead>
                  <TableHead>{t("financeMod.costing.forecast.status")}</TableHead>
                  <TableHead className="text-right">{t("financeMod.costing.forecast.amount")}</TableHead>
                  <TableHead className="text-right">{t("financeMod.costing.forecast.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.accruals.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.cost_code ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{a.period.slice(0, 7)}</TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCostingMoney(a.amount, a.currency_code)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {canWrite && canTransitionAccrual(a.status, "approve") ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={transition.isPending}
                            onClick={() => transition.mutate({ id: a.id, action: "approve" })}
                          >
                            {t("financeMod.costing.forecast.approve")}
                          </Button>
                        ) : null}
                        {canWrite && canTransitionAccrual(a.status, "reverse") ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={transition.isPending}
                            onClick={() => transition.mutate({ id: a.id, action: "reverse" })}
                          >
                            {t("financeMod.costing.forecast.reverse")}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
