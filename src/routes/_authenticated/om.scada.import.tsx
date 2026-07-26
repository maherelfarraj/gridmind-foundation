// P-172 — CSV / historian import wizard: upload → map → preview → import.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, FileUp, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActiveCompany } from "@/components/company-switcher";
import { supabase } from "@/integrations/supabase/client";
import {
  createImportUpload,
  importScadaCsv,
  listImportTags,
} from "@/lib/scada-import.functions";
import {
  MAX_PREVIEW_ROWS,
  TIMESTAMP_FORMATS,
  parseCsvTable,
  suggestTagForColumn,
  validateCsvRows,
  type ImportMapping,
  type TimestampFormat,
} from "@/lib/scada/csv-import";
import { listScadaProjectOptions } from "@/lib/scada.functions";

export const Route = createFileRoute("/_authenticated/om/scada/import")({
  head: () => ({
    meta: [
      { title: "Historian CSV import · GridMind EPC" },
      {
        name: "description",
        content:
          "Upload historian CSV exports, map columns to plant tags, preview validation errors and load telemetry idempotently.",
      },
      { property: "og:title", content: "Historian CSV import · GridMind EPC" },
      {
        property: "og:description",
        content: "Map historian columns to tags and import telemetry in validated batches.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScadaImportPage,
});

const NO_TAG = "__none__";

function ScadaImportPage() {
  const { activeCompanyId } = useActiveCompany();
  const projectsFn = useServerFn(listScadaProjectOptions);
  const tagsFn = useServerFn(listImportTags);
  const uploadFn = useServerFn(createImportUpload);
  const importFn = useServerFn(importScadaCsv);

  const [projectId, setProjectId] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [csv, setCsv] = useState<string>("");
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [tsColumn, setTsColumn] = useState<string>("");
  const [tsFormat, setTsFormat] = useState<TimestampFormat>("iso");
  const [columnTags, setColumnTags] = useState<Record<string, string>>({});

  const projects = useQuery({
    queryKey: ["scada", "projects", activeCompanyId],
    queryFn: () => projectsFn({ data: { companyId: activeCompanyId! } }),
    enabled: Boolean(activeCompanyId),
  });

  const tags = useQuery({
    queryKey: ["scada", "import-tags", activeCompanyId, projectId],
    queryFn: () => tagsFn({ data: { companyId: activeCompanyId!, projectId } }),
    enabled: Boolean(activeCompanyId && projectId),
  });

  const table = useMemo(() => (csv ? parseCsvTable(csv) : null), [csv]);
  const knownTags = useMemo(
    () => new Set((tags.data?.tags ?? []).map((t) => t.tag)),
    [tags.data],
  );

  const mapping: ImportMapping | null = useMemo(() => {
    const columns = Object.entries(columnTags)
      .filter(([, tag]) => tag && tag !== NO_TAG)
      .map(([column, tag]) => ({ column, tag }));
    if (!tsColumn || columns.length === 0) return null;
    return { timestamp_column: tsColumn, timestamp_format: tsFormat, columns };
  }, [columnTags, tsColumn, tsFormat]);

  const preview = useMemo(() => {
    if (!table || !mapping) return null;
    return validateCsvRows(table, mapping, knownTags, MAX_PREVIEW_ROWS);
  }, [table, mapping, knownTags]);

  async function onFile(file: File) {
    const text = await file.text();
    setFilename(file.name);
    setCsv(text);
    setStoragePath(null);
    const parsed = parseCsvTable(text);
    const tagNames = (tags.data?.tags ?? []).map((t) => t.tag);
    setTsColumn(parsed.header[0] ?? "");
    const next: Record<string, string> = {};
    for (const col of parsed.header.slice(1)) {
      next[col] = suggestTagForColumn(col, tagNames) ?? NO_TAG;
    }
    setColumnTags(next);

    // Archive the raw file in the private documents bucket (best effort).
    try {
      const signed = await uploadFn({ data: { projectId, filename: file.name } });
      const { error } = await supabase.storage
        .from("documents")
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (error) throw error;
      setStoragePath(signed.path);
    } catch {
      toast.warning("File parsed, but archiving to storage failed — import can still proceed.");
    }
  }

  const runImport = useMutation({
    mutationFn: () =>
      importFn({
        data: {
          projectId,
          sourceLabel: filename || "historian.csv",
          storagePath,
          csv,
          mapping: mapping!,
        },
      }),
    onSuccess: (res) => {
      toast.success(`Imported ${res.accepted} readings (${res.rejected} rejected)`);
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Import failed"),
  });

  const result = runImport.data;

  return (
    <div className="page-shell">
      <PageHeader
        title="Historian CSV import"
        description="Upload an export, map columns to plant tags, review validation errors, then load telemetry in idempotent batches."
      />

      <Card>
        <CardHeader>
          <CardTitle>1 · Source</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Project</Label>
            {projects.isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {(projects.data ?? []).map((p: { id: string; name: string }) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">CSV file</Label>
            <Input
              type="file"
              accept=".csv,text/csv"
              disabled={!projectId}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
            {storagePath && (
              <p className="text-xs text-muted-foreground">Archived to {storagePath}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {!table && (
        <EmptyState
          icon={FileUp}
          title="No file loaded"
          description="Pick a project, then choose a historian CSV export with a timestamp column and one column per tag."
        />
      )}

      {table && (
        <Card>
          <CardHeader>
            <CardTitle>2 · Column mapping</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Timestamp column</Label>
                <Select value={tsColumn} onValueChange={setTsColumn}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select column" />
                  </SelectTrigger>
                  <SelectContent>
                    {table.header.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Timestamp format</Label>
                <Select
                  value={tsFormat}
                  onValueChange={(v) => setTsFormat(v as TimestampFormat)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMESTAMP_FORMATS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File column</TableHead>
                  <TableHead>Tag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.header
                  .filter((h) => h !== tsColumn)
                  .map((col) => (
                    <TableRow key={col}>
                      <TableCell className="font-medium">{col}</TableCell>
                      <TableCell>
                        <Select
                          value={columnTags[col] ?? NO_TAG}
                          onValueChange={(v) => setColumnTags((c) => ({ ...c, [col]: v }))}
                        >
                          <SelectTrigger className="max-w-sm">
                            <SelectValue placeholder="Skip column" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_TAG}>Skip column</SelectItem>
                            {(tags.data?.tags ?? []).map((t) => (
                              <SelectItem key={t.id} value={t.tag}>
                                {t.tag}
                                {t.unit ? ` (${t.unit})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {table && (
        <Card>
          <CardHeader>
            <CardTitle>3 · Preview (first {MAX_PREVIEW_ROWS} rows)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!mapping && (
              <p className="text-sm text-muted-foreground">
                Choose a timestamp column and map at least one tag column to preview.
              </p>
            )}
            {preview && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{preview.accepted} readings</Badge>
                  <Badge variant={preview.rejected > 0 ? "destructive" : "secondary"}>
                    {preview.rejected} rejected
                  </Badge>
                  {table.truncated && <Badge variant="secondary">file truncated</Badge>}
                </div>
                {preview.errors.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No validation errors in the previewed rows.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Line</TableHead>
                        <TableHead>Column</TableHead>
                        <TableHead>Problem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.errors.map((e, i) => (
                        <TableRow key={i}>
                          <TableCell>{e.line || "—"}</TableCell>
                          <TableCell>{e.column ?? "—"}</TableCell>
                          <TableCell className="text-destructive">{e.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {table && (
        <Card>
          <CardHeader>
            <CardTitle>4 · Import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Readings are written in batches of 500 with conflicts ignored — re-importing the same
              file never duplicates telemetry.
            </p>
            <Button
              disabled={!mapping || runImport.isPending}
              onClick={() => runImport.mutate()}
            >
              <Upload className="mr-1 h-4 w-4" />
              {runImport.isPending ? "Importing…" : "Run import"}
            </Button>

            {runImport.isError && (
              <EmptyState icon={AlertTriangle} title="Import failed" description="Try again." />
            )}

            {result && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{result.accepted} accepted</Badge>
                  <Badge variant={result.rejected > 0 ? "destructive" : "secondary"}>
                    {result.rejected} rejected
                  </Badge>
                  <Badge variant="secondary">
                    {result.queued ? "failures queued" : "no retry queue"}
                  </Badge>
                </div>
                {result.errors.length > 0 && (
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {result.errors.map((e, i) => (
                      <li key={i}>
                        {e.line ? `line ${e.line} · ` : ""}
                        {e.column ? `${e.column} · ` : ""}
                        {e.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
