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
        toast.success(`Imported ${r.imported} rate(s) observed ${r.observationDate}.`);
      } else {
        toast.error(`Sync ${r.status}: ${r.error ?? "no details"}`);
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
      toast.success("Manual rate saved.");
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
    ? `${data.freshness.businessDaysStale}d`
    : "—";

  const manualValid =
    /^[A-Za-z]{3}$/.test(form.base_code) &&
    /^[A-Za-z]{3}$/.test(form.quote_code) &&
    Number(form.rate) > 0 &&
    form.reason.trim().length >= 3;

  return (
    <div className="page-shell">
      <PageHeader
        title="FX Rate Management"
        description={`Automatic import from ${data.settings.provider} at ${data.settings.schedule_time} ${data.settings.schedule_timezone}. The internal rate ledger stays authoritative.`}
        actions={
          data.canManage ? (
            <Button
              onClick={() => {
                if (window.confirm("Run an exchange-rate import now?")) sync.mutate();
              }}
              disabled={sync.isPending}
            >
              <RefreshCw className="size-4" aria-hidden />
              {sync.isPending ? "Syncing…" : "Sync now"}
            </Button>
          ) : null
        }
      />

      <KpiGrid label="Exchange-rate feed status">
        <KpiTile
          label="Provider"
          value={data.settings.enabled ? "Enabled" : "Disabled"}
          hint={data.settings.provider}
        />
        <KpiTile
          label="Last observation"
          value={data.freshness.lastObservationDate ?? "—"}
          hint={data.lastSuccess ? "Last successful run" : "No successful run yet"}
        />
        <KpiTile
          label="Business days stale"
          value={freshnessValue}
          hint={
            data.freshness.nonPublicationDay
              ? "Non-publication day — no failure"
              : data.freshness.stale
                ? `Above ${data.settings.staleness_business_days}-day threshold`
                : "Within threshold"
          }
        />
        <KpiTile
          label="Unsupported currencies"
          value={String(data.missingCurrencies.length)}
          hint={data.missingCurrencies.join(", ") || "All covered"}
        />
      </KpiGrid>

      {data.freshness.stale && !data.freshness.nonPublicationDay ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          The latest successful observation is older than the configured threshold. Rates remain
          usable; approvals are blocked only where no valid rate exists.
        </p>
      ) : null}

      {data.lastFailure ? (
        <p className="text-sm text-muted-foreground">
          Last failure {new Date(data.lastFailure.started_at).toLocaleString()} —{" "}
          {data.lastFailure.error_summary ?? "no details"}
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Recent import runs</h2>
        {data.runs.length === 0 ? (
          <EmptyState title="No import runs yet" description="Run a sync to populate history." />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Observed</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right">Imported</TableHead>
                  <TableHead className="text-right">Skipped</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>Notes</TableHead>
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
          <h2 className="text-sm font-medium text-foreground">Rate ledger</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-10 w-44"
              placeholder="Search pair (e.g. EURUSD)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search currency pair"
            />
            <div className="flex gap-1" role="group" aria-label="Filter by source">
              {(["all", "imported", "manual"] as const).map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant={sourceFilter === k ? "default" : "outline"}
                  onClick={() => setSourceFilter(k)}
                >
                  {k}
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
              Export
            </Button>
          </div>
        </div>

        {rates.length === 0 ? (
          <EmptyState title="No rates match" description="Adjust the search or source filter." />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pair</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>As of</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Imported</TableHead>
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
                        label={r.is_manual ? "Manual" : r.source}
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
            <h2 className="text-sm font-medium text-foreground">Manual rate entry</h2>
            <p className="text-xs text-muted-foreground">
              Manual rates always take precedence over imported rates for the same pair and date.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="fx-base">From</Label>
              <Input
                id="fx-base"
                maxLength={3}
                value={form.base_code}
                onChange={(e) => setForm((f) => ({ ...f, base_code: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-quote">To</Label>
              <Input
                id="fx-quote"
                maxLength={3}
                value={form.quote_code}
                onChange={(e) => setForm((f) => ({ ...f, quote_code: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-rate">Rate</Label>
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
              <Label htmlFor="fx-date">Effective date</Label>
              <Input
                id="fx-date"
                type="date"
                value={form.as_of}
                onChange={(e) => setForm((f) => ({ ...f, as_of: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-reason">Reason</Label>
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
              {addManual.isPending ? "Saving…" : "Save manual rate"}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
