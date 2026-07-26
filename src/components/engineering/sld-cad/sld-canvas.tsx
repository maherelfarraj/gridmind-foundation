// P-138 — SVG canvas: pan/zoom/grid/snap, selection, drag, pinch zoom.
import { useCallback, useEffect, useRef, useState } from "react";

import { SheetBorder, type TitleBlockData } from "./title-block";
import {
  isLayerLocked,
  nearestPort,
  snapValue,
  useCanvasStore,
} from "@/lib/sld/canvas-store";
import { SHEET_SIZES, type SldCanvasObject } from "@/lib/sld/canvas-types";
import { symbolDef } from "@/lib/sld/symbols";

type Props = {
  editable: boolean;
  titleBlock: TitleBlockData;
  onPlace: (point: { x: number; y: number }) => void;
};

export function SldCanvas({ editable, titleBlock, onPlace }: Props) {
  const ref = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const spaceRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<number | null>(null);
  const [dragDelta, setDragDelta] = useState<{ x: number; y: number } | null>(null);

  const zoom = useCanvasStore((s) => s.zoom);
  const pan = useCanvasStore((s) => s.pan);
  const gridMm = useCanvasStore((s) => s.gridMm);
  const snapEnabled = useCanvasStore((s) => s.snapEnabled);
  const layers = useCanvasStore((s) => s.layers);
  const objects = useCanvasStore((s) => s.objects);
  const connections = useCanvasStore((s) => s.connections ?? []) as unknown as never[];
  const selection = useCanvasStore((s) => s.selection);
  const tool = useCanvasStore((s) => s.tool);
  const placingType = useCanvasStore((s) => s.placingType);
  const snapIndicator = useCanvasStore((s) => s.snapIndicator);
  const store = useCanvasStore;

  const sheet = SHEET_SIZES[titleBlock.sheet_size] ?? SHEET_SIZES.A1;

  const toSheet = useCallback(
    (clientX: number, clientY: number) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const s = store.getState();
      return { x: (clientX - rect.left - s.pan.x) / s.zoom, y: (clientY - rect.top - s.pan.y) / s.zoom };
    },
    [store],
  );

  const snapPoint = useCallback(
    (p: { x: number; y: number }) => {
      const s = store.getState();
      const port = s.snapEnabled ? nearestPort(s.objects, p, s.gridMm) : null;
      if (port) return port;
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
      store
        .getState()
        .zoomAt(factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
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
    if (editable && tool === "place" && placingType) {
      onPlace(snapPoint(toSheet(e.clientX, e.clientY)));
      return;
    }
    store.getState().clearSelection();
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current) {
      const p = panRef.current;
      store.getState().setPan({ x: p.x + (e.clientX - p.px), y: p.y + (e.clientY - p.py) });
      return;
    }
    if (dragRef.current) {
      const p = toSheet(e.clientX, e.clientY);
      const snapped = snapPoint(p);
      setDragDelta({ x: snapped.x - dragRef.current.x, y: snapped.y - dragRef.current.y });
      store.getState().setSnapIndicator(snapped);
      return;
    }
    if (editable && tool === "place" && placingType) {
      store.getState().setSnapIndicator(snapPoint(toSheet(e.clientX, e.clientY)));
    }
  };

  const endPointer = () => {
    panRef.current = null;
    if (dragRef.current && dragDelta && (dragDelta.x !== 0 || dragDelta.y !== 0)) {
      store.getState().moveSelection(dragDelta.x, dragDelta.y);
    }
    dragRef.current = null;
    setDragDelta(null);
    store.getState().setSnapIndicator(null);
  };

  const onObjectPointerDown = (e: React.PointerEvent, obj: SldCanvasObject) => {
    if (spaceRef.current || tool === "pan") return;
    e.stopPropagation();
    if (isLayerLocked(layers, obj.layer_id)) return;
    const additive = e.shiftKey;
    if (!selection.includes(obj.id)) store.getState().select([obj.id], additive);
    if (!editable) return;
    dragRef.current = snapPoint(toSheet(e.clientX, e.clientY));
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

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-background">
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
          {objects.map((obj) => {
            const layer = layers.find((l) => l.id === obj.layer_id);
            if (layer && !layer.visible) return null;
            const selected = selection.includes(obj.id);
            const dx = selected && dragDelta ? dragDelta.x : 0;
            const dy = selected && dragDelta ? dragDelta.y : 0;
            const def = symbolDef(obj.symbol_type);
            return (
              <g
                key={obj.id}
                data-object-id={obj.id}
                transform={`translate(${obj.x + dx} ${obj.y + dy}) rotate(${obj.rotation}) scale(${obj.mirrored ? -1 : 1} 1)`}
                onPointerDown={(e) => onObjectPointerDown(e, obj)}
                className={isLayerLocked(layers, obj.layer_id) ? "cursor-not-allowed" : "cursor-move"}
              >
                <rect
                  x={-def.w / 2}
                  y={-def.h / 2}
                  width={def.w}
                  height={def.h}
                  rx={1.5}
                  className={
                    selected
                      ? "fill-primary/15 stroke-primary"
                      : "fill-card stroke-foreground/70 hover:stroke-primary"
                  }
                  strokeWidth={selected ? 0.9 : 0.5}
                />
                <text
                  y={1.4}
                  textAnchor="middle"
                  className="pointer-events-none fill-foreground"
                  style={{ fontSize: 3.2 }}
                >
                  {obj.tag ?? def.label}
                </text>
                {def.ports.map((p) => (
                  <circle
                    key={p.id}
                    cx={p.x}
                    cy={p.y}
                    r={0.9}
                    className="fill-muted-foreground"
                  />
                ))}
              </g>
            );
          })}
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
        <rect
          x={0}
          y={0}
          width={sheet.w * 0}
          height={0}
          className="fill-none"
          aria-hidden
        />
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
