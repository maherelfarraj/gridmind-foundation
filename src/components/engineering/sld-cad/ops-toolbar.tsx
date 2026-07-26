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
import { CONNECTION_LABELS, CONNECTION_TYPES, type ConnectionType } from "@/lib/sld/canvas-types";
import type { AlignMode, DistributeAxis } from "@/lib/sld/geometry";

const ALIGN_BUTTONS: Array<{ mode: AlignMode; label: string; Icon: typeof AlignStartVertical }> = [
  { mode: "left", label: "Align left", Icon: AlignStartVertical },
  { mode: "center", label: "Align centre", Icon: AlignCenterVertical },
  { mode: "right", label: "Align right", Icon: AlignEndVertical },
  { mode: "top", label: "Align top", Icon: AlignStartHorizontal },
  { mode: "middle", label: "Align middle", Icon: AlignCenterHorizontal },
  { mode: "bottom", label: "Align bottom", Icon: AlignEndHorizontal },
];

export function OpsToolbar({ editable }: { editable: boolean }) {
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
          aria-label="Select tool"
          onClick={() => s().setTool("select")}
        >
          <MousePointer2 className="size-4" />
        </Button>
        <Button
          variant={tool === "pan" ? "default" : "ghost"}
          size="icon"
          aria-label="Pan tool"
          onClick={() => s().setTool("pan")}
        >
          <Move className="size-4" />
        </Button>
        <Button
          variant={tool === "connect" ? "default" : "ghost"}
          size="icon"
          aria-label="Connection tool"
          disabled={!editable}
          onClick={() => s().setTool("connect")}
        >
          <Cable className="size-4" />
        </Button>
        <Button
          variant={tool === "measure" ? "default" : "ghost"}
          size="icon"
          aria-label="Measure tool"
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
        <SelectTrigger className="h-8 w-[130px]" aria-label="Connection type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONNECTION_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {CONNECTION_LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="mx-1 h-6 w-px bg-border" aria-hidden />

      <Button
        variant="ghost"
        size="icon"
        aria-label="Rotate 90°"
        disabled={!editable || !some}
        onClick={() => s().rotateSelection()}
      >
        <RotateCw className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Mirror horizontally"
        disabled={!editable || !some}
        onClick={() => s().mirrorSelection()}
      >
        <FlipHorizontal className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Copy"
        disabled={!editable || !some}
        onClick={() => s().copySelection()}
      >
        <Copy className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Paste"
        disabled={!editable}
        onClick={() => s().paste()}
      >
        <ClipboardPaste className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Group"
        disabled={!editable || !many}
        onClick={() => s().groupSelection()}
      >
        <Group className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Ungroup"
        disabled={!editable || !some}
        onClick={() => s().ungroupSelection()}
      >
        <Ungroup className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Delete selection"
        disabled={!editable || !some}
        onClick={() => s().deleteSelection()}
      >
        <Trash2 className="size-4" />
      </Button>

      <span className="mx-1 h-6 w-px bg-border" aria-hidden />

      {ALIGN_BUTTONS.map(({ mode, label, Icon }) => (
        <Button
          key={mode}
          variant="ghost"
          size="icon"
          aria-label={label}
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
          aria-label={`Distribute ${axis}ly`}
          disabled={!editable || !three}
          onClick={() => s().distributeSelection(axis)}
        >
          {axis === "horizontal" ? "Dist H" : "Dist V"}
        </Button>
      ))}
    </div>
  );
}
