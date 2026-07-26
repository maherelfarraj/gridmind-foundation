// P-160 — Terrain canvas: contours + slope heat map + points, pan / zoom / touch.
// Colours come from design tokens read off the document root — no raw hex here.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { extractContours, type ContourLine } from "@/lib/terrain/contours";
import {
  buildElevationGrid,
  fillHoles,
  gridStats,
  sampleElevation,
  valueAt,
  type ElevationGrid,
  type TerrainPointInput,
} from "@/lib/terrain/grid";
import { computeSlope, slopeAt, slopeRampT, slopeStats } from "@/lib/terrain/slope";
import { cn } from "@/lib/utils";

export type TerrainLayers = { contours: boolean; slope: boolean; points: boolean };

/** P-161 — civil overlays drawn above the terrain layers. */
export type TerrainOverlay = {
  id: string;
  kind: "flood" | "drainage" | "grading" | "proposal";
  /** one or more vertex lists in world coordinates */
  parts: [number, number][][];
  closed: boolean;
  label?: string | null;
};

export type TerrainCursor = {
  easting: number;
  northing: number;
  elevation: number | null;
  slope: number | null;
};

type Props = {
  points: TerrainPointInput[];
  spacing: number;
  contourInterval: number;
  layers: TerrainLayers;
  /** Persisted contours from the server; when absent they are drawn from the grid. */
  contours?: ContourLine[];
  overlays?: TerrainOverlay[];
  onCursorChange?: (cursor: TerrainCursor | null) => void;
  className?: string;
};

function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Ramp: success (flat) → warning → destructive (steep), mixed in oklab. */
function rampColor(t: number, stops: string[]): string {
  const clamped = Math.max(0, Math.min(1, t));
  const span = 1 / (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(clamped / span));
  const local = (clamped - i * span) / span;
  return `color-mix(in oklab, ${stops[i + 1]} ${(local * 100).toFixed(1)}%, ${stops[i]})`;
}

