// P-157 — TanStack Query wrappers for PV yield simulations.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { parseServerError } from "@/lib/pv-library-query";
import {
  getPvSimulationApproval,
  getPvSimulationPrefill,
  listPvSimulations,
  runPvSimulation,
  setSimulationBaseline,
  submitPvSimulation,
} from "@/lib/pv-yield.functions";

export function pvSimulationsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listPvSimulations>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["pv-simulations", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 15_000,
  });
}

export function pvSimulationPrefillQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getPvSimulationPrefill>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["pv-simulation-prefill", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 60_000,
  });
}

export function pvSimulationApprovalQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getPvSimulationApproval>>,
  simulationId: string | null,
) {
  return queryOptions({
    queryKey: ["pv-simulation-approval", simulationId],
    queryFn: () => fn({ data: { simulationId: simulationId! } }),
    enabled: Boolean(simulationId),
    staleTime: 10_000,
  });
}

export function useRunPvSimulation(projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(runPvSimulation);
  return useMutation({
    mutationFn: (input: unknown) => fn({ data: input as never }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pv-simulations", projectId] });
      toast.success("Simulation complete — results persisted");
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useSubmitPvSimulation(projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(submitPvSimulation);
  return useMutation({
    mutationFn: (simulationId: string) => fn({ data: { simulationId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pv-simulations", projectId] });
      qc.invalidateQueries({ queryKey: ["pv-simulation-approval"] });
      toast.success("Submitted for engineering approval");
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useSetSimulationBaseline(projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(setSimulationBaseline);
  return useMutation({
    mutationFn: (simulationId: string) => fn({ data: { simulationId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pv-simulations", projectId] });
      toast.success("Simulation set as the project baseline");
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}
