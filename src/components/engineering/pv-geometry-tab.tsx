// P-151 — Geometry tab: anchor inputs, canvas, exclusion list, terrain ref card.
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PvBoundaryCanvas, type CanvasTool } from "@/components/engineering/pv-boundary-canvas";
import { closeRing, formatArea, ringAreaM2, validateRing, type Ring } from "@/lib/pv-site.geo";
import {
  EXCLUSION_REASONS,
  EXCLUSION_REASON_LABELS,
  type ExclusionReason,
  type PvExclusion,
  type PvWeatherMeta,
} from "@/lib/pv-site.schemas";

interface Props {
  latitude: number;
  longitude: number;
  boundary: Ring;
  exclusions: PvExclusion[];
  meta: PvWeatherMeta;
  readOnly: boolean;
  onAnchorChange: (patch: { latitude?: number; longitude?: number }) => void;
  onBoundaryChange: (ring: Ring) => void;
  onExclusionsChange: (exclusions: PvExclusion[]) => void;
  onMetaChange: (patch: Partial<PvWeatherMeta>) => void;
}

function newId(): string {
  return `exc-${Math.random().toString(36).slice(2, 10)}`;
}

export function PvGeometryTab({
  latitude,
  longitude,
  boundary,
  exclusions,
  meta,
  readOnly,
  onAnchorChange,
  onBoundaryChange,
  onExclusionsChange,
  onMetaChange,
}: Props) {
  const [tool, setTool] = useState<CanvasTool>("select");
  const [snap, setSnap] = useState(true);
  const [activeExclusionId, setActiveExclusionId] = useState<string | null>(null);

  const anchor = { lat: latitude, lon: longitude };

  const addExclusion = () => {
    const id = newId();
    const next: PvExclusion = {
      id,
      name: `Exclusion ${exclusions.length + 1}`,
      reason: "setback",
      notes: null,
      polygon: { type: "Polygon", coordinates: [[]] as any },
    };
    onExclusionsChange([...exclusions, next]);
    setActiveExclusionId(id);
    setTool("exclusion");
  };

  const patchExclusion = (id: string, patch: Partial<PvExclusion>) => {
    onExclusionsChange(exclusions.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const setExclusionRing = (id: string, ring: Ring) => {
    patchExclusion(id, { polygon: { type: "Polygon", coordinates: [closeRing(ring)] as any } });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Site anchor (WGS84)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="lat">Latitude °</Label>
              <Input
                id="lat"
                type="number"
                step="0.000001"
                value={latitude}
                disabled={readOnly}
                onChange={(e) => onAnchorChange({ latitude: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lon">Longitude °</Label>
              <Input
                id="lon"
                type="number"
                step="0.000001"
                value={longitude}
                disabled={readOnly}
                onChange={(e) => onAnchorChange({ longitude: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="north">North offset °</Label>
              <Input
                id="north"
                type="number"
                step="0.1"
                value={meta.north_offset_deg}
                disabled={readOnly}
                onChange={(e) => onMetaChange({ north_offset_deg: Number(e.target.value) })}
              />
            </div>
          </CardContent>
        </Card>

        <PvBoundaryCanvas
          anchor={anchor}
          northOffsetDeg={meta.north_offset_deg}
          boundary={boundary}
          exclusions={exclusions}
          activeExclusionId={activeExclusionId}
          tool={tool}
          snap={snap}
          readOnly={readOnly}
          onToolChange={setTool}
          onSnapChange={setSnap}
          onBoundaryChange={onBoundaryChange}
          onExclusionRingChange={setExclusionRing}
        />
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Exclusion zones</CardTitle>
            {!readOnly ? (
              <Button size="sm" variant="outline" onClick={addExclusion}>
                <Plus className="mr-1 h-4 w-4" /> Add
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {exclusions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No exclusion zones. Add wadis, setbacks or access corridors to reduce usable area.
              </p>
            ) : (
              exclusions.map((e) => {
                const ring = (e.polygon.coordinates?.[0] ?? []) as Ring;
                const issue = ring.length >= 3 ? validateRing(ring) : null;
                return (
                  <div
                    key={e.id}
                    className={`space-y-2 rounded-md border p-3 ${
                      e.id === activeExclusionId ? "border-primary" : "border-border"
                    }`}
                    onClick={() => setActiveExclusionId(e.id)}
                  >
                    <Input
                      value={e.name}
                      disabled={readOnly}
                      onChange={(ev) => patchExclusion(e.id, { name: ev.target.value })}
                    />
                    <Select
                      value={e.reason}
                      disabled={readOnly}
                      onValueChange={(v) => patchExclusion(e.id, { reason: v as ExclusionReason })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXCLUSION_REASONS.map((r) => (
                          <SelectItem key={r} value={r}>
                            {EXCLUSION_REASON_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline">{formatArea(ringAreaM2(ring, anchor))}</Badge>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={e.id === activeExclusionId ? "default" : "ghost"}
                          onClick={() => {
                            setActiveExclusionId(e.id);
                            setTool("exclusion");
                          }}
                          disabled={readOnly}
                        >
                          Edit shape
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={readOnly}
                          aria-label={`Delete ${e.name}`}
                          onClick={() =>
                            onExclusionsChange(exclusions.filter((x) => x.id !== e.id))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {issue ? <p className="text-xs text-destructive">{issue.message}</p> : null}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Terrain reference</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="terrain-source">Source</Label>
              <Input
                id="terrain-source"
                placeholder="Topographic survey, SRTM, drone…"
                value={meta.terrain.source ?? ""}
                disabled={readOnly}
                onChange={(e) =>
                  onMetaChange({ terrain: { ...meta.terrain, source: e.target.value || null } })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="surface-id">Surface id</Label>
              <Input
                id="surface-id"
                value={meta.terrain.surface_id ?? ""}
                disabled={readOnly}
                onChange={(e) =>
                  onMetaChange({ terrain: { ...meta.terrain, surface_id: e.target.value || null } })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crs">CRS</Label>
              <Input
                id="crs"
                value={meta.terrain.crs ?? ""}
                disabled={readOnly}
                onChange={(e) =>
                  onMetaChange({ terrain: { ...meta.terrain, crs: e.target.value || null } })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="terrain-notes">Notes</Label>
              <Textarea
                id="terrain-notes"
                rows={3}
                value={meta.terrain.notes ?? ""}
                disabled={readOnly}
                onChange={(e) =>
                  onMetaChange({ terrain: { ...meta.terrain, notes: e.target.value || null } })
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Links to terrain surfaces once surface management ships.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
