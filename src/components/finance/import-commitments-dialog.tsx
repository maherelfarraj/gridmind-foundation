// P-075 — Import PO commitments dialog.
import { useMemo, useState } from "react";
import { Import } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { formatMoney } from "@/lib/budget.rules";
import type { CostCodeRow, EligiblePoRow } from "@/lib/budget.functions";

const NONE = "__none";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  pos: EligiblePoRow[];
  costCodes: CostCodeRow[];
  saving: boolean;
  onSubmit: (assignments: Array<{ po_id: string; cost_code_id: string | null }>) => void;
}

export function ImportCommitmentsDialog({
  open,
  onOpenChange,
  loading,
  pos,
  costCodes,
  saving,
  onSubmit,
}: Props) {
  const [assign, setAssign] = useState<Record<string, string | null>>({});

  const runningTotals = useMemo(() => {
    const m = new Map<string, { total: number; currency: string }>();
    for (const po of pos) {
      const cc = assign[po.id];
      if (!cc) continue;
      const t = m.get(cc) ?? { total: 0, currency: po.currency_code };
      t.total += po.total_amount;
      m.set(cc, t);
    }
    return m;
  }, [assign, pos]);

  const activeCostCodes = costCodes.filter((c) => c.is_active);

  const assignedCount = Object.values(assign).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Import size={16} aria-hidden />
            Import PO commitments
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : pos.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            No eligible purchase orders — POs must be approved or issued before they count as
            commitments.
          </div>
        ) : activeCostCodes.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            Create at least one active cost code before importing commitments.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <ScrollArea className="max-h-[420px]">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left">PO</th>
                    <th className="px-2 py-1 text-left">Vendor</th>
                    <th className="px-2 py-1 text-right">Total</th>
                    <th className="px-2 py-1 text-left">Cost code</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map((po) => (
                    <tr key={po.id} className="border-t border-border/60">
                      <td className="px-2 py-1 font-mono text-xs">{po.po_number}</td>
                      <td className="px-2 py-1 text-muted-foreground">{po.vendor_name ?? "—"}</td>
                      <td className="px-2 py-1 text-right">
                        {formatMoney(po.total_amount, po.currency_code)}
                      </td>
                      <td className="px-2 py-1">
                        <Select
                          value={assign[po.id] ?? NONE}
                          onValueChange={(v) =>
                            setAssign((a) => ({
                              ...a,
                              [po.id]: v === NONE ? null : v,
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 w-56 text-xs">
                            <SelectValue placeholder="Unassigned" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Unassigned</SelectItem>
                            {activeCostCodes.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.code} — {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>

            {runningTotals.size > 0 && (
              <div className="rounded-md border border-border bg-muted/20 p-3 text-xs">
                <div className="mb-1 font-medium text-muted-foreground">
                  Running totals per cost code
                </div>
                <ul className="flex flex-wrap gap-x-4 gap-y-1">
                  {[...runningTotals.entries()].map(([ccId, t]) => {
                    const cc = costCodes.find((c) => c.id === ccId);
                    return (
                      <li key={ccId} className="text-foreground">
                        <span className="font-mono">{cc?.code}</span>{" "}
                        {formatMoney(t.total, t.currency)}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={saving || assignedCount === 0}
            onClick={() =>
              onSubmit(
                Object.entries(assign)
                  .filter(([, v]) => v)
                  .map(([po_id, cost_code_id]) => ({ po_id, cost_code_id })),
              )
            }
          >
            {saving ? "Importing…" : `Import ${assignedCount} PO(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
