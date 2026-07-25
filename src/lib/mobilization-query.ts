// P-084 — Query options for mobilization checklists.
import { queryOptions } from "@tanstack/react-query";

import {
  getMobilizationChecklist,
  getMobilizationHeaderChip,
  listCompanyProjectsForMobilization,
  listMobilizationChecklists,
} from "@/lib/mobilization.functions";

export const mobilizationProjectOptionsQuery = () =>
  queryOptions({
    queryKey: ["mobilization", "project-options"],
    queryFn: () => listCompanyProjectsForMobilization(),
    staleTime: 30_000,
  });

export const mobilizationListQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: ["mobilization", "list", projectId],
    queryFn: () => listMobilizationChecklists({ data: { projectId } }),
    enabled: Boolean(projectId),
    staleTime: 10_000,
  });

export const mobilizationDetailQueryOptions = (checklistId: string) =>
  queryOptions({
    queryKey: ["mobilization", "detail", checklistId],
    queryFn: () => getMobilizationChecklist({ data: { checklistId } }),
    staleTime: 5_000,
  });

export const mobilizationHeaderChipQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: ["mobilization", "header", projectId],
    queryFn: () => getMobilizationHeaderChip({ data: { projectId } }),
    staleTime: 30_000,
  });

export function errorMessage(e: unknown): string {
  if (!e) return "Unknown error";
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
