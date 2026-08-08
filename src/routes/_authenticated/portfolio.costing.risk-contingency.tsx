// GC-17 — Portfolio risk & contingency dashboard.
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ShieldAlert, Wallet } from "lucide-react";
import { Suspense } from "react";
import { z } from "zod";

import { money } from "@/components/cashflow/cash-format";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { SavedViewsBar } from "@/components/portfolio/saved-views-bar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
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
  riskContingencyConfigToSearch,
  riskContingencySearchToConfig,
  type RiskContingencySearch,
} from "@/lib/portfolio-views.rules";
import { portfolioRiskContingencyQueryOptions } from "@/lib/risk-contingency.query";

const K = "financeMod.costing.riskContingency";

const searchSchema = z.object({
  band: z.string().optional(),
  search: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/portfolio/costing/risk-contingency")({
  validateSearch: searchSchema,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(portfolioRiskContingencyQueryOptions()),
  head: () => ({
    meta: [
      { title: "Portfolio risk & contingency — GridMind" },
      {
        name: "description",
        content:
          "Cross-project quantitative risk exposure, contingency adequacy and drawdown velocity.",
      },
      { property: "og:title", content: "Portfolio risk & contingency — GridMind" },
      {
        property: "og:description",
        content: "P80 exposure, contingency cover and drawdown burn across the portfolio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PortfolioRiskContingency,
});

function PortfolioRiskContingency() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const { data } = useSuspenseQuery(portfolioRiskContingencyQueryOptions());
  const currency = data.rows[0]?.reporting_currency ?? "USD";
  const term = (search.search ?? "").trim().toLowerCase();
  const rows = data.rows.filter(
    (r) =>
      (!search.band || search.band === "all" || r.band === search.band) &&
      (term === "" ||
        r.project_name.toLowerCase().includes(term) ||
        (r.project_code ?? "").toLowerCase().includes(term)),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t(`${K}.portfolioTitle`)} description={t(`${K}.portfolioDescription`)} />

      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <SavedViewsBar<RiskContingencySearch>
          scope="risk_contingency"
          search={search}
          onApply={(next) => void navigate({ search: () => next })}
          toSearch={riskContingencyConfigToSearch}
          fromSearch={riskContingencySearchToConfig}
        />
      </Suspense>

      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="space-y-1">
          <Label htmlFor="rc-band">{t(`${K}.filters.band`)}</Label>
          <select
            id="rc-band"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={search.band ?? "all"}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  band: e.target.value === "all" ? undefined : e.target.value,
                }),
              })
            }
          >
            <option value="all">{t(`${K}.filters.allBands`)}</option>
            <option value="healthy">{t(`${K}.bands.healthy`)}</option>
            <option value="watch">{t(`${K}.bands.watch`)}</option>
            <option value="inadequate">{t(`${K}.bands.inadequate`)}</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rc-search">{t(`${K}.filters.search`)}</Label>
          <Input
            id="rc-search"
            className="h-9 w-64"
            value={search.search ?? ""}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({ ...prev, search: e.target.value || undefined }),
              })
            }
          />
        </div>
      </Card>

      <KpiGrid>
        <KpiTile
          label={t(`${K}.kpi.projects`)}
          value={String(data.totals.projects)}
          icon={ShieldAlert}
        />
        <KpiTile label={t(`${K}.kpi.totalP80`)} value={money(data.totals.p80, currency)} />
        <KpiTile
          label={t(`${K}.kpi.available`)}
          value={money(data.totals.available, currency)}
          icon={Wallet}
        />
        <KpiTile
          label={t(`${K}.kpi.totalShortfall`)}
          value={money(data.totals.shortfall, currency)}
          status={data.totals.shortfall > 0 ? "bad" : "good"}
        />
      </KpiGrid>

      <Card className="flex flex-col gap-4 p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t(`${K}.table.project`)}</h2>
          <p className="text-xs text-muted-foreground">{t(`${K}.portfolioDescription`)}</p>
        </div>
        {rows.length === 0 ? (
          <EmptyState title={t(`${K}.portfolioTitle`)} description={t(`${K}.table.empty`)} />
        ) : (
          <Table>
            <caption className="sr-only">{t(`${K}.portfolioTitle`)}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t(`${K}.table.project`)}</TableHead>
                <TableHead scope="col" className="text-right">
                  {t(`${K}.table.exposure`)}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {t(`${K}.table.available`)}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {t(`${K}.table.cover`)}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {t(`${K}.table.shortfall`)}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {t(`${K}.table.burn`)}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {t(`${K}.table.alerts`)}
                </TableHead>
                <TableHead scope="col">{t(`${K}.table.top`)}</TableHead>
                <TableHead scope="col">{t(`${K}.table.lastRun`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.project_id}>
                  <TableCell>
                    <Link
                      className="underline underline-offset-2"
                      to="/projects/$projectId/costing/risk-contingency"
                      params={{ projectId: row.project_id }}
                    >
                      {row.project_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    {money(row.p80, row.reporting_currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {money(row.available, row.reporting_currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <StatusBadge status={row.band} />
                  </TableCell>
                  <TableCell className="text-right">
                    {money(row.shortfall, row.reporting_currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {money(row.burn_per_day, row.reporting_currency)}
                  </TableCell>
                  <TableCell className="text-right">{row.open_alerts}</TableCell>
                  <TableCell>{row.top_contributor ?? "—"}</TableCell>
                  <TableCell>{row.last_run_at?.slice(0, 10) ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
