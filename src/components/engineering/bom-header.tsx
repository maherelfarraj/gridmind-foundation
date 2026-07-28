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
import { useI18n } from "@/lib/i18n/locale-provider";

const STATUS_VARIANT: Record<BomSnapshotRow["status"], "default" | "secondary" | "outline"> = {
  draft: "outline",
  released: "default",
  superseded: "secondary",
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
  const { t } = useI18n();
  const STATUS_LABEL: Record<BomSnapshotRow["status"], string> = {
    draft: t("engMod.calculators.bomHeader.statusLabels.draft"),
    released: t("engMod.calculators.bomHeader.statusLabels.released"),
    superseded: t("engMod.calculators.bomHeader.statusLabels.superseded"),
  };
  const snap = detail?.snapshot;
  const totals = (snap?.totals ?? {}) as any;
  const params = (snap?.params ?? {}) as any;
  const isReleased = snap?.status === "released";

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="text-base">{t("engMod.calculators.bomHeader.title")}</CardTitle>
          {snap && <Badge variant={STATUS_VARIANT[snap.status]}>{STATUS_LABEL[snap.status]}</Badge>}
          {snapshots.length > 0 && (
            <Select value={selectedId} onValueChange={onSelect}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={t("engMod.calculators.bomHeader.metrics.version")} />
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
            <Download className="mr-1 h-4 w-4" /> {t("engMod.calculators.bomHeader.exportCsv")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onGenerate}
            disabled={!canWrite || generating}
          >
            <Play className="mr-1 h-4 w-4" />
            {generating
              ? t("engMod.calculators.bomHeader.generating")
              : snapshots.length === 0
                ? t("engMod.calculators.bomHeader.generate")
                : t("engMod.calculators.bomHeader.regenerate")}
          </Button>
          <Button
            size="sm"
            onClick={onRelease}
            disabled={!canRelease || !snap || isReleased || releasing}
          >
            <Rocket className="mr-1 h-4 w-4" />
            {releasing ? t("engMod.calculators.bomHeader.releasing") : t("engMod.calculators.bomHeader.release")}
          </Button>
        </div>
      </CardHeader>
      {snap && (
        <CardContent className="grid gap-4 md:grid-cols-4">
          <Metric label={t("engMod.calculators.bomHeader.metrics.version")} value={`v${snap.version}`} />
          <Metric
            label={t("engMod.calculators.bomHeader.metrics.capacity")}
            value={params.capacity_mwp_dc != null ? Number(params.capacity_mwp_dc).toFixed(1) : "—"}
          />
          <Metric
            label={t("engMod.calculators.bomHeader.metrics.lineCount")}
            value={totals.line_count != null ? String(totals.line_count) : "—"}
          />
          <Metric
            label={t("engMod.calculators.bomHeader.metrics.estimatedTotal")}
            value={
              typeof totals.total_cost === "number" && totals.total_cost > 0
                ? currency(totals.total_cost)
                : t("engMod.calculators.bomHeader.addUnitCosts")
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
