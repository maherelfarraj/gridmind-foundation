// P-045 — React Query hooks for proposal builder.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  createProposal,
  createProposalVersion,
  decidePricingApproval,
  getPricingChecklist,
  getProposal,
  listProposals,
  runYieldStub,
  saveArrayConfig,
  saveLineItems,
  saveProposalHeader,
  submitPricingApproval,
} from "@/lib/proposal.functions";

export function proposalDetailQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getProposal>>,
  id: string,
) {
  return queryOptions({
    queryKey: ["proposal", id],
    queryFn: () => fn({ data: { proposalId: id } }),
    staleTime: 10_000,
  });
}

export function proposalsListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listProposals>>,
  opportunityId?: string,
) {
  return queryOptions({
    queryKey: ["proposals", opportunityId ?? "all"],
    queryFn: () => fn({ data: opportunityId ? { opportunityId } : {} }),
    staleTime: 15_000,
  });
}

function useInvalidateProposal(id: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["proposal", id] });
    qc.invalidateQueries({ queryKey: ["proposals"] });
  };
}

export function useCreateProposal() {
  const fn = useServerFn(createProposal);
  return useMutation({
    mutationFn: (vars: {
      opportunityId?: string;
      projectId?: string;
      title?: string;
      currencyCode?: string;
    }) => fn({ data: vars }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Create failed"),
  });
}

export function useSaveProposalHeader(id: string) {
  const fn = useServerFn(saveProposalHeader);
  const invalidate = useInvalidateProposal(id);
  return useMutation({
    mutationFn: (vars: {
      title: string;
      currency_code: string;
      contingency_pct: number;
      margin_pct: number;
      valid_until: string | null;
      notes: string | null;
    }) => fn({ data: { proposalId: id, ...vars } }),
    onSuccess: () => {
      toast.success("Proposal saved");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Save failed"),
  });
}

export function useSaveLineItems(id: string) {
  const fn = useServerFn(saveLineItems);
  const invalidate = useInvalidateProposal(id);
  return useMutation({
    mutationFn: (items: Array<any>) => fn({ data: { proposalId: id, items } }),
    onSuccess: () => {
      toast.success("Line items saved");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Save failed"),
  });
}

export function useSaveArrayConfig(id: string) {
  const fn = useServerFn(saveArrayConfig);
  const invalidate = useInvalidateProposal(id);
  return useMutation({
    mutationFn: (array_config: any) => fn({ data: { proposalId: id, array_config } }),
    onSuccess: () => {
      toast.success("Array config saved");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Save failed"),
  });
}

export function useRunYieldStub(id: string) {
  const fn = useServerFn(runYieldStub);
  const invalidate = useInvalidateProposal(id);
  return useMutation({
    mutationFn: () => fn({ data: { proposalId: id } }),
    onSuccess: () => {
      toast.success("Yield simulation complete");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Simulation failed"),
  });
}

export function useCreateProposalVersion(id: string) {
  const fn = useServerFn(createProposalVersion);
  const invalidate = useInvalidateProposal(id);
  return useMutation({
    mutationFn: () => fn({ data: { proposalId: id } }),
    onSuccess: () => {
      toast.success("New version created");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Version failed"),
  });
}

export function pricingChecklistQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getPricingChecklist>>,
  id: string,
) {
  return queryOptions({
    queryKey: ["pricing-checklist", id],
    queryFn: () => fn({ data: { proposalId: id } }),
    staleTime: 5_000,
  });
}

function useInvalidateChecklist(id: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["pricing-checklist", id] });
    qc.invalidateQueries({ queryKey: ["proposal", id] });
  };
}

export function useSubmitPricingApproval(id: string) {
  const fn = useServerFn(submitPricingApproval);
  const invalidate = useInvalidateChecklist(id);
  return useMutation({
    mutationFn: () => fn({ data: { proposalId: id } }),
    onSuccess: () => {
      toast.success("Submitted to CFO for approval");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Submit failed"),
  });
}

export function useDecidePricingApproval(id: string) {
  const fn = useServerFn(decidePricingApproval);
  const invalidate = useInvalidateChecklist(id);
  return useMutation({
    mutationFn: (vars: { decision: "approve" | "reject"; comment?: string }) =>
      fn({ data: { proposalId: id, ...vars } }),
    onSuccess: (_r, vars) => {
      toast.success(vars.decision === "approve" ? "Pricing approved" : "Pricing rejected");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Action failed"),
  });
}
