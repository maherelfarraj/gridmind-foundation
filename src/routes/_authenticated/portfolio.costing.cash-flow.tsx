// GC-13 — Portfolio cash flow & liquidity: consolidated funding need, headroom,
// concentration and maturity across the portfolio. Read-only; every figure comes
// from governed project snapshots translated once at their declared rate.
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Download } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { CashBucketChart } from "@/components/cashflow/cash-bucket-chart";
import { money, percent } from "@/components/cashflow/cash-format";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { aggregatePortfolioCurve, portfolioStress } from "@/lib/cashflow.rules";
import type { PortfolioStressAssumptions } from "@/lib/cashflow.rules";
import { portfolioCashflowQueryOptions } from "@/lib/cashflow.query";
import { costingErrorMessage } from "@/lib/costing.query";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "portfolioMod.costing.cashFlow";
const F = "financeMod.costing.cashFlow";

const searchSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/)
    .optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  only_approved: z.boolean().optional(),
});

export const Route = createFileRoute("/_authenticated/portfolio/costing/cash-flow")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(portfolioCashflowQueryOptions(deps)),
  head: () => ({
    meta: [
      { title: "Portfolio cash flow & liquidity — GridMind EPC" },
      {
        name: "description",
        content:
          "Consolidated peak funding need, headroom, covenant risk and facility maturities across the project portfolio.",
      },
      { property: "og:title", content: "Portfolio cash flow & liquidity — GridMind EPC" },
      {
        property: "og:description",
        content: "Liquidity and funding position consolidated across every reporting project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: ({ error }) => (
    <Card className="p-6 text-sm text-destructive">{costingErrorMessage(error)}</Card>
  ),
  notFoundComponent: PortfolioCashNotFound,
  component: PortfolioCashPage,
});

function PortfolioCashNotFound() {
  const { t } = useI18n();
  return <Card className="p-6 text-sm">{t(`${K}.notFound`)}</Card>;
}

/** Concentration: share of total unfunded requirement held by each project. */
function concentration(
  rows: { project_id: string; project_code: string; funding: { unfunded_requirement: number } }[],
): { project_id: string; project_code: string; amount: number; share: number }[] {
  const total = rows.reduce((s, r) => s + Math.max(0, r.funding.unfunded_requirement), 0);
  return rows
    .map((r) => ({
      project_id: r.project_id,
      project_code: r.project_code,
      amount: Math.max(0, r.funding.unfunded_requirement),
      share: total > 0 ? (Math.max(0, r.funding.unfunded_requirement) / total) * 100 : 0,
    }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

function heatTone(value: number): string {
  if (value <= 0) return "bg-muted text-muted-foreground";
  if (value < 0.34) return "bg-warning/20 text-foreground";
  if (value < 0.67) return "bg-warning/40 text-foreground";
  return "bg-destructive/40 text-foreground";
}

function PortfolioCashPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const { data } = useSuspenseQuery(portfolioCashflowQueryOptions(search));
  const currency = data.reporting_currency;
  const totals = data.totals;
  const conc = concentration(data.rows);
  const navigate = useNavigate();
  const [stress, setStress] = useState<PortfolioStressAssumptions>({
    receipt_delay_buckets: 0,
    outflow_uplift_pct: 0,
    fx_shock_pct: 0,
    facility_change_pct: 0,
  });
  const curve = useMemo(() => aggregatePortfolioCurve(data.rows), [data.rows]);
  const stressed = useMemo(
    () => portfolioStress(data.rows, totals.available_funding, stress),
    [data.rows, totals.available_funding, stress],
  );
  const stressActive = Object.values(stress).some((v) => Number(v) !== 0);

  function setSearch(patch: Record<string, unknown>) {
    void navigate({
      to: "/portfolio/costing/cash-flow",
      search: (prev) => ({ ...prev, ...patch }),
    });
  }
  const maxNeed = Math.max(1, ...data.rows.map((r) => Math.max(0, r.measures.peak_funding_need)));

  function onExport() {
    try {
      const csv = toCsv(
        [
          "project_code",
          "project_name",
          "status",
          "basis",
          "reporting_currency",
          "closing_cash",
          "peak_funding_need",
          "minimum_liquidity",
          "unfunded_requirement",
          "headroom",
          "utilization_pct",
          "fx_missing",
        ],
        [...data.rows]
          .sort((a, b) => a.project_code.localeCompare(b.project_code))
          .map((r) => [
            r.project_code,
            r.project_name,
            r.status ?? "",
            r.basis,
            r.reporting_currency,
            r.measures.closing_cash,
            r.measures.peak_funding_need,
            r.measures.minimum_liquidity,
            r.funding.unfunded_requirement,
            r.funding.headroom,
            r.funding.utilization_pct ?? "",
            r.fx_missing,
          ]),
      );
      downloadCsv(`portfolio-cash-flow-${data.period.slice(0, 7)}.csv`, csv);
    } catch (e) {
      toast.error(costingErrorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title={t(`${K}.title`)}
        description={t(`${K}.description`)}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/portfolio/costing" search={{}}>
                <ArrowLeft aria-hidden="true" className="size-4" />
                {t(`${K}.back`)}
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download aria-hidden="true" className="size-4" />
              {t(`${K}.export`)}
            </Button>
          </div>
        }
      />

      {totals.fx_missing_projects.length > 0 && (
        <Card className="flex items-start gap-2 p-4 text-sm">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 text-warning" />
          <span className="text-muted-foreground">
            {t(`${K}.fxMissing`, { count: totals.fx_missing_projects.length })}
          </span>
        </Card>
      )}

      <KpiGrid aria-label={t(`${F}.kpi.groupLabel`)}>
        <KpiTile
          label={t(`${F}.kpi.peakFunding`)}
          value={money(totals.peak_funding_need, currency)}
          hint={t(`${F}.kpi.peakFundingHint`)}
        />
        <KpiTile
          label={t(`${F}.kpi.minLiquidity`)}
          value={money(totals.minimum_liquidity, currency)}
          hint={t(`${F}.kpi.minLiquidityHint`)}
        />
        <KpiTile
          label={t(`${F}.kpi.unfunded`)}
          value={money(totals.unfunded_requirement, currency)}
          hint={t(`${F}.kpi.unfundedHint`)}
          status={totals.unfunded_requirement > 0 ? "bad" : "good"}
        />
        <KpiTile
          label={t(`${F}.facilities.headroom`)}
          value={money(totals.headroom, currency)}
          hint={t(`${K}.coverage`, {
            approved: totals.approved_projects,
            projects: totals.projects,
          })}
        />
      </KpiGrid>

      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="pf-period">{t(`${F}.basis.period`)}</Label>
          <Input
            id="pf-period"
            type="month"
            className="w-40"
            value={(search.period ?? data.period).slice(0, 7)}
            onChange={(e) =>
              setSearch({ period: e.target.value ? `${e.target.value}-01` : undefined })
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pf-currency">{t(`${F}.basis.reportingCurrency`)}</Label>
          <Input
            id="pf-currency"
            className="w-28 uppercase"
            maxLength={3}
            value={search.currency ?? currency}
            onChange={(e) => {
              const v = e.target.value.toUpperCase();
              setSearch({ currency: /^[A-Z]{3}$/.test(v) ? v : undefined });
            }}
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox
            id="pf-approved"
            checked={search.only_approved ?? false}
            onCheckedChange={(v) => setSearch({ only_approved: v === true ? true : undefined })}
          />
          <Label htmlFor="pf-approved">{t(`${K}.filters.onlyApproved`)}</Label>
        </div>
      </Card>

      <section className="flex flex-col gap-3">
        <SectionHeader title={t(`${K}.curve.title`)} description={t(`${K}.curve.description`)} />
        <Card className="p-4">
          <CashBucketChart
            buckets={stressActive ? stressed.stressed_curve : curve}
            currency={currency}
            granularity="month"
          />
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader title={t(`${K}.stress.title`)} description={t(`${K}.stress.description`)} />
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-end gap-4">
            {(
              [
                ["receipt_delay_buckets", `${K}.stress.receiptDelay`],
                ["outflow_uplift_pct", `${K}.stress.outflowUplift`],
                ["fx_shock_pct", `${K}.stress.fxShock`],
                ["facility_change_pct", `${K}.stress.facilityChange`],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex flex-col gap-1">
                <Label htmlFor={`stress-${key}`}>{t(label)}</Label>
                <Input
                  id={`stress-${key}`}
                  type="number"
                  className="w-32"
                  value={String(stress[key] ?? 0)}
                  onChange={(e) =>
                    setStress((prev) => ({ ...prev, [key]: Number(e.target.value) || 0 }))
                  }
                />
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setStress({
                  receipt_delay_buckets: 0,
                  outflow_uplift_pct: 0,
                  fx_shock_pct: 0,
                  facility_change_pct: 0,
                })
              }
            >
              {t(`${K}.stress.reset`)}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t(`${K}.stress.watermark`)}</p>
          <Table>
            <caption className="sr-only">{t(`${K}.stress.title`)}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t(`${K}.stress.metric`)}</TableHead>
                <TableHead scope="col" className="text-end">
                  {t(`${K}.stress.basis`)}
                </TableHead>
                <TableHead scope="col" className="text-end">
                  {t(`${K}.stress.scenario`)}
                </TableHead>
                <TableHead scope="col" className="text-end">
                  {t(`${K}.stress.delta`)}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stressed.comparison
                .filter((c) => c.basis !== null || c.scenario !== null)
                .map((c) => (
                  <TableRow key={c.metric}>
                    <TableCell className="text-foreground">
                      {t(`${F}.scenario.metric.${c.metric}`, { defaultValue: c.metric })}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {c.basis == null ? "—" : money(c.basis, currency)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {c.scenario == null ? "—" : money(c.scenario, currency)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {c.delta == null ? "—" : money(c.delta, currency)}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader
          title={t(`${K}.heatmap.title`)}
          description={t(`${K}.heatmap.description`)}
        />
        {data.rows.length === 0 ? (
          <EmptyState title={t(`${K}.empty.title`)} description={t(`${K}.empty.body`)} />
        ) : (
          <Card className="overflow-x-auto p-0">
            <Table>
              <caption className="sr-only">{t(`${K}.heatmap.title`)}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t(`${K}.table.project`)}</TableHead>
                  <TableHead scope="col">{t(`${F}.basis.status`)}</TableHead>
                  <TableHead scope="col" className="text-end">
                    {t(`${F}.kpi.closingCash`)}
                  </TableHead>
                  <TableHead scope="col" className="text-end">
                    {t(`${F}.kpi.peakFunding`)}
                  </TableHead>
                  <TableHead scope="col" className="text-end">
                    {t(`${F}.kpi.unfunded`)}
                  </TableHead>
                  <TableHead scope="col" className="text-end">
                    {t(`${F}.facilities.utilization`)}
                  </TableHead>
                  <TableHead scope="col">{t(`${K}.table.risk`)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.rows]
                  .sort((a, b) => b.measures.peak_funding_need - a.measures.peak_funding_need)
                  .map((r) => {
                    const intensity = Math.max(0, r.measures.peak_funding_need) / maxNeed;
                    return (
                      <TableRow key={r.project_id}>
                        <TableCell>
                          <Link
                            to="/projects/$projectId/costing/cash-flow"
                            params={{ projectId: r.project_id }}
                            search={{}}
                            className="text-foreground underline-offset-4 hover:underline"
                          >
                            {r.project_code} {r.project_name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={r.status === "approved" ? "approved" : "draft"}
                            label={
                              r.status
                                ? t(`${F}.status.${r.status}`, { defaultValue: r.status })
                                : t(`${K}.table.noSnapshot`)
                            }
                          />
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {r.fx_missing ? "—" : money(r.measures.closing_cash, currency)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {r.fx_missing ? "—" : money(r.measures.peak_funding_need, currency)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {r.fx_missing ? "—" : money(r.funding.unfunded_requirement, currency)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {percent(r.funding.utilization_pct)}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-xs ${heatTone(intensity)}`}
                          >
                            {percent(intensity * 100)}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <SectionHeader
            title={t(`${K}.concentration.title`)}
            description={t(`${K}.concentration.description`)}
          />
          <Card className="p-4">
            {conc.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t(`${K}.concentration.empty`)}</p>
            ) : (
              <Table>
                <caption className="sr-only">{t(`${K}.concentration.title`)}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t(`${K}.table.project`)}</TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${F}.kpi.unfunded`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${K}.concentration.share`)}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conc.map((c) => (
                    <TableRow key={c.project_id}>
                      <TableCell className="text-foreground">{c.project_code}</TableCell>
                      <TableCell className="text-end tabular-nums">
                        {money(c.amount, currency)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{percent(c.share)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </section>

        <section className="flex flex-col gap-3">
          <SectionHeader
            title={t(`${F}.maturity.title`)}
            description={t(`${F}.maturity.description`)}
          />
          <Card className="p-4">
            {data.maturity.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t(`${F}.maturity.empty`)}</p>
            ) : (
              <Table>
                <caption className="sr-only">{t(`${F}.maturity.title`)}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t(`${F}.maturity.bucket`)}</TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${F}.maturity.amount`)}
                    </TableHead>
                    <TableHead scope="col" className="text-end">
                      {t(`${F}.maturity.facilities`)}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.maturity.map((m) => (
                    <TableRow key={m.bucket}>
                      <TableCell className="text-foreground">{m.bucket.slice(0, 7)}</TableCell>
                      <TableCell className="text-end tabular-nums">
                        {money(m.amount, currency)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{m.facilities.length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <SectionHeader title={t(`${K}.risks.title`)} description={t(`${K}.risks.description`)} />
        <Card className="p-4">
          {data.alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(`${K}.risks.empty`)}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {data.alerts.slice(0, 20).map((a, i) => (
                <li key={`${a.project_id}-${a.code}-${i}`} className="flex items-center gap-2">
                  <StatusBadge
                    status={a.severity === "blocker" ? "blocked" : "warning"}
                    label={t(`${F}.severity.${a.severity}`, { defaultValue: a.severity })}
                  />
                  <Link
                    to="/projects/$projectId/costing/cash-flow"
                    params={{ projectId: a.project_id }}
                    search={{}}
                    className="text-foreground underline-offset-4 hover:underline"
                  >
                    {a.message}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
