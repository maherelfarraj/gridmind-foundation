// P-138 — Query options + save mutation for the SLD CAD workspace.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { getSldCadWorkspace, saveSldObjects, type SldCadWorkspace } from "@/lib/sld-cad.functions";
import type { SldCanvasMeta, SldCanvasObject, SldConnection } from "@/lib/sld/canvas-types";

export function sldCadWorkspaceQueryOptions(
  fn: (args: { data: { drawingId: string } }) => Promise<SldCadWorkspace>,
  drawingId: string,
) {
  return queryOptions({
    queryKey: ["sld-cad", drawingId],
    queryFn: () => fn({ data: { drawingId } }),
  });
}

export function useSldCadWorkspace(drawingId: string) {
  const fn = useServerFn(getSldCadWorkspace);
  return sldCadWorkspaceQueryOptions(fn as any, drawingId);
}

export function useSaveSldCanvas(drawingId: string, onSaved?: () => void) {
  const saveFn = useServerFn(saveSldObjects);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      objects: SldCanvasObject[];
      removedIds: string[];
      connections: SldConnection[];
      removedConnectionIds: string[];
      canvas: SldCanvasMeta;
    }) => (saveFn as any)({ data: { drawingId, ...vars } }),
    onSuccess: async (res: any) => {
      toast.success(`Canvas saved — ${res?.object_count ?? 0} objects`);
      onSaved?.();
      await qc.invalidateQueries({ queryKey: ["sld-cad", drawingId] });
    },
    onError: (err: any) => {
      const msg = String(err?.message ?? "");
      if (msg.includes("locked")) {
        toast.error("This drawing is locked — changes were not saved.");
      } else {
        toast.error(msg || "Failed to save canvas.");
      }
    },
  });
}
