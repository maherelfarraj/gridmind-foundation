import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createFileRoute("/design-system")({
  head: () => ({
    meta: [
      { title: "Design System · GridMind EPC" },
      {
        name: "description",
        content:
          "GridMind EPC design tokens: semantic color palette, typography scale, and theme switching.",
      },
      { property: "og:title", content: "Design System · GridMind EPC" },
      {
        property: "og:description",
        content: "Explore GridMind EPC's semantic tokens, typography, and light/dark theme system.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DesignSystemPage,
});

type Swatch = { name: string; bg: string; fg?: string; border?: boolean };

const surfaces: Swatch[] = [
  { name: "background", bg: "bg-background", fg: "text-foreground", border: true },
  { name: "card", bg: "bg-card", fg: "text-card-foreground", border: true },
  { name: "popover", bg: "bg-popover", fg: "text-popover-foreground", border: true },
  { name: "muted", bg: "bg-muted", fg: "text-muted-foreground" },
];

const brand: Swatch[] = [
  { name: "primary", bg: "bg-primary", fg: "text-primary-foreground" },
  { name: "secondary", bg: "bg-secondary", fg: "text-secondary-foreground" },
  { name: "accent", bg: "bg-accent", fg: "text-accent-foreground" },
  { name: "destructive", bg: "bg-destructive", fg: "text-destructive-foreground" },
];

const lines: Swatch[] = [
  { name: "border", bg: "bg-border" },
  { name: "input", bg: "bg-input" },
  { name: "ring", bg: "bg-ring" },
];

const sidebar: Swatch[] = [
  {
    name: "sidebar-background",
    bg: "bg-sidebar-background",
    fg: "text-sidebar-foreground",
    border: true,
  },
  { name: "sidebar-primary", bg: "bg-sidebar-primary", fg: "text-sidebar-primary-foreground" },
  { name: "sidebar-accent", bg: "bg-sidebar-accent", fg: "text-sidebar-accent-foreground" },
  { name: "sidebar-border", bg: "bg-sidebar-border" },
];

const charts: Swatch[] = [
  { name: "chart-1", bg: "bg-chart-1" },
  { name: "chart-2", bg: "bg-chart-2" },
  { name: "chart-3", bg: "bg-chart-3" },
  { name: "chart-4", bg: "bg-chart-4" },
  { name: "chart-5", bg: "bg-chart-5" },
];

function SwatchGrid({ title, items }: { title: string; items: Swatch[] }) {
  return (
    <section className="space-y-3">
      <h3 className="font-display text-sm font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((s) => (
          <div
            key={s.name}
            className={`flex h-24 flex-col justify-between rounded-md p-3 ${s.bg} ${s.fg ?? ""} ${
              s.border ? "border border-border" : ""
            }`}
          >
            <span className="text-xs font-medium">{s.name}</span>
            <span className="font-mono text-[10px] opacity-70">bg-{s.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DesignSystemPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-12 px-4 py-12 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">GridMind EPC</p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">Design System</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Semantic tokens, typography, and theming for an industrial EPC surface. Use these
              tokens only — never raw hex or arbitrary color values.
            </p>
          </div>
          <ThemeToggle />
        </header>

        <div className="space-y-10">
          <SwatchGrid title="Surfaces" items={surfaces} />
          <SwatchGrid title="Brand" items={brand} />
          <SwatchGrid title="Lines & focus" items={lines} />
          <SwatchGrid title="Sidebar" items={sidebar} />
          <SwatchGrid title="Charts" items={charts} />
        </div>

        <section className="space-y-4">
          <h2 className="font-display text-xl font-semibold">Typography</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-md border border-border bg-card p-4">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                font-sans · Inter
              </p>
              <p className="mt-3 font-sans text-2xl text-foreground">Grid stability, quantified.</p>
              <p className="mt-2 text-sm text-muted-foreground">Body & UI text.</p>
            </div>
            <div className="rounded-md border border-border bg-card p-4">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                font-display · Space Grotesk
              </p>
              <p className="mt-3 font-display text-2xl font-bold text-foreground">GridMind EPC</p>
              <p className="mt-2 text-sm text-muted-foreground">Brand & display headings.</p>
            </div>
            <div className="rounded-md border border-border bg-card p-4">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                font-alt · DM Sans
              </p>
              <p className="mt-3 font-alt text-2xl text-foreground">Alternate long-form.</p>
              <p className="mt-2 text-sm text-muted-foreground">Documents & reports.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-xl font-semibold">Buttons</h2>
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
