// P-254 — HSE/quality exposure view: HSE strip, quality strip, project heat
// table. Presentational only — every count comes from portfolio_hse_exposure()
// and every number clicks through to its filtered source list.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  HardHat,
  Minus,
  ShieldAlert,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  dimensionMaxima,
  EXPOSURE_DIMENSIONS,
  heatLevel,
  holdPointDrill,
  incidentDrill,
  ncrDrill,
  orderedCounts,
  punchDrill,
  PUNCH_ORDER,
  SEVERITY_ORDER,
  sortByExposure,
  totalCounts,
  trirTrend,
  type DrillTarget,
  type ExposureDimension,
  type ExposureProjectRow,
} from "@/lib/portfolio/exposure.rules";
import { portfolioExposureQueryOptions } from "@/lib/portfolio/portfolio-query";
import { cn } from "@/lib/utils";

const HEAT_CLASS: Record<number, string> = {
  0: "bg-muted/40 text-muted-foreground",
  1: "bg-warning/10 text-foreground",
  2: "bg-warning/25 text-foreground",
  3: "bg-destructive/25 text-foreground",
  4: "bg-destructive/45 text-foreground",
};

/** Typed-route escape hatch: drill targets are built as plain data in rules. */
function DrillLink({
  target,
  label,
  className,
  children,
}: {
  target: DrillTarget;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={target.to as never}
      search={target.search as never}
      aria-label={label}
      className={cn("rounded-md underline-offset-4 hover:underline", className)}
    >
      {children}
    </Link>
  );
}

function Count({ value }: { value: number }) {
  const { locale } = useI18n();
  return (
    <span dir="ltr" className="tabular-nums">
      {formatNumber(value, locale)}
    </span>
  );
}

