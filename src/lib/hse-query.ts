// P-088 — Query options for HSE dashboard, incidents, inspections, training.
import { queryOptions } from "@tanstack/react-query";

import {
  getHseDashboard,
  getIncident,
  listHseProjects,
  listIncidents,
  listInspections,
  listTraining,
} from "@/lib/hse.functions";

export interface IncidentListFilters {
  projectId?: string | null;
  status?: "open" | "investigating" | "closed" | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface InspectionListFilters {
  projectId?: string | null;
  status?: "scheduled" | "completed" | "closed" | null;
  search?: string | null;
}

export interface TrainingListFilters {
  projectId?: string | null;
  search?: string | null;
}

export const hseProjectsQueryOptions = () =>
  queryOptions({
    queryKey: ["hse", "projects"],
    queryFn: () => listHseProjects(),
    staleTime: 30_000,
  });

export const hseDashboardQueryOptions = (projectId: string | null) =>
  queryOptions({
    queryKey: ["hse", "dashboard", projectId],
    queryFn: () => getHseDashboard({ data: { projectId } as any }),
    staleTime: 30_000,
  });

export const incidentListQueryOptions = (filters: IncidentListFilters) =>
  queryOptions({
    queryKey: ["hse", "incidents", filters],
    queryFn: () => listIncidents({ data: filters as any }),
    staleTime: 10_000,
  });

export const incidentDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["hse", "incident", id],
    queryFn: () => getIncident({ data: { id } }),
    staleTime: 5_000,
  });

export const inspectionListQueryOptions = (filters: InspectionListFilters) =>
  queryOptions({
    queryKey: ["hse", "inspections", filters],
    queryFn: () => listInspections({ data: filters as any }),
    staleTime: 10_000,
  });

export const trainingListQueryOptions = (filters: TrainingListFilters) =>
  queryOptions({
    queryKey: ["hse", "training", filters],
    queryFn: () => listTraining({ data: filters as any }),
    staleTime: 10_000,
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
