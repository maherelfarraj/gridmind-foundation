// P-089 — Query options for QA/QC.
import { queryOptions } from "@tanstack/react-query";

import {
  getInspection,
  getPunchItem,
  getPunchWalkContext,
  getQaqcHeatmap,
  listInspections,
  listInspectors,
  listPunchItems,
  listQaqcProjects,
} from "@/lib/qaqc.functions";
import type {
  PunchCategory,
  PunchStatus,
  QaqcDiscipline,
  QaqcResult,
} from "@/lib/qaqc.rules";

export { errorMessage } from "@/lib/hse-query";

export interface InspectionListFilters {
  projectId?: string | null;
  discipline?: QaqcDiscipline | null;
  result?: QaqcResult | null;
  area?: string | null;
  reworkOnly?: boolean | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
}

export const qaqcProjectsQueryOptions = () =>
  queryOptions({
    queryKey: ["qaqc", "projects"],
    queryFn: () => listQaqcProjects(),
    staleTime: 30_000,
  });

export const qaqcInspectorsQueryOptions = () =>
  queryOptions({
    queryKey: ["qaqc", "inspectors"],
    queryFn: () => listInspectors(),
    staleTime: 30_000,
  });

export const inspectionListQueryOptions = (filters: InspectionListFilters) =>
  queryOptions({
    queryKey: ["qaqc", "inspections", filters],
    queryFn: () => listInspections({ data: filters as any }),
    staleTime: 10_000,
  });

export const inspectionDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["qaqc", "inspection", id],
    queryFn: () => getInspection({ data: { id } }),
    staleTime: 5_000,
  });

export const qaqcHeatmapQueryOptions = (
  projectId: string | null,
  from: string,
  to: string,
) =>
  queryOptions({
    queryKey: ["qaqc", "heatmap", projectId, from, to],
    enabled: !!projectId,
    queryFn: () =>
      getQaqcHeatmap({ data: { projectId: projectId!, from, to } as any }),
    staleTime: 15_000,
  });
