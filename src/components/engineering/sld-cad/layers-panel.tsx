// P-138 — Layers dock: create, rename, visibility + lock toggles.
import { useState } from "react";
import { Eye, EyeOff, Lock, LockOpen, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCanvasStore } from "@/lib/sld/canvas-store";

export function LayersPanel({ editable }: { editable: boolean }) {
  const layers = useCanvasStore((s) => s.layers);
  const objects = useCanvasStore((s) => s.objects);
  const addLayer = useCanvasStore((s) => s.addLayer);
  const renameLayer = useCanvasStore((s) => s.renameLayer);
  const toggleVisible = useCanvasStore((s) => s.toggleLayerVisible);
  const toggleLocked = useCanvasStore((s) => s.toggleLayerLocked);
  const [newName, setNewName] = useState("");

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Layers</p>
      <ul className="space-y-1">
        {layers.map((layer) => (
          <li
            key={layer.id}
            className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1"
          >
            <button
              type="button"
              aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => toggleVisible(layer.id)}
            >
              {layer.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </button>
            <button
              type="button"
              aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
              className="text-muted-foreground hover:text-foreground disabled:opacity-40"
              disabled={!editable || layer.system}
              onClick={() => toggleLocked(layer.id)}
            >
              {layer.locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
            </button>
            {layer.system || !editable ? (
              <span className="flex-1 truncate text-sm">{layer.name}</span>
            ) : (
              <Input
                value={layer.name}
                aria-label={`Layer name ${layer.name}`}
                onChange={(e) => renameLayer(layer.id, e.target.value)}
                className="h-7 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-1"
              />
            )}
            <span className="text-xs tabular-nums text-muted-foreground">
              {objects.filter((o) => o.layer_id === layer.id).length}
            </span>
          </li>
        ))}
      </ul>
      {editable ? (
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name) return;
            addLayer(name);
            setNewName("");
          }}
        >
          <Input
            value={newName}
            placeholder="New layer"
            aria-label="New layer name"
            onChange={(e) => setNewName(e.target.value)}
            className="h-8"
          />
          <Button
            type="submit"
            size="icon"
            variant="secondary"
            className="size-8"
            aria-label="Add layer"
          >
            <Plus className="size-4" />
          </Button>
        </form>
      ) : null}
    </div>
  );
}
