// P-138/P-140 — SVG canvas: pan/zoom/grid/snap, selection + marquee, drag,
// port-to-port connectors, measurement, pinch zoom.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SheetBorder, type TitleBlockData } from "./title-block";
import { CanvasGlyph } from "./symbol-glyph";
import { SYMBOL_DRAG_MIME } from "./symbol-palette";
import {
  connectionEndpoints,
  isLayerLocked,
  nearestPortHit,
  snapValue,
  useCanvasStore,
} from "@/lib/sld/canvas-store";
import { MEASURE_SYMBOL, type ConnectionType, type SldCanvasObject } from "@/lib/sld/canvas-types";
import {
  orthogonalRoute,
  pathFromPoints,
  rectFromPoints,
  type Pt,
  type Rect,
} from "@/lib/sld/geometry";
import { symbolDef } from "@/lib/sld/symbols";
import { duplicateTagIds } from "@/lib/sld/tagging";

type Props = {
  editable: boolean;
  /** P-142 — object id → worst validation severity, drives the halo markers. */
  issueSeverity?: Map<string, "error" | "warning">;
  titleBlock: TitleBlockData;
  onPlace: (point: Pt, symbolType?: string) => void;
};

const PORT_TOLERANCE_MM = 4;

const CONNECTION_STROKE: Record<
  ConnectionType,
  { className: string; width: number; dash?: string }
> = {
  cable: { className: "stroke-foreground", width: 0.6 },
  busbar: { className: "stroke-foreground", width: 2 },
  dc_string: { className: "stroke-primary", width: 0.7, dash: "3 1.6" },
  earth: { className: "stroke-success", width: 0.7, dash: "1.6 1.2" },
  signal: { className: "stroke-muted-foreground", width: 0.5, dash: "0.8 1.2" },
};

