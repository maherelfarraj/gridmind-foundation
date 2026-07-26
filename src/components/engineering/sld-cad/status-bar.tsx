// P-140 — Canvas status bar: cursor mm, zoom, snap, selection position.
import { toast } from "sonner";

import { useCanvasStore } from "@/lib/sld/canvas-store";
import { formatMm } from "@/lib/sld/geometry";
import { DuplicateTagWarning } from "./tags-menu";

function copy(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(text);
    toast.success(`Copied ${text}`);
  }
}

export function CanvasStatusBar() {
  const cursor = useCanvasStore((s) => s.cursorMm);
  const zoom = useCanvasStore((s) => s.zoom);
  const snapEnabled = useCanvasStore((s) => s.snapEnabled);
  const gridMm = useCanvasStore((s) => s.gridMm);
  const tool = useCanvasStore((s) => s.tool);
  const selection = useCanvasStore((s) => s.selection);
  const objects = useCanvasStore((s) => s.objects);
  const measurement = useCanvasStore((s) => s.measurement);

  const sel = selection.length === 1 ? objects.find((o) => o.id === selection[0]) : undefined;
  const cursorText = cursor
    ? `${Math.round(cursor.x * 10) / 10}, ${Math.round(cursor.y * 10) / 10}`
    : "—";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
      <button
        type="button"
        className="tabular-nums hover:text-foreground"
        aria-label="Copy cursor coordinates"
        onClick={() => cursor && copy(cursorText)}
      >
        X/Y: {cursorText} mm
      </button>
      <span className="tabular-nums">Zoom {Math.round(zoom * 100)}%</span>
      <span>Snap {snapEnabled ? `on · ${gridMm} mm` : "off"}</span>
      <span className="capitalize">Tool: {tool}</span>
      {sel ? (
        <button
          type="button"
          className="tabular-nums hover:text-foreground"
          aria-label="Copy selected object position"
          onClick={() => copy(`${Math.round(sel.x * 10) / 10}, ${Math.round(sel.y * 10) / 10}`)}
        >
          {sel.tag ?? sel.symbol_type}: {Math.round(sel.x * 10) / 10}, {Math.round(sel.y * 10) / 10}{" "}
          mm
        </button>
      ) : selection.length > 1 ? (
        <span>{selection.length} selected</span>
      ) : null}
      <DuplicateTagWarning />
      {measurement ? (
        <span className="text-foreground">
          Δ {formatMm(measurement.distance)} (dx {formatMm(measurement.dx)}, dy{" "}
          {formatMm(measurement.dy)})
        </span>
      ) : null}
    </div>
  );
}
