import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, HardHat, Inbox, Truck, Wrench } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";

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

const KPIS = [
  { label: "Active projects", value: "0", hint: "Across all lifecycle stages", icon: Activity },
  { label: "Open punchlist", value: "0", hint: "Items awaiting close-out", icon: HardHat },
  { label: "In transit", value: "0", hint: "POs shipped, not received", icon: Truck },
  { label: "O&M tickets", value: "0", hint: "Open across sites", icon: Wrench },
] as const;

function DashboardPage() {
  const [loadingActivity, setLoadingActivity] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setLoadingActivity(false), 600);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="page-shell">
      <PageHeader
        title="Dashboard"
        description="Overview of active EPC projects across engineering, procurement, field, and O&M."
      />

      <KpiGrid>
        {KPIS.map((kpi) => (
          <KpiTile
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            hint={kpi.hint}
            icon={kpi.icon}
          />
        ))}
      </KpiGrid>

      <section aria-label="Recent activity">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingActivity ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              <EmptyState
                icon={Inbox}
                title="No recent activity"
                description="New events will appear here as your team works across projects."
                compact
              />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
