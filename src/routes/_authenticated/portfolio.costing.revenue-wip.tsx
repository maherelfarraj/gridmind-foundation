// GC-15 — Portfolio revenue, margin and WIP roll-up.
// Read-only, non-posting. Every figure comes from governed recognition
// snapshots; nothing on this page writes to the ledger or to any authoritative
// costing / EVM / cash-flow snapshot.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AlertTriangle, Coins, Gauge, Layers, TrendingDown, Wallet } from "lucide-react";
import { Suspense, useMemo } from "react";
import { z } from "zod";

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
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency, formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/locale-provider";
import { SavedViewsBar } from "@/components/portfolio/saved-views-bar";
import {
  revenueWipConfigToSearch,
  revenueWipSearchToConfig,
  type RevenueWipSearch,
} from "@/lib/portfolio-views.rules";
import { portfolioRecognitionQueryOptions } from "@/lib/recognition.query";
import {
  ageWip,
  concentrationBy,
  RECOGNITION_DISCLAIMER,
  rollupPortfolio,
  WIP_AGE_BUCKETS,
  type PortfolioProjectInput,
} from "@/lib/recognition.rules";

const K = "portfolioMod.costing.revenue";
const ALL = "all";

const searchSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/)
    .optional(),
  status: z.string().optional(),
  method: z.string().optional(),
  customer: z.string().optional(),
  project: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/portfolio/costing/revenue-wip")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Portfolio Revenue & WIP | GridMind EPC" },
      {
        name: "description",
        content:
          "Consolidated recognized revenue, margin, contract asset (WIP) and contract liability across the project portfolio.",
      },
      { property: "og:title", content: "Portfolio Revenue & WIP | GridMind EPC" },
      {
        property: "og:description",
        content:
          "Governed percentage-of-completion revenue, WIP ageing, concentration and margin deterioration across all projects.",
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
  errorComponent: RevenueWipError,
  component: PortfolioRevenueWipPage,
});

