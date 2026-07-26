// P-151 — Map-free coordinate canvas for site boundary + exclusion zones.
import { useMemo, useRef, useState } from "react";
import { Crosshair, MousePointer2, Pentagon, Trash2, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  closeRing,
  formatArea,
  openRing,
  polygonAreaM2,
  ringAreaM2,
  scaleBarMeters,
  snapMeters,
  toLngLat,
  toLocalMeters,
  validateRing,
  type LngLat,
  type PointM,
  type Ring,
} from "@/lib/pv-site.geo";
import type { PvExclusion } from "@/lib/pv-site.schemas";

export type CanvasTool = "select" | "boundary" | "exclusion";

const VIEW_W = 900;
const VIEW_H = 560;
const PADDING = 48;

interface Props {
  anchor: LngLat;
  northOffsetDeg: number;
  boundary: Ring;
  exclusions: PvExclusion[];
  activeExclusionId: string | null;
  tool: CanvasTool;
  snap: boolean;
  readOnly?: boolean;
  onToolChange: (tool: CanvasTool) => void;
  onSnapChange: (snap: boolean) => void;
  onBoundaryChange: (ring: Ring) => void;
  onExclusionRingChange: (id: string, ring: Ring) => void;
}

function ringToPoints(ring: Ring, anchor: LngLat): PointM[] {
  return openRing(ring).map(([lon, lat]) => toLocalMeters({ lon, lat }, anchor));
}

