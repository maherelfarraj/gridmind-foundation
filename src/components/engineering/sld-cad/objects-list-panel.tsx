// P-141 — Objects list dock with inline tag editing and duplicate detection.
import { useMemo, useState } from "react";
import { AlertTriangle, Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSetObjectTag } from "@/lib/sld-tagging-query";
import { useCanvasStore } from "@/lib/sld/canvas-store";
import { MEASURE_SYMBOL } from "@/lib/sld/canvas-types";
import { duplicateTagIds, isValidTag, TAG_PATTERN } from "@/lib/sld/tagging";

export function ObjectsListPanel({
  drawingId,
  editable,
}: {
  drawingId: string;
  editable: boolean;
}) {
  const objects = useCanvasStore((s) => s.objects);
  const selection = useCanvasStore((s) => s.selection);
  const select = useCanvasStore((s) => s.select);
  const setObjectProps = useCanvasStore((s) => s.setObjectProps);
  const setTag = useSetObjectTag(drawingId);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const rows = useMemo(
    () => objects.filter((o) => o.symbol_type !== MEASURE_SYMBOL),
    [objects],
  );
  const dupes = useMemo(() => duplicateTagIds(rows), [rows]);

  const commit = async (id: string) => {
    const next = draft.trim().toUpperCase();
    if (!isValidTag(next)) {
      toast.error("Tag must look like INV-01-02.");
      return;
    }
    setObjectProps(id, { tag: next });
    setEditingId(null);
    const isPersisted =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isPersisted) await setTag.mutateAsync({ objectId: id, tag: next });
  };

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Objects ({rows.length})</p>
        {dupes.size > 0 ? (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="size-3" />
            {dupes.size}
          </Badge>
        ) : null}
      </div>
      <ScrollArea className="h-56 pr-2">
        <ul className="space-y-0.5">
          {rows.map((o) => {
            const selected = selection.includes(o.id);
            const dupe = dupes.has(o.id);
            return (
              <li key={o.id}>
                {editingId === o.id ? (
                  <div className="flex items-center gap-1">
                    <Input
                      autoFocus
                      value={draft}
                      pattern={TAG_PATTERN.source}
                      aria-label={`Tag for ${o.label ?? o.symbol_type}`}
                      className="h-7 font-mono text-xs"
                      onChange={(e) => setDraft(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commit(o.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label="Save tag"
                      onClick={() => void commit(o.id)}
                    >
                      <Check className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label="Cancel tag edit"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div
                    className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs ${
                      selected ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => select([o.id])}
                    >
                      <span
                        className={`font-mono ${dupe ? "text-destructive" : "text-foreground"}`}
                      >
                        {o.tag ?? "—"}
                      </span>
                      <span className="truncate text-muted-foreground">
                        {o.label ?? o.symbol_type}
                      </span>
                    </button>
                    {dupe ? (
                      <Badge variant="destructive" className="px-1 py-0 text-[10px]">
                        dup
                      </Badge>
                    ) : null}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      aria-label={`Edit tag for ${o.label ?? o.symbol_type}`}
                      disabled={!editable}
                      onClick={() => {
                        setEditingId(o.id);
                        setDraft(o.tag ?? "");
                      }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
          {rows.length === 0 ? (
            <li className="px-1.5 py-2 text-xs text-muted-foreground">No objects yet.</li>
          ) : null}
        </ul>
      </ScrollArea>
    </div>
  );
}
