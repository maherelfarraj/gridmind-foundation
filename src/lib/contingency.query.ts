// GC-14 — Query options for the contingency & risk exposure cockpit.
import { queryOptions } from "@tanstack/react-query";

import { getContingencyAccess, getContingencyWorkspace } from "@/lib/contingency.functions";

export function contingencyWorkspaceQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["contingency", "workspace", projectId],
    queryFn: () => getContingencyWorkspace({ data: { project_id: projectId } }),
    staleTime: 10_000,
  });
}

export function contingencyAccessQueryOptions() {
  return queryOptions({
    queryKey: ["contingency", "access"],
    queryFn: () => getContingencyAccess(),
    staleTime: 60_000,
  });
}
