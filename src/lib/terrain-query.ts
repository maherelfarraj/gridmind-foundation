// P-160 — TanStack Query wrappers for the terrain workspace.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { parseServerError } from "@/lib/pv-library-query";
import {
  createTerrainUploadUrl,
  deleteTerrainSurface,
  getTerrainSurface,
  getTerrainWriteAccess,
  listTerrainSurfaces,
  parseTerrainSurface,
} from "@/lib/terrain.functions";

export function terrainSurfacesQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listTerrainSurfaces>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["terrain-surfaces", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 15_000,
  });
}

export function terrainSurfaceQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getTerrainSurface>>,
  surfaceId: string | null,
) {
  return queryOptions({
    queryKey: ["terrain-surface", surfaceId],
    queryFn: () => fn({ data: { surfaceId: surfaceId as string } }),
    enabled: Boolean(surfaceId),
    staleTime: 60_000,
  });
}

export function terrainWriteAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getTerrainWriteAccess>>,
) {
  return queryOptions({
    queryKey: ["terrain", "write-access"],
    queryFn: () => fn({}),
    staleTime: 5 * 60_000,
  });
}

export type TerrainImportInput = {
  projectId: string;
  file: File;
  name: string;
  revisionCode: string;
  contourInterval: number;
  crs: string;
  notes?: string;
};

/** Upload to storage via signed URL, then let the server parse + persist. */
export function useImportTerrainSurface(projectId: string) {
  const qc = useQueryClient();
  const createUrl = useServerFn(createTerrainUploadUrl);
  const parseFn = useServerFn(parseTerrainSurface);

  return useMutation({
    mutationFn: async (input: TerrainImportInput) => {
      const signed = await createUrl({
        data: { projectId: input.projectId, fileName: input.file.name },
      });
      const res = await fetch(signed.signedUrl, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: input.file,
      });
      if (!res.ok) throw new Error("Upload failed — please try again.");
      return parseFn({
        data: {
          projectId: input.projectId,
          path: signed.path,
          fileName: input.file.name,
          name: input.name,
          revisionCode: input.revisionCode,
          contourInterval: input.contourInterval,
          crs: input.crs,
          notes: input.notes,
        },
      });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["terrain-surfaces", projectId] });
      toast.success(
        `Surface imported — ${result.points.toLocaleString()} points, ${result.contours} contour lines`,
      );
    },
  });
}

export function useDeleteTerrainSurface(projectId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(deleteTerrainSurface);
  return useMutation({
    mutationFn: (surfaceId: string) => fn({ data: { surfaceId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terrain-surfaces", projectId] });
      toast.success("Surface deleted");
    },
    onError: (err) => toast.error(parseServerError(err).message),
  });
}

export { parseServerError };
