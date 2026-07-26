// POL-5 — Query options for the project overview KPI strip.
import { queryOptions } from "@tanstack/react-query";

import { getProjectOverviewKpis } from "@/lib/project-overview.functions";

export function projectOverviewKpisQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["project-overview-kpis", projectId],
    queryFn: () => getProjectOverviewKpis({ data: { project_id: projectId } }),
    staleTime: 30_000,
  });
}
