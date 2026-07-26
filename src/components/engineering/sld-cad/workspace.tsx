// P-138 — SLD CAD workspace shell: toolbar, palette, canvas, docks, shortcuts.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Grid2x2,
  Keyboard,
  Magnet,
  Maximize,
  Redo2,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { LayersPanel } from "./layers-panel";
import { PropertiesPanel } from "./properties-panel";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { ObjectsListPanel } from "./objects-list-panel";
import { OpsToolbar } from "./ops-toolbar";
import { TagsMenu } from "./tags-menu";
import { SldCanvas } from "./sld-canvas";
import { CanvasStatusBar } from "./status-bar";
import type { TitleBlockData } from "./title-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSaveSldCanvas } from "@/lib/sld-cad-query";
import type { SldCadWorkspace } from "@/lib/sld-cad.functions";
import { useCanvasStore } from "@/lib/sld/canvas-store";
import type { SldConnection } from "@/lib/sld/canvas-types";
import {
  BORDER_LAYER_ID,
  GRID_STEPS,
  normalizeCanvasMeta,
  type GridMm,
  type SheetSize,
} from "@/lib/sld/canvas-types";
import { setSymbolRegistry } from "@/lib/sld/symbols";
import { SymbolPalette } from "./symbol-palette";
import { useSymbolRegistry } from "@/lib/sld-symbols-query";
import { initialProperties, mergeSymbolTypes } from "@/lib/sld/symbol-registry";
import { generateTags } from "@/lib/sld/tagging";
import { ValidationPanel } from "./validation-panel";
import { useLiveValidation, useRunValidation } from "@/lib/sld-validation-query";
import { sldConfigQueryOptions } from "@/lib/sld-query";
import { getSldConfig } from "@/lib/sld.functions";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

