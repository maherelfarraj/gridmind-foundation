// GC-08 — Portfolio Cost & Close: company-wide consolidated cost position and
// close oversight. Read-only; every authorization and formula lives server-side.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ClipboardCheck,
  Coins,
  Download,
  FileText,
  Gauge,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { CostingCloseMatrix } from "@/components/portfolio/costing-close-matrix";
import { CostingConsolidationTable } from "@/components/portfolio/costing-consolidation-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatNumber } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import { getPortfolioCostingCsv } from "@/lib/portfolio-costing.functions";
import { portfolioCostingQueryOptions } from "@/lib/portfolio-costing.query";

const K = "portfolioMod.costing";

const searchSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/)
    .optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  basis: z.enum(["period_end", "latest"]).optional(),
});

export const Route = createFileRoute("/_authenticated/portfolio/costing")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Portfolio Cost & Close | GridMind EPC" },
      {
        name: "description",
        content:
          "Consolidated multi-currency cost position, close oversight and management pack across the project portfolio.",
      },
      { property: "og:title", content: "Portfolio Cost & Close | GridMind EPC" },
      {
        property: "og:description",
        content:
          "Company-wide EAC, variance and period-close readiness consolidated into one reporting currency.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: () => (
    <div className="page-shell">
      <Skeleton className="h-64 w-full" />
    </div>
  ),
  errorComponent: PortfolioCostingError,
  component: PortfolioCostingPage,
});

function PortfolioCostingError() {
  const { t } = useI18n();
  return (
    <div className="page-shell">
      <EmptyState
        icon={AlertTriangle}
        title={t(`${K}.error.title`)}
        description={t(`${K}.error.description`)}
      />
    </div>
  );
}