export function ExposureSection() {
  const { t, locale } = useI18n();
  const query = useQuery(portfolioExposureQueryOptions());
  const data = query.data;

  const rows = useMemo<ExposureProjectRow[]>(
    () => sortByExposure(data?.by_project ?? []),
    [data?.by_project],
  );
  const maxima = useMemo(() => dimensionMaxima(rows), [rows]);
  const trend = trirTrend(data?.trir_current ?? null, data?.trir_prior ?? null);
  const severities = orderedCounts(data?.incidents_by_severity, SEVERITY_ORDER);
  const punch = orderedCounts(data?.punch_open, PUNCH_ORDER);
  const punchTotal = totalCounts(data?.punch_open);
  const ncrs = orderedCounts(data?.ncr_open_by_status, ["open", "in_progress"] as const);
  const ncrTotal = totalCounts(data?.ncr_open_by_status);

  const TrendIcon =
    trend.direction === "up" ? ArrowUpRight : trend.direction === "down" ? ArrowDownRight : Minus;
  const trendTone =
    trend.tone === "bad"
      ? "text-destructive"
      : trend.tone === "good"
        ? "text-success"
        : "text-muted-foreground";

  const dimHeader: Record<ExposureDimension, string> = {
    incidents_open: t("portfolioMod.exposure.heat.incidents"),
    punch_a_open: t("portfolioMod.exposure.heat.punchA"),
    punch_b_open: t("portfolioMod.exposure.heat.punchB"),
    ncr_open: t("portfolioMod.exposure.heat.ncrs"),
    hold_points_open: t("portfolioMod.exposure.heat.holdPoints"),
  };

  const dimDrill = (dim: ExposureDimension, projectId: string): DrillTarget => {
    switch (dim) {
      case "incidents_open":
        return incidentDrill(projectId);
      case "punch_a_open":
        return punchDrill(projectId, "A");
      case "punch_b_open":
        return punchDrill(projectId, "B");
      case "ncr_open":
        return ncrDrill(projectId, "open");
      case "hold_points_open":
        return holdPointDrill(projectId);
    }
  };

  if (query.isLoading) {
    return (
      <section className="space-y-4">
        <SectionHeader title={t("portfolioMod.exposure.heading")} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="space-y-3 p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-20" />
            </Card>
          ))}
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="space-y-4">
        <SectionHeader title={t("portfolioMod.exposure.heading")} />
        <EmptyState
          icon={ShieldAlert}
          title={t("portfolioMod.exposure.empty.title")}
          description={t("portfolioMod.exposure.empty.description")}
        />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("portfolioMod.exposure.heading")}
        description={t("portfolioMod.exposure.description")}
      />

      {/* ---------------------------------------------------------- HSE strip */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldAlert className="size-4" aria-hidden="true" />
            {t("portfolioMod.exposure.incidentsOpen")}
          </div>
          <DrillLink
            target={incidentDrill(null)}
            label={t("portfolioMod.exposure.drill")}
            className="text-3xl font-semibold"
          >
            <Count value={data.incidents_open} />
          </DrillLink>
          <ul className="flex flex-wrap gap-2">
            {severities.map((s) => (
              <li key={s.key}>
                <DrillLink
                  target={incidentDrill(null)}
                  label={t("portfolioMod.exposure.drill")}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                    s.count > 0
                      ? "bg-destructive/20 text-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <span>{t(`portfolioMod.exposure.severities.${s.key}`)}</span>
                  <Count value={s.count} />
                </DrillLink>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-2 p-4">
          <div className="text-sm text-muted-foreground">{t("portfolioMod.exposure.trir")}</div>
          <div className="flex items-baseline gap-2">
            <span dir="ltr" className="text-3xl font-semibold tabular-nums">
              {data.trir_current === null
                ? "—"
                : formatNumber(data.trir_current, locale, { maximumFractionDigits: 2 })}
            </span>
            <span className={cn("inline-flex items-center gap-1 text-xs", trendTone)}>
              <TrendIcon className="size-4" aria-hidden="true" />
              {t(`portfolioMod.exposure.trend.${trend.direction}`)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {data.exposure_hours_current > 0
              ? t("portfolioMod.exposure.trirHint", {
                  hours: formatNumber(data.exposure_hours_current, locale),
                })
              : t("portfolioMod.exposure.trirNone")}
          </p>
        </Card>

        <Card className="space-y-2 p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <HardHat className="size-4" aria-hidden="true" />
            {t("portfolioMod.exposure.daysSince")}
          </div>
          <ul className="space-y-1 text-sm">
            {rows.map((r) => (
              <li key={r.project_id} className="flex items-center justify-between gap-3">
                <span className="truncate">{r.project_code}</span>
                <span dir="ltr" className="tabular-nums text-muted-foreground">
                  {r.days_since_last_incident === null
                    ? t("portfolioMod.exposure.daysSinceNone")
                    : formatNumber(r.days_since_last_incident, locale)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* ------------------------------------------------------ Quality strip */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("portfolioMod.exposure.punchOpen")}</span>
            <Count value={punchTotal} />
          </div>
          <ul className="space-y-2">
            {punch.map((p) => (
              <li key={p.key}>
                <DrillLink
                  target={punchDrill(null, p.key)}
                  label={t("portfolioMod.exposure.drill")}
                  className="flex items-center gap-3 text-sm"
                >
                  <span className="w-40 shrink-0">
                    {t(`portfolioMod.exposure.punch${p.key}` as never)}
                  </span>
                  <span
                    className={cn(
                      "h-3 rounded-sm",
                      p.key === "A"
                        ? "bg-destructive"
                        : p.key === "B"
                          ? "bg-warning"
                          : "bg-muted-foreground/50",
                    )}
                    style={{
                      width: `${punchTotal > 0 ? Math.max(4, (p.count / punchTotal) * 100) : 4}%`,
                    }}
                    aria-hidden="true"
                  />
                  <Count value={p.count} />
                </DrillLink>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("portfolioMod.exposure.ncrOpen")}</span>
            <Count value={ncrTotal} />
          </div>
          <ul className="space-y-2 text-sm">
            {ncrs.map((s) => (
              <li key={s.key}>
                <DrillLink
                  target={ncrDrill(null, s.key)}
                  label={t("portfolioMod.exposure.drill")}
                  className="flex items-center justify-between gap-3"
                >
                  <span>{t(`portfolioMod.exposure.ncrStatus.${s.key}`)}</span>
                  <Count value={s.count} />
                </DrillLink>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-2 p-4">
          <div className="text-sm text-muted-foreground">
            {t("portfolioMod.exposure.holdPoints")}
          </div>
          <DrillLink
            target={holdPointDrill(null)}
            label={t("portfolioMod.exposure.drill")}
            className="block text-3xl font-semibold"
          >
            <Count value={data.hold_points_open} />
          </DrillLink>
          <p className="text-xs text-muted-foreground">
            {t("portfolioMod.exposure.holdPointsHint")}
          </p>
        </Card>
      </div>

      {/* --------------------------------------------------------- Heat table */}
      <Card className="overflow-x-auto p-0">
        <div className="space-y-1 p-4">
          <h3 className="text-sm font-semibold">{t("portfolioMod.exposure.heat.heading")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("portfolioMod.exposure.heat.description")}
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t("portfolioMod.exposure.heat.clean")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th scope="col" className="p-3 text-start">
                  {t("portfolioMod.exposure.heat.project")}
                </th>
                {EXPOSURE_DIMENSIONS.map((dim) => (
                  <th key={dim} scope="col" className="p-3 text-center">
                    {dimHeader[dim]}
                  </th>
                ))}
                <th scope="col" className="p-3 text-center">
                  {t("portfolioMod.exposure.heat.daysSince")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.project_id} className="border-b last:border-0">
                  <th scope="row" className="p-3 text-start font-medium">
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: row.project_id }}
                      className="underline-offset-4 hover:underline"
                    >
                      {row.project_code}
                    </Link>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {row.project_name}
                    </span>
                  </th>
                  {EXPOSURE_DIMENSIONS.map((dim) => (
                    <td key={dim} className="p-1 text-center">
                      <DrillLink
                        target={dimDrill(dim, row.project_id)}
                        label={t("portfolioMod.exposure.drill")}
                        className={cn(
                          "flex h-10 items-center justify-center rounded-md font-semibold",
                          HEAT_CLASS[heatLevel(row[dim], maxima[dim])],
                        )}
                      >
                        <Count value={row[dim]} />
                      </DrillLink>
                    </td>
                  ))}
                  <td className="p-3 text-center text-muted-foreground">
                    {row.days_since_last_incident === null ? (
                      "—"
                    ) : (
                      <Count value={row.days_since_last_incident} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowRight className="size-3 rtl:rotate-180" aria-hidden="true" />
        {t("portfolioMod.exposure.drill")}
      </p>
    </section>
  );
}
