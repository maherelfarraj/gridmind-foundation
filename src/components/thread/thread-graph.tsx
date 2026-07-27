// P-188 — Depth-columned SVG graph viewer for the digital thread.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";
import type { EntityGraph, GraphNode } from "@/lib/digital-thread/thread.server";

const COL_W = 240;
const ROW_H = 56;
const NODE_W = 196;
const NODE_H = 40;
const PAD = 24;

function typeLabel(t: string) {
  return t.replaceAll("_", " ");
}

interface Positioned extends GraphNode {
  x: number;
  y: number;
}

export function ThreadGraph({
  graph,
  className,
}: {
  graph: EntityGraph;
  className?: string;
}) {
  const { placed, width, height, index } = useMemo(() => {
    const byDepth = new Map<number, GraphNode[]>();
    for (const n of graph.nodes) {
      const list = byDepth.get(n.depth) ?? [];
      list.push(n);
      byDepth.set(n.depth, list);
    }
    const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
    const tallest = Math.max(1, ...depths.map((d) => byDepth.get(d)!.length));
    const placed: Positioned[] = [];
    depths.forEach((d, col) => {
      const list = byDepth.get(d)!.slice().sort((a, b) => a.entity_type.localeCompare(b.entity_type));
      const offset = (tallest - list.length) / 2;
      list.forEach((n, row) => {
        placed.push({
          ...n,
          x: PAD + col * COL_W,
          y: PAD + (row + offset) * ROW_H,
        });
      });
    });
    const index = new Map(placed.map((p) => [`${p.entity_type}:${p.entity_id}`, p]));
    return {
      placed,
      index,
      width: PAD * 2 + Math.max(1, depths.length) * COL_W,
      height: PAD * 2 + tallest * ROW_H,
    };
  }, [graph]);

  if (graph.nodes.length === 0) return null;

  return (
    <div className={cn("overflow-x-auto rounded-lg border border-border bg-card p-2", className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Digital thread graph"
        className="min-w-full"
      >
        <g>
          {graph.edges.map((e) => {
            const a = index.get(`${e.source_type}:${e.source_id}`);
            const b = index.get(`${e.target_type}:${e.target_id}`);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={e.id}
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                fill="none"
                strokeWidth={1.5}
                strokeDasharray={e.link_type === "derives" ? "4 3" : undefined}
                className="stroke-border"
              />
            );
          })}
        </g>
        {placed.map((n) => {
          const isRoot =
            n.entity_type === graph.root.entity_type && n.entity_id === graph.root.entity_id;
          return (
            <g key={`${n.entity_type}:${n.entity_id}`} transform={`translate(${n.x} ${n.y})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                className={cn(
                  "stroke-border",
                  isRoot ? "fill-primary/15 stroke-primary" : "fill-muted",
                )}
              />
              <text x={10} y={16} className="fill-muted-foreground text-[10px] uppercase">
                {typeLabel(n.entity_type)}
              </text>
              <text x={10} y={31} className="fill-foreground text-xs">
                {(n.label ?? "").slice(0, 28)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-2 px-1">
        {placed
          .filter((n) => !(n.entity_type === graph.root.entity_type && n.entity_id === graph.root.entity_id))
          .map((n) => (
            <Link
              key={`link-${n.entity_type}:${n.entity_id}`}
              to="/thread/$entityType/$entityId"
              params={{ entityType: n.entity_type, entityId: n.entity_id }}
              search={{ depth: 2 }}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {typeLabel(n.entity_type)}: {n.label}
            </Link>
          ))}
      </div>
    </div>
  );
}
