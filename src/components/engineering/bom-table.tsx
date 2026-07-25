// P-057 — Grouped editable BOM table with live buffer recompute.
import { useEffect, useReducer } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  applyBuffer,
  BOM_CATEGORIES,
  BOM_CATEGORY_LABEL,
  type BomCategory,
} from "@/lib/calculators/bom";
import type { BomLineRow } from "@/lib/bom.functions";
import { useUpdateBomLine } from "@/lib/bom-query";

type EditState = Record<
  string,
  {
    qty: number;
    buffer_pct: number;
    unit_cost: number | null;
    qty_buffered: number;
  }
>;

type Action =
  | { type: "init"; lines: BomLineRow[] }
  | { type: "field"; id: string; field: "qty" | "buffer_pct"; value: number; category: BomCategory }
  | { type: "cost"; id: string; value: number | null };

function reducer(state: EditState, action: Action): EditState {
  switch (action.type) {
    case "init": {
      const next: EditState = {};
      for (const l of action.lines) {
        next[l.id] = {
          qty: Number(l.qty),
          buffer_pct: Number(l.buffer_pct),
          unit_cost: l.unit_cost != null ? Number(l.unit_cost) : null,
          qty_buffered: Number(l.qty_buffered),
        };
      }
      return next;
    }
    case "field": {
      const cur = state[action.id];
      if (!cur) return state;
      const nextField = { ...cur, [action.field]: action.value };
      nextField.qty_buffered = applyBuffer(nextField.qty, nextField.buffer_pct, action.category);
      return { ...state, [action.id]: nextField };
    }
    case "cost": {
      const cur = state[action.id];
      if (!cur) return state;
      return { ...state, [action.id]: { ...cur, unit_cost: action.value } };
    }
    default:
      return state;
  }
}

export function BomTable({
  snapshotId,
  projectId,
  lines,
  readOnly,
}: {
  snapshotId: string;
  projectId: string;
  lines: BomLineRow[];
  readOnly: boolean;
}) {
  const [edit, dispatch] = useReducer(reducer, {} as EditState);
  const update = useUpdateBomLine(snapshotId, projectId);

  useEffect(() => {
    dispatch({ type: "init", lines });
  }, [lines]);

  const grouped = new Map<BomCategory, BomLineRow[]>();
  for (const c of BOM_CATEGORIES) grouped.set(c, []);
  for (const l of lines) {
    const cat = (grouped.get(l.category) ?? []) as BomLineRow[];
    cat.push(l);
    grouped.set(l.category, cat);
  }

  const commit = (
    line: BomLineRow,
    patch: {
      qty?: number;
      buffer_pct?: number;
      unit_cost?: number | null;
    },
  ) => {
    if (readOnly) return;
    update.mutate({ lineId: line.id, ...patch });
  };

  return (
    <div className="space-y-4">
      {BOM_CATEGORIES.map((cat) => {
        const rows = grouped.get(cat) ?? [];
        if (rows.length === 0) return null;
        return (
          <Card key={cat}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                {BOM_CATEGORY_LABEL[cat]}
                <Badge variant="secondary">{rows.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Spec</TableHead>
                    <TableHead className="w-20">Unit</TableHead>
                    <TableHead className="w-32 text-right">Qty</TableHead>
                    <TableHead className="w-28 text-right">Buffer %</TableHead>
                    <TableHead className="w-32 text-right">Buffered</TableHead>
                    <TableHead className="w-32 text-right">Unit cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((l) => {
                    const e = edit[l.id];
                    if (!e) return null;
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.item}</TableCell>
                        <TableCell className="text-muted-foreground">{l.spec ?? "—"}</TableCell>
                        <TableCell>{l.unit}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            className="h-8 text-right"
                            value={e.qty}
                            min={0}
                            step="any"
                            disabled={readOnly}
                            onChange={(ev) =>
                              dispatch({
                                type: "field",
                                id: l.id,
                                field: "qty",
                                value: Number(ev.target.value),
                                category: cat,
                              })
                            }
                            onBlur={() => e.qty !== Number(l.qty) && commit(l, { qty: e.qty })}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            className="h-8 text-right"
                            value={e.buffer_pct}
                            min={-50}
                            max={200}
                            step="0.1"
                            disabled={readOnly}
                            onChange={(ev) =>
                              dispatch({
                                type: "field",
                                id: l.id,
                                field: "buffer_pct",
                                value: Number(ev.target.value),
                                category: cat,
                              })
                            }
                            onBlur={() =>
                              e.buffer_pct !== Number(l.buffer_pct) &&
                              commit(l, { buffer_pct: e.buffer_pct })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatNumber(e.qty_buffered)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            className="h-8 text-right"
                            value={e.unit_cost ?? ""}
                            min={0}
                            step="any"
                            disabled={readOnly}
                            onChange={(ev) =>
                              dispatch({
                                type: "cost",
                                id: l.id,
                                value: ev.target.value === "" ? null : Number(ev.target.value),
                              })
                            }
                            onBlur={() => {
                              const prev = l.unit_cost != null ? Number(l.unit_cost) : null;
                              if (e.unit_cost !== prev) {
                                commit(l, { unit_cost: e.unit_cost });
                              }
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
