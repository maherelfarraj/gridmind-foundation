// P-160 — Terrain visualization workspace: contours, slope heat map & surface import.
import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Download, Mountain, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import {
  TerrainCanvas,
  type TerrainCursor,
  type TerrainLayers,
  type TerrainOverlay,
} from "@/components/engineering/terrain-canvas";
import { CivilAnalysisPanel } from "@/components/engineering/civil-analysis-panel";
import { civilFeaturesQueryOptions } from "@/lib/civil-query";
import { listCivilFeatures } from "@/lib/civil.functions";
import { geometryVertexLists } from "@/lib/civil/geom";
import type { DrainageProposal } from "@/lib/civil/flow";
import {
  getTerrainSurface,
  getTerrainWriteAccess,
  listTerrainSurfaces,
} from "@/lib/terrain.functions";
import {
  parseServerError,
  terrainSurfaceQueryOptions,
  terrainSurfacesQueryOptions,
  terrainWriteAccessQueryOptions,
  useDeleteTerrainSurface,
  useImportTerrainSurface,
} from "@/lib/terrain-query";
import { SAMPLE_TERRAIN_CSV } from "@/lib/terrain/parse";

export const Route = createFileRoute("/_authenticated/projects/$projectId/engineering/terrain")({
  head: () => ({
    meta: [
      { title: "Terrain & civil surfaces — GridMind EPC" },
      {
        name: "description",
        content:
          "Import survey or DEM data, then review contour lines, slope heat maps and elevation statistics for the project site.",
      },
      { property: "og:title", content: "Terrain & civil surfaces — GridMind EPC" },
      {
        property: "og:description",
        content: "Contours, slope analysis and terrain surface import for renewable EPC sites.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TerrainPage,
});

const CRS_OPTIONS = ["EPSG:4326", "EPSG:32636", "EPSG:32637", "EPSG:3857", "Local grid"];

function TerrainPage() {
  const { projectId } = Route.useParams();
  const listFn = useServerFn(listTerrainSurfaces);
  const detailFn = useServerFn(getTerrainSurface);
  const accessFn = useServerFn(getTerrainWriteAccess);

  const surfaces = useSuspenseQuery(terrainSurfacesQueryOptions(listFn, projectId));
  const access = useQuery(terrainWriteAccessQueryOptions(accessFn));
  const canWrite = access.data?.canWrite ?? false;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeId = selectedId ?? surfaces.data[0]?.id ?? null;
  const detail = useQuery(terrainSurfaceQueryOptions(detailFn, activeId));

  const [layers, setLayers] = useState<TerrainLayers>({
    contours: true,
    slope: true,
    points: false,
  });
  const [contourInterval, setContourInterval] = useState(1);
  const [cursor, setCursor] = useState<TerrainCursor | null>(null);
  const [showCivil, setShowCivil] = useState(true);
  const [proposals, setProposals] = useState<DrainageProposal[]>([]);

  const civilFn = useServerFn(listCivilFeatures);
  const civilFeatures = useQuery(civilFeaturesQueryOptions(civilFn as never, projectId));

  const overlays = useMemo<TerrainOverlay[]>(() => {
    if (!showCivil) return [];
    const fromFeatures: TerrainOverlay[] = (civilFeatures.data ?? [])
      .filter((f) =>
        ["flood_risk_zone", "drainage_path", "grading_zone"].includes(f.feature_type),
      )
      .map((f) => ({
        id: f.id,
        kind:
          f.feature_type === "flood_risk_zone"
            ? ("flood" as const)
            : f.feature_type === "drainage_path"
              ? ("drainage" as const)
              : ("grading" as const),
        parts: geometryVertexLists(f.geometry),
        closed: f.feature_type !== "drainage_path",
        label: f.feature_ref,
      }));
    const fromProposals: TerrainOverlay[] = proposals.map((p) => ({
      id: `proposal-${p.proposal_ref}`,
      kind: "proposal" as const,
      parts: [p.coordinates],
      closed: false,
      label: p.proposal_ref,
    }));
    return [...fromFeatures, ...fromProposals];
  }, [civilFeatures.data, proposals, showCivil]);

  const deleteSurface = useDeleteTerrainSurface(projectId);

  const points = useMemo(
    () =>
      (detail.data?.points ?? []).map((p) => ({
        easting: p.easting,
        northing: p.northing,
        elevation_m: p.elevation_m,
        grid_row: p.grid_row ?? undefined,
        grid_col: p.grid_col ?? undefined,
      })),
    [detail.data],
  );
  const contours = useMemo(
    () =>
      (detail.data?.contours ?? []).map((c) => ({
        elevation_m: c.elevation_m,
        is_major: c.is_major,
        coordinates: (c.geometry?.coordinates ?? []) as [number, number][],
      })),
    [detail.data],
  );
  const surface = detail.data?.surface ?? null;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Terrain & civil surfaces"
        description="Import survey points or an Esri ASCII DEM, then inspect contours, slope and elevation range before civil design."
      />

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 pt-6">
              <Label htmlFor="terrain-surface">Surface</Label>
              {surfaces.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">No surfaces yet.</p>
              ) : (
                <Select value={activeId ?? undefined} onValueChange={setSelectedId}>
                  <SelectTrigger id="terrain-surface">
                    <SelectValue placeholder="Select a surface" />
                  </SelectTrigger>
                  <SelectContent>
                    {surfaces.data.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} — rev {s.revision_code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {surface ? (
                <dl className="space-y-1.5 text-sm">
                  <Row label="Status">
                    <Badge variant="secondary">{surface.status}</Badge>
                  </Row>
                  <Row label="Source">{surface.source_type}</Row>
                  <Row label="CRS">{surface.crs}</Row>
                  <Row label="Grid">
                    {surface.grid_rows ?? "—"}×{surface.grid_cols ?? "—"} @ {surface.grid_spacing_m}{" "}
                    m
                  </Row>
                  <Row label="Elevation">
                    {surface.min_elevation_m?.toFixed(1) ?? "—"}–
                    {surface.max_elevation_m?.toFixed(1) ?? "—"} m
                  </Row>
                  {surface.source_notes ? <Row label="Notes">{surface.source_notes}</Row> : null}
                </dl>
              ) : null}

              {canWrite && surface ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={deleteSurface.isPending}
                  onClick={() => {
                    if (confirm(`Delete surface "${surface.name}"? This cannot be undone.`)) {
                      setSelectedId(null);
                      deleteSurface.mutate(surface.id);
                    }
                  }}
                >
                  <Trash2 className="mr-2 size-4" /> Delete surface
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <p className="text-sm font-medium">Layers</p>
              <LayerToggle
                id="layer-contours"
                label="Contour lines"
                checked={layers.contours}
                onChange={(v) => setLayers((l) => ({ ...l, contours: v }))}
              />
              <LayerToggle
                id="layer-slope"
                label="Slope heat map"
                checked={layers.slope}
                onChange={(v) => setLayers((l) => ({ ...l, slope: v }))}
              />
              <LayerToggle
                id="layer-civil"
                label="Flood & drainage overlays"
                checked={showCivil}
                onChange={setShowCivil}
              />
              <LayerToggle
                id="layer-points"
                label="Survey points"
                checked={layers.points}
                onChange={(v) => setLayers((l) => ({ ...l, points: v }))}
              />
              <div className="space-y-1.5">
                <Label htmlFor="interval">Contour interval (m)</Label>
                <Input
                  id="interval"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={contourInterval}
                  onChange={(e) => setContourInterval(Math.max(0.1, Number(e.target.value) || 1))}
                />
                <p className="text-xs text-muted-foreground">
                  Redraws locally; stored contours use the interval chosen at import.
                </p>
              </div>
            </CardContent>
          </Card>

          {canWrite ? <ImportCard projectId={projectId} /> : null}

          <CivilAnalysisPanel
            projectId={projectId}
            surfaceId={activeId}
            canWrite={canWrite}
            onProposalsChange={setProposals}
          />
        </div>

        <Card>
          <CardContent className="pt-6">
            {detail.isLoading ? (
              <Skeleton className="h-[420px] w-full" />
            ) : !surface || points.length === 0 ? (
              <EmptyState
                icon={Mountain}
                title="No terrain surface loaded"
                description="Import a survey CSV (easting, northing, elevation_m) or an Esri ASCII grid to generate contours and a slope heat map."
              />
            ) : (
              <>
                <TerrainCanvas
                  points={points}
                  spacing={surface.grid_spacing_m}
                  contourInterval={contourInterval}
                  layers={layers}
                  contours={contourInterval === 1 ? contours : undefined}
                  overlays={overlays}
                  onCursorChange={setCursor}
                />
                <div className="mt-2 text-xs text-muted-foreground">
                  {cursor
                    ? `E ${cursor.easting.toFixed(1)} · N ${cursor.northing.toFixed(1)} · Z ${
                        cursor.elevation != null ? `${cursor.elevation.toFixed(2)} m` : "—"
                      } · slope ${cursor.slope != null ? `${cursor.slope.toFixed(1)}%` : "—"}`
                    : "Hover the map to inspect elevation and slope. Drag to pan, scroll or pinch to zoom."}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function LayerToggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ImportCard({ projectId }: { projectId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [revisionCode, setRevisionCode] = useState("A");
  const [crs, setCrs] = useState("EPSG:4326");
  const [interval, setInterval] = useState(1);
  const [notes, setNotes] = useState("");
  const [parseError, setParseError] = useState<{ code: string; message: string } | null>(null);
  const importer = useImportTerrainSurface(projectId);

  function downloadSample() {
    const blob = new Blob([SAMPLE_TERRAIN_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "terrain-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <p className="text-sm font-medium">Import surface</p>
        {parseError ? (
          <Alert variant="destructive" role="alert">
            <AlertTriangle className="size-4" />
            <AlertTitle className="flex items-center justify-between gap-2">
              <span>Import failed — nothing was saved</span>
              <button
                type="button"
                aria-label="Dismiss error"
                className="text-current opacity-70 hover:opacity-100"
                onClick={() => setParseError(null)}
              >
                <X className="size-4" />
              </button>
            </AlertTitle>
            <AlertDescription>
              {parseError.message}
              <span className="mt-1 block text-xs opacity-80">Code: {parseError.code}</span>
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="terrain-file">Source file (.csv, .asc, .txt, .dem)</Label>
          <Input
            id="terrain-file"
            ref={fileRef}
            type="file"
            accept=".csv,.asc,.txt,.dem"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !name) setName(f.name.replace(/\.[^.]+$/, ""));
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="terrain-name">Surface name</Label>
          <Input
            id="terrain-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="Existing ground — topo survey"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="terrain-rev">Revision</Label>
            <Input
              id="terrain-rev"
              value={revisionCode}
              maxLength={12}
              onChange={(e) => setRevisionCode(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="terrain-interval">Interval (m)</Label>
            <Input
              id="terrain-interval"
              type="number"
              min={0.1}
              step={0.1}
              value={interval}
              onChange={(e) => setInterval(Math.max(0.1, Number(e.target.value) || 1))}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="terrain-crs">Coordinate system</Label>
          <Select value={crs} onValueChange={setCrs}>
            <SelectTrigger id="terrain-crs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CRS_OPTIONS.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="terrain-notes">Notes</Label>
          <Textarea
            id="terrain-notes"
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Surveyor, datum, capture date…"
          />
        </div>
        <Button
          className="w-full"
          disabled={!file || !name.trim() || importer.isPending}
          onClick={() => {
            if (!file) return;
            setParseError(null);
            importer.mutate(
              {
                projectId,
                file,
                name: name.trim(),
                revisionCode: revisionCode.trim() || "A",
                contourInterval: interval,
                crs,
                notes: notes.trim() || undefined,
              },
              {
                onSuccess: () => {
                  setParseError(null);
                  setFile(null);
                  setNotes("");
                  if (fileRef.current) fileRef.current.value = "";
                },
                onError: (err) => {
                  const parsed = parseServerError(err);
                  setParseError({ code: parsed.code, message: parsed.message });
                  toast.error(parsed.message);
                },
              },
            );
          }}
        >
          <Upload className="mr-2 size-4" />
          {importer.isPending ? "Importing…" : "Import surface"}
        </Button>
        <Button variant="ghost" size="sm" className="w-full" onClick={downloadSample}>
          <Download className="mr-2 size-4" /> Download sample CSV
        </Button>
      </CardContent>
    </Card>
  );
}
