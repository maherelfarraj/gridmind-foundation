// P-057 — TanStack Query hooks for BOM.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  generateBom,
  getBomSnapshot,
  getMyBomRoles,
  listBomSnapshots,
  releaseBom,
  updateBomLine,
  type BomSnapshotDetail,
} from "@/lib/bom.functions";

export function bomSnapshotsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listBomSnapshots>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["bom-snapshots", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 15_000,
  });
}

export function bomSnapshotDetailQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getBomSnapshot>>,
  snapshotId: string | undefined,
) {
  return queryOptions({
    queryKey: ["bom-snapshot", snapshotId ?? "none"],
    queryFn: () =>
      snapshotId ? fn({ data: { snapshotId } }) : Promise.resolve<BomSnapshotDetail | null>(null),
    enabled: !!snapshotId,
    staleTime: 10_000,
  });
}

export function bomRolesQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getMyBomRoles>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["bom-roles", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 5 * 60_000,
  });
}

export function useGenerateBom(projectId: string) {
  const fn = useServerFn(generateBom);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn({ data: { projectId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bom-snapshots", projectId] });
      toast.success("BOM generated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Generate failed"),
  });
}

export function useUpdateBomLine(snapshotId: string, projectId: string) {
  const fn = useServerFn(updateBomLine);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      lineId: string;
      qty?: number;
      buffer_pct?: number;
      unit_cost?: number | null;
      notes?: string | null;
    }) => fn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bom-snapshot", snapshotId] });
      qc.invalidateQueries({ queryKey: ["bom-snapshots", projectId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Update failed"),
  });
}

export function useReleaseBom(snapshotId: string, projectId: string) {
  const fn = useServerFn(releaseBom);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn({ data: { snapshotId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bom-snapshot", snapshotId] });
      qc.invalidateQueries({ queryKey: ["bom-snapshots", projectId] });
      toast.success("BOM released");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Release failed"),
  });
}
