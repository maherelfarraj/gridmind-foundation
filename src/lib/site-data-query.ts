// P-052 — React Query hooks for site data uploads.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  getSiteDataDownloadUrl,
  listSiteData,
  registerSiteDataDocument,
  uploadSiteData,
} from "@/lib/site-data.functions";

export function siteDataListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listSiteData>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["engineering", "site-data", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 30_000,
  });
}

export function useUploadSiteData() {
  const fn = useServerFn(uploadSiteData);
  return useMutation({
    mutationFn: (input: {
      projectId: string;
      category: "survey_topo" | "geotech" | "meteorological" | "other";
      fileName: string;
      fileSize: number;
      mimeType: string | null;
    }) => fn({ data: input }),
  });
}

export function useRegisterSiteDataDocument(projectId: string) {
  const fn = useServerFn(registerSiteDataDocument);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      category: "survey_topo" | "geotech" | "meteorological" | "other";
      storagePath: string;
      fileName: string;
      fileSize: number;
      mimeType: string | null;
      title: string;
      tags?: string[];
      metadata?: Record<string, any>;
    }) =>
      fn({
        data: {
          projectId,
          tags: input.tags ?? [],
          metadata: input.metadata ?? {},
          ...input,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["engineering", "site-data", projectId],
      });
    },
  });
}

export function useDownloadSiteData() {
  const fn = useServerFn(getSiteDataDownloadUrl);
  return useMutation({
    mutationFn: (documentId: string) => fn({ data: { documentId } }),
    onSuccess: (res) => {
      if (res.url && typeof window !== "undefined") {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        toast.error("Download link unavailable");
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Download failed"),
  });
}
