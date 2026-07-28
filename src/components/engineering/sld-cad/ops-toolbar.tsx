// P-140 — Operations toolbar: transforms, align/distribute, group, tools.
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Cable,
  Copy,
  ClipboardPaste,
  FlipHorizontal,
  Group,
  MousePointer2,
  Move,
  Ruler,
  RotateCw,
  Trash2,
  Ungroup,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCanvasStore } from "@/lib/sld/canvas-store";
import { CONNECTION_TYPES, type ConnectionType } from "@/lib/sld/canvas-types";
import type { AlignMode, DistributeAxis } from "@/lib/sld/geometry";
import { useI18n } from "@/lib/i18n/locale-provider";

const ALIGN_MODES: Array<{ mode: AlignMode; Icon: typeof AlignStartVertical }> = [
  { mode: "left", Icon: AlignStartVertical },
  { mode: "center", Icon: AlignCenterVertical },
  { mode: "right", Icon: AlignEndVertical },
  { mode: "top", Icon: AlignStartHorizontal },
  { mode: "middle", Icon: AlignCenterHorizontal },
  { mode: "bottom", Icon: AlignEndHorizontal },
];

export function OpsToolbar({ editable }: { editable: boolean }) {
  const { t } = useI18n();
  const CONNECTION_LABELS_T: Record<ConnectionType, string> = {
    cable: t("engMod.sld.canvas.connectionTypeLabels.cable"),
    busbar: t("engMod.sld.canvas.connectionTypeLabels.busbar"),
    dc_string: t("engMod.sld.canvas.connectionTypeLabels.dc_string"),
    earth: t("engMod.sld.canvas.connectionTypeLabels.earth"),
    signal: t("engMod.sld.canvas.connectionTypeLabels.signal"),
  };
  const ALIGN_LABELS: Record<AlignMode, string> = {
    left: t("engMod.sld.canvas.align.left"),
    center: t("engMod.sld.canvas.align.center"),
    right: t("engMod.sld.canvas.align.right"),
    top: t("engMod.sld.canvas.align.top"),
    middle: t("engMod.sld.canvas.align.middle"),
    bottom: t("engMod.sld.canvas.align.bottom"),
  };
  const tool = useCanvasStore((s) => s.tool);
  const selection = useCanvasStore((s) => s.selection);
  const connectionType = useCanvasStore((s) => s.connectionType);
  const store = useCanvasStore;

  const s = () => store.getState();
  const many = selection.length >= 2;
  const some = selection.length >= 1;
  const three = selection.length >= 3;

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
      <div className="flex items-center gap-0.5 pr-1">
        <Button
          variant={tool === "select" ? "default" : "ghost"}
          size="icon"
          aria-label={t("engMod.sld.canvas.tools.select")}
          onClick={() => s().setTool("select")}
        >
          <MousePointer2 className="size-4" />
        </Button>
        <Button
          variant={tool === "pan" ? "default" : "ghost"}
          size="icon"
          aria-label={t("engMod.sld.canvas.tools.pan")}
          onClick={() => s().setTool("pan")}
        >
          <Move className="size-4" />
        </Button>
        <Button
          variant={tool === "connect" ? "default" : "ghost"}
          size="icon"
          aria-label={t("engMod.sld.canvas.tools.connect")}
          disabled={!editable}
          onClick={() => s().setTool("connect")}
        >
          <Cable className="size-4" />
        </Button>
        <Button
          variant={tool === "measure" ? "default" : "ghost"}
          size="icon"
          aria-label={t("engMod.sld.canvas.tools.measure")}
          disabled={!editable}
          onClick={() => s().setTool("measure")}
        >
          <Ruler className="size-4" />
        </Button>
      </div>

      <Select
        value={connectionType}
        onValueChange={(v) => s().setConnectionType(v as ConnectionType)}
      >
        <SelectTrigger className="h-8 w-[130px]" aria-label={t("engMod.sld.canvas.connectionType")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONNECTION_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {CONNECTION_LABELS_T[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="mx-1 h-6 w-px bg-border" aria-hidden />

      <Button
        variant="ghost"
        size="icon"
        aria-label={t("engMod.sld.canvas.actions.rotate")}
        disabled={!editable || !some}
        onClick={() => s().rotateSelection()}
      >
        <RotateCw className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("engMod.sld.canvas.actions.mirror")}
        disabled={!editable || !some}
        onClick={() => s().mirrorSelection()}
      >
        <FlipHorizontal className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("engMod.sld.canvas.actions.copy")}
        disabled={!editable || !some}
        onClick={() => s().copySelection()}
      >
        <Copy className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("engMod.sld.canvas.actions.paste")}
        disabled={!editable}
        onClick={() => s().paste()}
      >
        <ClipboardPaste className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("engMod.sld.canvas.actions.group")}
        disabled={!editable || !many}
        onClick={() => s().groupSelection()}
      >
        <Group className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("engMod.sld.canvas.actions.ungroup")}
        disabled={!editable || !some}
        onClick={() => s().ungroupSelection()}
      >
        <Ungroup className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("engMod.sld.canvas.actions.delete")}
        disabled={!editable || !some}
        onClick={() => s().deleteSelection()}
      >
        <Trash2 className="size-4" />
      </Button>

      <span className="mx-1 h-6 w-px bg-border" aria-hidden />

      {ALIGN_MODES.map(({ mode, Icon }) => (
        <Button
          key={mode}
          variant="ghost"
          size="icon"
          aria-label={ALIGN_LABELS[mode]}
          disabled={!editable || !many}
          onClick={() => s().alignSelection(mode)}
        >
          <Icon className="size-4" />
        </Button>
      ))}
      {(["horizontal", "vertical"] as DistributeAxis[]).map((axis) => (
        <Button
          key={axis}
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          aria-label={t("engMod.sld.canvas.distribute.aria", { axis })}
          disabled={!editable || !three}
          onClick={() => s().distributeSelection(axis)}
        >
          {axis === "horizontal"
            ? t("engMod.sld.canvas.distribute.horizontal")
            : t("engMod.sld.canvas.distribute.vertical")}
        </Button>
      ))}
    </div>
  );
}
