// P-147 — Client wiring for SLD import/export.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { downloadDrawingPdf } from "@/lib/exports/sld-drawing-pdf";
import { exportSldDrawing, importSldJson, listSldExports } from "@/lib/sld-export.functions";
import { toPng } from "@/lib/sld/exporters";

export type SldExportFormat = "svg" | "pdf" | "png" | "json" | "csv" | "dxf";

export const EXPORT_FORMAT_LABELS: Record<SldExportFormat, string> = {
  svg: "SVG",
  pdf: "PDF",
  png: "PNG",
  json: "JSON",
  csv: "CSV",
  dxf: "DXF",
};

export type ExportArtifact = {
  id: string;
  format: SldExportFormat;
  file_name: string;
  storage_path: string;
  file_size_bytes: number | null;
  created_at: string;
};

export function sldExportsQueryOptions(drawingId: string) {
  return queryOptions({
    queryKey: ["sld-exports", drawingId],
    queryFn: () =>
      (listSldExports as any)({ data: { drawingId } }) as Promise<{
        revision_id: string | null;
        artifacts: ExportArtifact[];
      }>,
  });
}

function errorMessage(err: unknown): string {
  const msg = String((err as any)?.message ?? "");
  if (msg.includes("export_locked") || (err as any)?.statusCode === 423) {
    return "Export locked — an approval is pending on this project.";
  }
  return msg || "Export failed";
}

function downloadText(filename: string, text: string, mime: string) {
  downloadBlobFile(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

function downloadBlobFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function useExportDrawing(drawingId: string) {
  const fn = useServerFn(exportSldDrawing);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (format: SldExportFormat) => (fn as any)({ data: { drawingId, format } }),
    onSuccess: async (res: any) => {
      if (res.format === "png") {
        downloadBlobFile(res.filename, await toPng(res.content, 2));
      } else if (res.format === "pdf") {
        await downloadDrawingPdf(res.filename, {
          svg: res.content,
          drawing: res.drawing,
          branding: res.branding,
        });
      } else {
        downloadText(res.filename, res.content, res.mime);
      }
      if ((res.warnings ?? []).length > 0) {
        toast.warning(`${res.warnings.length} element(s) skipped`, {
          description: res.warnings.slice(0, 3).join(" · "),
        });
      }
      toast.success(`Exported ${res.filename}`);
      await qc.invalidateQueries({ queryKey: ["sld-exports", drawingId] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useImportSldJson(drawingId: string) {
  const fn = useServerFn(importSldJson);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (document: unknown) => (fn as any)({ data: { drawingId, document } }),
    onSuccess: async (res: any) => {
      toast.success(
        `Imported into new draft revision ${res.revision_code} — ${res.object_count} object(s)`,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sld-cad", drawingId] }),
        qc.invalidateQueries({ queryKey: ["sld-revisions", drawingId] }),
        qc.invalidateQueries({ queryKey: ["sld-exports", drawingId] }),
      ]);
    },
    onError: (err) => toast.error(String((err as any)?.message ?? "Import failed")),
  });
}
