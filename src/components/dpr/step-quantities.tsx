// P-086 — Quantities step: add rows from WBS picker; feeds discipline board.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Package, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dprDetailQueryOptions, errorMessage, wbsPickerQueryOptions } from "@/lib/dpr-query";
import {
  addQuantityRow,
  deleteQuantityRow,
  type DprRow,
  type QuantityEntry,
} from "@/lib/dpr.functions";
import type { WbsPickerRow } from "@/lib/wbs-picker.functions";

interface Props {
  header: DprRow;
  readOnly: boolean;
}

export function StepQuantities({ header, readOnly }: Props) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: dprDetailQueryOptions(header.id).queryKey,
    });
  const add = useServerFn(addQuantityRow);
  const del = useServerFn(deleteQuantityRow);

  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<WbsPickerRow | null>(null);
  const [quantity, setQuantity] = useState<string>("");
  const [area, setArea] = useState("");

  const wbsQuery = useQuery(wbsPickerQueryOptions(header.project_id, q));
  const options = (wbsQuery.data ?? []).slice(0, 20);

  const addMut = useMutation({
    mutationFn: () =>
      add({
        data: {
          dprId: header.id,
          wbsItemId: selected!.id,
          quantity: Number(quantity),
          area: area.trim() || selected!.area || null,
          uom: selected!.uom ?? null,
          notes: null,
        },
      }),
    onSuccess: () => {
      toast.success("Quantity added");
      setSelected(null);
      setQuantity("");
      setArea("");
      setQ("");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const delMut = useMutation({
    mutationFn: (entryId: string) => del({ data: { dprId: header.id, entryId } }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const entries: QuantityEntry[] = useMemo(
    () => (Array.isArray(header.quantities) ? header.quantities : []),
    [header.quantities],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" aria-hidden /> Installed quantities
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No quantities yet. These drive tomorrow's discipline board install rate.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border bg-card p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {e.wbs_code ? `${e.wbs_code} · ` : ""}
                      {e.wbs_name ?? e.wbs_item_id}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {e.quantity} {e.uom ?? ""} · {e.discipline}
                      {e.area ? ` · ${e.area}` : ""}
                    </div>
                  </div>
                  {!readOnly && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-11 w-11 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => delMut.mutate(e.id)}
                      disabled={delMut.isPending}
                      aria-label="Remove"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!readOnly && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Add quantity</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qty-search">Find WBS item</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="qty-search"
                  className="h-11 pl-9"
                  placeholder="Search by name, code or area"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
            {q && (
              <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                {wbsQuery.isLoading ? (
                  <div className="p-3 text-sm text-muted-foreground">Loading…</div>
                ) : options.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">
                    No matches. Baseline items need `planned_quantity` set to drive install rate.
                  </div>
                ) : (
                  <ul>
                    {options.map((w) => {
                      const isSelected = selected?.id === w.id;
                      return (
                        <li key={w.id}>
                          <button
                            type="button"
                            onClick={() => setSelected(w)}
                            className={`flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40 ${
                              isSelected ? "bg-accent/60" : ""
                            }`}
                          >
                            <span className="truncate font-medium text-foreground">
                              {w.code ? `${w.code} · ` : ""}
                              {w.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {w.discipline ?? "—"}
                              {w.area ? ` · ${w.area}` : ""}
                              {w.uom ? ` · UoM ${w.uom}` : ""}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            {selected && (
              <div className="rounded-md border border-dashed border-border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Selected
                </div>
                <div className="mt-1 truncate text-sm font-medium text-foreground">
                  {selected.code ? `${selected.code} · ` : ""}
                  {selected.name}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="qty-value">
                      Quantity {selected.uom ? `(${selected.uom})` : ""}
                    </Label>
                    <Input
                      id="qty-value"
                      type="number"
                      inputMode="decimal"
                      className="h-11"
                      min={0}
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="qty-area">
                      Area {selected.area ? `(default: ${selected.area})` : ""}
                    </Label>
                    <Input
                      id="qty-area"
                      className="h-11"
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                      placeholder={selected.area ?? "Optional"}
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  className="mt-3 h-11 w-full"
                  disabled={addMut.isPending || !(Number(quantity) > 0)}
                  onClick={() => addMut.mutate()}
                >
                  <Plus className="mr-2 h-4 w-4" aria-hidden />
                  Add quantity
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
