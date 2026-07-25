// P-057 — BOM header card (version selector, status, totals, actions).
import { Download, Play, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BomSnapshotDetail, BomSnapshotRow } from "@/lib/bom.functions";

const STATUS_VARIANT: Record<BomSnapshotRow["status"], "default" | "secondary" | "outline"> = {
  draft: "outline",
  released: "default",
  superseded: "secondary",
};

const STATUS_LABEL: Record<BomSnapshotRow["status"], string> = {
  draft: "Draft",
  released: "Released",
  superseded: "Superseded",
};

export function BomHeader({
  snapshots,
  selectedId,
  onSelect,
  detail,
  canWrite,
  canRelease,
  generating,
  releasing,
  onGenerate,
  onRelease,
  onExport,
}: {
  snapshots: BomSnapshotRow[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  detail: BomSnapshotDetail | null;
  canWrite: boolean;
  canRelease: boolean;
  generating: boolean;
  releasing: boolean;
  onGenerate: () => void;
  onRelease: () => void;
  onExport: () => void;
}) {
  const snap = detail?.snapshot;
  const totals = (snap?.totals ?? {}) as any;
  const params = (snap?.params ?? {}) as any;
  const isReleased = snap?.status === "released";

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="text-base">Bill of materials</CardTitle>
          {snap && <Badge variant={STATUS_VARIANT[snap.status]}>{STATUS_LABEL[snap.status]}</Badge>}
          {snapshots.length > 0 && (
            <Select value={selectedId} onValueChange={onSelect}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Version" />
              </SelectTrigger>
              <SelectContent>
                {snapshots.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    v{s.version} — {STATUS_LABEL[s.status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={!detail || detail.lines.length === 0}
          >
            <Download className="mr-1 h-4 w-4" /> Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onGenerate}
            disabled={!canWrite || generating}
          >
            <Play className="mr-1 h-4 w-4" />
            {generating ? "Generating…" : snapshots.length === 0 ? "Generate" : "Regenerate"}
          </Button>
          <Button
            size="sm"
            onClick={onRelease}
            disabled={!canRelease || !snap || isReleased || releasing}
          >
            <Rocket className="mr-1 h-4 w-4" />
            {releasing ? "Releasing…" : "Release"}
          </Button>
        </div>
      </CardHeader>
      {snap && (
        <CardContent className="grid gap-4 md:grid-cols-4">
          <Metric label="Version" value={`v${snap.version}`} />
          <Metric
            label="Capacity (MWp DC)"
            value={params.capacity_mwp_dc != null ? Number(params.capacity_mwp_dc).toFixed(1) : "—"}
          />
          <Metric
            label="Line count"
            value={totals.line_count != null ? String(totals.line_count) : "—"}
          />
          <Metric
            label="Estimated total"
            value={
              typeof totals.total_cost === "number" && totals.total_cost > 0
                ? currency(totals.total_cost)
                : "Add unit costs"
            }
          />
        </CardContent>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-medium">{value}</p>
    </div>
  );
}

function currency(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
