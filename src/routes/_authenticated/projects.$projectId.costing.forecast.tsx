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
import { useI18n } from "@/lib/i18n/locale-provider";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

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

  const baseCurrency = data.baseCurrency;
  const rateOf = (code: string) =>
    code === baseCurrency ? 1 : (data.fxRates.find((r) => r.currency_code === code)?.rate ?? 0);
  const rateInfo = (code: string) => data.fxRates.find((r) => r.currency_code === code) ?? null;
  const currencyOptions = Array.from(
    new Set([
      baseCurrency,
      ...data.fxRates.map((r) => r.currency_code),
      ...data.forecasts.map((f) => f.currency_code),
      ...data.accruals.map((a) => a.currency_code),
    ]),
  );
  const thisMonth = monthKey(new Date().toISOString().slice(0, 10));

  const [fCode, setFCode] = useState("");
  const [fPeriod, setFPeriod] = useState(thisMonth.slice(0, 7));
  const [fAmount, setFAmount] = useState("");
  const [aCode, setACode] = useState("");
  const [aPeriod, setAPeriod] = useState(thisMonth.slice(0, 7));
  const [aAmount, setAAmount] = useState("");
  const [aDesc, setADesc] = useState("");
  const [fCurrency, setFCurrency] = useState(baseCurrency);
  const [aCurrency, setACurrency] = useState(baseCurrency);
  const [overrideOn, setOverrideOn] = useState(false);
  const [overrideRate, setOverrideRate] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [showBase, setShowBase] = useState(true);

  const override =
    overrideOn && Number(overrideRate) > 0 && overrideReason.trim().length >= 3
      ? { rate: Number(overrideRate), reason: overrideReason.trim() }
      : null;
  const missingRate = (code: string) => code !== baseCurrency && rateOf(code) <= 0 && !override;

  const saveForecast = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          projectId,
          cost_code_id: fCode,
          period: `${fPeriod}-01`,
          etc_amount: Number(fAmount),
          currency_code: fCurrency,
          fx_override: override,
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
          currency_code: aCurrency,
          description: aDesc || undefined,
          fx_override: override,
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
            <h3 className="text-sm font-semibold text-foreground">
              {t("financeMod.costing.forecast.addForecast")}
            </h3>
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
                <Label htmlFor="f-amount">
                  {t("financeMod.costing.forecast.etcLabel", { currency: fCurrency })}
                </Label>
                <Input
                  id="f-amount"
                  inputMode="decimal"
                  value={fAmount}
                  onChange={(e) => setFAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex w-40 flex-col gap-1.5">
                <Label htmlFor="f-currency">{t("financeMod.costing.fx.currency")}</Label>
                <Select value={fCurrency} onValueChange={setFCurrency}>
                  <SelectTrigger id="f-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencyOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <FxHint
                code={fCurrency}
                base={baseCurrency}
                info={rateInfo(fCurrency)}
                override={override}
                t={t}
              />
            </div>
            <Button
              className="self-start"
              disabled={!fCode || !fAmount || missingRate(fCurrency) || saveForecast.isPending}
              onClick={() => saveForecast.mutate()}
            >
              {t("financeMod.costing.forecast.saveForecast")}
            </Button>
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-sm font-semibold text-foreground">
              {t("financeMod.costing.forecast.newAccrual")}
            </h3>
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
                <Label htmlFor="a-amount">
                  {t("financeMod.costing.forecast.amountLabel", { currency: aCurrency })}
                </Label>
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
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex w-40 flex-col gap-1.5">
                <Label htmlFor="a-currency">{t("financeMod.costing.fx.currency")}</Label>
                <Select value={aCurrency} onValueChange={setACurrency}>
                  <SelectTrigger id="a-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencyOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <FxHint
                code={aCurrency}
                base={baseCurrency}
                info={rateInfo(aCurrency)}
                override={override}
                t={t}
              />
            </div>
            <Button
              className="self-start"
              disabled={!aCode || !aAmount || missingRate(aCurrency) || addAccrual.isPending}
              onClick={() => addAccrual.mutate()}
            >
              {t("financeMod.costing.forecast.createAccrual")}
            </Button>
          </Card>
        </div>
      ) : null}

      {canWrite ? (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t("financeMod.costing.fx.overrideTitle")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("financeMod.costing.fx.overrideBody", { base: baseCurrency })}
              </p>
            </div>
            <Switch
              checked={overrideOn}
              onCheckedChange={setOverrideOn}
              aria-label={t("financeMod.costing.fx.overrideTitle")}
            />
          </div>
          {overrideOn ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fx-rate">{t("financeMod.costing.fx.rate")}</Label>
                <Input
                  id="fx-rate"
                  inputMode="decimal"
                  value={overrideRate}
                  onChange={(e) => setOverrideRate(e.target.value)}
                  placeholder="1.0000"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fx-reason">{t("financeMod.costing.fx.reason")}</Label>
                <Input
                  id="fx-reason"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder={t("financeMod.costing.fx.reasonPlaceholder")}
                />
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {data.fxMissing.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>{t("financeMod.costing.fx.missingTitle")}</AlertTitle>
          <AlertDescription>
            {t("financeMod.costing.fx.missingBody", {
              currencies: data.fxMissing.join(", "),
              base: baseCurrency,
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
          <SelectTrigger className="w-48" aria-label={t("financeMod.costing.fx.currencyFilter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("financeMod.costing.fx.allCurrencies")}</SelectItem>
            {currencyOptions.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showBase} onCheckedChange={setShowBase} />
          {t("financeMod.costing.fx.showBase", { base: baseCurrency })}
        </label>
      </div>

      {data.currencySubtotals.length > 0 ? (
        <Card className="flex flex-col gap-2 p-4">
          <h3 className="text-sm font-semibold text-foreground">
            {t("financeMod.costing.fx.subtotalsTitle")}
          </h3>
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("financeMod.costing.fx.currency")}</TableHead>
                  <TableHead className="text-right">
                    {t("financeMod.costing.forecast.etc")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("financeMod.costing.forecast.amount")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("financeMod.costing.fx.inBase", { base: baseCurrency })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.currencySubtotals.map((s) => (
                  <TableRow key={s.currency_code}>
                    <TableCell className="font-medium">{s.currency_code}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCostingMoney(s.forecast_txn, s.currency_code)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCostingMoney(s.accrual_txn, s.currency_code)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCostingMoney(s.forecast_base + s.accrual_base, baseCurrency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("financeMod.costing.fx.totalsNote", {
              base: baseCurrency,
              eac: formatCostingMoney(data.baseRollup.eac, baseCurrency),
              vac: formatCostingMoney(data.baseRollup.variance_at_completion, baseCurrency),
            })}
          </p>
        </Card>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t("financeMod.costing.forecast.periodsTitle")}
        </h3>
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
                  <TableHead className="text-right">
                    {t("financeMod.costing.forecast.etc")}
                  </TableHead>
                  <TableHead>{t("financeMod.costing.forecast.notes")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.forecasts
                  .filter((f) => currencyFilter === "all" || f.currency_code === currencyFilter)
                  .map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.cost_code ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {f.period.slice(0, 7)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCostingMoney(f.etc_amount, f.currency_code)}
                        {showBase && f.currency_code !== baseCurrency ? (
                          <span className="block text-xs text-muted-foreground">
                            {formatCostingMoney(f.etc_amount_base, baseCurrency)}
                          </span>
                        ) : null}
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
        <h3 className="text-sm font-semibold text-foreground">
          {t("financeMod.costing.forecast.accrualsTitle")}
        </h3>
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
                  <TableHead className="text-right">
                    {t("financeMod.costing.forecast.amount")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("financeMod.costing.forecast.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.accruals
                  .filter((a) => currencyFilter === "all" || a.currency_code === currencyFilter)
                  .map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.cost_code ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {a.period.slice(0, 7)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={a.status} />
                          {a.currency_code !== baseCurrency ? (
                            <Badge variant="outline" className="font-mono text-xs">
                              {a.fx_locked_at
                                ? t("financeMod.costing.fx.locked", { rate: a.fx_rate })
                                : t("financeMod.costing.fx.indicative", { rate: a.fx_rate })}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCostingMoney(a.amount, a.currency_code)}
                        {showBase && a.currency_code !== baseCurrency ? (
                          <span className="block text-xs text-muted-foreground">
                            {formatCostingMoney(a.amount_base, baseCurrency)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {canWrite && canTransitionAccrual(a.status, "approve") ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={transition.isPending || a.fx_rate <= 0}
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

/** Inline effective-rate hint with stale / missing warnings. */
function FxHint({
  code,
  base,
  info,
  override,
  t,
}: {
  code: string;
  base: string;
  info: { rate: number; as_of: string | null; stale: boolean } | null;
  override: { rate: number; reason: string } | null;
  t: (key: string, vars?: Record<string, unknown>) => string;
}) {
  if (code === base) return null;
  if (override) {
    return (
      <p className="text-xs text-primary">
        {t("financeMod.costing.fx.usingOverride", { rate: override.rate, base })}
      </p>
    );
  }
  if (!info || info.rate <= 0) {
    return (
      <p className="text-xs text-destructive">
        {t("financeMod.costing.fx.noRate", { code, base })}
      </p>
    );
  }
  return (
    <p className={info.stale ? "text-xs text-warning-foreground" : "text-xs text-muted-foreground"}>
      {t(info.stale ? "financeMod.costing.fx.staleRate" : "financeMod.costing.fx.effectiveRate", {
        rate: info.rate,
        base,
        date: info.as_of ?? "—",
      })}
    </p>
  );
}
