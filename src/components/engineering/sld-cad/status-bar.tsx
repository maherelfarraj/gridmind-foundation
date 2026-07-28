// P-140 — Canvas status bar: cursor mm, zoom, snap, selection position.
import { toast } from "sonner";

import { useCanvasStore } from "@/lib/sld/canvas-store";
import { formatMm } from "@/lib/sld/geometry";
import { useI18n } from "@/lib/i18n/locale-provider";
import { DuplicateTagWarning } from "./tags-menu";

export function CanvasStatusBar() {
  const { t } = useI18n();
  function copy(text: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      toast.success(t("engMod.sld.canvas.status.copiedToast", { text }));
    }
  }

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
        aria-label={t("engMod.sld.canvas.status.copyCursor")}
        onClick={() => cursor && copy(cursorText)}
      >
        {t("engMod.sld.canvas.status.cursor", { value: cursorText })}
      </button>
      <span className="tabular-nums">{t("engMod.sld.canvas.status.zoom", { value: Math.round(zoom * 100) })}</span>
      <span>{snapEnabled ? t("engMod.sld.canvas.status.snapOn", { grid: gridMm }) : t("engMod.sld.canvas.status.snapOff")}</span>
      <span className="capitalize">{t("engMod.sld.canvas.status.tool", { tool })}</span>
      {sel ? (
        <button
          type="button"
          className="tabular-nums hover:text-foreground"
          aria-label={t("engMod.sld.canvas.status.copySelection")}
          onClick={() => copy(`${Math.round(sel.x * 10) / 10}, ${Math.round(sel.y * 10) / 10}`)}
        >
          {sel.tag ?? sel.symbol_type}: {Math.round(sel.x * 10) / 10}, {Math.round(sel.y * 10) / 10}{" "}
          mm
        </button>
      ) : selection.length > 1 ? (
        <span>{t("engMod.sld.canvas.status.selectedCount", { count: selection.length })}</span>
      ) : null}
      <DuplicateTagWarning />
      {measurement ? (
        <span className="text-foreground">
          {t("engMod.sld.canvas.status.measurement", {
            distance: formatMm(measurement.distance),
            dx: formatMm(measurement.dx),
            dy: formatMm(measurement.dy),
          })}
        </span>
      ) : null}
    </div>
  );
}
