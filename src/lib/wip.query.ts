// P-197 — Query options for the WIP / revenue-recognition report.
import { queryOptions } from "@tanstack/react-query";

import { getWipAccess, getWipReport, listWipProjects } from "@/lib/wip.functions";

export function wipProjectsQueryOptions() {
  return queryOptions({
    queryKey: ["wip", "projects"],
    queryFn: () => listWipProjects(),
    staleTime: 60_000,
  });
}

export function wipAccessQueryOptions() {
  return queryOptions({
    queryKey: ["wip", "access"],
    queryFn: () => getWipAccess(),
    staleTime: 60_000,
  });
}

export function wipReportQueryOptions(projectId: string | null, asOf: string | null) {
  return queryOptions({
    queryKey: ["wip", "report", projectId, asOf],
    queryFn: () =>
      getWipReport({
        data: { project_id: projectId as string, ...(asOf ? { as_of_date: asOf } : {}) },
      }),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
}
