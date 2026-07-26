// P-153 — TanStack Query wrappers for PV layouts.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { parseServerError } from "@/lib/pv-library-query";
import {
  createPvLayout,
  decidePvLayoutApproval,
  getPvLayout,
  getPvLayoutWriteAccess,
  listPvLayouts,
  saveLayoutBlocks,
  submitPvLayout,
} from "@/lib/pv-layout.functions";
import type { CreatePvLayoutInput, SaveLayoutBlocksInput } from "@/lib/pv-layout.schemas";

export function pvLayoutsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listPvLayouts>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["pv-layouts", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 15_000,
  });
}

export function pvLayoutQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getPvLayout>>,
  layoutId: string | null,
) {
  return queryOptions({
    queryKey: ["pv-layout", layoutId],
    queryFn: () => fn({ data: { layoutId: layoutId! } }),
    enabled: Boolean(layoutId),
    staleTime: 15_000,
  });
}

export function pvLayoutWriteAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getPvLayoutWriteAccess>>,
) {
  return queryOptions({
    queryKey: ["pv-layout", "write-access"],
    queryFn: () => fn({}),
    staleTime: 5 * 60_000,
  });
}

export function useCreatePvLayout(projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(createPvLayout);
  return useMutation({
    mutationFn: (input: CreatePvLayoutInput) => fn({ data: input as any }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["pv-layouts", projectId] });
      toast.success(`${row.layout_number ?? row.name} saved as draft`);
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useSaveLayoutBlocks(projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(saveLayoutBlocks);
  return useMutation({
    mutationFn: (input: SaveLayoutBlocksInput) => fn({ data: input as any }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["pv-layouts", projectId] });
      qc.invalidateQueries({ queryKey: ["pv-layout", row.id] });
      toast.success("Layout blocks saved");
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useSubmitPvLayout(projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(submitPvLayout);
  return useMutation({
    mutationFn: (layoutId: string) => fn({ data: { layoutId } }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["pv-layouts", projectId] });
      qc.invalidateQueries({ queryKey: ["pv-layout", row.id] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      toast.success("Submitted for engineering approval");
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useDecidePvLayoutApproval(projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(decidePvLayoutApproval);
  return useMutation({
    mutationFn: (layoutId: string) => fn({ data: { layoutId } }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["pv-layouts", projectId] });
      qc.invalidateQueries({ queryKey: ["pv-layout", row.id] });
      toast.success(
        row.status === "approved"
          ? "Layout approved — other options superseded"
          : `Layout returned to ${row.status}`,
      );
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}
