// P-161 — Civil analysis panel: cut/fill, pile schedule, slope tolerance,
// drainage proposals and the coordinate schedule export. Tokens only.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Droplets, Layers, Mountain, Ruler, Shovel } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  confirmDrainageProposals,
  exportCivilCoordinateSchedule,
  listCivilFeatures,
  proposeDrainage,
  runCutFillAnalysis,
  runPileEstimate,
  runSlopeToleranceCheck,
} from "@/lib/civil.functions";
import { civilFeaturesQueryOptions, parseServerError } from "@/lib/civil-query";
import type { DrainageProposal } from "@/lib/civil/flow";
import type { PileScheduleRow, PileScheduleSummary } from "@/lib/civil/piles";
import type { SlopeCheckBlockResult, SlopeCheckSummary } from "@/lib/civil/slopeCheck";

type Props = {
  projectId: string;
  surfaceId: string | null;
  canWrite: boolean;
  onProposalsChange?: (proposals: DrainageProposal[]) => void;
};

const M3 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const M2 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function CivilAnalysisPanel({ projectId, surfaceId, canWrite, onProposalsChange }: Props) {
  const qc = useQueryClient();
  const listFn = useServerFn(listCivilFeatures);
  const cutFillFn = useServerFn(runCutFillAnalysis);
  const slopeFn = useServerFn(runSlopeToleranceCheck);
  const pileFn = useServerFn(runPileEstimate);
  const drainageFn = useServerFn(proposeDrainage);
  const confirmFn = useServerFn(confirmDrainageProposals);
  const exportFn = useServerFn(exportCivilCoordinateSchedule);

  const features = useQuery(civilFeaturesQueryOptions(listFn as never, projectId));
  const zones = useMemo(
    () => (features.data ?? []).filter((f) => f.feature_type === "grading_zone"),
    [features.data],
  );
  const [zoneId, setZoneId] = useState<string | null>(null);
  const activeZone = zones.find((z) => z.id === (zoneId ?? zones[0]?.id)) ?? null;

  const [tolerance, setTolerance] = useState(10);
  const [pileSpacing, setPileSpacing] = useState(6);
  const [slope, setSlope] = useState<{
    results: SlopeCheckBlockResult[];
    summary: SlopeCheckSummary;
  } | null>(null);
  const [piles, setPiles] = useState<{
    rows: PileScheduleRow[];
    summary: PileScheduleSummary;
    embedment_m: number;
  } | null>(null);
  const [proposals, setProposals] = useState<DrainageProposal[]>([]);

  const fail = (err: unknown) => toast.error(parseServerError(err));

  const cutFill = useMutation({
    mutationFn: () => cutFillFn({ data: { featureId: activeZone!.id, surfaceId } }),
    onSuccess: (res) => {
      toast.success(`Cut/fill computed for ${res.feature.feature_ref}`);
      qc.invalidateQueries({ queryKey: ["civil-features", projectId] });
    },
    onError: fail,
  });

  const slopeCheck = useMutation({
    mutationFn: () =>
      slopeFn({ data: { projectId, surfaceId: surfaceId!, maxSlopePct: tolerance } }),
    onSuccess: (res) => {
      setSlope({ results: res.results, summary: res.summary });
      toast.success(`Slope check: ${res.summary.failing} failing, ${res.summary.warning} warning`);
    },
    onError: fail,
  });

  const pileRun = useMutation({
    mutationFn: () =>
      pileFn({ data: { projectId, surfaceId: surfaceId!, pileSpacingM: pileSpacing } }),
    onSuccess: (res) => {
      setPiles({ rows: res.rows, summary: res.summary, embedment_m: res.embedment_m });
      toast.success(`${res.summary.piles} piles estimated`);
    },
    onError: fail,
  });

  const drainage = useMutation({
    mutationFn: () => drainageFn({ data: { surfaceId: surfaceId!, maxPaths: 5 } }),
    onSuccess: (res) => {
      setProposals(res.proposals);
      onProposalsChange?.(res.proposals);
      toast.success(
        res.proposals.length
          ? `${res.proposals.length} drainage paths proposed — review before saving`
          : "No channels above the accumulation threshold",
      );
    },
    onError: fail,
  });

  const confirmDrainage = useMutation({
    mutationFn: () =>
      confirmFn({
        data: {
          projectId,
          surfaceId: surfaceId!,
          confirmed: true as const,
          proposals: proposals.map((p) => ({
            proposal_ref: p.proposal_ref,
            coordinates: p.coordinates,
            catchment_m2: p.catchment_m2,
            length_m: p.length_m,
          })),
        },
      }),
    onSuccess: (res) => {
      toast.success(`${res.created} drainage paths saved as draft features`);
      setProposals([]);
      onProposalsChange?.([]);
      qc.invalidateQueries({ queryKey: ["civil-features", projectId] });
    },
    onError: fail,
  });

  const exportCsv = useMutation({
    mutationFn: () => exportFn({ data: { projectId, surfaceId } }),
    onSuccess: (res) => {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Coordinate schedule exported (${res.rows.length} vertices)`);
    },
    onError: fail,
  });

  const analysis = (activeZone?.properties?.analysis ?? null) as null | {
    cut_m3: number;
    fill_m3: number;
    net_m3: number;
    area_m2: number;
    method: string;
    computed_at: string;
  };

  const disabled = !surfaceId || !canWrite;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shovel className="size-4" aria-hidden /> Cut &amp; fill
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {zones.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No grading zones yet. Add a grading_zone civil feature to run earthworks volumes.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="civil-zone">Grading zone</Label>
                <Select value={activeZone?.id} onValueChange={setZoneId}>
                  <SelectTrigger id="civil-zone">
                    <SelectValue placeholder="Select a zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map((z) => (
                      <SelectItem key={z.id} value={z.id}>
                        {z.feature_ref} — {z.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                className="w-full"
                disabled={disabled || !activeZone || cutFill.isPending}
                onClick={() => cutFill.mutate()}
              >
                <Mountain className="mr-2 size-4" aria-hidden /> Run cut/fill analysis
              </Button>
              {analysis ? (
                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Cut" value={`${M3.format(analysis.cut_m3)} m³`} />
                  <Metric label="Fill" value={`${M3.format(analysis.fill_m3)} m³`} />
                  <Metric
                    label="Net"
                    value={`${M3.format(analysis.net_m3)} m³ ${analysis.net_m3 >= 0 ? "export" : "import"}`}
                  />
                  <Metric label="Area" value={`${M2.format(analysis.area_m2)} m²`} />
                  <p className="col-span-2 text-xs text-muted-foreground">
                    Method: {analysis.method.replace(/_/g, " ")} · computed{" "}
                    {new Date(analysis.computed_at).toLocaleString()}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="size-4" aria-hidden /> Slope tolerance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="civil-tolerance">Max slope (%)</Label>
            <Input
              id="civil-tolerance"
              type="number"
              min={1}
              max={100}
              step={0.5}
              value={tolerance}
              onChange={(e) => setTolerance(Math.max(1, Number(e.target.value) || 10))}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={disabled || slopeCheck.isPending}
            onClick={() => slopeCheck.mutate()}
          >
            Run slope check on layout blocks
          </Button>
          {slope ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <StatusBadge status="pass" label={`${slope.summary.passing} pass`} />
                <StatusBadge
                  status="warning"
                  tone="attention"
                  label={`${slope.summary.warning} warn`}
                />
                <StatusBadge
                  status="failed"
                  tone="critical"
                  label={`${slope.summary.failing} fail`}
                />
              </div>
              <div className="max-h-64 overflow-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Block</TableHead>
                      <TableHead className="text-right">In-row</TableHead>
                      <TableHead className="text-right">Cross-row</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {slope.results.map((r) => (
                      <TableRow key={r.block_id}>
                        <TableCell className="font-medium">
                          {r.label ?? r.block_id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.max_in_row_pct.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.max_cross_row_pct.toFixed(1)}%
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={r.status}
                            tone={
                              r.status === "fail"
                                ? "critical"
                                : r.status === "warn"
                                  ? "attention"
                                  : r.status === "pass"
                                    ? "positive"
                                    : "neutral"
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Ruler className="size-4" aria-hidden /> Pile schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="civil-pile-spacing">Pile spacing (m)</Label>
            <Input
              id="civil-pile-spacing"
              type="number"
              min={1}
              max={20}
              step={0.5}
              value={pileSpacing}
              onChange={(e) => setPileSpacing(Math.max(1, Number(e.target.value) || 6))}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={!surfaceId || pileRun.isPending}
            onClick={() => pileRun.mutate()}
          >
            Estimate pile lengths
          </Button>
          {piles ? (
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Piles" value={String(piles.summary.piles)} />
              <Metric label="Embedment" value={`${piles.embedment_m.toFixed(2)} m`} />
              <Metric
                label="Length range"
                value={`${piles.summary.min_length_m.toFixed(2)}–${piles.summary.max_length_m.toFixed(2)} m`}
              />
              <Metric label="Total steel" value={`${M3.format(piles.summary.total_length_m)} m`} />
              {piles.summary.exceeding > 0 ? (
                <p className="col-span-2 text-xs text-destructive">
                  {piles.summary.exceeding} piles exceed the maximum length — regrade or use a
                  special foundation.
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Droplets className="size-4" aria-hidden /> Drainage proposals
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            D8 flow accumulation proposes channels. Nothing is saved until you confirm — proposals
            then land as draft civil features for engineering review.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={!surfaceId || drainage.isPending}
            onClick={() => drainage.mutate()}
          >
            Propose drainage paths
          </Button>
          {proposals.length ? (
            <div className="space-y-2">
              <ul className="space-y-1 text-sm">
                {proposals.map((p) => (
                  <li key={p.proposal_ref} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{p.proposal_ref}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {p.length_m.toFixed(0)} m · {M2.format(p.catchment_m2)} m² catchment
                    </span>
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                className="w-full"
                disabled={disabled || confirmDrainage.isPending}
                onClick={() => confirmDrainage.mutate()}
              >
                Confirm &amp; save as draft features
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={exportCsv.isPending || (features.data?.length ?? 0) === 0}
        onClick={() => exportCsv.mutate()}
      >
        <Download className="mr-2 size-4" aria-hidden /> Export coordinate schedule (CSV)
      </Button>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
