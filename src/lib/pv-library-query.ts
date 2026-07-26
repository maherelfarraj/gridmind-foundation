// P-150 — TanStack Query wrappers for the PV equipment library.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  createPvUploadUrl,
  getPvEquipment,
  getPvFileUrl,
  getPvLibraryWriteAccess,
  listPvEquipment,
  registerPvUpload,
  removePvDoc,
  savePvEquipment,
  setPvEquipmentActive,
} from "@/lib/pv-library.functions";
import type { PvCategory, PvEquipmentInput } from "@/lib/pv-library.schemas";

export interface PvLibraryFilters {
  category: PvCategory;
  search: string | null;
  activeOnly: boolean;
}

export function pvEquipmentListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listPvEquipment>>,
  filters: PvLibraryFilters,
) {
  return queryOptions({
    queryKey: ["pv-library", filters],
    queryFn: () =>
      fn({
        data: {
          category: filters.category,
          search: filters.search,
          activeOnly: filters.activeOnly,
        },
      }),
    staleTime: 30_000,
  });
}

export function pvEquipmentDetailQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getPvEquipment>>,
  id: string | null,
) {
  return queryOptions({
    queryKey: ["pv-equipment", id],
    queryFn: () => fn({ data: { id: id! } }),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function pvWriteAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getPvLibraryWriteAccess>>,
) {
  return queryOptions({
    queryKey: ["pv-library", "write-access"],
    queryFn: () => fn({}),
    staleTime: 5 * 60_000,
  });
}

export function parseServerError(err: unknown): { code: string; message: string; extra: any } {
  const anyErr = err as any;
  const body = anyErr?.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return {
        code: String(parsed?.error ?? "error"),
        message: String(parsed?.message ?? "Something went wrong"),
        extra: parsed,
      };
    } catch {
      // ignore
    }
  }
  return { code: "error", message: anyErr?.message ?? "Something went wrong", extra: null };
}

export function useSavePvEquipment() {
  const qc = useQueryClient();
  const fn = useServerFn(savePvEquipment);
  return useMutation({
    mutationFn: (input: PvEquipmentInput) => fn({ data: input as any }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["pv-library"] });
      qc.invalidateQueries({ queryKey: ["pv-equipment", res.id] });
      toast.success("Equipment saved");
    },
  });
}

export function useSetPvEquipmentActive() {
  const qc = useQueryClient();
  const fn = useServerFn(setPvEquipmentActive);
  return useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) => fn({ data: input }),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ["pv-library"] });
      qc.invalidateQueries({ queryKey: ["pv-equipment", vars.id] });
      toast.success(vars.isActive ? "Equipment reactivated" : "Equipment deactivated");
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useUploadPvFile(equipmentId: string) {
  const qc = useQueryClient();
  const signFn = useServerFn(createPvUploadUrl);
  const registerFn = useServerFn(registerPvUpload);
  return useMutation({
    mutationFn: async (input: { file: File; kind: "datasheet" | "doc" }) => {
      const signed = await signFn({ data: { equipmentId, fileName: input.file.name } });
      const res = await fetch(signed.signedUrl, {
        method: "PUT",
        headers: { "x-upsert": "true" },
        body: input.file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      await registerFn({
        data: {
          equipmentId,
          path: signed.path,
          fileName: input.file.name,
          kind: input.kind,
        },
      });
      return signed.path;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pv-equipment", equipmentId] });
      qc.invalidateQueries({ queryKey: ["pv-library"] });
      toast.success("File uploaded");
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useRemovePvDoc(equipmentId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(removePvDoc);
  return useMutation({
    mutationFn: (path: string) => fn({ data: { equipmentId, path } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pv-equipment", equipmentId] });
      toast.success("File removed");
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useOpenPvFile() {
  const fn = useServerFn(getPvFileUrl);
  return useMutation({
    mutationFn: (path: string) => fn({ data: { path } }),
    onSuccess: (res) => {
      window.open(res.url, "_blank", "noopener,noreferrer");
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}
