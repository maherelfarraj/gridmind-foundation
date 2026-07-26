// P-147 — Export/Import tab for the SLD CAD workspace.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Loader2, Lock, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsExportLocked } from "@/lib/export-locks.hooks";
import { formatDateTime } from "@/lib/format";
import {
  EXPORT_FORMAT_LABELS,
  sldExportsQueryOptions,
  useExportDrawing,
  useImportSldJson,
  type SldExportFormat,
} from "@/lib/sld-export-query";
import { fromJson, SldImportError, type ExportGraph } from "@/lib/sld/exporters";

const FORMATS: SldExportFormat[] = ["svg", "pdf", "png", "json", "csv", "dxf"];

interface ExportPanelProps {
  drawingId: string;
  projectId: string;
  canEdit: boolean;
}

export function ExportPanel({ drawingId, projectId, canEdit }: ExportPanelProps) {
  const query = useQuery(sldExportsQueryOptions(drawingId));
  const exportDrawing = useExportDrawing(drawingId);
  const importJson = useImportSldJson(drawingId);
  const { data: locked } = useIsExportLocked(projectId, "sld_drawing");

  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ExportGraph | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setError(null);
    setPreview(null);
    if (!file) return;
    setFileName(file.name);
    try {
      setPreview(fromJson(await file.text()));
    } catch (err) {
      setError(
        err instanceof SldImportError ? err.message : "Could not read this file as an SLD export.",
      );
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-sm">Export current revision</CardTitle>
          {locked ? (
            <Badge variant="outline" className="gap-1 text-warning">
              <Lock className="size-3" /> Locked
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((format) => (
              <Button
                key={format}
                size="sm"
                variant="outline"
                disabled={Boolean(locked) || exportDrawing.isPending}
                onClick={() => exportDrawing.mutate(format)}
              >
                {exportDrawing.isPending && exportDrawing.variables === format ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <FileDown className="mr-1 size-3.5" />
                )}
                {EXPORT_FORMAT_LABELS[format]}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Files are stored with the project and recorded in the export register. PDF applies
            company branding; SVG and DXF stay neutral for downstream CAD.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-sm">Import JSON</CardTitle>
          <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => setOpen(true)}>
            <Upload className="mr-1 size-3.5" /> Import
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            An import always creates a new draft revision and re-tags equipment and cables. Existing
            revisions are never modified.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Recent exports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {query.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (query.data?.artifacts ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No exports generated yet.</p>
          ) : (
            (query.data?.artifacts ?? []).map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{a.file_name}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(a.created_at)}</p>
                </div>
                <Badge variant="secondary">{EXPORT_FORMAT_LABELS[a.format] ?? a.format}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import SLD JSON</DialogTitle>
            <DialogDescription>
              Validated against the GridMind SLD format (v1, max 10,000 objects).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <input
              type="file"
              accept="application/json,.json"
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {preview ? (
              <div className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">{fileName}</p>
                <p className="text-muted-foreground">
                  {preview.objects.length} object(s) · {preview.connections.length} connection(s)
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!preview || importJson.isPending}
              onClick={() => {
                if (!preview) return;
                importJson.mutate(
                  { format: "gridmind-sld", version: 1, ...preview },
                  { onSuccess: () => setOpen(false) },
                );
              }}
            >
              {importJson.isPending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
              Create draft revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
