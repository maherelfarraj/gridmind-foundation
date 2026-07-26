// P-162 — Civil feature editor canvas. Same pan/zoom/grid model as the P-160
// terrain canvas, SVG based for hit-testing. Colours come from --civil-* theme
// tokens only; never raw hex.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CIVIL_TYPE_SPECS, type CivilFeatureType, type GeometryKind } from "@/lib/civil/feature-types";
import { geometryVertexLists, ringBBox, type GeoJsonGeometry, type Vertex } from "@/lib/civil/geom";
import { cn } from "@/lib/utils";

export type CanvasFeature = {
  id: string;
  feature_ref: string;
  name: string;
  feature_type: string;
  status: string;
  geometry: GeoJsonGeometry;
};

type Props = {
  features: CanvasFeature[];
  visibleTypes: Set<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** active drawing tool; null = select/pan mode */
  activeTool: CivilFeatureType | null;
  draft: Vertex[];
  onDraftChange: (vertices: Vertex[]) => void;
  onFinishDraft: () => void;
  onCancelDraft: () => void;
  /** vertex editing of the selected feature (disabled when read-only) */
  editable: boolean;
  onVertexMove?: (partIndex: number, vertexIndex: number, position: Vertex) => void;
  snapEnabled: boolean;
  snapStep: number;
  onHoverChange?: (position: Vertex | null) => void;
  className?: string;
};

const PAD = 32;

function snap(value: number, step: number, enabled: boolean): number {
  if (!enabled || step <= 0) return value;
  return Math.round(value / step) * step;
}

function kindOf(type: string): GeometryKind {
  return CIVIL_TYPE_SPECS[type as CivilFeatureType]?.kind ?? "line";
}

function colorVar(type: string): string {
  const spec = CIVIL_TYPE_SPECS[type as CivilFeatureType];
  return spec ? `var(${spec.cssVar})` : "var(--muted-foreground)";
}

