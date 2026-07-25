// P-080 — Milestone billing dialog. Reused inside a contract's SOV tab.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { billMilestone } from "@/lib/invoices.functions";
import { computeMilestoneBill } from "@/lib/invoices.rules";
import {
  contractBillingSummaryQueryOptions,
  invoiceErrorMessage,
} from "@/lib/invoices.query";

function fmt(n: number, currency: string | null) {
  return new Intl.NumberFormat(undefined, {
    style: currency ? "currency" : "decimal",
    currency: currency ?? undefined,
    maximumFractionDigits: 2,
  }).format(n);
}

export function MilestoneBillDialog({
  contractId,
  open,
  onOpenChange,
}: {
  contractId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const billFn = useServerFn(billMilestone);
  const summary = useQuery(contractBillingSummaryQueryOptions(contractId));
  const [lineNo, setLineNo] = useState<string>("");
  const [pct, setPct] = useState<string>("");

  const currency = summary.data?.currency_code ?? null;
  const selected = useMemo(
    () => summary.data?.lines.find((l) => String(l.line_no) === lineNo) ?? null,
    [summary.data, lineNo],
  );

  const preview = useMemo(() => {
    if (!selected) return null;
    const p = Number(pct);
    if (!Number.isFinite(p) || p <= 0 || p > 100) return null;
    try {
      return computeMilestoneBill(selected.scheduled_amount, selected.billed, p);
    } catch {
      return null;
    }
  }, [selected, pct]);

  const canSubmit =
    summary.data?.status &&
    ["signed", "active"].includes(summary.data.status) &&
    selected &&
    selected.remaining > 0 &&
    preview !== null;

  const mutation = useMutation({
    mutationFn: () =>
      billFn({
        data: {
          contract_id: contractId,
          sov_line_no: Number(lineNo),
          pct_to_bill: Number(pct),
        },
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["invoices"] });
      await qc.invalidateQueries({ queryKey: ["contracts", "detail", contractId] });
      await qc.invalidateQueries({ queryKey: ["invoices", "billing-summary", contractId] });
      toast.success(
        res.capped
          ? `Draft invoice created — capped to remaining ${res.cappedPct}%`
          : `Draft invoice created (${res.cappedPct}%)`,
      );
      onOpenChange(false);
      setLineNo("");
      setPct("");
    },
    onError: (err) => toast.error(invoiceErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bill milestone</DialogTitle>
          <DialogDescription>
            Create a draft receivable invoice against a Schedule of Values line.
          </DialogDescription>
        </DialogHeader>

        {summary.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : summary.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Could not load SOV. Try again.
          </div>
        ) : !summary.data || summary.data.lines.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            This contract has no Schedule of Values yet.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sov-line">SOV line</Label>
              <Select value={lineNo} onValueChange={setLineNo}>
                <SelectTrigger id="sov-line">
                  <SelectValue placeholder="Pick a line…" />
                </SelectTrigger>
                <SelectContent>
                  {summary.data.lines.map((l) => (
                    <SelectItem
                      key={l.line_no}
                      value={String(l.line_no)}
                      disabled={l.remaining <= 0}
                    >
                      #{l.line_no} — {l.description || "(untitled)"} · {l.pct_billed}% billed
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected && (
                <div className="text-xs text-muted-foreground">
                  Scheduled {fmt(selected.scheduled_amount, currency)} · Billed{" "}
                  {fmt(selected.billed, currency)} · Remaining{" "}
                  <span className="font-mono">{fmt(selected.remaining, currency)}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="pct">% complete to bill</Label>
              <Input
                id="pct"
                type="number"
                inputMode="decimal"
                step="0.1"
                min={0.1}
                max={100}
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                placeholder="e.g. 30"
              />
            </div>

            {preview && selected && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Invoice amount</span>
                  <span className="font-mono tabular-nums">{fmt(preview.amount, currency)}</span>
                </div>
                {preview.hitCap && (
                  <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Capped to remaining unbilled ({preview.cappedPct}% of scheduled).
                    </span>
                  </div>
                )}
              </div>
            )}

            {summary.data.status && !["signed", "active"].includes(summary.data.status) && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
                Milestone billing is only available on signed or active contracts.
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Creating…" : "Create draft invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
