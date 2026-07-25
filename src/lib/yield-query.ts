// P-056 — TanStack Query hooks for yield scenarios.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  deleteYieldScenario,
  duplicateYieldScenario,
  estimateYieldScenario,
  getEngineeringYieldKpi,
  getMyYieldRoles,
  importPvsystScenario,
  listYieldScenarios,
  saveYieldScenario,
  type YieldParams,
} from "@/lib/yield.functions";

export function yieldScenariosQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listYieldScenarios>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["yield-scenarios", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 15_000,
  });
}

export function yieldRolesQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getMyYieldRoles>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["yield-roles", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 5 * 60_000,
  });
}

export function useSaveYieldScenario(projectId: string) {
  const fn = useServerFn(saveYieldScenario);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; scenarioName: string; params: YieldParams }) =>
      fn({ data: { projectId, ...input } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["yield-scenarios", projectId] });
      toast.success("Scenario saved");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Save failed"),
  });
}

export function useEstimateYieldScenario(projectId: string) {
  const fn = useServerFn(estimateYieldScenario);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string }) => fn({ data: { projectId, id: input.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["yield-scenarios", projectId] });
      toast.success("Preliminary estimate updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Estimate failed"),
  });
}

export function useDuplicateYieldScenario(projectId: string) {
  const fn = useServerFn(duplicateYieldScenario);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; newName: string }) => fn({ data: { projectId, ...input } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["yield-scenarios", projectId] });
      toast.success("Scenario duplicated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Duplicate failed"),
  });
}

export function useDeleteYieldScenario(projectId: string) {
  const fn = useServerFn(deleteYieldScenario);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string }) => fn({ data: { projectId, id: input.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["yield-scenarios", projectId] });
      toast.success("Scenario deleted");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Delete failed"),
  });
}

export function useImportPvsystScenario(projectId: string) {
  const fn = useServerFn(importPvsystScenario);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      scenarioName: string;
      documentId?: string;
      metrics: {
        p50_mwh: number;
        p90_mwh: number;
        pr_pct: number;
        specific_yield_kwh_kwp: number;
      };
    }) => fn({ data: { projectId, ...input } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["yield-scenarios", projectId] });
      toast.success("PVsyst scenario imported");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Import failed"),
  });
}

export function useEngineeringYieldKpi(projectId: string) {
  const fn = useServerFn(getEngineeringYieldKpi);
  return {
    queryOptions: queryOptions({
      queryKey: ["yield-kpi", projectId],
      queryFn: () => fn({ data: { projectId } }),
      staleTime: 60_000,
    }),
  };
}
