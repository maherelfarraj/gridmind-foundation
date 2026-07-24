// P-038 — Shared query options so layout + all tab child routes reuse one cache entry.
import { queryOptions } from "@tanstack/react-query";
import { getProject } from "@/lib/projects.functions";

export const projectDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["project-detail", id] as const,
    queryFn: () => getProject({ data: { id } }),
    staleTime: 30_000,
  });
