import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, HardHat, Inbox, Truck, Wrench } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardQueryOptions } from "@/lib/dashboard-query";

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
  const { data, isLoading } = useQuery(dashboardQueryOptions());

  const punch = data?.openPunch;
  const tiles = [
    {
      label: "Active projects",
      value: data?.activeProjects ?? 0,
      hint: "Across all lifecycle stages",
      icon: Activity,
      to: "/projects",
    },
    {
      label: "Open punchlist",
      value: punch?.total ?? 0,
      hint: punch ? `A ${punch.a} · B ${punch.b} · C ${punch.c}` : "Items awaiting close-out",
      icon: HardHat,
      to: "/qaqc/punch",
    },
    {
      label: "In transit",
      value: data?.inTransit ?? 0,
      hint: "POs issued, not fully received",
      icon: Truck,
      to: "/procurement/expediting",
    },
    {
      label: "O&M tickets",
      value: data?.openTickets ?? 0,
      hint: "Open across sites",
      icon: Wrench,
      to: "/om/service-tickets",
    },
  ] as const;

  return (
    <div className="page-shell">
      <PageHeader
        title="Dashboard"
        description="Overview of active EPC projects across engineering, procurement, field, and O&M."
      />

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

      <section aria-label="Recent activity">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent activity</CardTitle>
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
                title="No recent activity"
                description="New events will appear here as your team works across projects."
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
                      <span className="text-muted-foreground">{item.action.toLowerCase()}</span>{" "}
                      <span className="text-foreground">{item.entity}</span>
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
