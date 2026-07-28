import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, HardHat, Inbox, Truck, Wrench } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardQueryOptions } from "@/lib/dashboard-query";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard | GridMind EPC" },
      {
        name: "description",
        content: "Overview of active EPC projects across engineering, procurement, field, and O&M.",
      },
      { property: "og:title", content: "Dashboard | GridMind EPC" },
      {
        property: "og:description",
        content: "Overview of active EPC projects across engineering, procurement, field, and O&M.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useI18n();
  const { data, isLoading } = useQuery(dashboardQueryOptions());

  const punch = data?.openPunch;
  const tiles = [
    {
      label: t("dashboard.activeProjects"),
      value: data?.activeProjects ?? 0,
      hint: t("dashboard.activeProjectsHint"),
      icon: Activity,
      to: "/projects",
    },
    {
      label: t("dashboard.openPunchlist"),
      value: punch?.total ?? 0,
      hint: punch
        ? t("dashboard.punchBreakdown", { a: punch.a, b: punch.b, c: punch.c })
        : t("dashboard.openPunchlistHint"),
      icon: HardHat,
      to: "/qaqc/punch",
    },
    {
      label: t("dashboard.inTransit"),
      value: data?.inTransit ?? 0,
      hint: t("dashboard.inTransitHint"),
      icon: Truck,
      to: "/procurement/expediting",
    },
    {
      label: t("dashboard.omTickets"),
      value: data?.openTickets ?? 0,
      hint: t("dashboard.omTicketsHint"),
      icon: Wrench,
      to: "/om/service-tickets",
    },
  ] as const;

  return (
    <div className="page-shell">
      <PageHeader title={t("dashboard.title")} description={t("dashboard.subtitle")} />

      <KpiGrid>
        {tiles.map((kpi) => (
          <Link key={kpi.label} to={kpi.to} className="rounded-lg focus-visible:outline-none">
            <KpiTile
              label={kpi.label}
              value={String(kpi.value)}
              hint={kpi.hint}
              icon={kpi.icon}
              isLoading={isLoading}
              className="h-full hover:border-primary/40"
            />
          </Link>
        ))}
      </KpiGrid>

      <section aria-label={t("dashboard.recentActivity")}>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("dashboard.recentActivity")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (data?.activity?.length ?? 0) === 0 ? (
              <EmptyState
                icon={Inbox}
                title={t("dashboard.noActivity")}
                description={t("dashboard.noActivityDescription")}
                compact
              />
            ) : (
              <ul className="divide-y divide-border">
                {data!.activity.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-foreground">{item.actor}</span>{" "}
                      <span className="text-muted-foreground">
                        {t(`activity.actions.${item.actionKey}`, {
                          defaultValue: item.action.toLowerCase(),
                        })}
                      </span>{" "}
                      <span className="text-foreground">
                        {t(`activity.entities.${item.entityKey}`, { defaultValue: item.entity })}
                      </span>
                    </span>
                    <time className="text-xs text-muted-foreground" dateTime={item.created_at}>
                      {item.when}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
