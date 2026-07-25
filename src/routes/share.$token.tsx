// P-115 — Public tokenized share view. Outside the auth shell. No indexable
// metadata, no data leaked on invalid/revoked/expired.
import { createFileRoute, useLoaderData, notFound } from "@tanstack/react-router";
import { format } from "date-fns";
import { Ban, Clock, Link2Off, ShieldAlert } from "lucide-react";

import { resolveShareLink, type ShareLinkResolveResult } from "@/lib/share-links.functions";

const TOKEN_RE = /^[a-f0-9]{64}$/i;

async function hashTokenBrowserOrNode(token: string): Promise<string> {
  // Prefer Web Crypto (works on Cloudflare Workers).
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const bytes = new TextEncoder().encode(token);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}

export const Route = createFileRoute("/share/$token")({
  head: () => ({
    meta: [
      { title: "Shared project view — GridMind EPC" },
      {
        name: "description",
        content: "Read-only project view shared by GridMind EPC.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  loader: async ({ params }): Promise<ShareLinkResolveResult> => {
    if (!TOKEN_RE.test(params.token)) {
      return { ok: false, reason: "invalid" };
    }
    const tokenHash = await hashTokenBrowserOrNode(params.token.toLowerCase());
    try {
      return await resolveShareLink({ data: { tokenHash } });
    } catch {
      return { ok: false, reason: "invalid" };
    }
  },
  component: SharePage,
});

function SharePage() {
  const result = useLoaderData({ from: "/share/$token" }) as ShareLinkResolveResult;

  if (!result.ok) {
    return <StateShell state={result.reason} />;
  }
  return <FeedView feed={result} />;
}

// ---------------------------------------------------------------------------
// Branded shell + states
// ---------------------------------------------------------------------------

function StateShell({ state }: { state: "invalid" | "revoked" | "expired" }) {
  const copy = {
    invalid: {
      icon: <Link2Off className="h-8 w-8 text-muted-foreground" />,
      title: "Link not valid",
      body: "This share link isn't recognized. Ask the project team for a fresh link.",
    },
    revoked: {
      icon: <Ban className="h-8 w-8 text-destructive" />,
      title: "Link revoked",
      body: "This share link has been revoked. Ask the project team for a new link.",
    },
    expired: {
      icon: <Clock className="h-8 w-8 text-muted-foreground" />,
      title: "Link expired",
      body: "This share link has expired. Ask the project team for a new link.",
    },
  }[state];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BrandBar />
      <main className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-6 py-24 text-center">
        <div className="rounded-full border border-border bg-card p-4">{copy.icon}</div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {copy.title}
        </h1>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
      </main>
    </div>
  );
}

type Feed = Extract<ShareLinkResolveResult, { ok: true }>;

function BrandBar({ feed }: { feed?: Feed } = {}) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          {feed?.company.branding.logo_url ? (
            <img
              src={feed.company.branding.logo_url}
              alt={feed.company.name}
              className="h-8 w-auto"
            />
          ) : (
            <span className="font-display text-lg font-semibold tracking-tight">
              GridMind EPC
            </span>
          )}
          {feed ? (
            <span className="text-sm text-muted-foreground">
              {feed.company.name}
            </span>
          ) : null}
        </div>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Shared view
        </span>
      </div>
    </header>
  );
}

