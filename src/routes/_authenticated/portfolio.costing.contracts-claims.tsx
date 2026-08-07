// GC-16 — Portfolio contract & claims exposure roll-up.
// Read-only, non-posting. Every figure is derived from governed claim records
// and their snapshots; nothing on this page writes to the ledger or to any
// authoritative costing / EVM / cash-flow / recognition snapshot.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Gauge, Layers, ScrollText, Scale } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SavedViewsBar } from "@/components/portfolio/saved-views-bar";
import { formatCurrency, formatNumber } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  contractsClaimsConfigToSearch,
  contractsClaimsSearchToConfig,
  type ContractsClaimsSearch,
} from "@/lib/portfolio-views.rules";
import { portfolioClaimsQueryOptions } from "@/lib/contracts-claims.query";
import {
  CONTRACTS_CLAIMS_DISCLAIMER,
  concentrationBy,
  exposureWaterfall,
  rollupPortfolio,
} from "@/lib/contracts-claims.rules";

const K = "portfolioMod.costing.contractsClaims";
const ALL = "all";
const REPORTING_CURRENCY = "USD";

const searchSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/)
    .optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  project: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/portfolio/costing/contracts-claims")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Portfolio Contracts & Claims | GridMind EPC" },
      {
        name: "description",
        content:
          "Consolidated contract claim exposure, entitlement, EOT and contractual deadline risk across the project portfolio.",
      },
      { property: "og:title", content: "Portfolio Contracts & Claims | GridMind EPC" },
      {
        property: "og:description",
        content:
          "Governed claim exposure waterfall, concentration, overdue contractual deadlines and open alerts across all projects.",
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
  errorComponent: ClaimsError,
  component: PortfolioContractsClaimsPage,
});

