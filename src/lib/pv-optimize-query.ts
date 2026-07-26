// P-163 — TanStack Query wrappers for layout optimization runs.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { parseServerError } from "@/lib/pv-library-query";
import {
  applyOptimizationScenario,
  chooseOptimizationCandidate,
  getOptimizationApproval,
  listLayoutOptimizationRuns,
  runLayoutOptimization,
  submitOptimizationRun,
} from "@/lib/pv-optimize.functions";
import type { OptimizationResults } from "@/lib/pv/optimize";

export interface OptimizationRunView {
  id: string;
  project_id: string;
  run_ref: string;
  name: string;
  scenario_type: string;
  status: string;
  revision_code: string;
  weights: Record<string, number>;
  chosen_candidate: number | null;
  score: number | null;
  approval_instance_id: string | null;
  results: (OptimizationResults & { error?: string }) | null;
  created_at: string;
}

export function optimizationRunsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listLayoutOptimizationRuns>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["layout-optimization-runs", projectId],
    queryFn: async () => {
      const data = await fn({ data: { projectId } });
      return {
        canWrite: data.canWrite,
        runs: data.runs as unknown as OptimizationRunView[],
      };
    },
    staleTime: 15_000,
  });
}

export function optimizationApprovalQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getOptimizationApproval>>,
  runId: string | null,
) {
  return queryOptions({
    queryKey: ["layout-optimization-approval", runId],
    queryFn: () => fn({ data: { runId: runId! } }),
    enabled: Boolean(runId),
    staleTime: 10_000,
  });
}

function useRunsInvalidator(projectId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["layout-optimization-runs", projectId] });
    qc.invalidateQueries({ queryKey: ["layout-optimization-approval"] });
  };
}

export function useRunLayoutOptimization(projectId: string) {
  const invalidate = useRunsInvalidator(projectId);
  const fn = useServerFn(runLayoutOptimization);
  return useMutation({
    mutationFn: (input: unknown) => fn({ data: input as never }),
    onSuccess: (result) => {
      invalidate();
      toast.success(`${result.runRef} complete`, {
        description: `${result.results.candidate_count} candidates scored.`,
      });
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useChooseCandidate(projectId: string) {
  const invalidate = useRunsInvalidator(projectId);
  const fn = useServerFn(chooseOptimizationCandidate);
  return useMutation({
    mutationFn: (input: { runId: string; candidateIndex: number }) => fn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Candidate selected");
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useSubmitOptimizationRun(projectId: string) {
  const invalidate = useRunsInvalidator(projectId);
  const fn = useServerFn(submitOptimizationRun);
  return useMutation({
    mutationFn: (runId: string) => fn({ data: { runId } }),
    onSuccess: () => {
      invalidate();
      toast.success("Sent for approval");
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useApplyOptimizationScenario(projectId: string) {
  const invalidate = useRunsInvalidator(projectId);
  const fn = useServerFn(applyOptimizationScenario);
  return useMutation({
    mutationFn: (runId: string) => fn({ data: { runId } }),
    onSuccess: (result) => {
      invalidate();
      toast.success("Scenario applied to the layout", {
        description: `${result.blockCount} blocks written.`,
      });
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}