function FeedView({ feed }: { feed: Feed }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <BrandBar feed={feed} />
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
        <section className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {feed.role === "lender_viewer" ? "Lender view" : "Investor view"}
          </span>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {feed.label}
          </h1>
          <p className="text-sm text-muted-foreground">
            Access valid through {format(new Date(feed.expires_at), "PPP")} · Read-only
          </p>
        </section>

        {feed.projects.length === 0 ? (
          <EmptySection label="No projects in this view." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {feed.projects.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Project
                </div>
                <div className="mt-1 text-base font-semibold">{p.name}</div>
                {p.phase ? (
                  <div className="mt-2 inline-flex rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    {p.phase}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {feed.sections.includes("kpis") ? <KpiSection feed={feed} /> : null}
        {feed.sections.includes("milestones") ? <MilestoneSection feed={feed} /> : null}
        {feed.sections.includes("photos") ? <PhotoSection feed={feed} /> : null}
        {feed.role === "lender_viewer" && feed.sections.includes("financials") ? (
          <FinancialsSection feed={feed} />
        ) : null}
      </main>
      <footer className="border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted-foreground">
          {feed.company.branding.footer_text ??
            `© ${new Date().getFullYear()} ${feed.company.name}. Shared securely by GridMind EPC.`}
        </div>
      </footer>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="font-display text-lg font-semibold tracking-tight">
      {title}
    </h2>
  );
}

function EmptySection({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function fmtMoney(n: number | null | undefined, currency: string | null): string {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 0,
    }).format(Number(n));
  } catch {
    return `${currency ?? ""} ${Number(n).toFixed(0)}`;
  }
}

function projectName(feed: Feed, id: string): string {
  return feed.projects.find((p) => p.id === id)?.name ?? id.slice(0, 8);
}

function KpiSection({ feed }: { feed: Feed }) {
  const rows = feed.kpis ?? [];
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="Project KPIs" />
      {rows.length === 0 ? (
        <EmptySection label="No KPI snapshots published yet." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((k) => (
            <div key={k.project_id} className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {projectName(feed, k.project_id)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                As of {k.as_of_date ? format(new Date(k.as_of_date), "PP") : "—"}
              </div>
              <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
                <Kpi label="SPI" value={fmtNum(k.spi, 2)} />
                <Kpi label="CPI" value={fmtNum(k.cpi, 2)} />
                <Kpi label="EV" value={fmtNum(k.ev, 0)} />
                <Kpi label="BAC" value={fmtNum(k.bac, 0)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-base font-semibold text-foreground">{value}</span>
    </div>
  );
}

function MilestoneSection({ feed }: { feed: Feed }) {
  const rows = feed.milestones ?? [];
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="Milestones" />
      {rows.length === 0 ? (
        <EmptySection label="No milestones published yet." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Project</th>
                <th className="px-4 py-2 text-left">Phase</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Planned</th>
                <th className="px-4 py-2 text-left">Actual</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-4 py-2">{projectName(feed, m.project_id)}</td>
                  <td className="px-4 py-2">{m.phase}</td>
                  <td className="px-4 py-2 text-muted-foreground">{m.status ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {m.planned_date ? format(new Date(m.planned_date), "PP") : "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {m.actual_date ? format(new Date(m.actual_date), "PP") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PhotoSection({ feed }: { feed: Feed }) {
  const rows = feed.photos ?? [];
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="Site photos" />
      {rows.length === 0 ? (
        <EmptySection label="No photos published yet." />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {rows.map((p) =>
            p.signed_url ? (
              <figure
                key={p.id}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                <img
                  src={p.signed_url}
                  alt={p.caption ?? "Site photo"}
                  loading="lazy"
                  className="aspect-video w-full object-cover"
                />
                <figcaption className="p-2 text-xs text-muted-foreground">
                  {p.caption ?? "—"}
                  {p.taken_at ? ` · ${format(new Date(p.taken_at), "PP")}` : ""}
                </figcaption>
              </figure>
            ) : null,
          )}
        </div>
      )}
    </section>
  );
}

function FinancialsSection({ feed }: { feed: Feed }) {
  const rows = feed.financials ?? [];
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="Financials" />
      <p className="text-xs text-muted-foreground">
        Lender view · aggregated cash flow to date
      </p>
      {rows.length === 0 ? (
        <EmptySection label="No cash flow published yet." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Project</th>
                <th className="px-4 py-2 text-right">Inflows</th>
                <th className="px-4 py-2 text-right">Outflows</th>
                <th className="px-4 py-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.project_id} className="border-t border-border">
                  <td className="px-4 py-2">{projectName(feed, f.project_id)}</td>
                  <td className="px-4 py-2 text-right">
                    {fmtMoney(f.inflow_total, f.currency_code)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {fmtMoney(f.outflow_total, f.currency_code)}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">
                    {fmtMoney(f.net, f.currency_code)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