export function SldCadWorkspaceView({ data }: { data: SldCadWorkspace }) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [isCoarse, setIsCoarse] = useState(false);

  const store = useCanvasStore;
  const hydrate = useCanvasStore((s) => s.hydrate);
  const zoom = useCanvasStore((s) => s.zoom);
  const gridMm = useCanvasStore((s) => s.gridMm);
  const snapEnabled = useCanvasStore((s) => s.snapEnabled);
  const objects = useCanvasStore((s) => s.objects);
  const layers = useCanvasStore((s) => s.layers);
  const dirty = useCanvasStore((s) => s.dirty);
  const removedIds = useCanvasStore((s) => s.removedIds);
  const connections = useCanvasStore((s) => s.connections);
  const undoDepth = useCanvasStore((s) => s.undoStack.length);
  const redoDepth = useCanvasStore((s) => s.redoStack.length);

  const sldConfigFn = useServerFn(getSldConfig);
  const sldConfig = useQuery(
    sldConfigQueryOptions(sldConfigFn as any, data.drawing.project_id),
  );
  const projectVoltagesKv = useMemo(
    () =>
      ((sldConfig.data as any)?.config?.voltage_levels ?? [])
        .map((v: any) => Number(v?.kv))
        .filter((v: number) => Number.isFinite(v) && v > 0),
    [sldConfig.data],
  );

  const registry = useSymbolRegistry();
  const symbols = useMemo(
    () => mergeSymbolTypes(registry.data?.symbols ?? []),
    [registry.data?.symbols],
  );
  useEffect(() => {
    setSymbolRegistry(symbols);
  }, [symbols]);

  const save = useSaveSldCanvas(data.drawing.id, () => store.getState().markSaved());
  const validation = useLiveValidation(symbols, projectVoltagesKv);
  const runValidation = useRunValidation(data.drawing.id);

  useEffect(() => {
    setIsCoarse(
      typeof window !== "undefined" &&
        window.matchMedia("(pointer: coarse), (max-width: 767px)").matches,
    );
  }, []);

  const editable = data.editable && !isCoarse;

  useEffect(() => {
    hydrate(
      data.objects.map((o) => ({
        ...o,
        rotation: o.rotation as 0 | 90 | 180 | 270,
        properties: (o.properties ?? {}) as Record<string, unknown>,
      })),
      normalizeCanvasMeta(data.revision?.canvas),
      data.connections.map((c) => ({
        ...c,
        connection_type: c.connection_type as SldConnection["connection_type"],
      })),
    );
  }, [data, hydrate]);

  const titleBlock: TitleBlockData = useMemo(
    () => ({
      drawing_number: data.drawing.drawing_number,
      title: data.drawing.title,
      revision_code: data.revision?.revision_code ?? null,
      status: data.drawing.status,
      project_name: data.drawing.project_name,
      drawn_by: data.drawnBy,
      date: new Date().toISOString().slice(0, 10),
      sheet_size: (data.drawing.sheet_size as SheetSize) ?? "A1",
      border_template: data.drawing.border_template,
    }),
    [data],
  );

  const doSave = useCallback(() => {
    const s = store.getState();
    if (!data.editable) {
      toast.error("This drawing is locked or read-only.");
      return;
    }
    save.mutate({
      objects: s.objects,
      removedIds: s.removedIds,
      connections: s.connections,
      removedConnectionIds: s.removedConnectionIds,
      canvas: { layers: s.layers, gridMm: s.gridMm, snapEnabled: s.snapEnabled, areas: s.areas },
    });
  }, [data.editable, save, store]);

  const fit = useCallback(() => {
    const el = document.querySelector('[aria-label="SLD canvas"]');
    const rect = el?.getBoundingClientRect();
    store
      .getState()
      .fitToContent({ width: rect?.width ?? 800, height: rect?.height ?? 600 }, { x: 841, y: 594 });
  }, [store]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const s = store.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === "?") {
        setShortcutsOpen(true);
        return;
      }
      if (e.key === "Escape") {
        s.cancelConnection();
        s.cancelMeasure();
        s.setPlacingType(null);
        s.clearSelection();
        return;
      }
      if (e.key.toLowerCase() === "f" && !mod) {
        fit();
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        doSave();
        return;
      }
      if (!editable) return;
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        s.duplicateSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) s.ungroupSelection();
        else s.groupSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        s.copySelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        s.paste();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        s.deleteSelection();
        return;
      }
      if (e.key.toLowerCase() === "r") {
        s.rotateSelection();
        return;
      }
      if (e.key.toLowerCase() === "m") {
        s.mirrorSelection();
        return;
      }
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = s.gridMm * (e.shiftKey ? 10 : 1);
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (dx || dy) s.moveSelection(dx, dy);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave, editable, fit, store]);

  const handlePlace = useCallback(
    (point: { x: number; y: number }, symbolType?: string) => {
      const s = store.getState();
      const type = symbolType ?? s.placingType;
      if (!type) return;
      const layer = s.layers.find((l) => !l.system && !l.locked && l.visible);
      if (!layer) {
        toast.error("Unlock a layer before placing symbols.");
        return;
      }
      const record = symbols.find((sym) => sym.type_key === type);
      s.placeObject({
        id: `tmp-${Math.random().toString(36).slice(2)}`,
        symbol_type: type,
        tag: record
          ? (generateTags(
              [
                ...s.objects.map((o) => ({
                  id: o.id,
                  symbol_type: o.symbol_type,
                  tag: o.tag,
                  x: o.x,
                  y: o.y,
                })),
                { id: "__new", symbol_type: type, tag: null, x: point.x, y: point.y },
              ],
              symbols.map((sym) => ({ type_key: sym.type_key, tag_prefix: sym.tag_prefix })),
              s.areas,
            ).find((a) => a.id === "__new")?.tag ?? null)
          : null,
        label: record?.display_name ?? null,
        x: point.x,
        y: point.y,
        rotation: 0,
        mirrored: false,
        layer_id: layer.id,
        properties: record ? initialProperties(record) : {},
      });
    },
    [store, symbols],
  );

  const lockedBanner = !data.canWrite
    ? "You have read-only access to this drawing."
    : data.drawing.locked
      ? "This drawing is locked — saving is blocked until it is unlocked."
      : ["ifc", "as_built", "superseded"].includes(data.drawing.status)
        ? `Status "${data.drawing.status.replace(/_/g, " ")}" is read-only — create a new revision to edit.`
        : isCoarse
          ? "Viewer mode on small screens — pinch to zoom. Open on a desktop to edit."
          : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold">
            {data.drawing.drawing_number} · {data.drawing.title}
          </h2>
          <StatusBadge status={data.drawing.status} />
          <Badge variant="outline">Rev {data.revision?.revision_code ?? "—"}</Badge>
          {dirty ? <Badge variant="secondary">Unsaved</Badge> : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Zoom out"
            onClick={() => store.getState().setZoom(zoom / 1.2)}
          >
            <ZoomOut className="size-4" />
          </Button>
          <span className="w-14 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Zoom in"
            onClick={() => store.getState().setZoom(zoom * 1.2)}
          >
            <ZoomIn className="size-4" />
          </Button>
          <Button variant="outline" size="icon" aria-label="Fit to content" onClick={fit}>
            <Maximize className="size-4" />
          </Button>
          <Button
            variant={snapEnabled ? "default" : "outline"}
            size="icon"
            aria-label="Toggle snap"
            onClick={() => store.getState().toggleSnap()}
          >
            <Magnet className="size-4" />
          </Button>
          <div className="flex items-center gap-1 rounded-md border border-border px-2 py-1">
            <Grid2x2 className="size-4 text-muted-foreground" />
            {GRID_STEPS.map((g) => (
              <button
                key={g}
                type="button"
                aria-label={`Grid ${g} mm`}
                onClick={() => store.getState().setGridMm(g as GridMm)}
                className={
                  g === gridMm
                    ? "rounded px-1.5 text-xs font-semibold text-primary"
                    : "rounded px-1.5 text-xs text-muted-foreground hover:text-foreground"
                }
              >
                {g}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Undo"
            disabled={undoDepth === 0}
            onClick={() => store.getState().undo()}
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Redo"
            disabled={redoDepth === 0}
            onClick={() => store.getState().redo()}
          >
            <Redo2 className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Shortcuts"
            onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard className="size-4" />
          </Button>
          <Button onClick={doSave} disabled={!editable || save.isPending}>
            <Save className="mr-2 size-4" />
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {lockedBanner ? (
        <Card>
          <CardContent className="py-2 text-sm text-muted-foreground">{lockedBanner}</CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <OpsToolbar editable={editable} />
        <TagsMenu drawingId={data.drawing.id} editable={editable} symbols={symbols} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[190px_minmax(0,1fr)_240px]">
        <Card className="hidden lg:block">
          <CardContent className="space-y-4 p-3">
            <SymbolPalette symbols={symbols} loading={registry.isLoading} editable={editable} />
            <LayersPanel editable={editable} />
          </CardContent>
        </Card>

        <div className="space-y-2">
          <div className="h-[70vh] min-h-[420px]">
            <SldCanvas
              editable={editable}
              titleBlock={titleBlock}
              onPlace={handlePlace}
              issueSeverity={validation.severityByObject}
            />
          </div>
          <CanvasStatusBar />
        </div>

        <Card className="hidden lg:block">
          <CardContent className="space-y-4 p-3">
            <ValidationPanel
              issues={validation.issues}
              errorCount={validation.error_count}
              warningCount={validation.warning_count}
              running={runValidation.isPending}
              lastRunAt={(runValidation.data as any)?.ran_at ?? null}
              onRun={() => runValidation.mutate()}
            />
            <PropertiesPanel editable={editable} />
            <ObjectsListPanel drawingId={data.drawing.id} editable={editable} />
            <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              <p>
                {objects.length} objects · {layers.filter((l) => l.id !== BORDER_LAYER_ID).length}{" "}
                layers
              </p>
              <p>
                {connections.length} connections · {removedIds.length} pending removals
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