function monthOptions(current: string): string[] {
  const out: string[] = [];
  const [y, m] = current.split("-").map(Number);
  for (let i = 0; i < 13; i += 1) {
    const d = new Date(Date.UTC(y!, m! - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`);
  }
  return out;
}

function PortfolioCostingPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const { data } = useSuspenseQuery(portfolioCostingQueryOptions(search));
  const downloadCsv = useServerFn(getPortfolioCostingCsv);
  const [downloading, setDownloading] = useState(false);

  const cur = data.reporting_currency;
  const money = (v: number | null) => (v === null ? "—" : formatCurrency(v, locale, cur));
  const totals = data.consolidation.totals;
  const priorEac = data.trend[0]?.eac ?? 0;
  const deltaEac = totals.eac - priorEac;

  const setSearch = (patch: Partial<typeof search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  async function onExportCsv() {
    setDownloading(true);
    try {
      const res = await downloadCsv({ data: search });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t(`${K}.export.failed`));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="page-shell">
      <PageHeader
        title={t(`${K}.title`)}
        description={t(`${K}.subtitle`)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onExportCsv} disabled={downloading}>
              <Download className="size-4" /> {t(`${K}.export.csv`)}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/portfolio/costing/pack" search={search}>
                <FileText className="size-4" /> {t(`${K}.export.pack`)}
              </Link>
            </Button>
          </div>
        }
      />

      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="space-y-1">
          <Label htmlFor="period">{t(`${K}.filters.period`)}</Label>
          <Select value={data.period} onValueChange={(v) => setSearch({ period: v })}>
            <SelectTrigger id="period" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions(data.current_period).map((m) => (
                <SelectItem key={m} value={m}>
                  {m.slice(0, 7)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="currency">{t(`${K}.filters.currency`)}</Label>
          <Select value={cur} onValueChange={(v) => setSearch({ currency: v })}>
            <SelectTrigger id="currency" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.currency_options.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="basis">{t(`${K}.filters.basis`)}</Label>
          <Select
            value={data.basis}
            onValueChange={(v) => setSearch({ basis: v as "period_end" | "latest" })}
          >
            <SelectTrigger id="basis" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="period_end">{t(`${K}.filters.basisPeriodEnd`)}</SelectItem>
              <SelectItem value="latest">{t(`${K}.filters.basisLatest`)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-muted-foreground text-xs">
          {t(`${K}.filters.rateNote`, { date: data.rate_date })}
        </p>
      </Card>

      {data.gate.official ? (
        <Alert>
          <ClipboardCheck className="size-4" />
          <AlertTitle>{t(`${K}.gate.officialTitle`)}</AlertTitle>
          <AlertDescription>{t(`${K}.gate.officialBody`)}</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning">
          <AlertTriangle className="size-4" />
          <AlertTitle>{t(`${K}.gate.managementTitle`)}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 ps-5">
              {data.gate.reasons.map((r) => (
                <li key={r.key}>{t(`${K}.gate.reason.${r.key}`, { count: r.count })}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <KpiGrid columns={6} label={t(`${K}.title`)}>
        <KpiTile
          label={t(`${K}.kpi.budget`)}
          value={money(totals.budget_current)}
          hint={t(`${K}.kpi.inCurrency`, { currency: cur })}
          icon={Coins}
        />
        <KpiTile label={t(`${K}.kpi.committed`)} value={money(totals.committed)} icon={Wallet} />
        <KpiTile label={t(`${K}.kpi.actual`)} value={money(totals.actual)} icon={Wallet} />
        <KpiTile
          label={t(`${K}.kpi.eac`)}
          value={money(totals.eac)}
          hint={t(`${K}.kpi.vsPrior`, { value: money(deltaEac) })}
          icon={TrendingUp}
          status={deltaEac > 0 ? "warning" : "good"}
        />
        <KpiTile
          label={t(`${K}.kpi.vac`)}
          value={money(totals.vac)}
          icon={Gauge}
          status={totals.vac < 0 ? "bad" : "good"}
        />
        <KpiTile
          label={t(`${K}.kpi.closeReady`)}
          value={`${data.close.ready}/${data.close.projects}`}
          hint={t(`${K}.kpi.closeHint`, {
            overdue: data.close.overdue_items,
            blockers: data.close.blocker_exceptions,
          })}
          icon={ClipboardCheck}
          status={data.close.ready === data.close.projects ? "good" : "warning"}
        />
      </KpiGrid>

      <section className="space-y-3">
        <SectionHeader
          title={t(`${K}.consolidation.heading`)}
          description={t(`${K}.consolidation.description`, {
            currency: cur,
            period: data.period.slice(0, 7),
          })}
        />
        {data.rows.length === 0 ? (
          <EmptyState
            icon={Coins}
            title={t(`${K}.empty.title`)}
            description={t(`${K}.empty.description`)}
          />
        ) : (
          <Card className="overflow-x-auto p-0">
            <CostingConsolidationTable rows={data.rows} consolidation={data.consolidation} />
          </Card>
        )}
        {data.consolidation.excluded.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {t(`${K}.consolidation.excluded`, {
              list: data.consolidation.excluded
                .map(
                  (e) =>
                    `${e.code} (${t(`${K}.gate.reason.${e.reason === "fx_rate_missing" ? "missing_rate" : "no_snapshot"}`, { count: 1 })})`,
                )
                .join(", "),
            })}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <SectionHeader
          title={t(`${K}.trend.heading`)}
          description={t(`${K}.trend.description`, {
            prior: data.prior_period.slice(0, 7),
            period: data.period.slice(0, 7),
          })}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {data.trend.map((pt) => (
            <Card key={pt.period} className="space-y-1 p-4">
              <div className="text-muted-foreground text-xs">{pt.period.slice(0, 7)}</div>
              <div className="text-lg font-semibold tabular-nums">{money(pt.eac)}</div>
              <div className="text-muted-foreground text-xs">
                {t(`${K}.trend.budget`, { value: money(pt.budget_current) })}
              </div>
            </Card>
          ))}
          <Card className="space-y-1 p-4">
            <div className="text-muted-foreground text-xs">{t(`${K}.trend.movement`)}</div>
            <div
              className={
                deltaEac > 0
                  ? "text-destructive text-lg font-semibold tabular-nums"
                  : "text-lg font-semibold tabular-nums"
              }
            >
              {money(deltaEac)}
            </div>
            <div className="text-muted-foreground text-xs">
              {t(`${K}.trend.materiality`, {
                pct: `${formatNumber(data.materiality.pct * 100, locale, { maximumFractionDigits: 1 })}%`,
                abs: money(data.materiality.abs),
              })}
            </div>
          </Card>
        </div>
      </section>



      <section className="space-y-3">
        <SectionHeader
          title={t(`${K}.movers.heading`)}
          description={t(`${K}.movers.description`)}
        />
        {data.movers.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t(`${K}.movers.none`)}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.movers.map((r) => (
              <Card key={r.project_id} className="space-y-1 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.code}</span>
                  <span
                    className={
                      (r.variance.delta_eac_prior ?? 0) > 0
                        ? "text-destructive tabular-nums"
                        : "tabular-nums"
                    }
                  >
                    {formatCurrency(r.variance.delta_eac_prior ?? 0, locale, r.currency)}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">{r.name}</p>
                <p className="text-muted-foreground text-xs">
                  {t(`${K}.movers.baseline`, {
                    value:
                      r.variance.delta_eac_baseline === null
                        ? "—"
                        : formatCurrency(r.variance.delta_eac_baseline, locale, r.currency),
                    pct:
                      r.variance.delta_pct_prior === null
                        ? "—"
                        : `${formatNumber(r.variance.delta_pct_prior * 100, locale, { maximumFractionDigits: 1 })}%`,
                  })}
                </p>
                {r.variance.material ? (
                  <p className="text-warning-foreground text-xs">
                    {r.variance.explanation ?? t(`${K}.movers.noExplanation`)}
                  </p>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader
          title={t(`${K}.close.heading`)}
          description={t(`${K}.close.description`, { period: data.period.slice(0, 7) })}
        />
        {data.rows.length === 0 ? null : (
          <Card className="overflow-x-auto p-0">
            <CostingCloseMatrix rows={data.rows} period={data.period} />
          </Card>
        )}
      </section>

      <p className="text-muted-foreground text-xs">
        {data.reconciliation.ok
          ? t(`${K}.reconciliation.ok`, { count: data.reconciliation.lines.length })
          : t(`${K}.reconciliation.failed`, { value: money(data.reconciliation.difference) })}
      </p>
    </div>
  );
}
