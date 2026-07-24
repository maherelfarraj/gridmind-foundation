// P-054 — TanStack Query hooks for SLD config + gallery.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  createSldDrawing,
  getMySldRoles,
  getSldConfig,
  listSldDrawings,
  saveSldConfig,
  type BusConfig,
  type MeteringPoint,
  type VoltageLevel,
} from "@/lib/sld.functions";

export function sldConfigQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getSldConfig>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["sld-config", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 15_000,
  });
}

export function sldDrawingsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listSldDrawings>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["sld-drawings", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 30_000,
  });
}

export function sldRolesQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getMySldRoles>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["sld-roles", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 5 * 60_000,
  });
}

export function useSaveSldConfig(projectId: string) {
  const fn = useServerFn(saveSldConfig);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      bus_config: BusConfig;
      voltage_levels: VoltageLevel[];
      metering_points: MeteringPoint[];
      protection_scheme?: string | null;
      notes?: string | null;
    }) => fn({ data: { projectId, ...input } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sld-config", projectId] });
      toast.success("SLD configuration saved");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Save failed"),
  });
}

export function useCreateSldDrawing(projectId: string) {
  const fn = useServerFn(createSldDrawing);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { drawingNumber: string; title: string }) =>
      fn({ data: { projectId, ...input } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sld-drawings", projectId] });
      qc.invalidateQueries({ queryKey: ["drawings", projectId] });
      toast.success("SLD drawing created");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Create failed"),
  });
}
