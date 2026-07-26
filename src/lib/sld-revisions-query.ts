// P-145 — React Query wiring for SLD revision management and markups.
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  addSldMarkup,
  compareAsDesignedAsBuilt,
  compareSldRevisions,
  createSldRevision,
  exportRevisionDiffCsv,
  listSldRevisions,
  markAsBuilt,
  resolveSldMarkup,
} from "@/lib/sld-revisions.functions";
import { downloadCsv } from "@/lib/csv";

const key = (drawingId: string) => ["sld-revisions", drawingId] as const;

export function useSldRevisions(drawingId: string) {
  const fn = useServerFn(listSldRevisions);
  return useQuery(
    queryOptions({
      queryKey: key(drawingId),
      queryFn: () => (fn as any)({ data: { drawingId } }),
    }),
  );
}

export function useRevisionDiff(drawingId: string, a: string | null, b: string | null) {
  const fn = useServerFn(compareSldRevisions);
  return useQuery({
    queryKey: ["sld-revision-diff", drawingId, a, b],
    queryFn: () => (fn as any)({ data: { revisionIdA: a, revisionIdB: b } }),
    enabled: Boolean(a && b && a !== b),
  });
}

export function useAsDesignedAsBuilt(drawingId: string, enabled: boolean) {
  const fn = useServerFn(compareAsDesignedAsBuilt);
  return useQuery({
    queryKey: ["sld-as-built-diff", drawingId],
    queryFn: () => (fn as any)({ data: { drawingId } }),
    enabled,
  });
}

function errorMessage(err: unknown, fallback: string) {
  const msg = String((err as { message?: string })?.message ?? "");
  if (msg.includes("locked"))
    return "This drawing is locked — only an as-built revision is allowed.";
  return msg || fallback;
}

export function useCreateRevision(drawingId: string) {
  const fn = useServerFn(createSldRevision);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { issueReason: string; reason: "revision" | "as_built" }) =>
      (fn as any)({ data: { drawingId, ...vars } }),
    onSuccess: async (res: any) => {
      toast.success(`Revision ${res?.revision_code} issued — ${res?.objects ?? 0} objects copied`);
      await qc.invalidateQueries({ queryKey: key(drawingId) });
      await qc.invalidateQueries({ queryKey: ["sld-cad", drawingId] });
    },
    onError: (err) => toast.error(errorMessage(err, "Failed to create revision.")),
  });
}

export function useMarkAsBuilt(drawingId: string) {
  const fn = useServerFn(markAsBuilt);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => (fn as any)({ data: { drawingId } }),
    onSuccess: async (res: any) => {
      toast.success(`As-built revision ${res?.revision_code} created`);
      await qc.invalidateQueries({ queryKey: key(drawingId) });
      await qc.invalidateQueries({ queryKey: ["sld-cad", drawingId] });
      await qc.invalidateQueries({ queryKey: ["sld-as-built-diff", drawingId] });
    },
    onError: (err) => toast.error(errorMessage(err, "Failed to mark as-built.")),
  });
}

export function useExportRevisionDiff() {
  const fn = useServerFn(exportRevisionDiffCsv);
  return useMutation({
    mutationFn: (vars: { revisionIdA: string; revisionIdB: string }) => (fn as any)({ data: vars }),
    onSuccess: (res: any) => {
      downloadCsv(res.filename, res.csv);
      toast.success(`Exported ${res.row_count} changes`);
    },
    onError: (err) => {
      const msg = String((err as { message?: string })?.message ?? "");
      toast.error(
        msg.includes("export_locked") || msg.includes("lock")
          ? "Export blocked: this project has an active export lock."
          : msg || "Export failed.",
      );
    },
  });
}

export function useAddMarkup(drawingId: string) {
  const fn = useServerFn(addSldMarkup);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      markup: {
        id: string;
        kind: "cloud" | "note" | "arrow";
        points: { x: number; y: number }[];
        note: string;
        linked_object_ids: string[];
      };
    }) => (fn as any)({ data: { drawingId, ...vars } }),
    onSuccess: async () => {
      toast.success("Markup added");
      await qc.invalidateQueries({ queryKey: key(drawingId) });
      await qc.invalidateQueries({ queryKey: ["sld-cad", drawingId] });
    },
    onError: (err) => toast.error(errorMessage(err, "Failed to add markup.")),
  });
}

export function useResolveMarkup(drawingId: string) {
  const fn = useServerFn(resolveSldMarkup);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { markupId: string; status: "open" | "resolved" }) =>
      (fn as any)({ data: { drawingId, ...vars } }),
    onSuccess: async (_res, vars) => {
      toast.success(vars.status === "resolved" ? "Markup resolved" : "Markup reopened");
      await qc.invalidateQueries({ queryKey: key(drawingId) });
      await qc.invalidateQueries({ queryKey: ["sld-cad", drawingId] });
    },
    onError: (err) =>
      toast.error(
        errorMessage(err, "Only the author or an engineering admin can resolve this markup."),
      ),
  });
}
