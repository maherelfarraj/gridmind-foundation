// P-086 — Query options for DPR list, detail, and WBS picker.
import { queryOptions } from "@tanstack/react-query";

import { getDpr, listDprProjects, listDprs } from "@/lib/dpr.functions";
import { listWbsForPicker } from "@/lib/wbs-picker.functions";

export interface DprListFilters {
  projectId?: string | null;
  from?: string | null;
  to?: string | null;
  status?: "draft" | "submitted" | "approved" | null;
  search?: string | null;
}

export const dprProjectsQueryOptions = () =>
  queryOptions({
    queryKey: ["dpr", "projects"],
    queryFn: () => listDprProjects(),
    staleTime: 30_000,
  });

export const dprListQueryOptions = (filters: DprListFilters) =>
  queryOptions({
    queryKey: ["dpr", "list", filters],
    queryFn: () => listDprs({ data: filters as any }),
    staleTime: 10_000,
  });

export const dprDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["dpr", "detail", id],
    queryFn: () => getDpr({ data: { id } }),
    staleTime: 5_000,
  });

export const wbsPickerQueryOptions = (projectId: string, q: string) =>
  queryOptions({
    queryKey: ["wbs", "picker", projectId, q],
    queryFn: () => listWbsForPicker({ data: { projectId, q: q || undefined } }),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });

export function errorMessage(e: unknown): string {
  if (!e) return "Unknown error";
  if (typeof e === "object" && e && "message" in e) {
    return String((e as any).message);
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
