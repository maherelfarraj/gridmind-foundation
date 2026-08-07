// GC-08 — Printable management pack: consolidated position, close matrix,
// FX attribution and reconciliation for one reporting period.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { Suspense } from "react";
import { z } from "zod";

import { PortfolioCashAppendixCard } from "@/components/cashflow/cash-appendix";
import { PortfolioEvmAppendixCard } from "@/components/evm/evm-appendix";
import { PortfolioRecognitionAppendixCard } from "@/components/recognition/recognition-appendix";
import { portfolioRecognitionQueryOptions } from "@/lib/recognition.query";
import { AuditTrailTable } from "@/components/portfolio/audit-trail-table";
import { CostingCloseMatrix } from "@/components/portfolio/costing-close-matrix";
import { CostingConsolidationTable } from "@/components/portfolio/costing-consolidation-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate, formatNumber } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import { portfolioCostingQueryOptions } from "@/lib/portfolio-costing.query";
import { portfolioAlertAppendixQueryOptions } from "@/lib/portfolio-alerts.query";
import { portfolioAuditQueryOptions } from "@/lib/portfolio-governance.query";
import { portfolioCashflowAppendixQueryOptions } from "@/lib/cashflow.query";
import { portfolioEvmAppendixQueryOptions } from "@/lib/evm.report.query";

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

export const Route = createFileRoute("/_authenticated/portfolio/costing/pack")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Portfolio management pack | GridMind EPC" },
      {
        name: "description",
        content:
          "Printable portfolio management pack: consolidated cost position, variance, close status and FX attribution.",
      },
      { property: "og:title", content: "Portfolio management pack | GridMind EPC" },
      {
        property: "og:description",
        content: "Board-ready consolidated cost and close pack for the project portfolio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: () => <Skeleton className="h-64 w-full" />,
  component: PackView,
});

