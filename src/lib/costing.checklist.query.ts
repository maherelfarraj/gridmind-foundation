// GC-07 — Query options for the Period Close Cockpit.
import { queryOptions } from "@tanstack/react-query";

import { getCloseCockpit } from "@/lib/costing.checklist.functions";

export function closeCockpitQueryOptions(projectId: string, period?: string) {
  return queryOptions({
    queryKey: ["costing", "cockpit", projectId, period ?? "current"],
    queryFn: () => getCloseCockpit({ data: { projectId, ...(period ? { period } : {}) } }),
    staleTime: 10_000,
  });
}
