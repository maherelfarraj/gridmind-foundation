// P-091 — Query options for transmittals.
import { queryOptions } from "@tanstack/react-query";

import {
  getTransmittal,
  listProjectDocuments,
  listTransmittalProjects,
  listTransmittals,
} from "@/lib/transmittals.functions";
import type { TransmittalDirection } from "@/lib/transmittals.rules";

export { errorMessage } from "@/lib/hse-query";

export interface TransmittalListFilters {
  projectId?: string | null;
  direction?: TransmittalDirection | null;
  search?: string | null;
}

export const transmittalProjectsQueryOptions = () =>
  queryOptions({
    queryKey: ["transmittals", "projects"],
    queryFn: () => listTransmittalProjects(),
    staleTime: 30_000,
  });

export const transmittalListQueryOptions = (filters: TransmittalListFilters) =>
  queryOptions({
    queryKey: ["transmittals", "list", filters],
    queryFn: () => listTransmittals({ data: filters as any }),
    staleTime: 10_000,
  });

export const transmittalDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["transmittals", "item", id],
    queryFn: () => getTransmittal({ data: { id } }),
    staleTime: 5_000,
  });

export const projectDocumentsQueryOptions = (projectId: string | null) =>
  queryOptions({
    queryKey: ["transmittals", "documents", projectId],
    enabled: !!projectId,
    queryFn: () => listProjectDocuments({ data: { projectId: projectId! } as any }),
    staleTime: 30_000,
  });
