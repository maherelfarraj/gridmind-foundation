// P-066 — TanStack Query wrappers for goods receipts.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  addGrnPhoto,
  confirmGrn,
  createDraftGrn,
  getGrn,
  getReceivableForPo,
  listGrns,
  listReceivablePos,
  removeGrnPhoto,
  saveGrnDraft,
} from "@/lib/grn.functions";
import type { GrnDraftPayload, GrnStatus } from "@/lib/grn-rules";

function errorMessage(err: unknown): string {
  const anyErr = err as any;
  const body = anyErr?.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) return String(parsed.message);
      if (parsed?.error) return String(parsed.error);
    } catch {
      /* ignore */
    }
  }
  if (anyErr?.message) return String(anyErr.message);
  return "Something went wrong";
}

export interface GrnFilters {
  search?: string | null;
  status?: GrnStatus | null;
  projectId?: string | null;
  poId?: string | null;
}

export function grnListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listGrns>>,
  filters: GrnFilters,
) {
  return queryOptions({
    queryKey: ["grns", filters],
    queryFn: () =>
      fn({
        data: {
          search: filters.search ?? null,
          status: filters.status ?? null,
          projectId: filters.projectId ?? null,
          poId: filters.poId ?? null,
        },
      }),
    staleTime: 30_000,
  });
}

export function grnDetailQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getGrn>>,
  grnId: string,
) {
  return queryOptions({
    queryKey: ["grn", grnId],
    queryFn: () => fn({ data: { grnId } }),
    staleTime: 15_000,
  });
}

export function receivableForPoQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getReceivableForPo>>,
  poId: string,
) {
  return queryOptions({
    queryKey: ["po-receivable", poId],
    queryFn: () => fn({ data: { poId } }),
    staleTime: 5_000,
  });
}

export function receivablePosQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listReceivablePos>>,
) {
  return queryOptions({
    queryKey: ["pos", "receivable"],
    queryFn: () => fn(),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// mutations
// ---------------------------------------------------------------------------
export function useCreateDraftGrn() {
  const fn = useServerFn(createDraftGrn);
  return useMutation({
    mutationFn: (poId: string) => fn({ data: { poId } }),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useSaveGrnDraft(grnId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(saveGrnDraft);
  return useMutation({
    mutationFn: (payload: GrnDraftPayload) => fn({ data: { grnId, payload } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grn", grnId] });
      toast.success("Draft saved");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useConfirmGrn(grnId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(confirmGrn);
  return useMutation({
    mutationFn: (payload: GrnDraftPayload) => fn({ data: { grnId, payload } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["grn", grnId] });
      qc.invalidateQueries({ queryKey: ["grns"] });
      qc.invalidateQueries({ queryKey: ["po"] });
      qc.invalidateQueries({ queryKey: ["pos"] });
      qc.invalidateQueries({ queryKey: ["pos", "receivable"] });
      qc.invalidateQueries({ queryKey: ["po-receivable"] });
      toast.success(
        res.status === "has_defects"
          ? `${res.grn_number} confirmed with defects`
          : `${res.grn_number} confirmed`,
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useAddGrnPhoto(grnId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(addGrnPhoto);
  return useMutation({
    mutationFn: (path: string) => fn({ data: { grnId, path } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["grn", grnId] }),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useRemoveGrnPhoto(grnId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(removeGrnPhoto);
  return useMutation({
    mutationFn: (path: string) => fn({ data: { grnId, path } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["grn", grnId] }),
    onError: (err) => toast.error(errorMessage(err)),
  });
}