function PackView() {
  const { t, locale } = useI18n();
  const search = Route.useSearch();
  const { data } = useSuspenseQuery(portfolioCostingQueryOptions(search));
  const cur = data.reporting_currency;

  return (
    <div className="page-shell">
      <PageHeader
        title={t(`${K}.pack.title`, { period: data.period.slice(0, 7) })}
        description={t(`${K}.pack.description`, { currency: cur, date: data.rate_date })}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button asChild variant="outline" size="sm">
              <Link to="/portfolio/costing">
                <ArrowLeft className="size-4" /> {t(`${K}.pack.back`)}
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" /> {t(`${K}.pack.print`)}
            </Button>
          </div>
        }
      />

      <Card className="flex flex-wrap gap-6 p-4 text-sm">
        <Field label={t(`${K}.pack.period`)} value={data.period.slice(0, 7)} />
        <Field label={t(`${K}.filters.currency`)} value={cur} />
        <Field label={t(`${K}.filters.basis`)} value={t(`${K}.filters.basis_${data.basis}`)} />
        <Field label={t(`${K}.pack.rateDate`)} value={data.rate_date} />
        <Field
          label={t(`${K}.pack.status`)}
          value={data.gate.official ? t(`${K}.pack.official`) : t(`${K}.pack.management`)}
        />
        <Field
          label={t(`${K}.pack.projects`)}
          value={`${data.consolidation.included}/${data.rows.length}`}
        />
      </Card>

      <section className="space-y-3">
        <SectionHeader title={t(`${K}.consolidation.heading`)} />
        <Card className="overflow-x-auto p-0">
          <CostingConsolidationTable rows={data.rows} consolidation={data.consolidation} />
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeader title={t(`${K}.pack.fxHeading`)} description={t(`${K}.pack.fxNote`)} />
        <Card className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(`${K}.table.project`)}</TableHead>
                <TableHead>{t(`${K}.pack.fromCurrency`)}</TableHead>
                <TableHead className="text-end">{t(`${K}.pack.rate`)}</TableHead>
                <TableHead>{t(`${K}.pack.rateAsOf`)}</TableHead>
                <TableHead>{t(`${K}.pack.rateSource`)}</TableHead>
                <TableHead className="text-end">{t(`${K}.pack.projectEac`)}</TableHead>
                <TableHead className="text-end">{t(`${K}.pack.reportingEac`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.reconciliation.lines.map((l) => (
                <TableRow key={l.project_id}>
                  <TableCell>{l.code}</TableCell>
                  <TableCell>{l.currency}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {l.rate === null
                      ? "—"
                      : formatNumber(l.rate, locale, { maximumFractionDigits: 6 })}
                  </TableCell>
                  <TableCell>
                    {data.rows.find((r) => r.project_id === l.project_id)?.rate.as_of ?? "—"}
                  </TableCell>
                  <TableCell>
                    {t(
                      `${K}.pack.source.${data.rows.find((r) => r.project_id === l.project_id)?.rate.source ?? "table"}`,
                    )}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatCurrency(l.project_eac, locale, l.currency)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {l.reporting_eac === null ? "—" : formatCurrency(l.reporting_eac, locale, cur)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <p className="text-muted-foreground text-xs">
          {data.reconciliation.ok
            ? t(`${K}.reconciliation.ok`, { count: data.reconciliation.lines.length })
            : t(`${K}.reconciliation.failed`, {
                value: formatCurrency(data.reconciliation.difference, locale, cur),
              })}
        </p>
      </section>

      <section className="space-y-3">
        <SectionHeader title={t(`${K}.close.heading`)} />
        <Card className="overflow-x-auto p-0">
          <CostingCloseMatrix rows={data.rows} period={data.period} />
        </Card>
      </section>

      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <AlertAppendix period={data.period} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <PortfolioEvmAppendix period={data.period} currency={cur} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <PortfolioCashAppendix period={data.period} currency={cur} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <PortfolioRecognitionAppendix period={data.period} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <AuditAppendix period={data.period} />
      </Suspense>
    </div>
  );
}

/** GC-12 — consolidated earned value appendix for the period. */
function PortfolioEvmAppendix({ period, currency }: { period: string; currency: string }) {
  const { data } = useSuspenseQuery(portfolioEvmAppendixQueryOptions({ period, currency }));
  return (
    <section className="space-y-3">
      <PortfolioEvmAppendixCard data={data} />
    </section>
  );
}

/** GC-13 — consolidated cash-flow & liquidity appendix for the period. */
function PortfolioCashAppendix({ period, currency }: { period: string; currency: string }) {
  const { data } = useSuspenseQuery(portfolioCashflowAppendixQueryOptions({ period, currency }));
  return (
    <section className="space-y-3">
      <PortfolioCashAppendixCard data={data} />
    </section>
  );
}

/** GC-15 — consolidated revenue / WIP appendix for the period. */
function PortfolioRecognitionAppendix({ period }: { period: string }) {
  const { data } = useSuspenseQuery(
    portfolioRecognitionQueryOptions({ period_month: period, status: "all" }),
  );
  return (
    <section className="space-y-3">
      <PortfolioRecognitionAppendixCard data={data} />
    </section>
  );
}

/** Unresolved critical/high finance alerts standing against the period. */
function AlertAppendix({ period }: { period: string }) {
  const { t, locale } = useI18n();
  const { data } = useSuspenseQuery(portfolioAlertAppendixQueryOptions(period));
  const A = `${K}.alerts`;
  return (
    <section className="space-y-3">
      <SectionHeader
        title={t(`${A}.appendixHeading`)}
        description={t(`${A}.appendixDescription`, {
          open: formatNumber(data.summary.open, locale),
          critical: formatNumber(
            data.summary.by_severity.critical + data.summary.by_severity.high,
            locale,
          ),
          projects: formatNumber(data.summary.projects_affected, locale),
        })}
      />
      {data.critical.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t(`${A}.empty.title`)}</p>
      ) : (
        <Card className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t(`${A}.col.severity`)}</TableHead>
                <TableHead scope="col">{t(`${A}.col.rule`)}</TableHead>
                <TableHead scope="col">{t(`${A}.col.scope`)}</TableHead>
                <TableHead scope="col">{t(`${A}.col.value`)}</TableHead>
                <TableHead scope="col">{t(`${A}.col.age`)}</TableHead>
                <TableHead scope="col">{t(`${A}.col.status`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.critical.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{t(`${A}.severity.${a.severity}`)}</TableCell>
                  <TableCell>{t(`${A}.rule.${a.rule_type}`)}</TableCell>
                  <TableCell>{a.project_code ?? t(`${A}.companyScope`)}</TableCell>
                  <TableCell>{a.title}</TableCell>
                  <TableCell>
                    {t(`${A}.ageDays`, { days: formatNumber(a.age_days, locale) })}
                  </TableCell>
                  <TableCell>{t(`${A}.status.${a.effective_status}`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function AuditAppendix({ period }: { period: string }) {
  const { t, locale } = useI18n();
  const { data } = useSuspenseQuery(portfolioAuditQueryOptions({ period, page: 1, page_size: 25 }));
  return (
    <section className="space-y-3">
      <SectionHeader
        title={t(`${K}.audit.appendixHeading`)}
        description={t(`${K}.audit.appendixDescription`, {
          // Latest recorded event, not `new Date()`: a render-time clock diverges
          // between SSR and hydration and makes printed packs non-reproducible.
          generated: data.events[0]
            ? formatDate(data.events[0].created_at, locale, {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : formatDate(period, locale, { dateStyle: "medium" }),
          gaps: formatNumber(data.reconciliation.gaps, locale),
        })}
      />
      {data.events.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t(`${K}.audit.none`)}</p>
      ) : (
        <Card className="overflow-x-auto p-0">
          <AuditTrailTable events={data.events} period={period} />
        </Card>
      )}
    </section>
  );
}
