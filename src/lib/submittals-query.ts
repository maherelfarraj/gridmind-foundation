// P-091 — Query options for submittals.
import { queryOptions } from "@tanstack/react-query";

import { getSubmittal, listSubmittalProjects, listSubmittals } from "@/lib/submittals.functions";
import type { SubmittalStatus } from "@/lib/submittals.rules";

export { errorMessage } from "@/lib/hse-query";

export interface SubmittalListFilters {
  projectId?: string | null;
  status?: SubmittalStatus | null;
  search?: string | null;
}

export const submittalProjectsQueryOptions = () =>
  queryOptions({
    queryKey: ["submittals", "projects"],
    queryFn: () => listSubmittalProjects(),
    staleTime: 30_000,
  });

export const submittalListQueryOptions = (filters: SubmittalListFilters) =>
  queryOptions({
    queryKey: ["submittals", "list", filters],
    queryFn: () => listSubmittals({ data: filters as any }),
    staleTime: 10_000,
  });

export const submittalDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["submittals", "item", id],
    queryFn: () => getSubmittal({ data: { id } }),
    staleTime: 5_000,
  });
