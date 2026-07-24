// P-056 — PVsyst report import tab.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

import { parsePvsystCsv, type PvsystParsed } from "@/lib/yield/pvsyst-parse";
import {
  registerSiteDataDocument,
  uploadSiteData,
} from "@/lib/site-data.functions";
import { useImportPvsystScenario } from "@/lib/yield-query";

export function YieldPvsystImport({
  projectId,
  canWrite,
}: {
  projectId: string;
  canWrite: boolean;
}) {
  const upload = useServerFn(uploadSiteData);
  const register = useServerFn(registerSiteDataDocument);
  const importScenario = useImportPvsystScenario(projectId);

  const [scenarioName, setScenarioName] = useState("PVsyst");
  const [file, setFile] = useState<File | null>(null);
  const [metrics, setMetrics] = useState<PvsystParsed>({});
  const [documentId, setDocumentId] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);

  const onFile = async (f: File | null) => {
    setFile(f);
    setDocumentId(undefined);
    setMetrics({});
    if (!f) return;
    if (f.name.toLowerCase().endsWith(".csv")) {
      try {
        const text = await f.text();
        const parsed = parsePvsystCsv(text);
        setMetrics(parsed);
        toast.success("CSV parsed — review metrics below");
      } catch {
        toast.error("Could not parse CSV");
      }
    }
  };

  const doUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const signed = await upload({
        data: {
          projectId,
          category: "meteorological",
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || null,
        },
      });
      const put = await fetch(signed.signedUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream" },
      });
      if (!put.ok) throw new Error("Upload failed");
      const reg = await register({
        data: {
          projectId,
          category: "meteorological",
          storagePath: signed.path,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || null,
          title: `PVsyst report — ${scenarioName}`,
          tags: ["pvsyst"],
          metadata: { subtype: "pvsyst_report" },
        },
      });
      setDocumentId(reg.id);
      toast.success("Report uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const canSave =
    canWrite &&
    scenarioName.trim().length > 0 &&
    typeof metrics.p50_mwh === "number" &&
    typeof metrics.p90_mwh === "number" &&
    typeof metrics.pr_pct === "number" &&
    typeof metrics.specific_yield_kwh_kwp === "number";

  const save = () => {
    if (!canSave) return;
    importScenario.mutate({
      scenarioName: scenarioName.trim(),
      documentId,
      metrics: {
        p50_mwh: metrics.p50_mwh!,
        p90_mwh: metrics.p90_mwh!,
        pr_pct: metrics.pr_pct!,
        specific_yield_kwh_kwp: metrics.specific_yield_kwh_kwp!,
      },
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Upload report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Scenario name</Label>
            <Input
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              maxLength={60}
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label>PVsyst file (PDF or CSV)</Label>
            <Input
              type="file"
              accept=".pdf,.csv"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              disabled={!canWrite}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              CSV metrics are parsed automatically. PDF is stored as-is — enter
              metrics manually.
            </p>
          </div>
          <Button
            onClick={doUpload}
            disabled={!file || uploading || !canWrite}
          >
            {uploading ? "Uploading…" : "Upload"}
          </Button>
          {documentId && (
            <p className="text-xs text-muted-foreground">
              Stored — document id ends {documentId.slice(-8)}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Metrics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <MetricInput
            label="P50 (MWh/yr)"
            value={metrics.p50_mwh}
            onChange={(v) => setMetrics((m) => ({ ...m, p50_mwh: v }))}
          />
          <MetricInput
            label="P90 (MWh/yr)"
            value={metrics.p90_mwh}
            onChange={(v) => setMetrics((m) => ({ ...m, p90_mwh: v }))}
          />
          <MetricInput
            label="Specific yield (kWh/kWp)"
            value={metrics.specific_yield_kwh_kwp}
            onChange={(v) =>
              setMetrics((m) => ({ ...m, specific_yield_kwh_kwp: v }))
            }
          />
          <MetricInput
            label="PR (%)"
            value={metrics.pr_pct}
            onChange={(v) => setMetrics((m) => ({ ...m, pr_pct: v }))}
          />
          <div className="flex justify-end pt-2">
            <Button
              onClick={save}
              disabled={!canSave || importScenario.isPending}
            >
              {importScenario.isPending
                ? "Saving…"
                : "Save as imported scenario"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        step="0.01"
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
      />
    </div>
  );
}
