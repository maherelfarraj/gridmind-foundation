// GC-12 — Portfolio earned value: consolidated cost/schedule performance.
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Download } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiTile } from "@/components/ui/kpi-tile";
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
import { indexTone, money, percent, ratio, varianceTone } from "@/components/evm/evm-format";
import { costingErrorMessage } from "@/lib/costing.query";
import { downloadCsv, toCsv } from "@/lib/csv";
import { portfolioEvmQueryOptions } from "@/lib/evm.report.query";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "portfolioMod.costing.evm";

interface EvmPortfolioSearch {
  period?: string;
  currency?: string;
}

export const Route = createFileRoute("/_authenticated/portfolio/costing/evm")({
  validateSearch: (search: Record<string, unknown>): EvmPortfolioSearch => ({
    ...(typeof search["period"] === "string" ? { period: search["period"] as string } : {}),
    ...(typeof search["currency"] === "string" ? { currency: search["currency"] as string } : {}),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(portfolioEvmQueryOptions(deps)),
  head: () => ({
    meta: [
      { title: "Portfolio earned value — GridMind EPC" },
      {
        name: "description",
        content:
          "Consolidated CPI, SPI and EAC across the project portfolio from approved earned value snapshots.",
      },
      { property: "og:title", content: "Portfolio earned value — GridMind EPC" },
      {
        property: "og:description",
        content: "Cost and schedule performance consolidated across every reporting project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: ({ error }) => (
    <Card className="p-6 text-sm text-destructive">{costingErrorMessage(error)}</Card>
  ),
  notFoundComponent: PortfolioEvmNotFound,
  component: PortfolioEvmPage,
});

function PortfolioEvmNotFound() {
  const { t } = useI18n();
  return <Card className="p-6 text-sm">{t(`${K}.notFound`)}</Card>;
}

function PortfolioEvmPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const { data } = useSuspenseQuery(portfolioEvmQueryOptions(search));
  const currency = data.reporting_currency;
  const totals = data.totals;

  function onExport() {
    try {
      const csv = toCsv(
        [
          "project_code",
          "project_name",
          "period",
          "status",
          "bac",
          "pv",
          "ev",
          "ac",
          "cpi",
          "spi",
          "eac",
          "vac",
          "blockers",
          "mapping_completeness_pct",
        ],
        [...data.rows]
          .sort((a, b) => a.code.localeCompare(b.code))
          .map((r) => {
            const m = r.reporting ?? r.project;
            return [
              r.code,
              r.name,
              r.period_month,
              r.status,
              m.bac,
              m.pv,
              m.ev,
              m.ac,
              m.cpi,
              m.spi,
              m.eac,
              m.vac,
              r.blockers,
              r.mapping_completeness_pct,
            ];
          }),
      );
      downloadCsv(`portfolio-evm-${data.period.slice(0, 7)}.csv`, csv);
    } catch (e) {
      toast.error(costingErrorMessage(e));
    }
  }

  return (
    <div className="page-shell flex flex-col gap-6">
      <PageHeader
        title={t(`${K}.title`)}
        description={t(`${K}.description`, { period: data.period.slice(0, 7), currency })}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/portfolio/costing" search={{}}>
                <ArrowLeft className="size-4" /> {t(`${K}.back`)}
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download className="size-4" /> {t(`${K}.export`)}
            </Button>
          </div>
        }
      />

      <div
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        role="group"
        aria-label={t(`${K}.kpiGroup`)}
      >
        <KpiTile label={t(`${K}.kpi.bac`)} value={money(totals.bac, currency)} />
        <KpiTile label={t(`${K}.kpi.ev`)} value={money(totals.ev, currency)} />
        <KpiTile label={t(`${K}.kpi.ac`)} value={money(totals.ac, currency)} />
        <KpiTile label={t(`${K}.kpi.eac`)} value={money(totals.eac, currency)} />
        <KpiTile
          label={t(`${K}.kpi.cpi`)}
          value={ratio(totals.cpi)}
          status={indexTone(totals.cpi, 1)}
        />
        <KpiTile
          label={t(`${K}.kpi.spi`)}
          value={ratio(totals.spi)}
          status={indexTone(totals.spi, 1)}
        />
        <KpiTile
          label={t(`${K}.kpi.cv`)}
          value={money(totals.cv, currency)}
          status={varianceTone(totals.cv)}
        />
        <KpiTile
          label={t(`${K}.kpi.vac`)}
          value={money(totals.vac, currency)}
          status={varianceTone(totals.vac)}
        />
      </div>

      <Card className="flex flex-wrap items-center gap-6 p-4 text-sm">
        <Field label={t(`${K}.included`)} value={String(totals.included)} />
        <Field label={t(`${K}.excluded`)} value={String(totals.excluded.length)} />
        <Field label={t(`${K}.mapping`)} value={percent(data.mapping_completeness_pct)} />
        {totals.excluded.length > 0 ? (
          <p className="flex items-center gap-2 text-xs text-warning">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {t(`${K}.excludedHint`, {
              projects: totals.excluded.map((e) => e.code).join(", "),
            })}
          </p>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.quadrants`)}</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          {data.quadrants.map((q) => (
            <Field
              key={q.quadrant}
              label={t(`${K}.quadrant.${q.quadrant}`)}
              value={String(q.count)}
            />
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.table.title`)}</h2>
        {data.rows.length === 0 ? (
          <EmptyState title={t(`${K}.table.emptyTitle`)} description={t(`${K}.table.emptyBody`)} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <caption className="sr-only">{t(`${K}.table.caption`)}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t(`${K}.table.project`)}</TableHead>
                  <TableHead scope="col">{t(`${K}.table.status`)}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t(`${K}.kpi.bac`)}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t(`${K}.kpi.ev`)}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t(`${K}.kpi.ac`)}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t(`${K}.kpi.cpi`)}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t(`${K}.kpi.spi`)}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t(`${K}.kpi.eac`)}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t(`${K}.table.blockers`)}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.rows]
                  .sort((a, b) => a.code.localeCompare(b.code))
                  .map((r) => {
                    const m = r.reporting ?? r.project;
                    const excluded = r.reporting === null;
                    return (
                      <TableRow key={r.project_id}>
                        <TableCell>
                          <Link
                            to="/projects/$projectId/costing/evm"
                            params={{ projectId: r.project_id }}
                            search={{ period: r.period_month }}
                            className="text-foreground underline-offset-2 hover:underline"
                          >
                            {r.code} — {r.name}
                          </Link>
                          {excluded ? (
                            <span className="ms-2 text-xs text-warning">
                              {t(`${K}.table.fxMissing`)}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={r.status}
                            label={t(`financeMod.costing.evm.status.${r.status}`)}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(m.bac, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(m.ev, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(m.ac, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{ratio(m.cpi)}</TableCell>
                        <TableCell className="text-right tabular-nums">{ratio(m.spi)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(m.eac, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.blockers}</TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.movers.title`)}</h2>
        {data.movers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${K}.movers.empty`)}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {data.movers.map((m) => (
              <li key={m.project_id} className="flex flex-wrap gap-3 text-muted-foreground">
                <span className="text-foreground">{m.code}</span>
                <span>
                  {t(`${K}.movers.cpi`)}: {ratio(m.cpi_delta)}
                </span>
                <span>
                  {t(`${K}.movers.spi`)}: {ratio(m.spi_delta)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}