export function PvBoundaryCanvas({
  anchor,
  northOffsetDeg,
  boundary,
  exclusions,
  activeExclusionId,
  tool,
  snap,
  readOnly = false,
  onToolChange,
  onSnapChange,
  onBoundaryChange,
  onExclusionRingChange,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{ target: "boundary" | string; index: number } | null>(null);

  const boundaryPts = useMemo(() => ringToPoints(boundary, anchor), [boundary, anchor]);
  const exclusionPts = useMemo(
    () =>
      exclusions.map((e) => ({
        id: e.id,
        name: e.name,
        pts: ringToPoints((e.polygon.coordinates?.[0] ?? []) as Ring, anchor),
      })),
    [exclusions, anchor],
  );

  // World → screen transform: fit everything with a sane default extent.
  const { scale, offsetX, offsetY } = useMemo(() => {
    const all = [...boundaryPts, ...exclusionPts.flatMap((e) => e.pts)];
    if (all.length === 0) {
      const s = (VIEW_W - PADDING * 2) / 1200; // default ~1.2 km wide view
      return { scale: s, offsetX: VIEW_W / 2, offsetY: VIEW_H / 2 };
    }
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = Math.max(maxX - minX, 200);
    const h = Math.max(maxY - minY, 200);
    const s = Math.min((VIEW_W - PADDING * 2) / w, (VIEW_H - PADDING * 2) / h);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return { scale: s, offsetX: VIEW_W / 2 - cx * s, offsetY: VIEW_H / 2 + cy * s };
  }, [boundaryPts, exclusionPts]);

  const toScreen = (p: PointM) => ({ x: offsetX + p.x * scale, y: offsetY - p.y * scale });
  const toWorld = (sx: number, sy: number): PointM => {
    const raw = { x: (sx - offsetX) / scale, y: (offsetY - sy) / scale };
    return snap ? { x: snapMeters(raw.x, 5), y: snapMeters(raw.y, 5) } : raw;
  };

  const eventWorld = (evt: React.MouseEvent): PointM | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const sx = ((evt.clientX - rect.left) / rect.width) * VIEW_W;
    const sy = ((evt.clientY - rect.top) / rect.height) * VIEW_H;
    return toWorld(sx, sy);
  };

  const activeTargetRing = (): { ring: Ring; commit: (r: Ring) => void } | null => {
    if (tool === "boundary") return { ring: boundary, commit: onBoundaryChange };
    if (tool === "exclusion" && activeExclusionId) {
      const ex = exclusions.find((e) => e.id === activeExclusionId);
      if (!ex) return null;
      return {
        ring: (ex.polygon.coordinates?.[0] ?? []) as Ring,
        commit: (r) => onExclusionRingChange(activeExclusionId, r),
      };
    }
    return null;
  };

  const handleClick = (evt: React.MouseEvent) => {
    if (readOnly || drag) return;
    const target = activeTargetRing();
    if (!target) return;
    const world = eventWorld(evt);
    if (!world) return;
    const ll = toLngLat(world, anchor);
    const open = openRing(target.ring);
    target.commit(closeRing([...open, [ll.lon, ll.lat]] as Ring));
  };

  const removeVertex = (which: "boundary" | string, index: number) => {
    if (readOnly) return;
    if (which === "boundary") {
      const open = openRing(boundary);
      const next = open.filter((_, i) => i !== index);
      onBoundaryChange(next.length >= 3 ? closeRing(next as Ring) : (next as Ring));
      return;
    }
    const ex = exclusions.find((e) => e.id === which);
    if (!ex) return;
    const open = openRing((ex.polygon.coordinates?.[0] ?? []) as Ring);
    const next = open.filter((_, i) => i !== index);
    onExclusionRingChange(which, next.length >= 3 ? closeRing(next as Ring) : (next as Ring));
  };

  const moveVertex = (evt: React.MouseEvent) => {
    if (!drag || readOnly) return;
    const world = eventWorld(evt);
    if (!world) return;
    const ll = toLngLat(world, anchor);
    if (drag.target === "boundary") {
      const open = openRing(boundary);
      open[drag.index] = [ll.lon, ll.lat];
      onBoundaryChange(closeRing(open as Ring));
    } else {
      const ex = exclusions.find((e) => e.id === drag.target);
      if (!ex) return;
      const open = openRing((ex.polygon.coordinates?.[0] ?? []) as Ring);
      open[drag.index] = [ll.lon, ll.lat];
      onExclusionRingChange(drag.target, closeRing(open as Ring));
    }
  };

  const boundaryArea = polygonAreaM2(boundaryPts);
  const exclusionArea = exclusionPts.reduce((sum, e) => sum + polygonAreaM2(e.pts), 0);
  const netArea = Math.max(boundaryArea - exclusionArea, 0);
  const boundaryIssue = boundary.length >= 3 ? validateRing(boundary) : null;

  const barMeters = scaleBarMeters(1 / scale);
  const barPx = barMeters * scale;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border p-0.5">
          <ToolButton
            active={tool === "select"}
            onClick={() => onToolChange("select")}
            icon={<MousePointer2 className="h-4 w-4" />}
            label="Select"
          />
          <ToolButton
            active={tool === "boundary"}
            onClick={() => onToolChange("boundary")}
            icon={<Pentagon className="h-4 w-4" />}
            label="Draw boundary"
          />
          <ToolButton
            active={tool === "exclusion"}
            onClick={() => onToolChange("exclusion")}
            icon={<Crosshair className="h-4 w-4" />}
            label="Draw exclusion"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="snap" checked={snap} onCheckedChange={onSnapChange} disabled={readOnly} />
          <Label htmlFor="snap" className="text-sm">
            Snap 5 m
          </Label>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly || openRing(boundary).length === 0}
          onClick={() => {
            const open = openRing(boundary);
            const next = open.slice(0, -1);
            onBoundaryChange(next.length >= 3 ? closeRing(next as Ring) : (next as Ring));
          }}
        >
          <Undo2 className="mr-2 h-4 w-4" /> Undo vertex
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly || boundary.length === 0}
          onClick={() => onBoundaryChange([])}
        >
          <Trash2 className="mr-2 h-4 w-4" /> Clear boundary
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline">Gross {formatArea(boundaryArea)}</Badge>
          <Badge variant="outline">Exclusions {formatArea(exclusionArea)}</Badge>
          <Badge>Usable {formatArea(netArea)}</Badge>
        </div>
      </div>

      {boundaryIssue ? (
        <p className="text-sm text-destructive" role="alert">
          {boundaryIssue.message}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className={cn("h-[560px] w-full touch-none select-none", !readOnly && "cursor-crosshair")}
          onClick={handleClick}
          onMouseMove={moveVertex}
          onMouseUp={() => setDrag(null)}
          onMouseLeave={() => setDrag(null)}
          role="img"
          aria-label="Site boundary coordinate canvas"
        >
          <defs>
            <pattern id="pv-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                className="stroke-border"
                strokeWidth="0.5"
                opacity="0.6"
              />
            </pattern>
          </defs>
          <rect width={VIEW_W} height={VIEW_H} className="fill-muted/30" />
          <rect width={VIEW_W} height={VIEW_H} fill="url(#pv-grid)" />

          {/* anchor cross */}
          <g className="stroke-muted-foreground" strokeWidth="1" opacity="0.7">
            <line x1={offsetX - 8} y1={offsetY} x2={offsetX + 8} y2={offsetY} />
            <line x1={offsetX} y1={offsetY - 8} x2={offsetX} y2={offsetY + 8} />
          </g>

          {/* boundary */}
          {boundaryPts.length > 1 ? (
            <polygon
              points={boundaryPts
                .map((p) => {
                  const s = toScreen(p);
                  return `${s.x},${s.y}`;
                })
                .join(" ")}
              className="fill-primary/10 stroke-primary"
              strokeWidth="2"
            />
          ) : null}

          {/* exclusions */}
          {exclusionPts.map((e) =>
            e.pts.length > 1 ? (
              <polygon
                key={e.id}
                points={e.pts
                  .map((p) => {
                    const s = toScreen(p);
                    return `${s.x},${s.y}`;
                  })
                  .join(" ")}
                className={cn(
                  "fill-destructive/20 stroke-destructive",
                  e.id === activeExclusionId && "fill-destructive/30",
                )}
                strokeWidth="1.5"
                strokeDasharray="6 3"
              />
            ) : null,
          )}

          {/* vertices */}
          {!readOnly &&
            boundaryPts.map((p, i) => {
              const s = toScreen(p);
              return (
                <circle
                  key={`b-${i}`}
                  cx={s.x}
                  cy={s.y}
                  r={5}
                  className="fill-background stroke-primary"
                  strokeWidth="2"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setDrag({ target: "boundary", index: i });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    removeVertex("boundary", i);
                  }}
                />
              );
            })}
          {!readOnly &&
            exclusionPts
              .filter((e) => e.id === activeExclusionId)
              .flatMap((e) =>
                e.pts.map((p, i) => {
                  const s = toScreen(p);
                  return (
                    <circle
                      key={`${e.id}-${i}`}
                      cx={s.x}
                      cy={s.y}
                      r={4.5}
                      className="fill-background stroke-destructive"
                      strokeWidth="2"
                      onMouseDown={(ev) => {
                        ev.stopPropagation();
                        setDrag({ target: e.id, index: i });
                      }}
                      onClick={(ev) => ev.stopPropagation()}
                      onDoubleClick={(ev) => {
                        ev.stopPropagation();
                        removeVertex(e.id, i);
                      }}
                    />
                  );
                }),
              )}

          {/* north arrow */}
          <g transform={`translate(${VIEW_W - 56} 56) rotate(${-northOffsetDeg})`}>
            <line x1="0" y1="22" x2="0" y2="-22" className="stroke-foreground" strokeWidth="2" />
            <polygon points="0,-28 6,-16 -6,-16" className="fill-foreground" />
            <text y="36" textAnchor="middle" className="fill-foreground text-[11px]">
              N
            </text>
          </g>

          {/* scale bar */}
          <g transform={`translate(24 ${VIEW_H - 32})`}>
            <line x1="0" y1="0" x2={barPx} y2="0" className="stroke-foreground" strokeWidth="2" />
            <line x1="0" y1="-5" x2="0" y2="5" className="stroke-foreground" strokeWidth="2" />
            <line
              x1={barPx}
              y1="-5"
              x2={barPx}
              y2="5"
              className="stroke-foreground"
              strokeWidth="2"
            />
            <text x={barPx / 2} y="-10" textAnchor="middle" className="fill-foreground text-[11px]">
              {barMeters >= 1000 ? `${barMeters / 1000} km` : `${barMeters} m`}
            </text>
          </g>
        </svg>
      </div>

      <p className="text-xs text-muted-foreground">
        Click to add vertices with the active tool, drag a vertex to move it, double-click a vertex
        to delete it. Areas use the shoelace formula on the local equirectangular projection about
        the site anchor.
      </p>
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "ghost"}
      onClick={onClick}
      aria-pressed={active}
    >
      {icon}
      <span className="ml-2">{label}</span>
    </Button>
  );
}

export { ringAreaM2 };
