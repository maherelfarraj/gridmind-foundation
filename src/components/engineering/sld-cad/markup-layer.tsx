// P-145 — Markup layer: revision clouds, notes and arrows drawn above the model.
// Never exported to DXF model space.
import { arrowHead, cloudPath, rectAround } from "@/lib/sld/markup";
import type { SldMarkup } from "@/lib/sld/canvas-types";

export function MarkupLayer({ markups }: { markups: SldMarkup[] }) {
  if (markups.length === 0) return null;

  return (
    <g className="pointer-events-none" data-markup-layer>
      {markups.map((m) => {
        const open = m.status === "open";
        const stroke = open ? "stroke-destructive" : "stroke-muted-foreground";
        const fill = open ? "fill-destructive" : "fill-muted-foreground";

        if (m.kind === "cloud") {
          const rect = rectAround(m.points, 3);
          if (!rect) return null;
          return (
            <g key={m.id}>
              <path
                d={cloudPath(rect, 6)}
                className={`${stroke} fill-none`}
                strokeWidth={0.6}
                strokeDasharray={open ? undefined : "2 1.5"}
              />
              {m.note ? (
                <text
                  x={rect.minX}
                  y={rect.minY - 2}
                  className={`${fill} text-[3px]`}
                  style={{ fontSize: 3 }}
                >
                  {m.note.slice(0, 60)}
                </text>
              ) : null}
            </g>
          );
        }

        if (m.kind === "arrow" && m.points.length >= 2) {
          const from = m.points[0];
          const to = m.points[m.points.length - 1];
          const head = arrowHead(from, to, 4);
          return (
            <g key={m.id}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className={stroke}
                strokeWidth={0.6}
              />
              <polygon points={head.map((p) => `${p.x},${p.y}`).join(" ")} className={fill} />
            </g>
          );
        }

        const anchor = m.points[0];
        if (!anchor) return null;
        return (
          <g key={m.id}>
            <circle cx={anchor.x} cy={anchor.y} r={1.6} className={`${fill}`} />
            <text x={anchor.x + 3} y={anchor.y + 1} className={fill} style={{ fontSize: 3 }}>
              {m.note.slice(0, 60)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
