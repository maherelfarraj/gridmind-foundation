// P-077 — Pivot grid: rows = category × direction, columns = months.
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABELS,
  formatPeriod,
  type CashFlowRow,
  type PivotResult,
} from "@/lib/cash-flow.rules";

function fmt(n: number, currency: string): string {
  if (n === 0) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function CashFlowPivot(props: {
  pivot: PivotResult;
  rows: CashFlowRow[];
  baseCurrency: string;
  showOriginal: boolean;
  canVoid: boolean;
  onVoid: (row: CashFlowRow) => void;
}) {
  const { pivot, rows: rawRows, baseCurrency, showOriginal, canVoid, onVoid } = props;

  // Group original-currency amounts by (category|direction|period) for tooltip line.
  const originalByKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of rawRows) {
      if (r.voided) continue;
      if (r.currency_code === baseCurrency) continue;
      const p = r.period.slice(0, 7) + "-01";
      const k = `${r.category}::${r.direction}::${p}`;
      const list = map.get(k) ?? [];
      list.push(
        `${new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: r.currency_code,
          maximumFractionDigits: 0,
        }).format(Number(r.amount))} (${r.kind[0].toUpperCase()})`,
      );
      map.set(k, list);
    }
    return map;
  }, [rawRows, baseCurrency]);

  return (
    <div className="overflow-auto rounded-md border border-border">
      <Table className="min-w-[720px] text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-card">Category</TableHead>
            <TableHead>Dir</TableHead>
            {pivot.months.map((m) => (
              <TableHead key={m} className="text-right whitespace-nowrap">
                {formatPeriod(m)}
              </TableHead>
            ))}
            <TableHead className="text-right">Total (F)</TableHead>
            <TableHead className="text-right">Total (A)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pivot.rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={pivot.months.length + 4}
                className="py-10 text-center text-muted-foreground"
              >
                No cash-flow entries — add a forecast to start the curve.
              </TableCell>
            </TableRow>
          ) : (
            pivot.rows.map((pr) => (
              <TableRow key={`${pr.category}-${pr.direction}`}>
                <TableCell className="sticky left-0 z-10 bg-card font-medium">
                  {CATEGORY_LABELS[pr.category]}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={pr.direction === "inflow" ? "default" : "secondary"}
                    className="capitalize"
                  >
                    {pr.direction}
                  </Badge>
                </TableCell>
                {pivot.months.map((m) => {
                  const cell = pr.cells[m];
                  const key = `${pr.category}::${pr.direction}::${m}`;
                  const origs = showOriginal ? originalByKey.get(key) : undefined;
                  return (
                    <TableCell
                      key={m}
                      className="text-right whitespace-nowrap tabular-nums"
                      title={origs?.join(", ")}
                    >
                      <div
                        className={cn(
                          "text-foreground",
                          cell.forecast === 0 && "text-muted-foreground",
                        )}
                      >
                        {fmt(cell.forecast, baseCurrency)}
                      </div>
                      <div
                        className={cn(
                          "text-xs",
                          cell.actual === 0
                            ? "text-muted-foreground"
                            : "text-primary",
                        )}
                      >
                        {fmt(cell.actual, baseCurrency)}
                      </div>
                    </TableCell>
                  );
                })}
                <TableCell className="text-right tabular-nums">
                  {fmt(pr.totalForecast, baseCurrency)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-primary">
                  {fmt(pr.totalActual, baseCurrency)}
                </TableCell>
              </TableRow>
            ))
          )}
          {pivot.rows.length > 0 && (
            <TableRow className="bg-muted/40 font-medium">
              <TableCell className="sticky left-0 z-10 bg-muted/40">
                Column totals
              </TableCell>
              <TableCell />
              {pivot.months.map((m) => (
                <TableCell
                  key={m}
                  className="text-right whitespace-nowrap tabular-nums"
                >
                  <div>{fmt(pivot.columnTotals[m].forecast, baseCurrency)}</div>
                  <div className="text-xs text-primary">
                    {fmt(pivot.columnTotals[m].actual, baseCurrency)}
                  </div>
                </TableCell>
              ))}
              <TableCell />
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>

      {rawRows.some((r) => !r.voided) && (
        <div className="border-t border-border p-3">
          <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            Entries
          </div>
          <div className="grid gap-2">
            {rawRows
              .filter((r) => !r.voided)
              .map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{formatPeriod(r.period)}</span>
                    <Badge variant="outline" className="capitalize">
                      {r.kind}
                    </Badge>
                    <Badge
                      variant={r.direction === "inflow" ? "default" : "secondary"}
                      className="capitalize"
                    >
                      {r.direction}
                    </Badge>
                    <span className="text-muted-foreground">
                      {CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS]}
                    </span>
                    <span className="tabular-nums">
                      {new Intl.NumberFormat(undefined, {
                        style: "currency",
                        currency: r.currency_code,
                        maximumFractionDigits: 2,
                      }).format(Number(r.amount))}
                    </span>
                    {r.currency_code !== baseCurrency && r.amount_base != null && (
                      <span className="text-muted-foreground">
                        ≈{" "}
                        {new Intl.NumberFormat(undefined, {
                          style: "currency",
                          currency: baseCurrency,
                          maximumFractionDigits: 0,
                        }).format(r.amount_base)}{" "}
                        @ {r.fx_rate_to_base?.toFixed(4)}
                      </span>
                    )}
                    {r.notes && (
                      <span className="text-muted-foreground italic">
                        {r.notes}
                      </span>
                    )}
                  </div>
                  {canVoid && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onVoid(r)}
                      className="text-destructive hover:text-destructive"
                    >
                      Void
                    </Button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