function RevenueWipError() {
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

function pctText(v: number | null, locale: Locale): string {
  return v === null ? "—" : `${formatNumber(v, locale, { maximumFractionDigits: 1 })}%`;
}

function PortfolioRevenueWipPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const { data } = useSuspenseQuery(
    portfolioRecognitionQueryOptions({
      ...(search.period ? { period_month: search.period } : {}),
      status: (search.status as never) ?? ("all" as never),
    }),
  );

  const setSearch = (patch: Partial<typeof search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const cur = data.reporting_currency;
  const money = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : formatCurrency(v, locale, cur);

  const all = data.rows as PortfolioProjectInput[];
  const methods = useMemo(() => [...new Set(all.map((r) => r.method))].sort(), [all]);
  const customers = useMemo(
    () => [...new Set(all.map((r) => r.customer ?? "unassigned"))].sort(),
    [all],
  );
  const projects = useMemo(() => [...new Set(all.map((r) => r.project_name))].sort(), [all]);

  const rows = useMemo(
    () =>
      all.filter(
        (r) =>
          (!search.method || search.method === ALL || r.method === search.method) &&
          (!search.customer ||
            search.customer === ALL ||
            (r.customer ?? "unassigned") === search.customer) &&
          (!search.project || search.project === ALL || r.project_name === search.project),
      ),
    [all, search.method, search.customer, search.project],
  );

  const rollup = useMemo(() => rollupPortfolio(rows), [rows]);
  const byCustomer = useMemo(() => concentrationBy(rows, "customer"), [rows]);
  const byProject = useMemo(() => concentrationBy(rows, "project"), [rows]);

  const asOf = new Date().toISOString().slice(0, 10);
  const aging = useMemo(
    () =>
      ageWip(
        rows
          .filter((r) => r.totals.contract_asset > 0)
          .map((r) => ({ amount: r.totals.contract_asset, since: r.data_date })),
        asOf,
      ),
    [rows, asOf],
  );
  const agingTotal = WIP_AGE_BUCKETS.reduce((a, b) => a + aging[b], 0);

  const deteriorating = useMemo(
    () =>
      rows
        .filter((r) => r.totals.loss_provision > 0 || (r.totals.margin_pct ?? 100) < 5)
        .sort((a, b) => (a.totals.margin_pct ?? 0) - (b.totals.margin_pct ?? 0)),
    [rows],
  );

  const staleOrMissing = useMemo(
    () => rows.filter((r) => r.status !== "approved" || !r.data_date),
    [rows],
  );

  const approvedShare = rows.length ? (rollup.approved_projects / rows.length) * 100 : null;
  const basisApproved = rollup.approved_projects === rows.length && rows.length > 0;

  const maxCurve = Math.max(1, rollup.revenue, rollup.billed_to_date, rollup.cash_received);
  const curve = [
    { key: "recognized", value: rollup.revenue },
    { key: "billed", value: rollup.billed_to_date },
    { key: "cash", value: rollup.cash_received },
  ];

  return (
    <div className="page-shell">
      <PageHeader
        title={t(`${K}.title`)}
        description={t(`${K}.subtitle`)}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/portfolio/costing" search={{}}>
              {t(`${K}.back`)}
            </Link>
          </Button>
        }
      />

      <Alert variant={basisApproved ? "default" : "warning"}>
        <Layers className="size-4" />
        <AlertTitle>
          {basisApproved ? t(`${K}.basis.approved`) : t(`${K}.basis.indicative`)}
        </AlertTitle>
        <AlertDescription>
          {t(`${K}.basis.note`, { pct: pctText(approvedShare, locale) })} {RECOGNITION_DISCLAIMER}
        </AlertDescription>
      </Alert>

      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <SavedViewsBar<RevenueWipSearch>
          scope="revenue_wip"
          search={search}
          onApply={(next) => void navigate({ search: () => next })}
          toSearch={revenueWipConfigToSearch}
          fromSearch={revenueWipSearchToConfig}
        />
      </Suspense>

      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="space-y-1">
          <Label htmlFor="rw-period">{t(`${K}.filters.period`)}</Label>
          <input
            id="rw-period"
            type="month"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={(search.period ?? data.period_month ?? "").slice(0, 7)}
            onChange={(e) =>
              setSearch({ period: e.target.value ? `${e.target.value}-01` : undefined })
            }
          />
        </div>
        <FilterSelect
          id="rw-status"
          label={t(`${K}.filters.status`)}
          value={search.status ?? ALL}
          options={["working", "submitted", "approved", "superseded"]}
          allLabel={t(`${K}.filters.all`)}
          onChange={(v) => setSearch({ status: v })}
        />
        <FilterSelect
          id="rw-method"
          label={t(`${K}.filters.method`)}
          value={search.method ?? ALL}
          options={methods}
          allLabel={t(`${K}.filters.all`)}
          onChange={(v) => setSearch({ method: v })}
        />
        <FilterSelect
          id="rw-customer"
          label={t(`${K}.filters.customer`)}
          value={search.customer ?? ALL}
          options={customers}
          allLabel={t(`${K}.filters.all`)}
          onChange={(v) => setSearch({ customer: v })}
        />
        <FilterSelect
          id="rw-project"
          label={t(`${K}.filters.project`)}
          value={search.project ?? ALL}
          options={projects}
          allLabel={t(`${K}.filters.all`)}
          onChange={(v) => setSearch({ project: v })}
        />
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={Coins}
          title={t(`${K}.empty.title`)}
          description={t(`${K}.empty.description`)}
        />
      ) : (
        <>
          <KpiGrid>
            <KpiTile
              icon={Coins}
              label={t(`${K}.kpi.revenue`)}
              value={money(rollup.revenue)}
              hint={t(`${K}.kpi.periodRevenue`, { value: money(rollup.period_revenue) })}
            />
            <KpiTile
              icon={Gauge}
              label={t(`${K}.kpi.margin`)}
              value={pctText(rollup.margin_pct, locale)}
              status={
                rollup.margin_pct === null ? "neutral" : rollup.margin_pct < 5 ? "bad" : "good"
              }
              hint={money(rollup.gross_profit)}
            />
            <KpiTile
              icon={Wallet}
              label={t(`${K}.kpi.contractAsset`)}
              value={money(rollup.contract_asset)}
              hint={t(`${K}.kpi.underbilled`)}
            />
            <KpiTile
              icon={Wallet}
              label={t(`${K}.kpi.contractLiability`)}
              value={money(rollup.contract_liability)}
              hint={t(`${K}.kpi.overbilled`)}
            />
            <KpiTile
              icon={TrendingDown}
              label={t(`${K}.kpi.lossProvision`)}
              value={money(rollup.loss_provision)}
              status={rollup.loss_provision > 0 ? "warning" : "neutral"}
              hint={t(`${K}.kpi.lossProjects`, {
                count: formatNumber(rollup.loss_making_projects, locale),
              })}
            />
          </KpiGrid>

          <section aria-label={t(`${K}.curves.title`)}>
            <SectionHeader title={t(`${K}.curves.title`)} />
            <Card className="space-y-3 p-4">
              {curve.map((c) => (
                <div key={c.key} className="grid grid-cols-[9rem_1fr_9rem] items-center gap-3">
                  <span className="text-sm text-muted-foreground">{t(`${K}.curves.${c.key}`)}</span>
                  <span
                    className="h-2 rounded-full bg-muted"
                    role="img"
                    aria-label={`${t(`${K}.curves.${c.key}`)}: ${money(c.value)}`}
                  >
                    <span
                      className="block h-2 rounded-full bg-primary motion-safe:transition-all"
                      style={{ inlineSize: `${(c.value / maxCurve) * 100}%` }}
                    />
                  </span>
                  <span className="text-end text-sm tabular-nums">{money(c.value)}</span>
                </div>
              ))}
            </Card>
          </section>

          <section aria-label={t(`${K}.bridge.title`)}>
            <SectionHeader title={t(`${K}.bridge.title`)} />
            <Card className="p-4">
              <table className="w-full text-sm">
                <caption className="sr-only">{t(`${K}.bridge.title`)}</caption>
                <tbody>
                  <BridgeRow
                    label={t(`${K}.bridge.opening`)}
                    value={money(rollup.revenue - rollup.period_revenue)}
                  />
                  <BridgeRow label={t(`${K}.bridge.period`)} value={money(rollup.period_revenue)} />
                  <BridgeRow
                    label={t(`${K}.bridge.lossProvision`)}
                    value={money(-rollup.loss_provision)}
                  />
                  <BridgeRow
                    label={t(`${K}.bridge.closing`)}
                    value={money(rollup.revenue)}
                    strong
                  />
                </tbody>
              </table>
            </Card>
          </section>

          <section aria-label={t(`${K}.aging.title`)}>
            <SectionHeader title={t(`${K}.aging.title`)} />
            <Card className="p-4">
              <table className="w-full text-sm">
                <caption className="sr-only">{t(`${K}.aging.title`)}</caption>
                <thead>
                  <tr className="text-start text-xs uppercase text-muted-foreground">
                    <th scope="col" className="py-1 text-start">
                      {t(`${K}.aging.bucket`)}
                    </th>
                    <th scope="col" className="py-1 text-end">
                      {t(`${K}.aging.amount`)}
                    </th>
                    <th scope="col" className="py-1 text-end">
                      {t(`${K}.aging.share`)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {WIP_AGE_BUCKETS.map((b) => (
                    <tr key={b} className="border-t border-border">
                      <th scope="row" className="py-1 text-start font-normal">
                        {t(`${K}.aging.${b}`)}
                      </th>
                      <td className="py-1 text-end tabular-nums">{money(aging[b])}</td>
                      <td className="py-1 text-end tabular-nums">
                        {pctText(agingTotal ? (aging[b] / agingTotal) * 100 : null, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          <section aria-label={t(`${K}.table.title`)}>
            <SectionHeader title={t(`${K}.table.title`)} />
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <caption className="sr-only">{t(`${K}.table.title`)}</caption>
                <thead>
                  <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                    <th scope="col" className="p-2 text-start">
                      {t(`${K}.table.project`)}
                    </th>
                    <th scope="col" className="p-2 text-start">
                      {t(`${K}.table.customer`)}
                    </th>
                    <th scope="col" className="p-2 text-start">
                      {t(`${K}.table.method`)}
                    </th>
                    <th scope="col" className="p-2 text-start">
                      {t(`${K}.table.status`)}
                    </th>
                    <th scope="col" className="p-2 text-end">
                      {t(`${K}.table.revenue`)}
                    </th>
                    <th scope="col" className="p-2 text-end">
                      {t(`${K}.table.billed`)}
                    </th>
                    <th scope="col" className="p-2 text-end">
                      {t(`${K}.table.asset`)}
                    </th>
                    <th scope="col" className="p-2 text-end">
                      {t(`${K}.table.liability`)}
                    </th>
                    <th scope="col" className="p-2 text-end">
                      {t(`${K}.table.margin`)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.project_id} className="border-b border-border last:border-0">
                      <th scope="row" className="p-2 text-start font-medium">
                        <Link
                          to="/projects/$projectId/costing/revenue"
                          params={{ projectId: r.project_id }}
                          className="underline-offset-4 hover:underline"
                        >
                          {r.project_name}
                        </Link>
                      </th>
                      <td className="p-2">{r.customer ?? "—"}</td>
                      <td className="p-2">{t(`${K}.methods.${r.method}`)}</td>
                      <td className="p-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="p-2 text-end tabular-nums">
                        {money(
                          r.totals.reporting.cumulative_revenue || r.totals.cumulative_revenue,
                        )}
                      </td>
                      <td className="p-2 text-end tabular-nums">
                        {money(r.totals.billed_to_date)}
                      </td>
                      <td className="p-2 text-end tabular-nums">
                        {money(r.totals.contract_asset)}
                      </td>
                      <td className="p-2 text-end tabular-nums">
                        {money(r.totals.contract_liability)}
                      </td>
                      <td className="p-2 text-end tabular-nums">
                        {pctText(r.totals.margin_pct, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-label={t(`${K}.deterioration.title`)}>
              <SectionHeader title={t(`${K}.deterioration.title`)} />
              <Card className="p-4">
                {deteriorating.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t(`${K}.deterioration.none`)}</p>
                ) : (
                  <ul className="space-y-2">
                    {deteriorating.map((r) => (
                      <li key={r.project_id} className="flex items-center justify-between gap-3">
                        <Link
                          to="/projects/$projectId/costing/revenue"
                          params={{ projectId: r.project_id }}
                          className="text-sm underline-offset-4 hover:underline"
                        >
                          {r.project_name}
                        </Link>
                        <span className="text-sm tabular-nums text-destructive">
                          {pctText(r.totals.margin_pct, locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            <section aria-label={t(`${K}.concentration.title`)}>
              <SectionHeader title={t(`${K}.concentration.title`)} />
              <Card className="space-y-4 p-4">
                <ConcentrationList
                  title={t(`${K}.concentration.customer`)}
                  slices={byCustomer.slice(0, 5)}
                  money={money}
                  locale={locale}
                />
                <ConcentrationList
                  title={t(`${K}.concentration.project`)}
                  slices={byProject.slice(0, 5)}
                  money={money}
                  locale={locale}
                />
              </Card>
            </section>
          </div>

          <section aria-label={t(`${K}.alerts.title`)}>
            <SectionHeader title={t(`${K}.alerts.title`)} />
            <Card className="p-4">
              {data.alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t(`${K}.alerts.none`)}</p>
              ) : (
                <ul className="space-y-2">
                  {data.alerts.map((a) => (
                    <li
                      key={a.fingerprint}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium">{a.title}</p>
                        <p className="text-xs text-muted-foreground">{a.detail}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={a.severity} />
                        <a href={a.evidence_url} className="text-xs underline underline-offset-4">
                          {t(`${K}.alerts.evidence`)}
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          {staleOrMissing.length > 0 ? (
            <Alert variant="warning">
              <AlertTriangle className="size-4" />
              <AlertTitle>{t(`${K}.stale.title`)}</AlertTitle>
              <AlertDescription>
                {t(`${K}.stale.body`, { count: formatNumber(staleOrMissing.length, locale) })}
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      )}
    </div>
  );
}

function BridgeRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <tr className="border-t border-border first:border-0">
      <th scope="row" className={`py-1 text-start ${strong ? "font-semibold" : "font-normal"}`}>
        {label}
      </th>
      <td className={`py-1 text-end tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</td>
    </tr>
  );
}

function ConcentrationList({
  title,
  slices,
  money,
  locale,
}: {
  title: string;
  slices: { key: string; revenue: number; share_pct: number | null }[];
  money: (v: number | null | undefined) => string;
  locale: Locale;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="space-y-1">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{s.key}</span>
            <span className="tabular-nums text-muted-foreground">
              {money(s.revenue)} · {pctText(s.share_pct, locale)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  allLabel: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