export function SldCanvas({ editable, titleBlock, onPlace }: Props) {
  const ref = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const spaceRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const dragRef = useRef<Pt | null>(null);
  const marqueeRef = useRef<{ origin: Pt; additive: boolean } | null>(null);
  const pinchRef = useRef<number | null>(null);
  const [dragDelta, setDragDelta] = useState<Pt | null>(null);
  const [hoverPort, setHoverPort] = useState<{ objectId: string; port: string } | null>(null);

  const zoom = useCanvasStore((s) => s.zoom);
  const pan = useCanvasStore((s) => s.pan);
  const gridMm = useCanvasStore((s) => s.gridMm);
  const snapEnabled = useCanvasStore((s) => s.snapEnabled);
  const layers = useCanvasStore((s) => s.layers);
  const objects = useCanvasStore((s) => s.objects);
  const connections = useCanvasStore((s) => s.connections);
  const selection = useCanvasStore((s) => s.selection);
  const tool = useCanvasStore((s) => s.tool);
  const placingType = useCanvasStore((s) => s.placingType);
  const snapIndicator = useCanvasStore((s) => s.snapIndicator);
  const pending = useCanvasStore((s) => s.pendingConnection);
  const measurement = useCanvasStore((s) => s.measurement);
  const marquee = useCanvasStore((s) => s.marquee);
  const store = useCanvasStore;

  const toSheet = useCallback(
    (clientX: number, clientY: number): Pt => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const s = store.getState();
      return {
        x: (clientX - rect.left - s.pan.x) / s.zoom,
        y: (clientY - rect.top - s.pan.y) / s.zoom,
      };
    },
    [store],
  );

  const snapPoint = useCallback(
    (p: Pt): Pt => {
      const s = store.getState();
      const port = s.snapEnabled ? nearestPortHit(s.objects, p, s.gridMm) : null;
      if (port) return port.point;
      return {
        x: snapValue(p.x, s.gridMm, s.snapEnabled),
        y: snapValue(p.y, s.gridMm, s.snapEnabled),
      };
    },
    [store],
  );

  // Wheel zoom around the cursor.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      store.getState().zoomAt(factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [store]);

  // Space bar = temporary pan tool.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const onPointerDownBackground = (e: React.PointerEvent<SVGSVGElement>) => {
    const wantsPan = e.button === 1 || spaceRef.current || tool === "pan";
    if (wantsPan) {
      panRef.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    const sheet = toSheet(e.clientX, e.clientY);
    if (editable && tool === "place" && placingType) {
      onPlace(snapPoint(sheet));
      return;
    }
    if (editable && tool === "measure") {
      const s = store.getState();
      if (!s.measureStart) s.startMeasure(snapPoint(sheet));
      else s.commitMeasure();
      return;
    }
    if (editable && tool === "connect") {
      store.getState().cancelConnection();
      return;
    }
    // Rubber-band marquee.
    marqueeRef.current = { origin: sheet, additive: e.shiftKey };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (!e.shiftKey) store.getState().clearSelection();
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const sheet = toSheet(e.clientX, e.clientY);
    store.getState().setCursorMm(sheet);
    if (panRef.current) {
      const p = panRef.current;
      store.getState().setPan({ x: p.x + (e.clientX - p.px), y: p.y + (e.clientY - p.py) });
      return;
    }
    if (marqueeRef.current) {
      store.getState().setMarquee(rectFromPoints(marqueeRef.current.origin, sheet));
      return;
    }
    if (dragRef.current) {
      const snapped = snapPoint(sheet);
      setDragDelta({ x: snapped.x - dragRef.current.x, y: snapped.y - dragRef.current.y });
      store.getState().setSnapIndicator(snapped);
      return;
    }
    const s = store.getState();
    if (editable && s.pendingConnection) {
      const hit = nearestPortHit(s.objects, sheet, PORT_TOLERANCE_MM);
      s.updateConnection(
        hit ? hit.point : sheet,
        hit && hit.objectId !== s.pendingConnection.objectId
          ? { objectId: hit.objectId, port: hit.port }
          : undefined,
      );
      setHoverPort(hit ? { objectId: hit.objectId, port: hit.port } : null);
      return;
    }
    if (editable && tool === "connect") {
      const hit = nearestPortHit(s.objects, sheet, PORT_TOLERANCE_MM);
      setHoverPort(hit ? { objectId: hit.objectId, port: hit.port } : null);
      return;
    }
    if (editable && tool === "measure" && s.measureStart) {
      s.updateMeasure(snapPoint(sheet), e.shiftKey);
      return;
    }
    if (editable && tool === "place" && placingType) {
      s.setSnapIndicator(snapPoint(sheet));
    }
  };

  const endPointer = () => {
    panRef.current = null;
    if (marqueeRef.current) {
      const rect = store.getState().marquee;
      if (rect && (rect.maxX - rect.minX > 0.5 || rect.maxY - rect.minY > 0.5)) {
        store.getState().commitMarquee(rect, marqueeRef.current.additive);
      } else {
        store.getState().setMarquee(null);
      }
      marqueeRef.current = null;
    }
    if (dragRef.current && dragDelta && (dragDelta.x !== 0 || dragDelta.y !== 0)) {
      store.getState().moveSelection(dragDelta.x, dragDelta.y);
    }
    dragRef.current = null;
    setDragDelta(null);
    store.getState().setSnapIndicator(null);
  };

  const onObjectPointerDown = (e: React.PointerEvent, obj: SldCanvasObject) => {
    if (spaceRef.current || tool === "pan" || tool === "measure") return;
    e.stopPropagation();
    if (isLayerLocked(layers, obj.layer_id)) return;
    const s = store.getState();
    const sheet = toSheet(e.clientX, e.clientY);

    if (editable && tool === "connect") {
      const hit = nearestPortHit([obj], sheet, PORT_TOLERANCE_MM);
      const port = hit?.port ?? symbolDef(obj.symbol_type).ports[0]?.id ?? "node";
      const anchor = hit?.point ?? { x: obj.x, y: obj.y };
      if (s.pendingConnection) s.finishConnection(obj.id, port);
      else s.startConnection(obj.id, port, anchor);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }

    const additive = e.shiftKey;
    if (additive) s.select([obj.id], true);
    else if (!selection.includes(obj.id)) s.select([obj.id]);
    if (!editable) return;
    dragRef.current = snapPoint(sheet);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  // Tablet pinch zoom (viewer + editor).
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 2) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const rect = ref.current?.getBoundingClientRect();
    if (pinchRef.current && rect) {
      const factor = dist / pinchRef.current;
      store.getState().zoomAt(factor, {
        x: (a.clientX + b.clientX) / 2 - rect.left,
        y: (a.clientY + b.clientY) / 2 - rect.top,
      });
    }
    pinchRef.current = dist;
  };

  const gridId = `sld-grid-${gridMm}`;

  const draggedIds = useMemo(() => new Set(selection), [selection]);
  const shifted = useCallback(
    (obj: SldCanvasObject): SldCanvasObject =>
      dragDelta && draggedIds.has(obj.id)
        ? { ...obj, x: obj.x + dragDelta.x, y: obj.y + dragDelta.y }
        : obj,
    [dragDelta, draggedIds],
  );
  const livePositions = useMemo(() => objects.map(shifted), [objects, shifted]);
  const dupeTagIds = useMemo(() => duplicateTagIds(objects), [objects]);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-background"
    >
      <svg
        ref={ref}
        role="application"
        aria-label="SLD canvas"
        className="h-full w-full touch-none select-none"
        onPointerDown={onPointerDownBackground}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerLeave={endPointer}
        onTouchMove={onTouchMove}
        onTouchEnd={() => {
          pinchRef.current = null;
        }}
        onDragOver={(e) => {
          if (!editable) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          store.getState().setSnapIndicator(snapPoint(toSheet(e.clientX, e.clientY)));
        }}
        onDragLeave={() => store.getState().setSnapIndicator(null)}
        onDrop={(e) => {
          if (!editable) return;
          e.preventDefault();
          const type =
            e.dataTransfer.getData(SYMBOL_DRAG_MIME) || e.dataTransfer.getData("text/plain");
          store.getState().setSnapIndicator(null);
          if (!type) return;
          onPlace(snapPoint(toSheet(e.clientX, e.clientY)), type);
        }}
      >
        <defs>
          <pattern
            id={gridId}
            width={gridMm * zoom}
            height={gridMm * zoom}
            patternUnits="userSpaceOnUse"
            x={pan.x}
            y={pan.y}
          >
            <circle cx={0.5} cy={0.5} r={0.6} className="fill-border" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${gridId})`} />
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          <SheetBorder data={titleBlock} />

          {/* Connections follow their objects (live during drags). */}
          {connections.map((c) => {
            const ends = connectionEndpoints(c, livePositions);
            if (!ends) return null;
            const style = CONNECTION_STROKE[c.connection_type] ?? CONNECTION_STROKE.cable;
            const route = orthogonalRoute(ends.from, ends.to);
            return (
              <path
                key={c.id}
                data-connection-id={c.id}
                d={pathFromPoints(route)}
                className={`${style.className} fill-none`}
                strokeWidth={style.width}
                strokeDasharray={style.dash}
                strokeLinejoin="round"
              />
            );
          })}

          {objects.map((raw) => {
            const obj = shifted(raw);
            const layer = layers.find((l) => l.id === obj.layer_id);
            if (layer && !layer.visible) return null;
            const selected = selection.includes(obj.id);

            if (obj.symbol_type === MEASURE_SYMBOL) {
              const p = obj.properties as Record<string, number>;
              return (
                <DimensionMark
                  key={obj.id}
                  x1={Number(p.x1)}
                  y1={Number(p.y1)}
                  x2={Number(p.x2)}
                  y2={Number(p.y2)}
                  label={obj.label ?? ""}
                  selected={selected}
                  onPointerDown={(e) => onObjectPointerDown(e, raw)}
                />
              );
            }

            const def = symbolDef(obj.symbol_type);
            const severity = issueSeverity?.get(obj.id);
            return (
              <g
                key={obj.id}
                data-object-id={obj.id}
                transform={`translate(${obj.x} ${obj.y}) rotate(${obj.rotation}) scale(${obj.mirrored ? -1 : 1} 1)`}
                onPointerDown={(e) => onObjectPointerDown(e, raw)}
                className={
                  isLayerLocked(layers, obj.layer_id) ? "cursor-not-allowed" : "cursor-move"
                }
              >
                {severity ? (
                  <rect
                    x={-def.w / 2 - 2.5}
                    y={-def.h / 2 - 2.5}
                    width={def.w + 5}
                    height={def.h + 5}
                    rx={2}
                    className={
                      severity === "error"
                        ? "pointer-events-none fill-destructive/10 stroke-destructive"
                        : "pointer-events-none fill-warning/10 stroke-warning"
                    }
                    strokeWidth={0.6}
                    strokeDasharray="2 1.5"
                  />
                ) : null}
                <rect
                  x={-def.w / 2}
                  y={-def.h / 2}
                  width={def.w}
                  height={def.h}
                  rx={1.5}
                  className={
                    selected
                      ? "fill-primary/15 stroke-primary"
                      : def.svg
                        ? "fill-card/60 stroke-transparent hover:stroke-primary"
                        : "fill-card stroke-foreground/70 hover:stroke-primary"
                  }
                  strokeWidth={selected ? 0.9 : 0.5}
                />
                {def.svg ? (
                  <g className="stroke-foreground fill-none" strokeWidth={1.4}>
                    <CanvasGlyph svg={def.svg} w={def.w} h={def.h} />
                  </g>
                ) : null}
                <text
                  y={def.h / 2 + 3.4}
                  textAnchor="middle"
                  className={
                    dupeTagIds.has(obj.id)
                      ? "pointer-events-none fill-destructive"
                      : "pointer-events-none fill-foreground"
                  }
                  style={{ fontSize: 3.2 }}
                >
                  {obj.tag ?? def.label}
                </text>
                {dupeTagIds.has(obj.id) ? (
                  <g className="pointer-events-none">
                    <circle
                      cx={def.w / 2 + 2}
                      cy={-def.h / 2 - 2}
                      r={2.4}
                      className="fill-destructive"
                    />
                    <text
                      x={def.w / 2 + 2}
                      y={-def.h / 2 - 1.1}
                      textAnchor="middle"
                      className="fill-destructive-foreground"
                      style={{ fontSize: 3 }}
                    >
                      !
                    </text>
                  </g>
                ) : null}
                {def.ports.map((p) => {
                  const hot =
                    hoverPort?.objectId === obj.id && hoverPort.port === p.id && tool === "connect";
                  return (
                    <g key={p.id}>
                      {hot ? (
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={2.2}
                          className="fill-none stroke-primary"
                          strokeWidth={0.4}
                        />
                      ) : null}
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={hot ? 1.2 : 0.9}
                        className={hot ? "fill-primary" : "fill-muted-foreground"}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Pending connector rubber line. */}
          {pending ? (
            <path
              d={pathFromPoints(orthogonalRoute(pending.from, pending.to))}
              className="stroke-primary fill-none"
              strokeWidth={0.7}
              strokeDasharray="2 1.5"
            />
          ) : null}

          {/* Live measurement. */}
          {measurement ? (
            <DimensionMark
              x1={measurement.start.x}
              y1={measurement.start.y}
              x2={measurement.end.x}
              y2={measurement.end.y}
              label={`${Math.round(measurement.distance * 10) / 10} mm`}
              live
            />
          ) : null}

          {marquee ? <MarqueeRect rect={marquee} /> : null}

          {snapIndicator && snapEnabled ? (
            <g className="pointer-events-none">
              <circle
                cx={snapIndicator.x}
                cy={snapIndicator.y}
                r={2.2}
                className="fill-none stroke-primary"
                strokeWidth={0.5}
              />
              <line
                x1={snapIndicator.x - 3.5}
                y1={snapIndicator.y}
                x2={snapIndicator.x + 3.5}
                y2={snapIndicator.y}
                className="stroke-primary"
                strokeWidth={0.3}
              />
              <line
                x1={snapIndicator.x}
                y1={snapIndicator.y - 3.5}
                x2={snapIndicator.x}
                y2={snapIndicator.y + 3.5}
                className="stroke-primary"
                strokeWidth={0.3}
              />
            </g>
          ) : null}
        </g>
      </svg>
      {objects.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-md border border-border bg-card/90 px-4 py-2 text-sm text-muted-foreground">
            {editable
              ? "Drag a symbol from the library to start"
              : "This drawing has no objects yet"}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function MarqueeRect({ rect }: { rect: Rect }) {
  return (
    <rect
      x={rect.minX}
      y={rect.minY}
      width={rect.maxX - rect.minX}
      height={rect.maxY - rect.minY}
      className="pointer-events-none fill-primary/10 stroke-primary"
      strokeWidth={0.4}
      strokeDasharray="2 1.5"
    />
  );
}

function DimensionMark({
  x1,
  y1,
  x2,
  y2,
  label,
  live,
  selected,
  onPointerDown,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  live?: boolean;
  selected?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const cls = selected ? "stroke-primary" : live ? "stroke-primary" : "stroke-muted-foreground";
  const ext = 2.5;
  return (
    <g onPointerDown={onPointerDown} className={live ? "pointer-events-none" : "cursor-pointer"}>
      <line x1={x1} y1={y1 - ext} x2={x1} y2={y1 + ext} className={cls} strokeWidth={0.3} />
      <line x1={x2} y1={y2 - ext} x2={x2} y2={y2 + ext} className={cls} strokeWidth={0.3} />
      <line x1={x1} y1={y1} x2={x2} y2={y2} className={cls} strokeWidth={0.4} />
      <text
        x={mx}
        y={my - 1.4}
        textAnchor="middle"
        className="pointer-events-none fill-foreground"
        style={{ fontSize: 3 }}
      >
        {label}
      </text>
    </g>
  );
}
