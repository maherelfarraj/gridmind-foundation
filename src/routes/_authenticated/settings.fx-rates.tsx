// FX-01 — FX Rate Management (finance/company admin).
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, RefreshCw } from "lucide-react";
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
import { syncFxRatesNow, upsertManualFxRate } from "@/lib/fx.functions";
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
          label={t("adminMod.fxPage.provider")}
          value={
            data.settings.enabled ? t("adminMod.fxPage.enabled") : t("adminMod.fxPage.disabled")
          }
          hint={data.settings.provider}
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
        <h2 className="text-sm font-medium text-foreground">{t("adminMod.fxPage.runsTitle")}</h2>
        {data.runs.length === 0 ? (
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
                {data.runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.started_at).toLocaleString()}</TableCell>
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
                        label={
                          r.is_manual ? t("adminMod.fxPage.filterManual") : r.source
                        }
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
