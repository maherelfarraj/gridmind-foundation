// P-042 — React Query hooks for CRM.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  convertLead,
  createLead,
  createOpportunity,
  getCrmKpis,
  listLeads,
  listOpportunities,
  moveOpportunityStage,
  STAGE_PROBABILITY,
  type OpportunityRow,
  type OpportunityStage,
} from "@/lib/crm.functions";

// ---- Query options ---------------------------------------------------------
export function opportunitiesQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listOpportunities>>,
) {
  return queryOptions({
    queryKey: ["crm", "opportunities"],
    queryFn: () => fn({ data: {} }),
    staleTime: 30_000,
  });
}

export function leadsQueryOptions(fn: ReturnType<typeof useServerFn<typeof listLeads>>) {
  return queryOptions({
    queryKey: ["crm", "leads"],
    queryFn: () => fn({ data: {} }),
    staleTime: 30_000,
  });
}

export function crmKpisQueryOptions(fn: ReturnType<typeof useServerFn<typeof getCrmKpis>>) {
  return queryOptions({
    queryKey: ["crm", "kpis"],
    queryFn: () => fn({ data: {} }),
    staleTime: 60_000,
  });
}

// ---- Mutations -------------------------------------------------------------
export function useMoveOpportunityStage() {
  const qc = useQueryClient();
  const fn = useServerFn(moveOpportunityStage);
  return useMutation({
    mutationFn: (vars: { id: string; stage: OpportunityStage; lossReason?: string }) =>
      fn({ data: vars }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["crm", "opportunities"] });
      const prev = qc.getQueryData<OpportunityRow[]>(["crm", "opportunities"]);
      if (prev) {
        qc.setQueryData<OpportunityRow[]>(
          ["crm", "opportunities"],
          prev.map((o) =>
            o.id === vars.id
              ? {
                  ...o,
                  stage: vars.stage,
                  probability: STAGE_PROBABILITY[vars.stage],
                  loss_reason: vars.stage === "lost" ? (vars.lossReason ?? null) : null,
                }
              : o,
          ),
        );
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["crm", "opportunities"], ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed to update stage");
    },
    onSuccess: () => {
      toast.success("Stage updated");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["crm", "opportunities"] });
      qc.invalidateQueries({ queryKey: ["crm", "kpis"] });
    },
  });
}

export function useCreateOpportunity() {
  const qc = useQueryClient();
  const fn = useServerFn(createOpportunity);
  return useMutation({
    mutationFn: (vars: any) => fn({ data: vars }),
    onSuccess: () => {
      toast.success("Opportunity created");
      qc.invalidateQueries({ queryKey: ["crm", "opportunities"] });
      qc.invalidateQueries({ queryKey: ["crm", "kpis"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to create"),
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  const fn = useServerFn(createLead);
  return useMutation({
    mutationFn: (vars: any) => fn({ data: vars }),
    onSuccess: () => {
      toast.success("Lead created");
      qc.invalidateQueries({ queryKey: ["crm", "leads"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to create lead"),
  });
}

export function useConvertLead() {
  const qc = useQueryClient();
  const fn = useServerFn(convertLead);
  return useMutation({
    mutationFn: (vars: { leadId: string }) => fn({ data: vars }),
    onSuccess: () => {
      toast.success("Lead converted → opportunity");
      qc.invalidateQueries({ queryKey: ["crm"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to convert"),
  });
}
