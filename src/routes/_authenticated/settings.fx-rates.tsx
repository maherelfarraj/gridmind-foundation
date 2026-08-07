// FX-01 — FX Rate Management (finance/company admin).
import { Fragment, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { downloadCsv, objectsToCsv } from "@/lib/csv";
import { Switch } from "@/components/ui/switch";
import { syncFxRatesNow, updateFxAlertSettings, upsertManualFxRate } from "@/lib/fx.functions";
import { fxAdminQueryOptions, fxErrorMessage } from "@/lib/fx.query";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/settings/fx-rates")({
  head: () => ({
    meta: [
      { title: "FX Rate Management — GridMind EPC" },
      {
        name: "description",
        content:
          "Monitor the automatic exchange-rate feed, review import runs, and maintain manual rates.",
      },
      { property: "og:title", content: "FX Rate Management — GridMind EPC" },
      {
        property: "og:description",
        content: "Provider status, data freshness, import history and manual exchange rates.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FxRatesSettings,
});

const today = () => new Date().toISOString().slice(0, 10);

function FxRatesSettings() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(fxAdminQueryOptions());
  const syncFn = useServerFn(syncFxRatesNow);
  const manualFn = useServerFn(upsertManualFxRate);
  const alertsFn = useServerFn(updateFxAlertSettings);

  const [runFilter, setRunFilter] = useState<"all" | "success" | "failed" | "manual">("all");
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{
    runId: string | null;
    status: string;
    imported: number;
    skipped: number;
    failed: number;
    observationDate: string | null;
    error: string | null;
  } | null>(null);
  const [alerts, setAlerts] = useState(data.alertSettings);

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "manual" | "imported">("all");
  const [form, setForm] = useState({
    base_code: "",
    quote_code: data.settings.base_currency,
    rate: "",
    as_of: today(),
    reason: "",
  });

  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: (r) => {
      setLastRun({
        runId: r.runId,
        status: r.status,
        imported: r.imported,
        skipped: r.skipped,
        failed: r.failed,
        observationDate: r.observationDate,
        error: r.error,
      });
      if (r.runId) setOpenRun(r.runId);
      if (r.status === "success") {
        toast.success(
          t("adminMod.fxPage.syncSuccess", { count: r.imported, date: r.observationDate }),
        );
      } else {
        toast.error(
          t("adminMod.fxPage.syncFailed", {
            status: r.status,
            reason: r.error ?? t("adminMod.fxPage.noDetails"),
          }),
        );
      }
      void qc.invalidateQueries({ queryKey: ["fx"] });
    },
    onError: (e) => toast.error(fxErrorMessage(e)),
  });

  const addManual = useMutation({
    mutationFn: () =>
      manualFn({
        data: {
          base_code: form.base_code.toUpperCase(),
          quote_code: form.quote_code.toUpperCase(),
          rate: Number(form.rate),
          as_of: form.as_of,
          reason: form.reason,
        },
      }),
    onSuccess: () => {
      toast.success(t("adminMod.fxPage.manualSaved"));
      setForm((f) => ({ ...f, base_code: "", rate: "", reason: "" }));
      void qc.invalidateQueries({ queryKey: ["fx"] });
    },
    onError: (e) => toast.error(fxErrorMessage(e)),
  });

  const saveAlerts = useMutation({
    mutationFn: () => alertsFn({ data: alerts }),
    onSuccess: () => {
      toast.success(t("adminMod.fxPage.alertsSaved"));
      void qc.invalidateQueries({ queryKey: ["fx"] });
    },
    onError: (e) => toast.error(fxErrorMessage(e)),
  });

  const runs = useMemo(() => {
    if (runFilter === "all") return data.runs;
    if (runFilter === "manual") return data.runs.filter((r) => r.trigger === "manual");
    return data.runs.filter((r) => r.status === runFilter);
  }, [data.runs, runFilter]);

  const rates = useMemo(() => {
    const q = search.trim().toUpperCase();
    return data.rates.filter((r) => {
      if (sourceFilter === "manual" && !r.is_manual) return false;
      if (sourceFilter === "imported" && r.is_manual) return false;
      if (!q) return true;
      return `${r.base_code}${r.quote_code}`.includes(q);
    });
  }, [data.rates, search, sourceFilter]);

  const freshnessValue = data.freshness.lastObservationDate
    ? `${data.freshness.businessDaysStale}`
    : "—";

  const manualValid =
    /^[A-Za-z]{3}$/.test(form.base_code) &&
    /^[A-Za-z]{3}$/.test(form.quote_code) &&
    Number(form.rate) > 0 &&
    form.reason.trim().length >= 3;

  const runFilters = [
    { key: "all" as const, label: t("adminMod.fxPage.filterAll") },
    { key: "success" as const, label: t("adminMod.fxPage.filterSuccess") },
    { key: "failed" as const, label: t("adminMod.fxPage.filterFailed") },
    { key: "manual" as const, label: t("adminMod.fxPage.filterManualRuns") },
  ];

  const filters = [
    { key: "all" as const, label: t("adminMod.fxPage.filterAll") },
    { key: "imported" as const, label: t("adminMod.fxPage.filterImported") },
    { key: "manual" as const, label: t("adminMod.fxPage.filterManual") },
  ];

  return (
    <div className="page-shell">
      <PageHeader
        title={t("adminMod.fxPage.title")}
        description={t("adminMod.fxPage.subtitle", {
          provider: data.settings.provider,
          time: data.settings.schedule_time,
          tz: data.settings.schedule_timezone,
        })}
        actions={
          data.canManage ? (
            <Button
              onClick={() => {
                if (window.confirm(t("adminMod.fxPage.confirmSync"))) sync.mutate();
              }}
              disabled={sync.isPending}
            >
              <RefreshCw className="size-4" aria-hidden />
              {sync.isPending ? t("adminMod.fxPage.syncing") : t("adminMod.fxPage.syncNow")}
            </Button>
          ) : null
        }
      />

      <KpiGrid label={t("adminMod.fxPage.statusLabel")}>
        <KpiTile
          label={t("adminMod.fxPage.health")}
          value={t(`adminMod.fxPage.healthStatus.${data.health.status}`)}
          hint={
            data.settings.enabled
              ? `${data.settings.provider} · ${t("adminMod.fxPage.enabled")}`
              : `${data.settings.provider} · ${t("adminMod.fxPage.disabled")}`
          }
        />
        <KpiTile
          label={t("adminMod.fxPage.lastObservation")}
          value={data.freshness.lastObservationDate ?? "—"}
          hint={
            data.lastSuccess ? t("adminMod.fxPage.lastSuccess") : t("adminMod.fxPage.noSuccess")
          }
        />
        <KpiTile
          label={t("adminMod.fxPage.daysStale")}
          value={freshnessValue}
          hint={
            data.freshness.nonPublicationDay
              ? t("adminMod.fxPage.nonPublication")
              : data.freshness.stale
                ? t("adminMod.fxPage.aboveThreshold", {
                    days: data.settings.staleness_business_days,
                  })
                : t("adminMod.fxPage.withinThreshold")
          }
        />
        <KpiTile
          label={t("adminMod.fxPage.unsupported")}
          value={String(data.missingCurrencies.length)}
          hint={data.missingCurrencies.join(", ") || t("adminMod.fxPage.allCovered")}
        />
      </KpiGrid>

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <StatusBadge
          status={data.health.status}
          label={t(`adminMod.fxPage.healthStatus.${data.health.status}`)}
        />
        <span>
          {t("adminMod.fxPage.lastAttempt")}:{" "}
          {data.health.lastAttemptAt ? new Date(data.health.lastAttemptAt).toLocaleString() : "—"}
        </span>
        <span>
          {t("adminMod.fxPage.nextRun")}:{" "}
          {data.health.nextScheduledRun
            ? new Date(data.health.nextScheduledRun).toLocaleString()
            : "—"}
        </span>
        {data.health.consecutiveFailures > 0 ? (
          <span>
            {t("adminMod.fxPage.consecutiveFailures", {
              count: data.health.consecutiveFailures,
            })}
          </span>
        ) : null}
      </div>

      {data.health.reasons.length > 0 ? (
        <ul className="list-inside list-disc rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {data.health.reasons.map((r) => (
            <li key={r}>{t(`adminMod.fxPage.healthReason.${r}`, { defaultValue: r })}</li>
          ))}
        </ul>
      ) : null}

      {lastRun ? (
        <div className="rounded-md border border-border px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={lastRun.status} />
            <span className="text-muted-foreground">
              {t("adminMod.fxPage.syncResult", {
                imported: lastRun.imported,
                skipped: lastRun.skipped,
                failed: lastRun.failed,
                date: lastRun.observationDate ?? "—",
              })}
            </span>
            {lastRun.runId ? (
              <Button size="sm" variant="outline" onClick={() => setOpenRun(lastRun.runId)}>
                {t("adminMod.fxPage.viewRun")}
              </Button>
            ) : null}
          </div>
          {lastRun.error ? <p className="mt-1 text-muted-foreground">{lastRun.error}</p> : null}
        </div>
      ) : null}

      {data.freshness.stale && !data.freshness.nonPublicationDay ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          {t("adminMod.fxPage.staleWarning")}
        </p>
      ) : null}

      {data.lastFailure ? (
        <p className="text-sm text-muted-foreground">
          {t("adminMod.fxPage.lastFailure", {
            when: new Date(data.lastFailure.started_at).toLocaleString(),
            reason: data.lastFailure.error_summary ?? t("adminMod.fxPage.noDetails"),
          })}
        </p>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-medium text-foreground">{t("adminMod.fxPage.runsTitle")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="group" aria-label={t("adminMod.fxPage.filterRuns")}>
              {runFilters.map((f) => (
                <Button
                  key={f.key}
                  size="sm"
                  variant={runFilter === f.key ? "default" : "outline"}
                  onClick={() => setRunFilter(f.key)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  "fx-import-runs.csv",
                  objectsToCsv(
                    runs.map((r) => ({
                      started_at: r.started_at,
                      finished_at: r.finished_at ?? "",
                      provider: r.provider,
                      trigger: r.trigger,
                      actor_kind: r.actor_kind,
                      status: r.status,
                      observation_date: r.observation_date ?? "",
                      base_currency: r.base_currency ?? "",
                      requested_currencies: r.requested_currencies.join(" "),
                      requested: r.requested_count,
                      imported: r.imported_count,
                      skipped: r.skipped_count,
                      failed: r.failed_count,
                      missing: r.missing_codes.join(" "),
                      error_code: r.error_code ?? "",
                      error_summary: r.error_summary ?? "",
                      duration_ms: r.duration_ms ?? "",
                    })),
                  ),
                )
              }
            >
              <Download className="size-4" aria-hidden />
              {t("adminMod.fxPage.export")}
            </Button>
          </div>
        </div>
        {runs.length === 0 ? (
          <EmptyState
            title={t("adminMod.fxPage.noRunsTitle")}
            description={t("adminMod.fxPage.noRunsDesc")}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adminMod.fxPage.started")}</TableHead>
                  <TableHead>{t("adminMod.fxPage.trigger")}</TableHead>
                  <TableHead>{t("adminMod.fxPage.status")}</TableHead>
                  <TableHead>{t("adminMod.fxPage.observed")}</TableHead>
                  <TableHead className="text-right">{t("adminMod.fxPage.requested")}</TableHead>
                  <TableHead className="text-right">{t("adminMod.fxPage.imported")}</TableHead>
                  <TableHead className="text-right">{t("adminMod.fxPage.skipped")}</TableHead>
                  <TableHead className="text-right">{t("adminMod.fxPage.duration")}</TableHead>
                  <TableHead>{t("adminMod.fxPage.notes")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <Fragment key={r.id}>
                    <TableRow>
                      <TableCell>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-start"
                          onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
                          aria-expanded={openRun === r.id}
                        >
                          {openRun === r.id ? (
                            <ChevronDown className="size-4" aria-hidden />
                          ) : (
                            <ChevronRight className="size-4" aria-hidden />
                          )}
                          {new Date(r.started_at).toLocaleString()}
                        </button>
                      </TableCell>
                      <TableCell>{r.trigger}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell>{r.observation_date ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.requested_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.imported_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.skipped_count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.duration_ms == null ? "—" : `${r.duration_ms} ms`}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.error_summary ??
                          (r.missing_codes.length ? r.missing_codes.join(", ") : "—")}
                      </TableCell>
                    </TableRow>
                    {openRun === r.id ? (
                      <TableRow>
                        <TableCell colSpan={9} className="bg-muted/30 text-xs">
                          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                            <div>
                              <dt className="inline text-muted-foreground">
                                {t("adminMod.fxPage.runId")}:{" "}
                              </dt>
                              <dd className="inline font-mono">{r.id}</dd>
                            </div>
                            <div>
                              <dt className="inline text-muted-foreground">
                                {t("adminMod.fxPage.actor")}:{" "}
                              </dt>
                              <dd className="inline">{r.actor_kind}</dd>
                            </div>
                            <div>
                              <dt className="inline text-muted-foreground">
                                {t("adminMod.fxPage.baseCurrency")}:{" "}
                              </dt>
                              <dd className="inline">{r.base_currency ?? "—"}</dd>
                            </div>
                            <div>
                              <dt className="inline text-muted-foreground">
                                {t("adminMod.fxPage.requestedCurrencies")}:{" "}
                              </dt>
                              <dd className="inline">{r.requested_currencies.join(", ") || "—"}</dd>
                            </div>
                            <div>
                              <dt className="inline text-muted-foreground">
                                {t("adminMod.fxPage.failed")}:{" "}
                              </dt>
                              <dd className="inline tabular-nums">{r.failed_count}</dd>
                            </div>
                            <div>
                              <dt className="inline text-muted-foreground">
                                {t("adminMod.fxPage.errorCode")}:{" "}
                              </dt>
                              <dd className="inline">{r.error_code ?? "—"}</dd>
                            </div>
                            <div className="sm:col-span-2">
                              <dt className="inline text-muted-foreground">
                                {t("adminMod.fxPage.diagnostics")}:{" "}
                              </dt>
                              <dd className="mt-1 whitespace-pre-wrap break-words font-mono">
                                {JSON.stringify(r.diagnostics)}
                              </dd>
                            </div>
                          </dl>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-medium text-foreground">
            {t("adminMod.fxPage.ledgerTitle")}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-10 w-44"
              placeholder={t("adminMod.fxPage.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t("adminMod.fxPage.searchPair")}
            />
            <div className="flex gap-1" role="group" aria-label={t("adminMod.fxPage.filterSource")}>
              {filters.map((f) => (
                <Button
                  key={f.key}
                  size="sm"
                  variant={sourceFilter === f.key ? "default" : "outline"}
                  onClick={() => setSourceFilter(f.key)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  "fx-rates.csv",
                  objectsToCsv(
                    rates.map((r) => ({
                      base: r.base_code,
                      quote: r.quote_code,
                      rate: r.rate,
                      as_of: r.as_of,
                      source: r.source,
                      provider: r.provider ?? "",
                      observed_on: r.provider_observed_on ?? "",
                    })),
                  ),
                )
              }
            >
              <Download className="size-4" aria-hidden />
              {t("adminMod.fxPage.export")}
            </Button>
          </div>
        </div>

        {rates.length === 0 ? (
          <EmptyState
            title={t("adminMod.fxPage.noRatesTitle")}
            description={t("adminMod.fxPage.noRatesDesc")}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adminMod.fxPage.pair")}</TableHead>
                  <TableHead className="text-right">{t("adminMod.fxPage.rate")}</TableHead>
                  <TableHead>{t("adminMod.fxPage.asOf")}</TableHead>
                  <TableHead>{t("adminMod.fxPage.source")}</TableHead>
                  <TableHead>{t("adminMod.fxPage.provider")}</TableHead>
                  <TableHead>{t("adminMod.fxPage.importedOn")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.base_code} → {r.quote_code}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.rate}</TableCell>
                    <TableCell>{r.as_of}</TableCell>
                    <TableCell>
                      <StatusBadge
                        status={r.is_manual ? "manual" : "imported"}
                        label={r.is_manual ? t("adminMod.fxPage.filterManual") : r.source}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.provider ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.imported_at ? new Date(r.imported_at).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {data.canManage ? (
        <section className="space-y-4 rounded-md border border-border p-6">
          <div>
            <h2 className="text-sm font-medium text-foreground">
              {t("adminMod.fxPage.alertsTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("adminMod.fxPage.alertsDesc")}</p>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="fx-alerts-enabled"
              checked={alerts.enabled}
              onCheckedChange={(v) => setAlerts((a) => ({ ...a, enabled: v }))}
            />
            <Label htmlFor="fx-alerts-enabled">{t("adminMod.fxPage.alertsEnabled")}</Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="fx-notify-role">{t("adminMod.fxPage.notifyRole")}</Label>
              <select
                id="fx-notify-role"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={alerts.notify_role}
                onChange={(e) =>
                  setAlerts((a) => ({
                    ...a,
                    notify_role: e.target.value as typeof a.notify_role,
                  }))
                }
              >
                <option value="finance_admin">finance_admin</option>
                <option value="company_admin">company_admin</option>
                <option value="billing_admin">billing_admin</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-failure-threshold">{t("adminMod.fxPage.failureThreshold")}</Label>
              <Input
                id="fx-failure-threshold"
                type="number"
                min="1"
                max="20"
                value={alerts.failure_threshold}
                onChange={(e) =>
                  setAlerts((a) => ({ ...a, failure_threshold: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-stale-days">{t("adminMod.fxPage.staleThreshold")}</Label>
              <Input
                id="fx-stale-days"
                type="number"
                min="1"
                max="30"
                value={alerts.stale_business_days}
                onChange={(e) =>
                  setAlerts((a) => ({ ...a, stale_business_days: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-large-move">{t("adminMod.fxPage.largeMovePct")}</Label>
              <Input
                id="fx-large-move"
                type="number"
                min="0"
                step="0.1"
                value={alerts.large_move_pct ?? ""}
                placeholder={t("adminMod.fxPage.optional")}
                onChange={(e) =>
                  setAlerts((a) => ({
                    ...a,
                    large_move_pct: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="fx-alert-missing"
              checked={alerts.alert_missing_currency}
              onCheckedChange={(v) => setAlerts((a) => ({ ...a, alert_missing_currency: v }))}
            />
            <Label htmlFor="fx-alert-missing">{t("adminMod.fxPage.alertMissingCurrency")}</Label>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => saveAlerts.mutate()} disabled={saveAlerts.isPending}>
              {saveAlerts.isPending ? t("adminMod.fxPage.saving") : t("adminMod.fxPage.saveAlerts")}
            </Button>
          </div>
        </section>
      ) : null}

      {data.canManage ? (
        <section className="space-y-4 rounded-md border border-border p-6">
          <div>
            <h2 className="text-sm font-medium text-foreground">
              {t("adminMod.fxPage.manualTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("adminMod.fxPage.manualDesc")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="fx-base">{t("adminMod.fxPage.from")}</Label>
              <Input
                id="fx-base"
                maxLength={3}
                value={form.base_code}
                onChange={(e) => setForm((f) => ({ ...f, base_code: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-quote">{t("adminMod.fxPage.to")}</Label>
              <Input
                id="fx-quote"
                maxLength={3}
                value={form.quote_code}
                onChange={(e) => setForm((f) => ({ ...f, quote_code: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-rate">{t("adminMod.fxPage.rate")}</Label>
              <Input
                id="fx-rate"
                type="number"
                step="0.00000001"
                min="0"
                value={form.rate}
                onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-date">{t("adminMod.fxPage.effectiveDate")}</Label>
              <Input
                id="fx-date"
                type="date"
                value={form.as_of}
                onChange={(e) => setForm((f) => ({ ...f, as_of: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-reason">{t("adminMod.fxPage.reason")}</Label>
              <Input
                id="fx-reason"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => addManual.mutate()}
              disabled={!manualValid || addManual.isPending}
            >
              {addManual.isPending ? t("adminMod.fxPage.saving") : t("adminMod.fxPage.saveManual")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
