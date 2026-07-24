// P-072 — WBS tree component.
import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  WBS_DISCIPLINE_LABEL,
  WBS_ITEM_TYPE_LABEL,
  type WbsDiscipline,
  type WbsItemType,
} from "@/lib/wbs-rules";
import type { WbsItemRow } from "@/lib/wbs.functions";

interface TreeNode extends WbsItemRow {
  children: TreeNode[];
}

function buildTree(items: WbsItemRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const it of items) byId.set(it.id, { ...it, children: [] });
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (arr: TreeNode[]) => {
    arr.sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.code.localeCompare(b.code, undefined, { numeric: true }),
    );
    for (const n of arr) sort(n.children);
  };
  sort(roots);
  return roots;
}

export interface WbsTreeProps {
  items: WbsItemRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild?: (parent: WbsItemRow) => void;
  onDelete?: (id: string) => void;
  onReparent?: (
    id: string,
    parent_id: string | null,
    sort_order: number,
  ) => void;
  busy?: boolean;
}

export function WbsTree({
  items,
  selectedId,
  onSelect,
  onAddChild,
  onDelete,
  onReparent,
  busy,
}: WbsTreeProps) {
  const tree = useMemo(() => buildTree(items), [items]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // expand roots by default
    return new Set(tree.map((r) => r.id));
  });
  const [dragId, setDragId] = useState<string | null>(null);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isDescendant = (
    ancestorId: string,
    candidateId: string,
    all: WbsItemRow[],
  ): boolean => {
    const children = all.filter((i) => i.parent_id === ancestorId);
    for (const c of children) {
      if (c.id === candidateId) return true;
      if (isDescendant(c.id, candidateId, all)) return true;
    }
    return false;
  };

  const handleDrop = (targetId: string | null) => {
    if (!dragId || !onReparent) return;
    if (dragId === targetId) return;
    if (targetId && isDescendant(dragId, targetId, items)) return;
    const siblings = items.filter((i) => i.parent_id === targetId);
    onReparent(dragId, targetId, siblings.length);
    setDragId(null);
  };

  return (
    <div
      className="flex flex-col"
      onDragOver={(e) => onReparent && e.preventDefault()}
    >
      {tree.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          selectedId={selectedId}
          onSelect={onSelect}
          onAddChild={onAddChild}
          onDelete={onDelete}
          onDragStart={(id) => setDragId(id)}
          onDropOn={(id) => handleDrop(id)}
          busy={busy}
        />
      ))}
      {onReparent && (
        <div
          className="mt-2 flex items-center justify-center rounded border border-dashed border-border py-2 text-xs text-muted-foreground"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(null)}
        >
          Drop here to make a root item
        </div>
      )}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  selectedId,
  onSelect,
  onAddChild,
  onDelete,
  onDragStart,
  onDropOn,
  busy,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild?: (n: WbsItemRow) => void;
  onDelete?: (id: string) => void;
  onDragStart: (id: string) => void;
  onDropOn: (id: string) => void;
  busy?: boolean;
}) {
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded px-1 py-1 text-sm",
          isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
        )}
        style={{ paddingLeft: 4 + depth * 16 }}
        draggable={!!onDragStart}
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStart(node.id);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.stopPropagation();
          onDropOn(node.id);
        }}
      >
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground"
          onClick={() => onToggle(node.id)}
          aria-label={isOpen ? "Collapse" : "Expand"}
        >
          {hasChildren ? (
            isOpen ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )
          ) : null}
        </button>

        <GripVertical
          size={12}
          className="text-muted-foreground opacity-0 group-hover:opacity-100"
          aria-hidden
        />

        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="font-mono text-xs text-muted-foreground">
            {node.code}
          </span>
          <span className="truncate text-foreground">{node.name}</span>
          <Badge variant="outline" className="ml-auto shrink-0 text-xs">
            {WBS_ITEM_TYPE_LABEL[node.item_type as WbsItemType]}
          </Badge>
          {node.discipline && (
            <Badge variant="secondary" className="shrink-0 text-xs">
              {WBS_DISCIPLINE_LABEL[node.discipline as WbsDiscipline]}
            </Badge>
          )}
        </button>

        <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
          {onAddChild && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              disabled={busy}
              onClick={() => onAddChild(node)}
              aria-label="Add child"
            >
              <Plus size={12} />
            </Button>
          )}
          {onDelete && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-destructive"
              disabled={busy}
              onClick={() => onDelete(node.id)}
              aria-label="Delete"
            >
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      </div>

      {isOpen &&
        node.children.map((c) => (
          <TreeRow
            key={c.id}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            selectedId={selectedId}
            onSelect={onSelect}
            onAddChild={onAddChild}
            onDelete={onDelete}
            onDragStart={onDragStart}
            onDropOn={onDropOn}
            busy={busy}
          />
        ))}
    </div>
  );
}
