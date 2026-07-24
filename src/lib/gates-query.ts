// P-040 — Query options for the gate history panel.
import { queryOptions } from "@tanstack/react-query";
import { getGateHistory } from "@/lib/gates.functions";

export const gateHistoryQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: ["gate-history", projectId] as const,
    queryFn: () => getGateHistory({ data: { project_id: projectId } }),
    staleTime: 15_000,
  });
