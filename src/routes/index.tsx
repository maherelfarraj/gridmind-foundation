import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "./__root";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GridMind EPC — Energy Performance Certificate Management" },
      {
        name: "description",
        content: "Streamline EPC assessments, certificates, and reporting with GridMind EPC.",
      },
      { property: "og:title", content: "GridMind EPC — Energy Performance Certificate Management" },
      {
        property: "og:description",
        content: "Streamline EPC assessments, certificates, and reporting with GridMind EPC.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const { user, isLoading } = useAuth();

  return (
    <div className="flex flex-col">
      <section className="relative overflow-hidden bg-background px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Energy Performance Certificates, simplified
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            GridMind EPC helps assessors, landlords, and property managers create, manage, and track
            EPC ratings from one secure workspace.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            {!isLoading && user ? (
              <Link to="/dashboard">
                <Button size="lg">Go to dashboard</Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button size="lg">Get started</Button>
                </Link>
                <Link to="/login">
                  <Button size="lg" variant="outline">
                    Sign in
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="border-t bg-muted/40 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            title="Assessment workflow"
            description="Capture property data, run SAP-style calculations, and generate recommendations in one place."
          />
          <FeatureCard
            title="Certificate management"
            description="Store, version, and export EPC certificates with full audit history."
          />
          <FeatureCard
            title="Analytics & reporting"
            description="Track rating trends, portfolio performance, and compliance deadlines."
          />
        </div>
      </section>
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border bg-background p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
