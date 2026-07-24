// P-045 — Proposals list.
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO } from "date-fns";
import { RefreshCw, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExportPdfButton } from "@/components/proposals/ExportPdfButton";
import { ExportPptxButton } from "@/components/proposals/ExportPptxButton";

import { Card } from "@/components/ui/card";
import { proposalsListQueryOptions } from "@/lib/proposal-query";
import { listProposals } from "@/lib/proposal.functions";

export const Route = createFileRoute("/_authenticated/proposals/")({
  head: () => ({
    meta: [
      { title: "Proposals — GridMind EPC" },
      {
        name: "description",
        content:
          "Commercial proposals with 8760-hour yield simulation, versioning, and CFO-approved pricing.",
      },
      { property: "og:title", content: "Proposals — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Draft, price, and simulate EPC proposals with immutable versioned history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProposalsListPage,
});

function statusColor(status: string) {
  switch (status) {
    case "draft":
      return "bg-muted text-muted-foreground";
    case "in_review":
      return "bg-warning/15 text-warning";
    case "sent":
      return "bg-primary/15 text-primary";
    case "accepted":
      return "bg-success/15 text-success";
    case "rejected":
    case "superseded":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function ProposalsListPage() {
  const router = useRouter();
  const fn = useServerFn(listProposals);
  const q = useQuery(proposalsListQueryOptions(fn));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-brand text-2xl font-semibold text-foreground">
            Proposals
          </h1>
          <p className="text-sm text-muted-foreground">
            All commercial proposals across your opportunities.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.invalidate()}
        >
          <RefreshCw size={14} aria-hidden />
          Refresh
        </Button>
      </div>

      <Card className="p-0">
        {q.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : q.isError ? (
          <div className="p-6 text-sm text-destructive">
            Failed to load proposals.
          </div>
        ) : !q.data || q.data.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <FileText size={24} aria-hidden className="mx-auto mb-2 opacity-50" />
            No proposals yet. Create one from an opportunity.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs uppercase text-muted-foreground">
                  <th className="p-3 text-left font-medium">Title</th>
                  <th className="p-3 text-left font-medium">Opportunity</th>
                  <th className="p-3 text-left font-medium">Version</th>
                  <th className="p-3 text-left font-medium">Status</th>
                  <th className="p-3 text-right font-medium">Total</th>
                  <th className="p-3 text-left font-medium">Updated</th>
                  <th className="p-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 hover:bg-muted/20">
                    <td className="p-3">
                      <Link
                        to="/proposals/$proposalId"
                        params={{ proposalId: p.id }}
                        className="font-medium text-foreground hover:underline"
                      >
                        {p.title ?? "Untitled proposal"}
                      </Link>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {p.opportunity_id ? (
                        <Link
                          to="/crm/opportunities/$opportunityId"
                          params={{ opportunityId: p.opportunity_id }}
                          className="hover:underline"
                        >
                          {p.opportunity_name ?? "—"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3 tabular-nums">v{p.version}</td>
                    <td className="p-3">
                      <Badge className={statusColor(p.status)}>
                        {p.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: p.currency_code,
                        maximumFractionDigits: 0,
                      }).format(p.total)}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {format(parseISO(p.updated_at), "PP")}
                    </td>
                    <td className="p-3 text-right">
                      <div className="inline-flex gap-1">
                        <ExportPdfButton
                          proposalId={p.id}
                          companyId={p.company_id}
                          projectId={p.project_id}
                          size="icon"
                        />
                        <ExportPptxButton
                          proposalId={p.id}
                          companyId={p.company_id}
                          projectId={p.project_id}
                          size="icon"
                        />
                      </div>
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