export function CivilFeatureCanvas({
  features,
  visibleTypes,
  selectedId,
  onSelect,
  activeTool,
  draft,
  onDraftChange,
  onFinishDraft,
  onCancelDraft,
  editable,
  onVertexMove,
  snapEnabled,
  snapStep,
  onHoverChange,
  className,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 900, h: 560 });
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [hover, setHover] = useState<Vertex | null>(null);
  const pan = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const dragVertex = useRef<{ part: number; index: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth || 900, h: el.clientHeight || 560 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visible = useMemo(
    () => features.filter((f) => visibleTypes.has(f.feature_type)),
    [features, visibleTypes],
  );

  const extent = useMemo(() => {
    const rings = visible.flatMap((f) => geometryVertexLists(f.geometry));
    if (draft.length) rings.push(draft);
    const box = ringBBox(rings);
    if (!box) return { minX: 0, minY: 0, maxX: 200, maxY: 150 };
    const spanX = Math.max(20, box.maxX - box.minX);
    const spanY = Math.max(20, box.maxY - box.minY);
    return {
      minX: box.minX - spanX * 0.1,
      minY: box.minY - spanY * 0.1,
      maxX: box.maxX + spanX * 0.1,
      maxY: box.maxY + spanY * 0.1,
    };
    // draft length only (not identity) keeps the view stable while drawing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, draft.length]);

  const world = useMemo(() => {
    const wM = Math.max(1, extent.maxX - extent.minX);
    const hM = Math.max(1, extent.maxY - extent.minY);
    const base = Math.min((size.w - PAD * 2) / wM, (size.h - PAD * 2) / hM);
    const scale = base * view.zoom;
    const offX = (size.w - wM * scale) / 2 + view.panX;
    const offY = (size.h - hM * scale) / 2 + view.panY;
    return {
      scale,
      toScreen: (e: number, n: number): Vertex => [
        offX + (e - extent.minX) * scale,
        size.h - offY - (n - extent.minY) * scale,
      ],
      toWorld: (x: number, y: number): Vertex => [
        extent.minX + (x - offX) / scale,
        extent.minY + (size.h - y - offY) / scale,
      ],
    };
  }, [extent, size, view]);

  const pointerWorld = useCallback(
    (clientX: number, clientY: number): Vertex => {
      const rect = svgRef.current?.getBoundingClientRect();
      const x = clientX - (rect?.left ?? 0);
      const y = clientY - (rect?.top ?? 0);
      const [e, n] = world.toWorld(x, y);
      return [snap(e, snapStep, snapEnabled), snap(n, snapStep, snapEnabled)];
    },
    [world, snapEnabled, snapStep],
  );

  const handleMove = (ev: React.PointerEvent) => {
    if (pan.current) {
      setView((v) => ({
        ...v,
        panX: pan.current!.panX + (ev.clientX - pan.current!.x),
        panY: pan.current!.panY - (ev.clientY - pan.current!.y),
      }));
      return;
    }
    const world2 = pointerWorld(ev.clientX, ev.clientY);
    setHover(world2);
    onHoverChange?.(world2);
    if (dragVertex.current && onVertexMove) {
      onVertexMove(dragVertex.current.part, dragVertex.current.index, world2);
    }
  };

  const handleDown = (ev: React.PointerEvent) => {
    if (dragVertex.current) return;
    if (activeTool) return; // drawing handled on click
    pan.current = { x: ev.clientX, y: ev.clientY, panX: view.panX, panY: view.panY };
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  };

  const handleUp = () => {
    pan.current = null;
    dragVertex.current = null;
  };

  const handleClick = (ev: React.MouseEvent) => {
    if (!activeTool) return;
    const position = pointerWorld(ev.clientX, ev.clientY);
    const next = [...draft, position];
    onDraftChange(next);
    if (kindOf(activeTool) === "point") onFinishDraft();
  };

  const handleWheel = (ev: React.WheelEvent) => {
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((v) => ({ ...v, zoom: Math.min(40, Math.max(0.2, v.zoom * factor)) }));
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!activeTool) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        onCancelDraft();
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        onFinishDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTool, onCancelDraft, onFinishDraft]);

  // Grid lines every `gridStep` metres, adaptive to zoom.
  const gridStep = useMemo(() => {
    const target = 60 / Math.max(world.scale, 1e-6);
    const steps = [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
    return steps.find((s) => s >= target) ?? 1000;
  }, [world.scale]);

  const gridLines = useMemo(() => {
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const startX = Math.ceil(extent.minX / gridStep) * gridStep;
    for (let x = startX; x <= extent.maxX; x += gridStep) {
      const [sx, sy1] = world.toScreen(x, extent.minY);
      const [, sy2] = world.toScreen(x, extent.maxY);
      lines.push({ x1: sx, y1: sy1, x2: sx, y2: sy2 });
    }
    const startY = Math.ceil(extent.minY / gridStep) * gridStep;
    for (let y = startY; y <= extent.maxY; y += gridStep) {
      const [sx1, sy] = world.toScreen(extent.minX, y);
      const [sx2] = world.toScreen(extent.maxX, y);
      lines.push({ x1: sx1, y1: sy, x2: sx2, y2: sy });
    }
    return lines;
  }, [extent, gridStep, world]);

  const path = (ring: Vertex[], closed: boolean) => {
    if (!ring.length) return "";
    const d = ring
      .map(([e, n], i) => {
        const [x, y] = world.toScreen(e, n);
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
    return closed ? `${d} Z` : d;
  };

  const selected = visible.find((f) => f.id === selectedId) ?? null;
  const draftKind = activeTool ? kindOf(activeTool) : null;

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative h-[560px] w-full overflow-hidden rounded-lg border border-border bg-card",
        activeTool ? "cursor-crosshair" : "cursor-grab",
        className,
      )}
    >
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        role="application"
        aria-label="Civil feature editor canvas"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={() => {
          handleUp();
          setHover(null);
          onHoverChange?.(null);
        }}
        onClick={handleClick}
        onDoubleClick={(ev) => {
          if (!activeTool) return;
          ev.preventDefault();
          onFinishDraft();
        }}
        onWheel={handleWheel}
        className="touch-none select-none"
      >
        <g className="text-border">
          {gridLines.map((l, i) => (
            <line
              key={i}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="currentColor"
              strokeWidth={0.5}
              opacity={0.5}
            />
          ))}
        </g>

        {visible.map((f) => {
          const kind = kindOf(f.feature_type);
          const stroke = colorVar(f.feature_type);
          const isSelected = f.id === selectedId;
          const parts = geometryVertexLists(f.geometry);
          if (kind === "point") {
            const [e, n] = parts[0]?.[0] ?? [0, 0];
            const [x, y] = world.toScreen(e, n);
            return (
              <g key={f.id} onClick={() => onSelect(f.id)} style={{ cursor: "pointer" }}>
                <circle
                  cx={x}
                  cy={y}
                  r={isSelected ? 8 : 6}
                  fill={stroke}
                  stroke="var(--background)"
                  strokeWidth={isSelected ? 3 : 1.5}
                />
                <title>{`${f.feature_ref} · ${f.name}`}</title>
              </g>
            );
          }
          return (
            <g key={f.id} onClick={() => onSelect(f.id)} style={{ cursor: "pointer" }}>
              {parts.map((ring, i) => (
                <path
                  key={i}
                  d={path(ring, kind === "polygon")}
                  fill={kind === "polygon" ? stroke : "none"}
                  fillOpacity={kind === "polygon" ? (isSelected ? 0.3 : 0.16) : 0}
                  stroke={stroke}
                  strokeWidth={isSelected ? 3 : 2}
                  strokeLinejoin="round"
                  strokeDasharray={f.status === "draft" ? "6 4" : undefined}
                />
              ))}
              <title>{`${f.feature_ref} · ${f.name}`}</title>
            </g>
          );
        })}

        {/* editable vertices of the current selection */}
        {selected && editable
          ? geometryVertexLists(selected.geometry).flatMap((ring, part) =>
              ring.map(([e, n], index) => {
                const [x, y] = world.toScreen(e, n);
                return (
                  <circle
                    key={`${part}-${index}`}
                    cx={x}
                    cy={y}
                    r={5}
                    fill="var(--background)"
                    stroke="var(--ring)"
                    strokeWidth={2}
                    style={{ cursor: "move" }}
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      dragVertex.current = { part, index };
                      (ev.target as Element).setPointerCapture?.(ev.pointerId);
                    }}
                  />
                );
              }),
            )
          : null}

        {/* in-progress sketch */}
        {draft.length > 0 && activeTool ? (
          <g>
            <path
              d={path(
                hover && draftKind !== "point" ? [...draft, hover] : draft,
                draftKind === "polygon",
              )}
              fill={draftKind === "polygon" ? colorVar(activeTool) : "none"}
              fillOpacity={0.2}
              stroke={colorVar(activeTool)}
              strokeWidth={2}
              strokeDasharray="5 4"
            />
            {draft.map(([e, n], i) => {
              const [x, y] = world.toScreen(e, n);
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={4}
                  fill={colorVar(activeTool)}
                  stroke="var(--background)"
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        ) : null}
      </svg>

      <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-border bg-background/90 px-2 py-1 font-mono text-xs text-muted-foreground">
        {hover
          ? `E ${hover[0].toFixed(2)}  N ${hover[1].toFixed(2)}`
          : `grid ${gridStep} m · snap ${snapEnabled ? `${snapStep} m` : "off"}`}
      </div>
    </div>
  );
}
