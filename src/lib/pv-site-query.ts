// P-151 — TanStack Query wrappers for PV site configurations.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { parseServerError } from "@/lib/pv-library-query";
import {
  activatePvSiteConfig,
  createPvWeatherUploadUrl,
  getActivePvSiteConfig,
  getPvSiteFileUrl,
  getPvSiteWriteAccess,
  listPvSiteConfigs,
  savePvSiteConfig,
} from "@/lib/pv-site.functions";
import type { PvSiteConfigInput } from "@/lib/pv-site.schemas";

export function pvSiteConfigsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listPvSiteConfigs>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["pv-site-configs", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 15_000,
  });
}

export function activePvSiteConfigQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getActivePvSiteConfig>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["pv-site-active", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 30_000,
  });
}

export function pvSiteWriteAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getPvSiteWriteAccess>>,
) {
  return queryOptions({
    queryKey: ["pv-site", "write-access"],
    queryFn: () => fn({}),
    staleTime: 5 * 60_000,
  });
}

export function useSavePvSiteConfig(projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(savePvSiteConfig);
  return useMutation({
    mutationFn: (input: PvSiteConfigInput) => fn({ data: input as any }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pv-site-configs", projectId] });
      qc.invalidateQueries({ queryKey: ["pv-site-active", projectId] });
      toast.success("Site configuration saved");
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useActivatePvSiteConfig(projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(activatePvSiteConfig);
  return useMutation({
    mutationFn: (id: string) => fn({ data: { id, projectId } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["pv-site-configs", projectId] });
      qc.invalidateQueries({ queryKey: ["pv-site-active", projectId] });
      toast.success(
        res.superseded > 0
          ? `Activated — ${res.superseded} earlier configuration${res.superseded > 1 ? "s" : ""} superseded`
          : "Site configuration activated",
      );
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useUploadPvWeatherFile(projectId: string) {
  const signFn = useServerFn(createPvWeatherUploadUrl);
  return useMutation({
    mutationFn: async (file: File) => {
      const signed = await signFn({ data: { projectId, fileName: file.name } });
      const res = await fetch(signed.signedUrl, {
        method: "PUT",
        headers: { "x-upsert": "true" },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      return signed.path;
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export function useOpenPvSiteFile() {
  const fn = useServerFn(getPvSiteFileUrl);
  return useMutation({
    mutationFn: (path: string) => fn({ data: { path } }),
    onSuccess: (res) => window.open(res.url, "_blank", "noopener,noreferrer"),
    onError: (err) => toast.error(parseServerError(err).message),
  });
}
