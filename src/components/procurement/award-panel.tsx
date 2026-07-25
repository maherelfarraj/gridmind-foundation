// P-064 — Award selector panel + Generate POs action on the RFQ Tabulation tab.
import { useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, PackagePlus, X } from "lucide-react";

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
import { listRfqAwards } from "@/lib/po.functions";
import {
  rfqAwardsQueryOptions,
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

  const awardLine = useAwardLine(rfq.id);
  const unaward = useUnawardLine(rfq.id);
  const generate = useGeneratePos(rfq.id);

  const awardByLine = useMemo(() => new Map(awards.map((a) => [a.line_no, a])), [awards]);

  const eligibleBids = useMemo(
    () => bids.filter((b) => ["submitted", "under_review", "awarded"].includes(b.status)),
    [bids],
  );

  const [selection, setSelection] = useState<Record<number, string>>({});

  const allAwarded = rfq.lines.every((l) => awardByLine.has(l.line_no));
  const isDisabled = rfq.status !== "issued" || !canAward;

  return (
    <section className="space-y-3 rounded-md border border-border p-4">
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
          <span>
            {awards.length} / {rfq.lines.length} awarded
          </span>
          {canAward && (
            <Button
              size="sm"
              onClick={() => generate.mutate()}
              disabled={!allAwarded || generate.isPending}
            >
              <PackagePlus className="mr-2 h-4 w-4" />
              {generate.isPending ? "Generating…" : "Generate POs"}
            </Button>
          )}
        </div>
      </div>

      {rfq.status !== "issued" && (
        <p className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground">
          Awards can only be recorded while the RFQ is issued.
        </p>
      )}

      <Table>
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
                <TableRow key={line.line_no}>
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
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        <span className="font-medium">
                          {winningBid?.vendor_name ?? "Unknown vendor"}
                        </span>
                      </div>
                    ) : (
                      <Select
                        value={pending}
                        onValueChange={(v) => setSelection((s) => ({ ...s, [line.line_no]: v }))}
                        disabled={isDisabled || eligibleBids.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select bid…" />
                        </SelectTrigger>
                        <SelectContent>
                          {eligibleBids
                            .filter((b) => b.lines.some((bl) => bl.line_no === line.line_no))
                            .map((b) => {
                              const bl = b.lines.find((x) => x.line_no === line.line_no);
                              return (
                                <SelectItem key={b.id} value={b.id}>
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
                          aria-label={`Unaward line ${line.line_no}`}
                          onClick={() => unaward.mutate(existing.id)}
                          disabled={unaward.isPending}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
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
    </section>
  );
}
