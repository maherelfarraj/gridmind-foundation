import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, HardHat, Truck, Wrench } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard | GridMind EPC" },
      {
        name: "description",
        content:
          "Overview of active EPC projects across engineering, procurement, field, and O&M.",
      },
      { property: "og:title", content: "Dashboard | GridMind EPC" },
      {
        property: "og:description",
        content:
          "Overview of active EPC projects across engineering, procurement, field, and O&M.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

interface Kpi {
  label: string;
  value: string;
  helper: string;
  icon: typeof Activity;
}

const KPIS: Kpi[] = [
  { label: "Active Projects", value: "0", helper: "Across all lifecycle stages", icon: Activity },
  { label: "Open Punchlist", value: "0", helper: "Items awaiting close-out", icon: HardHat },
  { label: "Procurement in Transit", value: "0", helper: "POs shipped, not received", icon: Truck },
  { label: "O&M Tickets", value: "0", helper: "Open across sites", icon: Wrench },
];

function DashboardPage() {
  const [loadingActivity, setLoadingActivity] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setLoadingActivity(false), 600);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Overview of active EPC projects across engineering, procurement, field, and O&amp;M.
        </p>
      </header>

      <section
        aria-label="Key performance indicators"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {KPIS.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {kpi.label}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-foreground">{kpi.value}</div>
                <p className="mt-1 text-xs text-muted-foreground">{kpi.helper}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section aria-label="Recent activity">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-foreground">
              Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingActivity ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <p className="text-sm font-medium text-foreground">
                  No recent activity
                </p>
                <p className="text-xs text-muted-foreground">
                  New events will appear here as your team works across projects.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
