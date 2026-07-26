// P-139 — Left dock symbol palette: search, category groups, click or drag to place.
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { SymbolGlyph } from "./symbol-glyph";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCanvasStore } from "@/lib/sld/canvas-store";
import { filterSymbols, groupByCategory, type SymbolTypeRecord } from "@/lib/sld/symbol-registry";

export const SYMBOL_DRAG_MIME = "application/x-gridmind-sld-symbol";

export function SymbolPalette({
  symbols,
  loading,
  editable,
}: {
  symbols: SymbolTypeRecord[];
  loading: boolean;
  editable: boolean;
}) {
  const [query, setQuery] = useState("");
  const placingType = useCanvasStore((s) => s.placingType);
  const setPlacingType = useCanvasStore((s) => s.setPlacingType);

  const groups = useMemo(() => groupByCategory(filterSymbols(symbols, query)), [symbols, query]);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Symbol library
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2.5 size-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search symbols"
          aria-label="Search symbols"
          className="h-8 pl-7 text-xs"
        />
      </div>
      <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">No symbols match “{query}”.</p>
        ) : null}
        {groups.map((group) => (
          <div key={group.category} className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </p>
            <div className="grid grid-cols-2 gap-1">
              {group.items.map((sym) => {
                const active = placingType === sym.type_key;
                return (
                  <button
                    key={sym.id}
                    type="button"
                    title={`${sym.display_name} · ${sym.tag_prefix}`}
                    draggable={editable}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(SYMBOL_DRAG_MIME, sym.type_key);
                      e.dataTransfer.setData("text/plain", sym.type_key);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => setPlacingType(active ? null : sym.type_key)}
                    disabled={!editable}
                    className={
                      active
                        ? "flex flex-col items-center gap-1 rounded-md border border-primary bg-primary/10 px-1 py-1.5 text-[11px]"
                        : "flex flex-col items-center gap-1 rounded-md border border-border bg-card px-1 py-1.5 text-[11px] hover:border-primary disabled:opacity-60"
                    }
                  >
                    <SymbolGlyph svg={sym.svg_body} size={28} className="text-foreground" />
                    <span className="line-clamp-2 text-center leading-tight">
                      {sym.display_name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {editable
          ? placingType
            ? "Click the sheet to place, or drag a symbol onto it."
            : "Pick a symbol, then click the sheet — or drag it straight on."
          : "Read-only view."}
      </p>
    </div>
  );
}
