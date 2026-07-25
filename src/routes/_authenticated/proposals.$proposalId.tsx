// P-045 — Proposal builder route.
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, GitBranch, RefreshCw } from "lucide-react";

import { ArrayConfigForm } from "@/components/proposals/ArrayConfigForm";
import { EsignCard } from "@/components/proposals/EsignCard";
import { ExportPdfButton } from "@/components/proposals/ExportPdfButton";
import { ExportPptxButton } from "@/components/proposals/ExportPptxButton";

import { LineItemsGrid } from "@/components/proposals/LineItemsGrid";
import { PricingApprovalCard } from "@/components/proposals/PricingApprovalCard";
import { ProposalHeaderForm } from "@/components/proposals/ProposalHeaderForm";
import { YieldSimulationCard } from "@/components/proposals/YieldSimulationCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { proposalDetailQueryOptions, useCreateProposalVersion } from "@/lib/proposal-query";
import { getProposal } from "@/lib/proposal.functions";
import { getCurrentUserRoles } from "@/lib/user-roles.functions";

export const Route = createFileRoute("/_authenticated/proposals/$proposalId")({
  head: ({ params }) => ({
    meta: [
      { title: `Proposal — GridMind EPC` },
      {
        name: "description",
        content:
          "Edit scope & pricing, configure the PV array, and run the 8760-hour yield simulation.",
      },
      {
        property: "og:title",
        content: `Proposal ${params.proposalId.slice(0, 8)} — GridMind`,
      },
      {
        property: "og:description",
        content: "Deterministic yield simulation and versioned pricing for EPC proposals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ context, params }) => {
    const fn = getProposal;
    await context.queryClient.ensureQueryData({
      queryKey: ["proposal", params.proposalId],
      queryFn: () => fn({ data: { proposalId: params.proposalId } }),
    });
  },
  component: ProposalBuilderPage,
});

function statusLabel(s: string) {
  return s.replace("_", " ");
}

function ProposalBuilderPage() {
  const { proposalId } = Route.useParams();
  const router = useRouter();
  const fn = useServerFn(getProposal);
  const q = useSuspenseQuery(proposalDetailQueryOptions(fn, proposalId));
  const proposal = q.data;

  const rolesFn = useServerFn(getCurrentUserRoles);
  const rolesQuery = useQuery({
    queryKey: ["me", "roles"],
    queryFn: () => rolesFn(),
    staleTime: 60_000,
  });
  const roles = new Set((rolesQuery.data ?? []).map((r) => r.role));
  const canWrite = roles.has("sales") || roles.has("company_admin") || roles.has("super_admin");
  const isFinanceAdmin = roles.has("finance_admin") || roles.has("super_admin");
  const isCompanyAdmin = roles.has("company_admin") || roles.has("super_admin");
  const isReadOnlyStatus = proposal && !["draft", "in_review"].includes(proposal.status);
  const readOnly = !canWrite || !!isReadOnlyStatus;

  const version = useCreateProposalVersion(proposalId);

  if (!proposal) return <ProposalNotFound />;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {proposal.opportunity_id ? (
            <Link
              to="/crm/opportunities/$opportunityId"
              params={{ opportunityId: proposal.opportunity_id }}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <ArrowLeft size={14} aria-hidden />
              Back to opportunity
            </Link>
          ) : (
            <Link to="/proposals" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft size={14} aria-hidden />
              All proposals
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">v{proposal.version}</Badge>
          <Badge variant="outline">{statusLabel(proposal.status)}</Badge>
          {canWrite && proposal.status !== "draft" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                version.mutate(undefined, {
                  onSuccess: (res: any) =>
                    router.navigate({
                      to: "/proposals/$proposalId",
                      params: { proposalId: res.id },
                    }),
                })
              }
              disabled={version.isPending}
            >
              <GitBranch size={14} aria-hidden />
              {version.isPending ? "Creating…" : "New version"}
            </Button>
          )}
          <ExportPdfButton
            proposalId={proposalId}
            companyId={proposal.company_id}
            projectId={proposal.project_id}
          />
          <ExportPptxButton
            proposalId={proposalId}
            companyId={proposal.company_id}
            projectId={proposal.project_id}
          />

          <Button size="sm" variant="ghost" onClick={() => router.invalidate()}>
            <RefreshCw size={14} aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      {isReadOnlyStatus && (
        <Card className="border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          This proposal is <strong>{statusLabel(proposal.status)}</strong> and locked. Create a new
          version to change pricing or configuration.
        </Card>
      )}

      <ProposalHeaderForm proposal={proposal} readOnly={readOnly} />
      <LineItemsGrid proposal={proposal} readOnly={readOnly} />
      <ArrayConfigForm proposal={proposal} readOnly={readOnly} />
      <YieldSimulationCard proposal={proposal} readOnly={readOnly} />
      <PricingApprovalCard
        proposalId={proposalId}
        canWrite={canWrite}
        isFinanceAdmin={isFinanceAdmin}
      />
      <EsignCard proposal={proposal} canWrite={canWrite} isCompanyAdmin={isCompanyAdmin} />
    </div>
  );
}

function ProposalNotFound() {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h2 className="mb-2 text-lg font-semibold text-foreground">Proposal not found</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        This proposal doesn’t exist or you don’t have access to it.
      </p>
      <Link to="/proposals" className="text-sm text-primary hover:underline">
        Back to proposals
      </Link>
    </div>
  );
}
