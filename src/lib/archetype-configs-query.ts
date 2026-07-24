// P-039 — Shared query options for project archetype configs.
import { queryOptions } from "@tanstack/react-query";
import { getArchetypeConfigs } from "@/lib/projects.functions";

export const archetypeConfigsQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: ["archetype-configs", projectId] as const,
    queryFn: () => getArchetypeConfigs({ data: { project_id: projectId } }),
    staleTime: 30_000,
  });
