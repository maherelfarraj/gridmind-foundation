import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "../__root";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard | GridMind EPC" },
      { name: "description", content: "Manage your EPC assessments, certificates, and properties." },
      { property: "og:title", content: "Dashboard | GridMind EPC" },
      { property: "og:description", content: "Manage your EPC assessments, certificates, and properties." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = useAuth();

  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">
          Signed in as {user?.email}
        </p>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <DashboardCard
          title="Properties"
          description="View and manage assessed properties."
          value="0"
        />
        <DashboardCard
          title="Certificates"
          description="Issued and pending EPC certificates."
          value="0"
        />
        <DashboardCard
          title="Assessments"
          description="Recent and scheduled assessments."
          value="0"
        />
      </div>
    </main>
  );
}

function DashboardCard({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-6 shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <p className="mt-1 text-3xl font-semibold text-foreground">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
