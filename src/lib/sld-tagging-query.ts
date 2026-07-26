// P-141 — Mutations for the SLD tagging engine.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { retagSldRevision, setSldObjectTag, type RetagPreview } from "@/lib/sld-tagging.functions";

function tagErrorMessage(err: unknown): string {
  const raw = String((err as any)?.message ?? "");
  if (raw.includes("tags_frozen") || raw.includes("frozen")) {
    return "Tags are frozen on this revision — create a new revision to retag.";
  }
  if (raw.includes("duplicate_tag")) return "That tag is already used on this revision.";
  if (raw.includes("drawing_locked")) return "This drawing is locked — tags cannot be changed.";
  return raw || "Tagging failed.";
}

export function useRetagPreview(drawingId: string) {
  const fn = useServerFn(retagSldRevision);
  return useMutation({
    mutationFn: (vars: { force: boolean }) =>
      (fn as any)({
        data: { drawingId, force: vars.force, dryRun: true },
      }) as Promise<RetagPreview>,
    onError: (err) => toast.error(tagErrorMessage(err)),
  });
}

export function useApplyRetag(drawingId: string) {
  const fn = useServerFn(retagSldRevision);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { force: boolean }) =>
      (fn as any)({
        data: { drawingId, force: vars.force, dryRun: false },
      }) as Promise<RetagPreview>,
    onSuccess: async (res) => {
      toast.success(
        `Retagged — ${res.tags.length} tags, ${res.cables.length} cable numbers updated`,
      );
      await qc.invalidateQueries({ queryKey: ["sld-cad", drawingId] });
    },
    onError: (err) => toast.error(tagErrorMessage(err)),
  });
}

export function useSetObjectTag(drawingId: string) {
  const fn = useServerFn(setSldObjectTag);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { objectId: string; tag: string }) =>
      (fn as any)({ data: { drawingId, ...vars } }),
    onSuccess: async () => {
      toast.success("Tag updated");
      await qc.invalidateQueries({ queryKey: ["sld-cad", drawingId] });
    },
    onError: (err) => toast.error(tagErrorMessage(err)),
  });
}
