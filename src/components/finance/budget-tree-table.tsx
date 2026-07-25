// P-075 — Budget tree table: cost codes grouped by parent + budget columns.
import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  flattenTree,
  formatMoney,
  groupCostCodesByParent,
  variance,
  varianceBand,
  varianceClass,
  type CostCodeTreeNode,
} from "@/lib/budget.rules";
import type { BudgetRow, CostCodeRow } from "@/lib/budget.functions";

interface Props {
  costCodes: CostCodeRow[];
  budgets: BudgetRow[];
  defaultCurrency: string;
  canWriteBudgets: boolean;
  canWriteCostCodes: boolean;
  onEditCostCode: (id: string) => void;
  onEditBudget: (costCodeId: string) => void;
  savingBudgetForCode: string | null;
  onQuickSaveBudget: (costCodeId: string, original: number, currency: string) => void;
}

export function BudgetTreeTable({
  costCodes,
  budgets,
  defaultCurrency,
  canWriteBudgets,
  canWriteCostCodes,
  onEditCostCode,
  onEditBudget,
  savingBudgetForCode,
  onQuickSaveBudget,
}: Props) {
  const tree = useMemo(
    () =>
      groupCostCodesByParent(
        costCodes.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          description: c.description,
          parent_id: c.parent_id,
          wbs_item_id: c.wbs_item_id,
          is_active: c.is_active,
        })),
      ),
    [costCodes],
  );
  const flat = useMemo(() => flattenTree(tree), [tree]);

  const budgetByCode = useMemo(() => {
    const m = new Map<string, BudgetRow>();
    for (const b of budgets) {
      const prev = m.get(b.cost_code_id);
      if (!prev || b.version > prev.version) m.set(b.cost_code_id, b);
    }
    return m;
  }, [budgets]);

  const costCodeById = useMemo(() => {
    const m = new Map<string, CostCodeRow>();
    for (const c of costCodes) m.set(c.id, c);
    return m;
  }, [costCodes]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, { amount: string; currency: string }>>({});

  if (costCodes.length === 0) {
    return (
      <Card className="border-border bg-card p-8 text-center text-sm text-muted-foreground">
        No cost codes yet — start with a standard EPC breakdown (e.g. 01-1000 Engineering, 02-2000
        Equipment, 03-3000 Civil).
      </Card>
    );
  }

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const isCollapsedAncestor = (node: CostCodeTreeNode): boolean => {
    let p: CostCodeTreeNode | undefined = node;
    const byId = new Map(flat.map((n) => [n.id, n]));
    while (p?.parent_id) {
      p = byId.get(p.parent_id);
      if (p && collapsed.has(p.id)) return true;
    }
    return false;
  };

  return (
    <Card className="border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">WBS</th>
              <th className="px-3 py-2 text-right">Original</th>
              <th className="px-3 py-2 text-right">Approved Δ</th>
              <th className="px-3 py-2 text-right">Current</th>
              <th className="px-3 py-2 text-right">Committed</th>
              <th className="px-3 py-2 text-right">Actual</th>
              <th className="px-3 py-2 text-right">Variance</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {flat.map((node) => {
              if (isCollapsedAncestor(node)) return null;
              const cc = costCodeById.get(node.id);
              if (!cc) return null;
              const b = budgetByCode.get(node.id);
              const currency = b?.currency_code ?? defaultCurrency;
              const current = b?.current_amount ?? 0;
              const committed = b?.committed_amount ?? 0;
              const actual = b?.actual_amount ?? 0;
              const v = variance(current, committed, actual);
              const band = varianceBand(v, current);
              const hasChildren = node.children.length > 0;
              const isCollapsed = collapsed.has(node.id);
              const draft = drafts[node.id] ?? {
                amount: String(b?.original_amount ?? 0),
                currency,
              };
              const isSaving = savingBudgetForCode === node.id;
              return (
                <Fragment key={node.id}>
                  <tr className={cn("border-b border-border/60", !cc.is_active && "opacity-60")}>
                    <td className="px-3 py-2">
                      <div
                        className="flex items-center gap-1"
                        style={{ paddingLeft: `${node.depth * 16}px` }}
                      >
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={() => toggle(node.id)}
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                            aria-label={isCollapsed ? "Expand" : "Collapse"}
                          >
                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </button>
                        ) : (
                          <span className="inline-block w-4" />
                        )}
                        <span className="font-mono text-xs text-foreground">{cc.code}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-foreground">{cc.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {cc.wbs_code ? (
                        <span className="font-mono text-xs">
                          {cc.wbs_code}
                          {cc.wbs_name ? ` · ${cc.wbs_name}` : ""}
                        </span>
                      ) : (
                        <span className="text-xs italic">Unmapped</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canWriteBudgets ? (
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={draft.amount}
                            onChange={(e) =>
                              setDrafts((d) => ({
                                ...d,
                                [node.id]: {
                                  ...draft,
                                  amount: e.target.value,
                                },
                              }))
                            }
                            className="h-7 w-28 text-right text-xs"
                          />
                          <Select
                            value={draft.currency}
                            onValueChange={(v) =>
                              setDrafts((d) => ({
                                ...d,
                                [node.id]: { ...draft, currency: v },
                              }))
                            }
                          >
                            <SelectTrigger className="h-7 w-16 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CURRENCIES.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={isSaving}
                            onClick={() =>
                              onQuickSaveBudget(node.id, Number(draft.amount) || 0, draft.currency)
                            }
                          >
                            {isSaving ? "…" : "Save"}
                          </Button>
                        </div>
                      ) : (
                        <span>{formatMoney(b?.original_amount ?? 0, currency)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatMoney(b?.approved_changes ?? 0, currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-muted-foreground">
                      {formatMoney(current, currency)}
                    </td>
                    <td className="px-3 py-2 text-right text-foreground">
                      {formatMoney(committed, currency)}
                    </td>
                    <td className="px-3 py-2 text-right text-foreground">
                      {formatMoney(actual, currency)}
                    </td>
                    <td className={cn("px-3 py-2 text-right font-semibold", varianceClass(band))}>
                      {v >= 0 ? "" : "-"}
                      {formatMoney(Math.abs(v), currency)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {canWriteCostCodes && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => onEditCostCode(node.id)}
                            aria-label="Edit cost code"
                          >
                            <Pencil size={12} />
                          </Button>
                        )}
                        {canWriteBudgets && b && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => onEditBudget(node.id)}
                          >
                            Notes
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const CURRENCIES = ["USD", "EUR", "CNY", "MAD", "JOD", "AED"];
