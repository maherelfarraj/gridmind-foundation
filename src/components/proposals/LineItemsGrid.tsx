import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSaveLineItems } from "@/lib/proposal-query";
import type { ProposalDetail, ProposalLineItem } from "@/lib/proposal.functions";

type Row = {
  id?: string;
  sort_order: number;
  category: string;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
};

function toRows(items: ProposalLineItem[]): Row[] {
  return items.map((i) => ({
    id: i.id,
    sort_order: i.sort_order,
    category: i.category ?? "",
    description: i.description ?? "",
    qty: i.qty,
    unit: i.unit ?? "",
    unit_price: i.unit_price,
  }));
}

function formatCurrency(v: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

export function LineItemsGrid({
  proposal,
  readOnly,
}: {
  proposal: ProposalDetail;
  readOnly: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(proposal.line_items));
  const [dirty, setDirty] = useState(false);
  const save = useSaveLineItems(proposal.id);

  useEffect(() => {
    setRows(toRows(proposal.line_items));
    setDirty(false);
  }, [proposal.id, proposal.line_items]);

  const subtotal = useMemo(
    () =>
      rows.reduce((sum, r) => sum + Math.round((r.qty ?? 0) * (r.unit_price ?? 0) * 100) / 100, 0),
    [rows],
  );
  const contingencyAmt = subtotal * (proposal.contingency_pct / 100);
  const marginAmt = (subtotal + contingencyAmt) * (proposal.margin_pct / 100);
  const total = Math.round((subtotal + contingencyAmt + marginAmt) * 100) / 100;

  const update = (i: number, patch: Partial<Row>) => {
    setRows((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
    setDirty(true);
  };

  const add = () => {
    setRows((prev) => [
      ...prev,
      {
        sort_order: prev.length,
        category: "",
        description: "",
        qty: 1,
        unit: "ea",
        unit_price: 0,
      },
    ]);
    setDirty(true);
  };

  const remove = (i: number) => {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  };

  const saveAll = () => {
    save.mutate(
      rows.map((r, i) => ({
        id: r.id,
        sort_order: i,
        category: r.category || null,
        description: r.description || null,
        qty: Number(r.qty) || 0,
        unit: r.unit || null,
        unit_price: Number(r.unit_price) || 0,
      })),
      { onSuccess: () => setDirty(false) },
    );
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Scope &amp; pricing</h3>
          <p className="text-xs text-muted-foreground">Line items — totals recompute on save</p>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={add}>
              <Plus size={14} aria-hidden />
              Add line
            </Button>
            <Button size="sm" onClick={saveAll} disabled={!dirty || save.isPending}>
              {save.isPending ? "Saving…" : "Save lines"}
            </Button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No line items yet. {!readOnly && "Click “Add line” to get started."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                <th className="p-2 text-left font-medium">Category</th>
                <th className="p-2 text-left font-medium">Description</th>
                <th className="p-2 text-right font-medium">Qty</th>
                <th className="p-2 text-left font-medium">Unit</th>
                <th className="p-2 text-right font-medium">Unit price</th>
                <th className="p-2 text-right font-medium">Line total</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const line = Math.round((r.qty ?? 0) * (r.unit_price ?? 0) * 100) / 100;
                return (
                  <tr key={r.id ?? `new-${i}`} className="border-b border-border/60">
                    <td className="p-1">
                      <Input
                        value={r.category}
                        disabled={readOnly}
                        onChange={(e) => update(i, { category: e.target.value })}
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        value={r.description}
                        disabled={readOnly}
                        onChange={(e) => update(i, { description: e.target.value })}
                      />
                    </td>
                    <td className="p-1 text-right">
                      <Input
                        type="number"
                        step="0.01"
                        className="text-right"
                        value={r.qty}
                        disabled={readOnly}
                        onChange={(e) => update(i, { qty: parseFloat(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        value={r.unit}
                        disabled={readOnly}
                        onChange={(e) => update(i, { unit: e.target.value })}
                      />
                    </td>
                    <td className="p-1 text-right">
                      <Input
                        type="number"
                        step="0.01"
                        className="text-right"
                        value={r.unit_price}
                        disabled={readOnly}
                        onChange={(e) =>
                          update(i, {
                            unit_price: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                    <td className="p-1 text-right text-sm tabular-nums">
                      {formatCurrency(line, proposal.currency_code)}
                    </td>
                    <td className="p-1 text-right">
                      {!readOnly && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(i)}
                          aria-label="Remove line"
                        >
                          <Trash2 size={14} aria-hidden />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-4">
        <Tile label="Subtotal" value={formatCurrency(subtotal, proposal.currency_code)} />
        <Tile
          label={`Contingency (${proposal.contingency_pct}%)`}
          value={formatCurrency(contingencyAmt, proposal.currency_code)}
        />
        <Tile
          label={`Margin (${proposal.margin_pct}%)`}
          value={formatCurrency(marginAmt, proposal.currency_code)}
        />
        <Tile label="Total" value={formatCurrency(total, proposal.currency_code)} strong />
      </div>
    </Card>
  );
}

function Tile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          strong
            ? "text-lg font-semibold tabular-nums text-foreground"
            : "text-sm tabular-nums text-foreground"
        }
      >
        {value}
      </div>
    </div>
  );
}
