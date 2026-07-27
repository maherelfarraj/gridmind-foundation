// P-064 — Award selector panel + Generate POs action on the RFQ Tabulation tab.
// Day-2 hardening: all controls carry `award-panel`-scoped test ids so they can
// never be confused with the bid-tabulation matrix above; Award is idempotent;
// Unaward requires confirmation and is locked once a PO exists.
import { useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Lock, PackagePlus, X } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listRfqAwards, rfqHasPos } from "@/lib/po.functions";
import {
  rfqAwardsQueryOptions,
  rfqHasPosQueryOptions,
  useAwardLine,
  useGeneratePos,
  useUnawardLine,
} from "@/lib/po-query";
import type { BidRow, RfqRow } from "@/lib/rfq.functions";


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

export function AwardPanel({
  rfq,
  bids,
  canAward,
}: {
  rfq: RfqRow;
  bids: BidRow[];
  canAward: boolean;
}) {
  const awardsFn = useServerFn(listRfqAwards);
  const awardsQuery = useSuspenseQuery(rfqAwardsQueryOptions(awardsFn, rfq.id));
  const awards = awardsQuery.data;

  const hasPosFn = useServerFn(rfqHasPos);
  const posQuery = useSuspenseQuery(rfqHasPosQueryOptions(hasPosFn, rfq.id));
  const posExist = posQuery.data.hasPos;

  const awardLine = useAwardLine(rfq.id);
  const unaward = useUnawardLine(rfq.id);
  const generate = useGeneratePos(rfq.id);

  const awardByLine = useMemo(() => new Map(awards.map((a) => [a.line_no, a])), [awards]);

  const eligibleBids = useMemo(
    () => bids.filter((b) => ["submitted", "under_review", "awarded"].includes(b.status)),
    [bids],
  );

  const [selection, setSelection] = useState<Record<number, string>>({});
  const [confirmUnaward, setConfirmUnaward] = useState<{
    awardId: string;
    lineNo: number;
  } | null>(null);

  const allAwarded = rfq.lines.every((l) => awardByLine.has(l.line_no));
  const isDisabled = rfq.status !== "issued" || !canAward;

  return (
    <section
      data-testid="award-panel"
      className="space-y-3 rounded-md border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide">
            Line awards
          </h3>
          <p className="text-xs text-muted-foreground">
            Pick a bid per line, then generate POs grouped by vendor.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span data-testid="award-panel-progress">
            {awards.length} / {rfq.lines.length} awarded
          </span>
          {canAward && (
            <Button
              size="sm"
              data-testid="award-panel-generate-pos"
              onClick={() => generate.mutate()}
              disabled={!allAwarded || generate.isPending}
            >
              <PackagePlus className="mr-2 h-4 w-4" />
              {generate.isPending ? "Generating…" : "Generate POs"}
            </Button>
          )}
        </div>
      </div>

      {posExist && (
        <p
          data-testid="award-panel-locked-notice"
          className="flex items-center gap-2 rounded border border-dashed border-border p-3 text-xs text-muted-foreground"
        >
          <Lock className="h-3.5 w-3.5" />
          Purchase orders exist for this RFQ — awards are locked and can no longer be removed.
        </p>
      )}


      {rfq.status !== "issued" && (
        <p className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground">
          Awards can only be recorded while the RFQ is issued.
        </p>
      )}

      <Table data-testid="award-panel-table">
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">#</TableHead>
            <TableHead>Line</TableHead>
            <TableHead className="w-[280px]">Awarded bid</TableHead>
            <TableHead className="w-40 text-right">Amount</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rfq.lines.map((line) => {
            const existing = awardByLine.get(line.line_no);
            const winningBid = existing
              ? (bids.find((b) => b.id === existing.rfq_bid_id) ?? null)
              : null;
            const pending = selection[line.line_no] ?? (existing ? existing.rfq_bid_id : "");

            return (
              <TableRow
                key={line.line_no}
                data-testid={`award-row-${line.line_no}`}
                data-awarded={existing ? "true" : "false"}
                className={existing ? "bg-muted/40" : undefined}
              >
                <TableCell className="font-mono">{line.line_no}</TableCell>
                <TableCell>
                  <div className="font-medium">{line.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {line.qty} {line.uom}
                    {line.spec ? ` · ${line.spec}` : ""}
                  </div>
                </TableCell>
                <TableCell>
                  {existing ? (
                    <div
                      data-testid={`award-locked-${line.line_no}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      <span className="font-medium">
                        {winningBid?.vendor_name ?? "Unknown vendor"}
                      </span>
                      <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  ) : (
                    <Select
                      value={pending}
                      onValueChange={(v) => setSelection((s) => ({ ...s, [line.line_no]: v }))}
                      disabled={isDisabled || eligibleBids.length === 0}
                    >
                      <SelectTrigger data-testid={`award-select-${line.line_no}`}>
                        <SelectValue placeholder="Select bid…" />
                      </SelectTrigger>
                      <SelectContent>
                        {eligibleBids
                          .filter((b) => b.lines.some((bl) => bl.line_no === line.line_no))
                          .map((b) => {
                            const bl = b.lines.find((x) => x.line_no === line.line_no);
                            return (
                              <SelectItem
                                key={b.id}
                                value={b.id}
                                data-testid={`award-option-${line.line_no}-${b.id}`}
                              >
                                {b.vendor_name}
                                {bl
                                  ? ` — ${fmtMoney(
                                      Number(bl.unit_price) * Number(bl.qty),
                                      rfq.currency_code,
                                    )}`
                                  : ""}
                              </SelectItem>
                            );
                          })}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {existing ? fmtMoney(existing.awarded_amount, rfq.currency_code) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {existing ? (
                    canAward && (
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid={`award-unaward-${line.line_no}`}
                        aria-label={`Unaward line ${line.line_no}`}
                        title={
                          posExist
                            ? "Locked — a purchase order already exists for this award"
                            : `Unaward line ${line.line_no}`
                        }
                        onClick={() =>
                          setConfirmUnaward({ awardId: existing.id, lineNo: line.line_no })
                        }
                        disabled={posExist || unaward.isPending}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`award-submit-${line.line_no}`}
                      onClick={() => {
                        // Idempotent: never toggles an existing award off.
                        if (awardByLine.has(line.line_no)) return;
                        const bidId = pending;
                        if (!bidId) return;
                        awardLine.mutate({
                          rfqId: rfq.id,
                          bidId,
                          lineNo: line.line_no,
                        });
                      }}
                      disabled={isDisabled || !pending || awardLine.isPending}
                    >
                      Award
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <AlertDialog
        open={confirmUnaward !== null}
        onOpenChange={(open) => !open && setConfirmUnaward(null)}
      >
        <AlertDialogContent data-testid="award-unaward-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove the award on line {confirmUnaward?.lineNo}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This reverses a procurement decision. The award record is deleted, the winning
              bid returns to its pre-award status, and the reversal is written to the audit
              log against your user.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="award-unaward-cancel">Keep award</AlertDialogCancel>
            <AlertDialogAction
              data-testid="award-unaward-confirm-action"
              onClick={() => {
                if (confirmUnaward) unaward.mutate(confirmUnaward.awardId);
                setConfirmUnaward(null);
              }}
            >
              Remove award
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>

  );
}