function ClaimsError() {
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

function PortfolioContractsClaimsPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const { data } = useSuspenseQuery(
    portfolioClaimsQueryOptions({
      ...(search.period ? { period_month: search.period } : {}),
      ...(search.search ? { search: search.search } : {}),
      status: (search.status as never) ?? ("all" as never),
    }),
  );

  const setSearch = (patch: Partial<typeof search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const money = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : formatCurrency(v, locale, REPORTING_CURRENCY);
  const num = (v: number) => formatNumber(v, locale, { maximumFractionDigits: 0 });

  const all = data.projects;
  const projectNames = useMemo(() => [...new Set(all.map((r) => r.project_name))].sort(), [all]);

  const rows = useMemo(
    () =>
      all.filter(
        (r) => !search.project || search.project === ALL || r.project_name === search.project,
      ),
    [all, search.project],
  );

  const rollup = useMemo(() => rollupPortfolio(rows), [rows]);
  const waterfall = useMemo(() => exposureWaterfall(rollup), [rollup]);
  const byExposure = useMemo(() => concentrationBy(rows, "live_exposure"), [rows]);
  const byUnapproved = useMemo(() => concentrationBy(rows, "unapproved_exposure"), [rows]);

  const openAlerts = (data.alerts as Array<Record<string, unknown>>).filter(
    (a) => a["effective_state"] !== "resolved",
  );
  const criticalAlerts = openAlerts.filter((a) => a["severity"] === "critical");
  const approvedShare =
    rollup.live_exposure > 0 ? (rollup.approved / rollup.live_exposure) * 100 : null;
  const maxStep = Math.max(1, ...waterfall.map((s) => Math.abs(s.cumulative)));

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

      <Alert variant={criticalAlerts.length === 0 ? "default" : "warning"}>
        <Layers className="size-4" />
        <AlertTitle>
          {criticalAlerts.length === 0 ? t(`${K}.basis.clear`) : t(`${K}.basis.attention`)}
        </AlertTitle>
        <AlertDescription>
          {t(`${K}.basis.note`, {
            projects: num(rollup.project_count),
            alerts: num(openAlerts.length),
          })}{" "}
          {CONTRACTS_CLAIMS_DISCLAIMER}
        </AlertDescription>
      </Alert>

      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <SavedViewsBar<ContractsClaimsSearch>
          scope="contracts_claims"
          search={search}
          onApply={(next) => void navigate({ search: () => next })}
          toSearch={contractsClaimsConfigToSearch}
          fromSearch={contractsClaimsSearchToConfig}
        />
      </Suspense>

      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="space-y-1">
          <Label htmlFor="cc-period">{t(`${K}.filters.period`)}</Label>
          <input
            id="cc-period"
            type="month"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={(search.period ?? data.period_month ?? "").slice(0, 7)}
            onChange={(e) =>
              setSearch({ period: e.target.value ? `${e.target.value}-01` : undefined })
            }
          />
        </div>
        <FilterSelect
          id="cc-status"
          label={t(`${K}.filters.status`)}
          value={search.status ?? ALL}
          options={["working", "submitted", "approved", "superseded"]}
          allLabel={t(`${K}.filters.all`)}
          onChange={(v) => setSearch({ status: v })}
        />
        <FilterSelect
          id="cc-project"
          label={t(`${K}.filters.project`)}
          value={search.project ?? ALL}
          options={projectNames}
          allLabel={t(`${K}.filters.all`)}
          onChange={(v) => setSearch({ project: v })}
        />
        <div className="space-y-1">
          <Label htmlFor="cc-search">{t(`${K}.filters.search`)}</Label>
          <input
            id="cc-search"
            type="search"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={search.search ?? ""}
            onChange={(e) => setSearch({ search: e.target.value || undefined })}
          />
        </div>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={t(`${K}.empty.title`)}
          description={t(`${K}.empty.description`)}
        />
      ) : (
        <>
          <KpiGrid>
            <KpiTile
              icon={Scale}
              label={t(`${K}.kpi.liveExposure`)}
              value={money(rollup.live_exposure)}
              hint={t(`${K}.kpi.claims`, { count: num(rollup.claim_count) })}
            />
            <KpiTile
              icon={Gauge}
              label={t(`${K}.kpi.approved`)}
              value={money(rollup.approved)}
              hint={
                approvedShare === null
                  ? "—"
                  : `${formatNumber(approvedShare, locale, { maximumFractionDigits: 1 })}%`
              }
            />
            <KpiTile
              icon={AlertTriangle}
              label={t(`${K}.kpi.unapproved`)}
              value={money(rollup.unapproved_exposure)}
              status={rollup.unapproved_exposure > 0 ? "warning" : "neutral"}
              hint={t(`${K}.kpi.unapprovedHint`)}
            />
            <KpiTile
              icon={CalendarClock}
              label={t(`${K}.kpi.overdueDeadlines`)}
              value={num(rollup.overdue_deadlines)}
              status={rollup.overdue_deadlines > 0 ? "bad" : "good"}
              hint={t(`${K}.kpi.eot`, { days: num(rollup.eot_days_approved) })}
            />
            <KpiTile
              icon={Layers}
              label={t(`${K}.kpi.ld`)}
              value={money(rollup.ld_exposure)}
              status={rollup.ld_exposure > 0 ? "warning" : "neutral"}
              hint={t(`${K}.kpi.openAlerts`, { count: num(openAlerts.length) })}
            />
          </KpiGrid>

          <section aria-label={t(`${K}.waterfall.title`)}>
            <SectionHeader title={t(`${K}.waterfall.title`)} />
            <Card className="space-y-3 p-4">
              {waterfall.map((s) => (
                <div key={s.key} className="grid grid-cols-[11rem_1fr_9rem] items-center gap-3">
                  <span className="text-sm text-muted-foreground">{s.label}</span>
                  <span
                    className="h-2 rounded-full bg-muted"
                    role="img"
                    aria-label={`${s.label}: ${money(s.cumulative)}`}
                  >
                    <span
                      className="block h-2 rounded-full bg-primary motion-safe:transition-all"
                      style={{
                        inlineSize: `${(Math.abs(s.cumulative) / maxStep) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="text-end text-sm tabular-nums">{money(s.cumulative)}</span>
                </div>
              ))}
            </Card>
          </section>

          <section aria-label={t(`${K}.table.title`)}>
            <SectionHeader title={t(`${K}.table.title`)} />
            <Card className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t(`${K}.table.project`)}</TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.table.claims`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.table.asserted`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.table.approved`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.table.unapproved`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.table.exposure`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.table.eot`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.table.overdue`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.table.alerts`)}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.project_id}>
                      <TableCell>
                        <Link
                          to="/projects/$projectId/costing/contracts-claims"
                          params={{ projectId: r.project_id }}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {r.project_name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {num(r.totals.claim_count)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {money(r.totals.asserted)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {money(r.totals.approved)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {money(r.totals.unapproved_exposure)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {money(r.totals.live_exposure)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {num(r.totals.eot_days_approved)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {r.overdue_deadlines > 0 ? (
                          <StatusBadge status="overdue" label={num(r.overdue_deadlines)} />
                        ) : (
                          "0"
                        )}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{num(r.open_alerts)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </section>

          <section aria-label={t(`${K}.concentration.title`)}>
            <SectionHeader title={t(`${K}.concentration.title`)} />
            <div className="grid gap-4 md:grid-cols-2">
              <ConcentrationCard
                heading={t(`${K}.concentration.byExposure`)}
                rows={byExposure}
                money={money}
                locale={locale}
              />
              <ConcentrationCard
                heading={t(`${K}.concentration.byUnapproved`)}
                rows={byUnapproved}
                money={money}
                locale={locale}
              />
            </div>
          </section>

          <section aria-label={t(`${K}.alerts.title`)}>
            <SectionHeader title={t(`${K}.alerts.title`)} />
            <Card className="p-4">
              {openAlerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t(`${K}.alerts.empty`)}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {openAlerts.slice(0, 25).map((a) => (
                    <li
                      key={String(a["id"])}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <StatusBadge status={String(a["severity"])} label={String(a["severity"])} />
                        <span className="text-foreground">{String(a["title"])}</span>
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {String(a["due_at"] ?? "—").slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </>
      )}

      <p className="text-xs text-muted-foreground">{data.disclaimer}</p>
    </div>
  );
}

function ConcentrationCard({
  heading,
  rows,
  money,
  locale,
}: {
  heading: string;
  rows: Array<{ project_id: string; project_name: string; value: number; share_pct: number }>;
  money: (v: number) => string;
  locale: Parameters<typeof formatNumber>[1];
}) {
  return (
    <Card className="space-y-2 p-4">
      <h3 className="text-sm font-semibold text-foreground">{heading}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {rows.map((r) => (
            <li key={r.project_id} className="flex justify-between gap-2">
              <span className="truncate text-foreground">{r.project_name}</span>
              <span className="tabular-nums text-muted-foreground">
                {money(r.value)} · {formatNumber(r.share_pct, locale, { maximumFractionDigits: 1 })}
                %
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
