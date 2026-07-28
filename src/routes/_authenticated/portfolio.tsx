// P-252 — Portfolio dashboard: KPI strip, project cards, gate rail.
// Internal roles only — the underlying RPCs deny external viewers and audit
// every read (ops.portfolio_view).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Coins, FileSignature, Gauge, TrendingUp, Wallet } from "lucide-react";

import { CashCurveSection } from "@/components/portfolio/cash-curve-section";
import { ExposureSection } from "@/components/portfolio/exposure-section";
import { GateRail } from "@/components/portfolio/gate-rail";
import { ProjectCard } from "@/components/portfolio/project-card";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatNumber } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  portfolioKpisQueryOptions,
  portfolioProjectCardsQueryOptions,
} from "@/lib/portfolio/portfolio-query";
import { perfTone } from "@/lib/portfolio/portfolio.rules";

export const Route = createFileRoute("/_authenticated/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio | GridMind EPC" },
      {
        name: "description",
        content:
          "Consolidated portfolio performance: weighted SPI/CPI, contract value, cash and gate position across every project.",
      },
      { property: "og:title", content: "Portfolio | GridMind EPC" },
      {
        property: "og:description",
        content:
          "Consolidated portfolio performance: weighted SPI/CPI, contract value, cash and gate position across every project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PortfolioPage,
  errorComponent: PortfolioError,
});

function PortfolioError() {
  const { t } = useI18n();
  return (
    <div className="page-shell">
      <EmptyState
        icon={Boxes}
        title={t("portfolioMod.error.title")}
        description={t("portfolioMod.error.description")}
      />
    </div>
  );
}

function PortfolioPage() {
  const { t, locale } = useI18n();
  const kpisQuery = useQuery(portfolioKpisQueryOptions());
  const cardsQuery = useQuery(portfolioProjectCardsQueryOptions());

  const kpis = kpisQuery.data;
  const projects = cardsQuery.data ?? [];
  const currency = kpis?.base_currency ?? "USD";
  const activeProjects = kpis?.projects.by_status?.active ?? 0;
  const spi = kpis?.evm.spi ?? null;
  const cpi = kpis?.evm.cpi ?? null;
  const isLoading = kpisQuery.isLoading;

  const num = (value: number | null) =>
    value === null ? "—" : formatNumber(value, locale, { maximumFractionDigits: 3 });

  return (
    <div className="page-shell">
      <PageHeader title={t("portfolioMod.title")} description={t("portfolioMod.subtitle")} />

      <KpiGrid columns={6} label={t("portfolioMod.title")}>
        <KpiTile
          label={t("portfolioMod.kpi.activeProjects")}
          value={formatNumber(activeProjects, locale)}
          hint={t("portfolioMod.kpi.activeProjectsHint", { total: kpis?.projects.total ?? 0 })}
          icon={Boxes}
          isLoading={isLoading}
        />
        <KpiTile
          label={t("portfolioMod.kpi.contractValue")}
          value={formatCurrency(Number(kpis?.contract_value ?? 0), locale, currency)}
          icon={FileSignature}
          isLoading={isLoading}
        />
        <KpiTile
          label={t("portfolioMod.kpi.spi")}
          value={num(spi)}
          hint={spi === null ? t("portfolioMod.kpi.noEvm") : t("portfolioMod.kpi.weightedHint")}
          icon={Gauge}
          status={perfTone(spi)}
          isLoading={isLoading}
        />
        <KpiTile
          label={t("portfolioMod.kpi.cpi")}
          value={num(cpi)}
          hint={cpi === null ? t("portfolioMod.kpi.noEvm") : t("portfolioMod.kpi.weightedCostHint")}
          icon={TrendingUp}
          status={perfTone(cpi)}
          isLoading={isLoading}
        />
        <KpiTile
          label={t("portfolioMod.kpi.arOpen")}
          value={formatCurrency(Number(kpis?.ar_open ?? 0), locale, currency)}
          icon={Coins}
          isLoading={isLoading}
        />
        <KpiTile
          label={t("portfolioMod.kpi.cashMtd")}
          value={formatCurrency(
            Number(kpis?.cash_mtd.inflow ?? 0) - Number(kpis?.cash_mtd.outflow ?? 0),
            locale,
            currency,
          )}
          hint={t("portfolioMod.kpi.cashMtdHint", {
            in: formatCurrency(Number(kpis?.cash_mtd.inflow ?? 0), locale, currency),
            out: formatCurrency(Number(kpis?.cash_mtd.outflow ?? 0), locale, currency),
          })}
          icon={Wallet}
          isLoading={isLoading}
        />
      </KpiGrid>

      <section className="space-y-4">
        <SectionHeader title={t("portfolioMod.projects.heading")} />
        {cardsQuery.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="space-y-3 p-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </Card>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={t("portfolioMod.empty.title")}
            description={t("portfolioMod.empty.description")}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.project_id}
                to="/projects/$projectId"
                params={{ projectId: project.project_id }}
                aria-label={t("portfolioMod.projects.open")}
                className="rounded-lg focus-visible:outline-none"
              >
                <ProjectCard project={project} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <CashCurveSection baseCurrency={currency} />

      <ExposureSection />

      {projects.length > 0 ? <GateRail projects={projects} /> : null}
    </div>
  );
}
