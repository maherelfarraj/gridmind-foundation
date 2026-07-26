// P-153 — SVG canvas for the PV layout workspace (site-local metre CRS).
import { useMemo } from "react";

import type { ArrangedBlock } from "@/lib/pv/layout";
import type { PointM } from "@/lib/pv-site.geo";
import { cn } from "@/lib/utils";

export interface PvLayoutCanvasProps {
  boundary: PointM[];
  exclusions: PointM[][];
  blocks: ArrangedBlock[];
  selectedKey?: string | null;
  highlightedKeys?: string[];
  onSelect?: (key: string | null) => void;
  height?: number;
}

const PAD = 24;

function pathFrom(points: PointM[], project: (p: PointM) => PointM): string {
  if (points.length === 0) return "";
  return `${points
    .map((p, i) => {
      const q = project(p);
      return `${i === 0 ? "M" : "L"}${q.x.toFixed(2)},${q.y.toFixed(2)}`;
    })
    .join(" ")} Z`;
}

const BLOCK_CLASS: Record<string, string> = {
  array_table: "fill-primary/40 stroke-primary",
  internal_road: "fill-muted stroke-muted-foreground",
  equipment_pad: "fill-accent/50 stroke-accent-foreground",
  inverter_station: "fill-accent/60 stroke-accent-foreground",
  setback: "fill-none stroke-border",
};

export function PvLayoutCanvas({
  boundary,
  exclusions,
  blocks,
  selectedKey,
  highlightedKeys = [],
  onSelect,
  height = 520,
}: PvLayoutCanvasProps) {
  const all = useMemo(
    () => [...boundary, ...exclusions.flat(), ...blocks.flatMap((b) => b.polygon)],
    [boundary, exclusions, blocks],
  );

  const view = useMemo(() => {
    if (all.length === 0) return { minX: 0, minY: 0, w: 100, h: 100 };
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      minX,
      minY,
      w: Math.max(1, Math.max(...xs) - minX),
      h: Math.max(1, Math.max(...ys) - minY),
    };
  }, [all]);

  const width = 900;
  const scale = Math.min((width - PAD * 2) / view.w, (height - PAD * 2) / view.h);
  const project = (p: PointM): PointM => ({
    x: PAD + (p.x - view.minX) * scale,
    y: height - PAD - (p.y - view.minY) * scale,
  });

  const highlight = new Set(highlightedKeys);

  return (
    <svg
      role="img"
      aria-label="PV layout canvas"
      viewBox={`0 0 ${width} ${height}`}
      className="w-full rounded-lg border border-border bg-card"
      onClick={() => onSelect?.(null)}
    >
      <path d={pathFrom(boundary, project)} className="fill-background stroke-foreground" strokeWidth={1.5} />
      {exclusions.map((zone, i) => (
        <path
          key={`ex-${i}`}
          d={pathFrom(zone, project)}
          className="fill-destructive/10 stroke-destructive"
          strokeWidth={1}
        />
      ))}
      {blocks.map((block) => (
        <path
          key={block.key}
          d={pathFrom(block.polygon, project)}
          role="button"
          aria-label={block.label}
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(block.key);
          }}
          className={cn(
            "cursor-pointer",
            BLOCK_CLASS[block.type] ?? "fill-secondary stroke-border",
            selectedKey === block.key && "fill-primary stroke-ring",
            highlight.has(block.key) && "fill-destructive/60 stroke-destructive",
          )}
          strokeWidth={selectedKey === block.key || highlight.has(block.key) ? 2 : 0.6}
        />
      ))}
    </svg>
  );
}
