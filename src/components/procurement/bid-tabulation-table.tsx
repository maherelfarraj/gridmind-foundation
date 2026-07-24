// P-063 — Leveled bid tabulation matrix with configurable TCO inputs.
import { useMemo, useState } from "react";
import { AlertTriangle, Trophy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { BidRow } from "@/lib/rfq.functions";
import {
  DEFAULT_TCO_CONFIG,
  computeTcoMatrix,
  type BidInput,
  type RfqLine,
} from "@/lib/rfq-rules";

function fmtMoney(n: number | null | undefined, currency: string) {
  if (n == null || Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

function fmtPct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  const s = n > 0 ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
}

export function BidTabulationTable({
  rfqLines,
  bids,
  currency,
}: {
  rfqLines: RfqLine[];
  bids: BidRow[];
  currency: string;
}) {
  const [delayCostPctPerDay, setDelay] = useState(
    DEFAULT_TCO_CONFIG.delayCostPctPerDay,
  );
  const [logisticsPct, setLogistics] = useState(DEFAULT_TCO_CONFIG.logisticsPct);
  const [defectRiskPct, setDefect] = useState(DEFAULT_TCO_CONFIG.defectRiskPct);

  const bidInputs = useMemo<BidInput[]>(
    () =>
      bids.map((b) => ({
        bidId: b.id,
        vendorId: b.vendor_id,
        vendorName: b.vendor_name,
        status: b.status,
        validityDate: b.validity_date,
        totalPrice: b.total_price,
        currencyCode: b.currency_code,
        leadTimeDays: b.lead_time_days,
        lines: b.lines,
      })),
    [bids],
  );

  const matrix = useMemo(
    () =>
      computeTcoMatrix({
        rfqLines,
        bids: bidInputs,
        config: { delayCostPctPerDay, logisticsPct, defectRiskPct },
      }),
    [rfqLines, bidInputs, delayCostPctPerDay, logisticsPct, defectRiskPct],
  );

  if (bids.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No bids submitted yet — invite vendors and record their quotes to run the
        TCO leveling.
      </div>
    );
  }

  const overallWinner = matrix.rows.find(
    (r) => r.bidId === matrix.overallWinnerBidId,
  );

  return (
    <div className="space-y-4">
      {/* KPI + config strip */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid grid-cols-3 gap-3 rounded-md border border-border p-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Lowest TCO
            </div>
            <div className="text-sm font-semibold">
              {overallWinner ? overallWinner.vendorName : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {overallWinner
                ? fmtMoney(overallWinner.vendorTotalTco, currency)
                : "no fully-compliant bid"}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Avg. price vs target
            </div>
            <div className="text-sm font-semibold">
              {fmtPct(matrix.averagePriceVariancePct)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Non-compliant
            </div>
            <div className="text-sm font-semibold">
              {matrix.nonCompliantCount} / {matrix.rows.length}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 rounded-md border border-border p-4">
          <div className="space-y-1">
            <Label className="text-xs">Delay cost (%/day)</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={delayCostPctPerDay}
              onChange={(e) => setDelay(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Logistics (%)</Label>
            <Input
              type="number"
              step="0.1"
              min={0}
              value={logisticsPct}
              onChange={(e) => setLogistics(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Defect risk (%)</Label>
            <Input
              type="number"
              step="0.1"
              min={0}
              value={defectRiskPct}
              onChange={(e) => setDefect(Number(e.target.value) || 0)}
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">Vendor</TableHead>
              {rfqLines.map((l) => (
                <TableHead key={l.line_no} className="min-w-[180px]">
                  <div className="font-medium">
                    #{l.line_no} · {l.description}
                  </div>
                  <div className="text-xs font-normal text-muted-foreground">
                    Target {fmtMoney(l.target_price ?? null, currency)} · qty{" "}
                    {l.qty} {l.uom}
                  </div>
                </TableHead>
              ))}
              <TableHead className="min-w-[140px] text-right">
                Vendor total TCO
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matrix.rows.map((row) => {
              const isVendorWinner = row.bidId === matrix.overallWinnerBidId;
              return (
                <TableRow key={row.bidId}>
                  <TableCell className="align-top">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{row.vendorName}</span>
                      {isVendorWinner && (
                        <Trophy className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    {!row.compliant && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="destructive"
                              className="mt-1 gap-1"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              Non-compliant
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            <ul className="space-y-1">
                              {row.issues.map((i, idx) => (
                                <li key={idx}>
                                  {i.kind === "missing_line" &&
                                    `Missing line #${i.line_no}`}
                                  {i.kind === "expired_validity" &&
                                    `Validity expired ${i.validityDate}`}
                                  {i.kind === "invalid_status" &&
                                    `Bid status: ${i.status}`}
                                </li>
                              ))}
                            </ul>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground capitalize">
                      {row.status.replace("_", " ")}
                    </div>
                  </TableCell>
                  {rfqLines.map((l) => {
                    const cell = row.cells.get(l.line_no);
                    const isWinner =
                      matrix.winnersByLine.get(l.line_no) === row.bidId;
                    return (
                      <TableCell
                        key={l.line_no}
                        className={`align-top ${
                          isWinner ? "bg-primary/10" : ""
                        }`}
                      >
                        {cell ? (
                          <div className="space-y-0.5">
                            <div className="font-medium">
                              {fmtMoney(cell.tco, currency)}
                              {isWinner && (
                                <span className="ml-1 text-xs text-primary">
                                  ★
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {fmtMoney(cell.unit_price, currency)} /{" "}
                              {cell.qty} · ext{" "}
                              {fmtMoney(cell.extended, currency)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Δ target {fmtPct(cell.price_variance_pct)} · lead{" "}
                              {cell.lead_time_days ?? "—"}d (+{cell.delay_days}
                              )
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-destructive">
                            not quoted
                          </span>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right align-top font-semibold">
                    {fmtMoney(row.vendorTotalTco, currency)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
