// GC-02 — Hierarchical CBS drill-down table for the Costing overview.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Search, TableIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatMoney, formatPercent } from "@/lib/format";
import type { CbsRow } from "@/lib/costing.cbs";

export type CbsMetricKey =
  | "original"
  | "approved_changes"
  | "current"
  | "committed"
  | "actual"
  | "accruals"
  | "etc"
  | "eac"
  | "variance_at_completion"
  | "available"
  | "paid"
  | "outstanding";

export type CbsVarianceFilter = "all" | "over" | "under" | "no_budget" | "has_activity";

const COLUMNS: { key: CbsMetricKey; labelKey: string; fallback: string }[] = [
  { key: "original", labelKey: "original", fallback: "Original" },
  { key: "approved_changes", labelKey: "approvedChanges", fallback: "Approved changes" },
  { key: "current", labelKey: "current", fallback: "Current budget" },
  { key: "committed", labelKey: "committed", fallback: "Committed" },
  { key: "actual", labelKey: "actual", fallback: "Actual" },
  { key: "accruals", labelKey: "accruals", fallback: "Accruals" },
  { key: "etc", labelKey: "etc", fallback: "ETC" },
  { key: "eac", labelKey: "eac", fallback: "EAC" },
  { key: "variance_at_completion", labelKey: "vac", fallback: "VAC" },
  { key: "available", labelKey: "available", fallback: "Available" },
];

export interface CbsTableProps {
  rows: CbsRow[];
  currency: string;
  highlight?: CbsMetricKey | null;
  onSelect?: (row: CbsRow) => void;
  labels?: Partial<Record<string, string>>;
}

export function CbsTable({ rows, currency, highlight, onSelect, labels = {} }: CbsTableProps) {
  const L = (key: string, fallback: string) => labels[key] ?? fallback;
  const [query, setQuery] = useState("");
  const [variance, setVariance] = useState<CbsVarianceFilter>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const parentOf = useMemo(() => new Map(rows.map((r) => [r.id, r.parent_id])), [rows]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const textOk =
        q === "" || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
      const varOk =
        variance === "all"
          ? true
          : variance === "over"
            ? r.variance_at_completion < 0
            : variance === "under"
              ? r.variance_at_completion > 0
              : variance === "no_budget"
                ? r.current === 0
                : r.committed !== 0 || r.actual !== 0 || r.accruals !== 0 || r.etc !== 0;
      return textOk && varOk;
    });
  }, [rows, query, variance]);

  // Keep ancestors of every match visible so the hierarchy stays readable.
  const visibleIds = useMemo(() => {
    const keep = new Set<string>();
    for (const r of matches) {
      keep.add(r.id);
      let p = parentOf.get(r.id) ?? null;
      while (p) {
        keep.add(p);
        p = parentOf.get(p) ?? null;
      }
    }
    return keep;
  }, [matches, parentOf]);

  const isHidden = (row: CbsRow): boolean => {
    let p = row.parent_id;
    while (p) {
      if (collapsed.has(p)) return true;
      p = parentOf.get(p) ?? null;
    }
    return false;
  };

  const shown = rows.filter((r) => visibleIds.has(r.id) && !isHidden(r));

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () =>
    setCollapsed(new Set(rows.filter((r) => r.has_children).map((r) => r.id)));

  const exportCsv = () => {
    const header = [
      "code",
      "description",
      ...COLUMNS.map((c) => c.key),
      "paid",
      "outstanding",
      "percent_consumed",
      "currency",
    ];
    const lines = [header.join(",")];
    for (const r of shown) {
      lines.push(
        [
          csv(r.code),
          csv(r.name),
          ...COLUMNS.map((c) => String(r[c.key])),
          String(r.paid),
          String(r.outstanding),
          String(r.percent_consumed),
          currency,
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cbs-costing-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={TableIcon}
        title={L("emptyTitle", "No cost codes yet")}
        description={L("emptyBody", "Create cost codes to break the project budget down by CBS.")}
      />
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute start-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={L("search", "Search code or description")}
            className="ps-8"
            aria-label={L("search", "Search code or description")}
          />
        </div>
        <Select value={variance} onValueChange={(v) => setVariance(v as CbsVarianceFilter)}>
          <SelectTrigger className="w-52" aria-label={L("filter", "Variance filter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{L("filterAll", "All cost codes")}</SelectItem>
            <SelectItem value="over">{L("filterOver", "Over budget (VAC < 0)")}</SelectItem>
            <SelectItem value="under">{L("filterUnder", "Under budget (VAC > 0)")}</SelectItem>
            <SelectItem value="no_budget">{L("filterNoBudget", "No budget set")}</SelectItem>
            <SelectItem value="has_activity">{L("filterActivity", "Has cost activity")}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={expandAll}>
          {L("expandAll", "Expand all")}
        </Button>
        <Button variant="outline" size="sm" onClick={collapseAll}>
          {L("collapseAll", "Collapse all")}
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="size-4" />
          {L("exportCsv", "Export CSV")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="sticky start-0 z-10 bg-muted/50 px-3 py-2 text-start font-medium text-muted-foreground">
                {L("costCode", "Cost code")}
              </th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "whitespace-nowrap px-3 py-2 text-end font-medium text-muted-foreground",
                    highlight === c.key && "bg-primary/10 text-primary",
                  )}
                >
                  {L(c.labelKey, c.fallback)}
                </th>
              ))}
              <th className="whitespace-nowrap px-3 py-2 text-end font-medium text-muted-foreground">
                {L("consumed", "% consumed")}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                onClick={() => onSelect?.(r)}
                className={cn(
                  "cursor-pointer border-t border-border transition-colors hover:bg-muted/40",
                  r.is_unassigned && "bg-muted/20",
                )}
              >
                <td className="sticky start-0 z-10 bg-card px-3 py-2">
                  <div
                    className="flex items-center gap-1"
                    style={{ paddingInlineStart: `${r.depth * 14}px` }}
                  >
                    {r.has_children ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(r.id);
                        }}
                        aria-label={collapsed.has(r.id) ? "Expand" : "Collapse"}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                      >
                        {collapsed.has(r.id) ? (
                          <ChevronRight className="size-4" />
                        ) : (
                          <ChevronDown className="size-4" />
                        )}
                      </button>
                    ) : (
                      <span className="inline-block w-5" />
                    )}
                    <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                    <span className="truncate font-medium text-foreground">{r.name}</span>
                  </div>
                </td>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-end tabular-nums",
                      highlight === c.key && "bg-primary/5 font-semibold text-primary",
                      (c.key === "variance_at_completion" || c.key === "available") &&
                        r[c.key] < 0 &&
                        "text-destructive",
                    )}
                  >
                    {formatMoney(r[c.key], currency)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-end tabular-nums text-muted-foreground">
                  {formatPercent(r.percent_consumed)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function csv(value: string): string {
  const v = value ?? "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