export function TerrainCanvas({
  points,
  spacing,
  contourInterval,
  layers,
  contours,
  overlays,
  onCursorChange,
  className,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const grid: ElevationGrid = useMemo(
    () => fillHoles(buildElevationGrid(points, { spacing })),
    [points, spacing],
  );
  const stats = useMemo(() => gridStats(grid), [grid]);
  const slope = useMemo(() => computeSlope(grid), [grid]);
  const sStats = useMemo(() => slopeStats(slope), [slope]);
  const maxSlope = Math.max(2, sStats.max);

  const drawnContours = useMemo(
    () =>
      contours && contours.length
        ? contours
        : extractContours(grid, contourInterval, { majorEvery: 5 }),
    [contours, grid, contourInterval],
  );

  // world → screen
  const world = useMemo(() => {
    const wMetres = Math.max(1, (grid.cols - 1) * grid.spacing);
    const hMetres = Math.max(1, (grid.rows - 1) * grid.spacing);
    const pad = 24;
    const base = Math.min((size.w - pad * 2) / wMetres, (size.h - pad * 2) / hMetres);
    const scale = base * view.zoom;
    const offX = (size.w - wMetres * scale) / 2 + view.panX;
    const offY = (size.h - hMetres * scale) / 2 + view.panY;
    return {
      scale,
      toScreen: (e: number, n: number): [number, number] => [
        offX + (e - grid.originE) * scale,
        size.h - offY - (n - grid.originN) * scale,
      ],
      toWorld: (x: number, y: number): [number, number] => [
        grid.originE + (x - offX) / scale,
        grid.originN + (size.h - y - offY) / scale,
      ],
    };
  }, [grid, size, view]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: Math.max(320, Math.round(el.clientWidth * 0.55)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const ramp = [
      token("--success", "oklch(0.52 0.1 155)"),
      token("--warning", "oklch(0.75 0.13 75)"),
      token("--destructive", "oklch(0.55 0.15 25)"),
    ];
    const contourColor = token("--muted-foreground", "oklch(0.5 0.02 250)");
    const majorColor = token("--primary", "oklch(0.38 0.08 252)");
    const pointColor = token("--foreground", "oklch(0.2 0.02 250)");

    if (layers.slope) {
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          const s = slopeAt(slope, r, c);
          if (s == null) continue;
          const [x, y] = world.toScreen(
            grid.originE + (c - 0.5) * grid.spacing,
            grid.originN + (r + 0.5) * grid.spacing,
          );
          const px = grid.spacing * world.scale;
          ctx.globalAlpha = 0.75;
          ctx.fillStyle = rampColor(slopeRampT(s, maxSlope), ramp);
          ctx.fillRect(x, y, Math.ceil(px) + 1, Math.ceil(px) + 1);
        }
      }
      ctx.globalAlpha = 1;
    }

    if (layers.contours) {
      for (const line of drawnContours) {
        if (line.coordinates.length < 2) continue;
        ctx.beginPath();
        line.coordinates.forEach(([e, n], i) => {
          const [x, y] = world.toScreen(e, n);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = line.is_major ? majorColor : contourColor;
        ctx.lineWidth = line.is_major ? 1.75 : 0.9;
        ctx.globalAlpha = line.is_major ? 0.95 : 0.6;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    if (overlays?.length) {
      const floodColor = token("--info", "oklch(0.6 0.12 235)");
      const drainageColor = token("--primary", "oklch(0.38 0.08 252)");
      const gradingColor = token("--warning", "oklch(0.75 0.13 75)");
      const proposalColor = token("--accent-foreground", "oklch(0.45 0.1 200)");
      for (const overlay of overlays) {
        const color =
          overlay.kind === "flood"
            ? floodColor
            : overlay.kind === "drainage"
              ? drainageColor
              : overlay.kind === "grading"
                ? gradingColor
                : proposalColor;
        for (const part of overlay.parts) {
          if (part.length < 2) continue;
          ctx.beginPath();
          part.forEach(([e, n], i) => {
            const [x, y] = world.toScreen(e, n);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          if (overlay.closed) {
            ctx.closePath();
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = color;
            ctx.fill();
          }
          ctx.globalAlpha = 0.95;
          ctx.strokeStyle = color;
          ctx.lineWidth = overlay.kind === "proposal" ? 2.5 : 2;
          ctx.setLineDash(overlay.kind === "proposal" ? [6, 4] : []);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.globalAlpha = 1;
    }

    if (layers.points) {
      ctx.fillStyle = pointColor;
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          if (valueAt(grid, r, c) == null) continue;
          const [x, y] = world.toScreen(
            grid.originE + c * grid.spacing,
            grid.originN + r * grid.spacing,
          );
          ctx.globalAlpha = 0.5;
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      }
      ctx.globalAlpha = 1;
    }
  }, [drawnContours, grid, layers, maxSlope, overlays, size, slope, world]);

  useEffect(() => {
    draw();
  }, [draw]);

  function pointerWorld(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const [e, n] = world.toWorld(clientX - rect.left, clientY - rect.top);
    const elevation = sampleElevation(grid, e, n);
    const r = Math.round((n - grid.originN) / grid.spacing);
    const c = Math.round((e - grid.originE) / grid.spacing);
    return {
      easting: e,
      northing: n,
      elevation,
      slope: slopeAt(slope, r, c),
    } satisfies TerrainCursor;
  }

  return (
    <div ref={wrapRef} className={cn("relative w-full touch-none select-none", className)}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        className="w-full rounded-md border border-border bg-card"
        role="img"
        aria-label="Terrain contour and slope map"
        onWheel={(ev) => {
          ev.preventDefault();
          setView((v) => ({
            ...v,
            zoom: Math.max(0.4, Math.min(12, v.zoom * (ev.deltaY < 0 ? 1.12 : 0.9))),
          }));
        }}
        onPointerDown={(ev) => {
          (ev.target as Element).setPointerCapture?.(ev.pointerId);
          drag.current = { x: ev.clientX, y: ev.clientY, panX: view.panX, panY: view.panY };
        }}
        onPointerMove={(ev) => {
          if (drag.current) {
            const d = drag.current;
            setView((v) => ({
              ...v,
              panX: d.panX + (ev.clientX - d.x),
              panY: d.panY - (ev.clientY - d.y),
            }));
          }
          onCursorChange?.(pointerWorld(ev.clientX, ev.clientY));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
          onCursorChange?.(null);
        }}
        onTouchStart={(ev) => {
          if (ev.touches.length === 2) {
            const dx = ev.touches[0].clientX - ev.touches[1].clientX;
            const dy = ev.touches[0].clientY - ev.touches[1].clientY;
            pinch.current = { dist: Math.hypot(dx, dy), zoom: view.zoom };
            drag.current = null;
          }
        }}
        onTouchMove={(ev) => {
          if (ev.touches.length === 2 && pinch.current) {
            const dx = ev.touches[0].clientX - ev.touches[1].clientX;
            const dy = ev.touches[0].clientY - ev.touches[1].clientY;
            const dist = Math.hypot(dx, dy);
            const next = (pinch.current.zoom * dist) / (pinch.current.dist || 1);
            setView((v) => ({ ...v, zoom: Math.max(0.4, Math.min(12, next)) }));
          }
        }}
        onTouchEnd={() => {
          pinch.current = null;
        }}
      />
      <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-border bg-background/85 px-2 py-1 text-xs text-muted-foreground">
        {grid.rows}×{grid.cols} nodes · {grid.spacing.toFixed(1)} m spacing · {stats.min.toFixed(1)}
        –{stats.max.toFixed(1)} m
      </div>
      <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded-md border border-border bg-background/85 px-2 py-1 text-xs text-muted-foreground">
        <span>0%</span>
        <span
          className="h-2 w-24 rounded-full"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--success), var(--warning), var(--destructive))",
          }}
        />
        <span>{maxSlope.toFixed(0)}%</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>Mean slope {sStats.mean.toFixed(1)}%</span>
        <span>Max slope {sStats.max.toFixed(1)}%</span>
        <span>Above 5%: {(sStats.aboveThreshold * 100).toFixed(0)}% of cells</span>
        <span>Zoom {view.zoom.toFixed(1)}×</span>
      </div>
    </div>
  );
}
